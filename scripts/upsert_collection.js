import fs from "fs";
import crypto from "crypto";
import fetch from "node-fetch";

/*
 * Retry summary:
 * - Retries HTTP 500/502/503/504 responses with exponential backoff (BASE_DELAY_MS * 2^n) plus a small jitter, up to 4 attempts.
 * - Retries rate-limit responses (HTTP 429 or JSON bodies whose error name/code contains "ratelimit") up to 3 attempts.
 * - Rate-limit retries honor Retry-After / X-RateLimit-* headers when present; otherwise they wait at least 30 seconds before retrying.
 * - Logs clearly distinguish between 5xx retries and rate-limit retries, showing wait time and attempt counts.
 * - Non-rate-limit 4xx errors fail immediately so request issues surface quickly.
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
const DEBUG = process.env.POSTMAN_DEBUG === "1";

const RETRY_STATUSES = new Set([500, 502, 503, 504]);
const MAX_5XX_RETRIES = 4;
const MAX_RATELIMIT_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const RATE_LIMIT_MIN_DELAY_MS = 30000;
const PRE_WRITE_DELAY_MS = 1500;
const MIN_INTERVAL_MS = 2000;
let lastApiCall = 0;
let payloadMetrics = null;
let lastPutSucceeded = false;
let lastPutError = null;
let lastFailedPutResponse = null;
let debugProbesRun = false;
let rateLimitedSeen = false;
let versionedPublishUsed = false;
let versionedPublishUsed = false;

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

function parseRetryAfter(value) {
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
    const parsed = parseRetryAfter(headers.get(key));
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

async function http(method, url, body, counters = { fivexx: 0, rate: 0, isProbe: false }) {
  await throttle();
  const start = Date.now();
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

  if (DEBUG) {
    const truncated = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
    const headerLogKeys = ["x-ratelimit-remaining", "x-ratelimit-reset", "x-ratelimit-retryafter", "retry-after", "x-request-id"];
    const headerLog = {};
    for (const key of headerLogKeys) {
      const val = res.headers.get(key);
      if (val) headerLog[key] = val;
    }
    console.log(
      `[DEBUG] ${method} ${url}${counters.isProbe ? " [probe]" : ""} -> ${res.status} (${Date.now() - start}ms)\nHeaders: ${JSON.stringify(
        headerLog
      )}\nBody: ${truncated}`
    );
  }

  if (!res.ok) {
    const rateLimited = isRateLimited(res.status, json);

    if (rateLimited) {
      rateLimitedSeen = true;
      if (counters.rate >= MAX_RATELIMIT_RETRIES) {
        const err = new Error(`${method} ${url} failed: ${res.status}\n${text}`);
        err.status = res.status;
        err.response = json;
        throw err;
      }
      const headerDelay = rateLimitDelay(res.headers);
      const delay = Math.max(headerDelay ?? RATE_LIMIT_MIN_DELAY_MS, RATE_LIMIT_MIN_DELAY_MS);
      const jittered = delay + Math.floor(Math.random() * 250);
      console.warn(
        `⚠️ Rate limit retry: ${method} ${url} -> ${res.status}. Waiting ${jittered}ms before attempt ${
          counters.rate + 1
        }/${MAX_RATELIMIT_RETRIES}`
      );
      await sleep(jittered);
      return http(method, url, body, { fivexx: counters.fivexx, rate: counters.rate + 1 });
    }

    const is5xx = RETRY_STATUSES.has(res.status);
    if (is5xx) {
      if (counters.fivexx >= MAX_5XX_RETRIES) {
        const err = new Error(`${method} ${url} failed: ${res.status}\n${text}`);
        err.status = res.status;
        err.response = json;
        throw err;
      }
      const baseDelay = BASE_DELAY_MS * Math.pow(2, counters.fivexx);
      const jittered = baseDelay + Math.floor(Math.random() * 250);
      console.warn(
        `⚠️ 5xx retry: ${method} ${url} -> ${res.status}. Waiting ${jittered}ms before attempt ${
          counters.fivexx + 1
        }/${MAX_5XX_RETRIES}`
      );
      await sleep(jittered);
      return http(method, url, body, { fivexx: counters.fivexx + 1, rate: counters.rate });
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
  logPayloadSize("POST");
  return http("POST", `${BASE}/collections?workspace=${WORKSPACE_ID}`, payload);
}

async function fetchCollection(uid) {
  return http("GET", `${BASE}/collections/${uid}`);
}

async function updateCollection(uid, payload) {
  logPayloadSize("PUT");
  lastPutSucceeded = false;
  try {
    if (rateLimitedSeen) {
      throw Object.assign(new Error("Rate limit encountered previously."), { status: 429 });
    }
    const result = await http("PUT", `${BASE}/collections/${uid}`, payload);
    lastPutSucceeded = true;
    lastPutError = null;
    debugProbesRun = false;
    return result;
  } catch (err) {
    lastPutError = err;
    lastFailedPutResponse = err?.response || null;
    if (rateLimitedSeen) {
      console.warn("Rate limit encountered; skipping further PUT attempts to prevent burst failures.");
      throw err;
    }
    if (DEBUG && !debugProbesRun && err?.status === 500) {
      debugProbesRun = true;
      console.log("[DEBUG] Running minimal PUT probe early to avoid rate-limit contamination.");
      await runDebugProbes(uid, payload);
    }
    throw err;
  }
}
async function deleteCollection(uid) {
  return http("DELETE", `${BASE}/collections/${uid}`);
}

function approxBytes(obj) {
  return Buffer.byteLength(JSON.stringify(obj), "utf8");
}

function computePayloadMetrics(raw) {
  const bytes = Buffer.byteLength(raw, "utf8");
  const kb = bytes / 1024;
  const mb = kb / 1024;
  return { bytes, kb, mb };
}

function logPayloadSize(method) {
  if (!payloadMetrics) return;
  const { bytes, kb, mb } = payloadMetrics;
  console.log(
    `Upserting collection '${COLLECTION_NAME}' via ${method} | Payload size: ${Math.round(kb)} KB (${(
      mb
    ).toFixed(2)} MB, ${bytes} bytes)`
  );
}

function hashPayload(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function sanitizeName(name) {
  return (name || "collection").replace(/[^A-Za-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

function hashFilePath(name) {
  const safe = sanitizeName(name);
  return `artifacts/last_hash.${safe}.txt`;
}

function readLastHash(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
}

function writeLastHash(filePath, hash) {
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(filePath, hash);
}

function versionedCollectionName(base) {
  const runNumber = process.env.GITHUB_RUN_NUMBER || `${Date.now()}`;
  return `${base} [build ${runNumber}]`;
}

async function createVersionedCollection(payload, payloadHash, hashFile) {
  const clone = JSON.parse(JSON.stringify(payload));
  const versionedName = versionedCollectionName(COLLECTION_NAME);
  if (clone?.collection?.info?.name) clone.collection.info.name = versionedName;
  console.log(`Publishing fallback collection via POST as '${versionedName}'`);
  console.log(`Pausing ${PRE_WRITE_DELAY_MS}ms before write to avoid Postman API burst limits.`);
  await sleep(PRE_WRITE_DELAY_MS);
  const out = await createInWorkspace(clone);
  console.log("✅ Published versioned collection uid:", out?.collection?.uid);
  versionedPublishUsed = true;
  writeLastHash(hashFile, payloadHash);
}

function buildMinimalProbePayload(payload) {
  const clone = JSON.parse(JSON.stringify(payload));
  if (!clone?.collection) return clone;
  delete clone.collection.event;

  function stripItems(items) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (Array.isArray(item?.response)) delete item.response;
      if (Array.isArray(item?.event)) delete item.event;
      if (item?.request?.auth) delete item.request.auth;
      if (item?.item) stripItems(item.item);
    }
  }

  stripItems(clone.collection.item);
  if (clone.collection?.auth) delete clone.collection.auth;
  return clone;
}

async function runDebugProbes(uid, payload) {
  console.log(`[DEBUG] PUT 500 detected for ${COLLECTION_NAME} (${uid}). Running diagnostic probes...`);
  let getSummary = "not-run";
  let minimalSummary = "not-run";

  try {
    const probe = await fetchCollection(uid);
    const name = probe?.collection?.info?.name || "unknown";
    const updatedAt = probe?.collection?.info?.updatedAt || probe?.collection?.info?.updated_at || "n/a";
    const reqId = probe?._request?.headers?.["x-request-id"] || "n/a";
    getSummary = `success (name=${name}, updatedAt=${updatedAt})`;
    console.log(`[DEBUG] Probe GET success. Name: ${name}, updatedAt: ${updatedAt}, x-request-id: ${reqId}`);
  } catch (err) {
    getSummary = `error (status=${err?.status || "n/a"} message=${err?.message || err})`;
    console.warn("[DEBUG] UID read failed during probe.", err);
  }

  const minimalPayload = buildMinimalProbePayload(payload);
  try {
    await http("PUT", `${BASE}/collections/${uid}`, minimalPayload, { fivexx: 0, rate: 0, isProbe: true });
    minimalSummary = "success";
  } catch (err) {
    minimalSummary = `error (status=${err?.status || "n/a"} message=${err?.message || err})`;
  }

  console.log(
    `[DEBUG] Probe summary -> Original PUT status: ${lastPutError?.status || "unknown"}, GET probe: ${getSummary}, minimal PUT probe: ${minimalSummary}`
  );
}

async function main() {
  const rawPayload = fs.readFileSync(COLLECTION_FILE, "utf8");
  payloadMetrics = computePayloadMetrics(rawPayload);
  const payload = JSON.parse(rawPayload);
  const payloadHash = hashPayload(rawPayload);
  const hashFile = hashFilePath(COLLECTION_NAME);
  const lastHash = readLastHash(hashFile);

  if (payload?.collection?.info?.name) {
    payload.collection.info.name = COLLECTION_NAME;
  }

  const bytes = approxBytes(payload);
  console.log(`Payload size: ${Math.round(bytes / 1024)} KB (${bytes} bytes)`);

  const existingUid = await findUidByName(COLLECTION_NAME);

  if (existingUid) {
    if (lastHash && lastHash === payloadHash) {
      console.log(`No changes detected for '${COLLECTION_NAME}'; skipping PUT.`);
      return;
    }

    console.log("Found existing collection:", COLLECTION_NAME, "uid:", existingUid);
    try {
      const current = await fetchCollection(existingUid);
      const info = current?.collection?.info || {};
      if (payload?.collection?.info) {
        payload.collection.info._postman_id = info._postman_id || info.id || existingUid;
        payload.collection.info.id = info.id || info._postman_id || existingUid;
      }
    } catch (err) {
      console.warn(
        "⚠️ Failed to fetch existing collection details; continuing with provided payload.",
        err?.message || err
      );
    }
    console.log(`Pausing ${PRE_WRITE_DELAY_MS}ms before write to avoid Postman API burst limits.`);
    await sleep(PRE_WRITE_DELAY_MS);
    console.log("Updating collection:", COLLECTION_NAME, "uid:", existingUid);
    try {
      await updateCollection(existingUid, payload);
      console.log("✅ Updated");
      writeLastHash(hashFile, payloadHash);
      return;
    } catch (err) {
      if (DEBUG && err?.status === 500) {
        await runDebugProbes(existingUid, payload);
      }
      const shouldVersionedPublish =
        rateLimitedSeen || (err?.status && err.status >= 500 && err.status < 600);

      if (shouldVersionedPublish) {
        console.warn("PUT update failed/unreliable; published versioned collection via POST instead.");
        await createVersionedCollection(payload, payloadHash, hashFile);
        console.log(
          "Cleanup policy: keep last N builds; delete older versions manually or via scheduled job."
        );
        return;
      }

      console.warn("⚠️ PUT update failed; attempting delete + recreate fallback.", err?.message || err);
      try {
        await deleteCollection(existingUid);
        const out = await createInWorkspace(payload);
        console.log("✅ Recreated uid:", out?.collection?.uid);
        writeLastHash(hashFile, payloadHash);
        return;
      } catch (fallbackErr) {
        console.error("❌ Fallback delete + recreate failed.", fallbackErr);
        throw fallbackErr;
      }
    }
  }

  console.log("Creating collection:", COLLECTION_NAME);
  console.log(`Pausing ${PRE_WRITE_DELAY_MS}ms before write to avoid Postman API burst limits.`);
  await sleep(PRE_WRITE_DELAY_MS);
  const out = await createInWorkspace(payload);
  console.log("✅ Created uid:", out?.collection?.uid);
  writeLastHash(hashFile, payloadHash);
}

main().catch((e) => {
  console.error("❌ Upsert failed.");
  if (e?.status) console.error("Status:", e.status);
  if (e?.response) console.error("Response:", JSON.stringify(e.response, null, 2));
  console.error(e);
  process.exit(1);
});
