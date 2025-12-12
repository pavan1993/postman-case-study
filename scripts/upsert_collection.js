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

// Retry config
const RETRY_STATUSES = new Set([500, 502, 503, 504, 429]);
const MAX_RETRIES = 6; // total attempts = 1 + retries
const BASE_DELAY_MS = 800;

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

function isRateLimited(status, responseBody) {
  if (status === 429) return true;
  const errName = responseBody?.error?.name || responseBody?.error?.code;
  return errName ? errName.toLowerCase().includes("ratelimit") : false;
}

async function http(method, url, body, attempt = 1) {
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
      // Rate-limit the next attempt more aggressively so we do not trip global quotas.
      const backoffMultiplier = isRateLimited(res.status, json) ? 2 : 1;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) * backoffMultiplier;
      console.warn(
        `⚠️ ${method} ${url} failed with ${res.status}. Retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`
      );
      // Small jitter to avoid thundering herd
      await sleep(delay + Math.floor(Math.random() * 250));
      return http(method, url, body, attempt + 1);
    }

    // Non-retryable or exhausted retries
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

async function update(uid, payload) {
  return http("PUT", `${BASE}/collections/${uid}`, payload);
}

function approxBytes(obj) {
  return Buffer.byteLength(JSON.stringify(obj), "utf8");
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(COLLECTION_FILE, "utf8"));

  // Defensive: enforce the collection name we intend
  if (payload?.collection?.info?.name) {
    payload.collection.info.name = COLLECTION_NAME;
  }

  // Sanity check payload size (helps diagnose deterministic 500s)
  const bytes = approxBytes(payload);
  console.log(`Payload size: ${Math.round(bytes / 1024)} KB (${bytes} bytes)`);

  const existingUid = await findUidByName(COLLECTION_NAME);

  if (existingUid) {
    console.log("Updating collection:", COLLECTION_NAME, "uid:", existingUid);
    await update(existingUid, payload);
    console.log("✅ Updated");
  } else {
    console.log("Creating collection:", COLLECTION_NAME);
    const out = await createInWorkspace(payload);
    console.log("✅ Created uid:", out?.collection?.uid);
  }
}

main().catch((e) => {
  console.error("❌ Upsert failed.");
  if (e?.status) console.error("Status:", e.status);
  if (e?.response) console.error("Response:", JSON.stringify(e.response, null, 2));
  console.error(e);
  process.exit(1);
});
