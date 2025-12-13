import fs from "fs";
import fetch from "node-fetch";

/*
 * Retry summary:
 * - Retries HTTP 500/502/503/504 responses plus any call that is rate-limited (HTTP 429 or JSON error names containing "rateLimited").
 * - Maximum of 4 attempts per request, using exponential backoff (BASE_DELAY_MS * 2^(attempt-1)) with a small jitter.
 * - When rate-limited, it first honors Retry-After / X-RateLimit-* headers if present; otherwise it falls back to the exponential delay.
 * - Logs whether the retry is due to a 5xx or a rate limit and shows the wait time and attempt count.
 * - Non-rate-limit 4xx errors fail fast so we surface actual request issues quickly.
 */

const API_KEY = process.env.POSTMAN_API_KEY;
const WORKSPACE_ID = process.env.POSTMAN_WORKSPACE_ID;
const COLLECTION_FILE = process.env.POSTMAN_COLLECTION_FILE; // e.g. artifacts/collection.mock.json
const COLLECTION_NAME = process.env.POSTMAN_COLLECTION_NAME; // e.g. Payments / payment-refund-api (Mock)

if (!API_KEY || !WORKSPACE_ID || !COLLECTION_FILE || !COLLECTION_NAME) {
  console.error(
    "Missing one of: POSTMAN_API_KEY, POSTMAN_WORKSPACE_ID, POSTMAN_COLLECTION_FILE, POSTMAN_COLLECTION_NAME"
  );
  process.exit(1);
}

const BASE = "https://api.getpostman.com";

const RETRY_STATUSES = new Set([500, 502, 503, 504]);
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1000;
const MIN_INTERVAL_MS = 2000;
let lastApiCall = 0;

function headers() {
  return {
    "X-Api-Key": API_KEY,
    "Content-Type": "application/json",
    "Accept": "application/vnd.api.v10+json",
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle() {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastApiCall);
  if (wait > 0) await sleep(wait);
  lastApiCall = Date.now();
}

function isRateLimited(status, responseBody) {
  if (status === 429) return true;
  const errName = responseBody?.error?.name || responseBody?.error?.code;
  if (!errName) return false;
  return errName.toLowerCase().includes("ratelimit");
}

function parseRetryAfterSeconds(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric * 1000;
  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) {
    const diff = asDate - Date.now();
    return diff > 0 ? diff : null;
  }
  return null;
}

function rateLimitDelay(headers) {
  if (!headers || typeof headers.get !== "function") return null;

  const retryAfterKeys = ["retry-after", "x-ratelimit-retryafter"];
  for (const key of retryAfterKeys) {
    const val = headers.get(key);
    const parsed = parseRetryAfterSeconds(val);
    if (parsed) return parsed;
  }

  const resetRaw = headers.get("x-ratelimit-reset");
  if (resetRaw) {
    const resetEpoch = Number(resetRaw);
    if (Number.isFinite(resetEpoch)) {
      const nowSec = Math.floor(Date.now() / 1000);
      const deltaSec = resetEpoch - nowSec;
      if (Number.isFinite(deltaSec) && deltaSec > 0) {
        return deltaSec * 1000;
      }
    }
  }

  return null;
}

async function http(method, url, body, attempt = 1) {
  await throttle();
  const res = await fetch(url, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const rateLimited = isRateLimited(res.status, json);
    const shouldRetry =
      (RETRY_STATUSES.has(res.status) || rateLimited) && attempt < MAX_RETRIES;

    if (shouldRetry) {
      const baseDelay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      const recommendedDelay = rateLimited ? rateLimitDelay(res.headers) : null;
      let delay = rateLimited && recommendedDelay ? Math.max(baseDelay, recommendedDelay) : baseDelay;
      const jittered = delay + Math.floor(Math.random() * 250);
      const reason = rateLimited ? "Rate limit retry" : "5xx retry";
      console.warn(
        `⚠️ ${reason}: ${method} ${url} -> ${res.status}. Waiting ${jittered}ms before attempt ${
          attempt + 1
        }/${MAX_RETRIES}`
      );
      await sleep(jittered);
      return http(method, url, body, attempt + 1);
    }

    const err = new Error(`${method} ${url} failed: ${res.status}\n${text}`);
    err.status = res.status;
    err.response = json;
    throw err;
  }

  return json;
}

async function listCollectionsInWorkspace() {
  const out = await http("GET", `${BASE}/collections?workspace=${WORKSPACE_ID}`);
  return out?.collections || [];
}

async function findUidByName(name) {
  const items = await listCollectionsInWorkspace();
  const match = items.find((c) => c?.name === name);
  return match?.uid || null;
}

async function createInWorkspace(payload) {
  return http("POST", `${BASE}/collections?workspace=${WORKSPACE_ID}`, payload);
}

async function fetchCollection(uid) {
  return http("GET", `${BASE}/collections/${uid}`);
}

async function updateCollection(uid, payload) {
  return http("PUT", `${BASE}/collections/${uid}`, payload);
}

function approxBytes(obj) {
  return Buffer.byteLength(JSON.stringify(obj), "utf8");
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(COLLECTION_FILE, "utf8"));

  if (payload?.collection?.info?.name) {
    payload.collection.info.name = COLLECTION_NAME;
  }

  const bytes = approxBytes(payload);
  console.log(`Payload size: ${Math.round(bytes / 1024)} KB (${bytes} bytes)`);

  const existingUid = await findUidByName(COLLECTION_NAME);

  if (existingUid) {
    console.log("Found existing collection:", COLLECTION_NAME, "uid:", existingUid);
    try {
      const current = await fetchCollection(existingUid);
      const info = current?.collection?.info || {};
      if (payload?.collection?.info) {
        payload.collection.info._postman_id = info._postman_id || info.id || existingUid;
        payload.collection.info.id = info.id || info._postman_id || existingUid;
      }
    } catch (err) {
      console.warn("⚠️ Failed to fetch existing collection details; continuing with provided payload.", err?.message || err);
    }
    console.log("Updating collection:", COLLECTION_NAME, "uid:", existingUid);
    await updateCollection(existingUid, payload);
    console.log("✅ Updated");
    return;
  }

  console.log("Creating collection:", COLLECTION_NAME);
  const out = await createInWorkspace(payload);
  console.log("✅ Created uid:", out?.collection?.uid);
}

main().catch((e) => {
  console.error("❌ Upsert failed.");
  if (e?.status) console.error("Status:", e.status);
  if (e?.response) console.error("Response:", JSON.stringify(e.response, null, 2));
  console.error(e);
  process.exit(1);
});
