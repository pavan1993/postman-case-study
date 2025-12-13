import fs from "fs";
import fetch from "node-fetch";

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

const RETRY_STATUSES = new Set([500, 502, 503, 504, 429]);
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
  return errName ? errName.toLowerCase().includes("ratelimit") : false;
}

function rateLimitDelay(headers) {
  if (!headers || typeof headers.get !== "function") return null;
  const resetRaw = headers.get("x-ratelimit-reset");
  if (!resetRaw) return null;

  const resetEpoch = Number(resetRaw);
  if (!Number.isFinite(resetEpoch)) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const deltaSec = resetEpoch - nowSec;
  if (!Number.isFinite(deltaSec) || deltaSec <= 0) return null;

  return deltaSec * 1000;
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
    const shouldRetry =
      (RETRY_STATUSES.has(res.status) || isRateLimited(res.status, json)) &&
      attempt < MAX_RETRIES;

    if (shouldRetry) {
      const rateLimited = isRateLimited(res.status, json);
      let delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);

      if (rateLimited) {
        const resetDelay = rateLimitDelay(res.headers);
        if (resetDelay) {
          delay = Math.max(delay, resetDelay);
        } else {
          delay *= 2;
        }
      }

      console.warn(
        `⚠️ ${method} ${url} failed with ${res.status}. Retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`
      );
      await sleep(delay + Math.floor(Math.random() * 250));
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

async function deleteCollection(uid) {
  return http("DELETE", `${BASE}/collections/${uid}`);
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
    console.log("Deleting collection before recreate to avoid flaky updates…");
    await deleteCollection(existingUid);
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
