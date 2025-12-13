import fs from "fs";
import crypto from "crypto";
import fetch from "node-fetch";

const API_KEY = process.env.POSTMAN_API_KEY;
const WORKSPACE_ID = process.env.POSTMAN_WORKSPACE_ID;
const COLLECTION_FILE = process.env.POSTMAN_COLLECTION_FILE;
const COLLECTION_NAME = process.env.POSTMAN_COLLECTION_NAME;

if (!API_KEY || !WORKSPACE_ID || !COLLECTION_FILE || !COLLECTION_NAME) {
  console.error("Missing one of: POSTMAN_API_KEY, POSTMAN_WORKSPACE_ID, POSTMAN_COLLECTION_FILE, POSTMAN_COLLECTION_NAME");
  process.exit(1);
}

const BASE = "https://api.getpostman.com";
const PRE_WRITE_DELAY_MS = 1500;
const PUT_RETRY_DELAY_MS = 2000;

function headers() {
  return {
    "X-Api-Key": API_KEY,
    "Content-Type": "application/json",
    "Accept": "application/vnd.api.v10+json",
  };
}

async function request(method, url, body) {
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
    const err = new Error(`${method} ${url} failed: ${res.status}\n${text}`);
    err.status = res.status;
    err.response = json;
    throw err;
  }
  return json;
}

async function listCollections() {
  const res = await request("GET", `${BASE}/collections?workspace=${WORKSPACE_ID}`);
  return res?.collections || [];
}

async function fetchCollection(uid) {
  return request("GET", `${BASE}/collections/${uid}`);
}

async function putCollection(uid, payload) {
  logPayloadSize("PUT");
  return request("PUT", `${BASE}/collections/${uid}`, payload);
}

async function postCollection(payload) {
  logPayloadSize("POST");
  return request("POST", `${BASE}/collections?workspace=${WORKSPACE_ID}`, payload);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logPayloadSize(method) {
  if (!globalThis.__payloadMetrics) return;
  const { bytes, kb, mb } = globalThis.__payloadMetrics;
  console.log(`Upserting collection '${COLLECTION_NAME}' via ${method} | Payload size: ${Math.round(kb)} KB (${mb.toFixed(2)} MB, ${bytes} bytes)`);
}

function hashStr(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function versionedName(base) {
  const run = process.env.GITHUB_RUN_NUMBER || `${Date.now()}`;
  return `${base} [build ${run}]`;
}

async function main() {
  const rawPayload = fs.readFileSync(COLLECTION_FILE, "utf8");
  const payload = JSON.parse(rawPayload);
  globalThis.__payloadMetrics = {
    bytes: Buffer.byteLength(rawPayload, "utf8"),
    kb: Buffer.byteLength(rawPayload, "utf8") / 1024,
    mb: Buffer.byteLength(rawPayload, "utf8") / 1024 / 1024,
  };

  if (payload?.collection?.info?.name) {
    payload.collection.info.name = COLLECTION_NAME;
  }

  console.log(`Payload size: ${Math.round(globalThis.__payloadMetrics.kb)} KB (${globalThis.__payloadMetrics.bytes} bytes)`);

  const collections = await listCollections();
  const existing = collections.find((c) => c?.name === COLLECTION_NAME);

  if (!existing) {
    console.log("No existing collection found. Creating via POST.");
    console.log(`Pausing ${PRE_WRITE_DELAY_MS}ms before write to avoid Postman API burst limits.`);
    await sleep(PRE_WRITE_DELAY_MS);
    await postCollection(payload);
    console.log("✅ Created collection.");
    return;
  }

  console.log("Found existing collection:", COLLECTION_NAME, "uid:", existing.uid);
  try {
    await fetchCollection(existing.uid);
  } catch (e) {
    console.warn("⚠️ Failed to fetch existing collection details.", e?.message || e);
  }

  console.log(`Pausing ${PRE_WRITE_DELAY_MS}ms before write to avoid Postman API burst limits.`);
  await sleep(PRE_WRITE_DELAY_MS);

  const putPayload = JSON.parse(JSON.stringify(payload));
  try {
    await putCollection(existing.uid, putPayload);
    console.log("✅ PUT succeeded.");
    return;
  } catch (err) {
    console.warn(`PUT failed (status=${err?.status || "unknown"}). Retrying once after ${PUT_RETRY_DELAY_MS}ms...`);
  }

  await sleep(PUT_RETRY_DELAY_MS);

  try {
    await putCollection(existing.uid, payload);
    console.log("✅ PUT succeeded on retry.");
    return;
  } catch (err) {
    console.warn("PUT failed twice; falling back to versioned POST.");
    const fallbackPayload = JSON.parse(JSON.stringify(payload));
    if (fallbackPayload?.collection?.info?.name) {
      fallbackPayload.collection.info.name = versionedName(COLLECTION_NAME);
    }
    console.log(`Pausing ${PRE_WRITE_DELAY_MS}ms before versioned publish.`);
    await sleep(PRE_WRITE_DELAY_MS);
    await postCollection(fallbackPayload);
    console.log(`PUT failed twice; published versioned collection via POST: ${fallbackPayload.collection.info.name}`);
    console.log("Cleanup policy: keep last N builds; delete older versions manually or via scheduled job.");
  }
}

main().catch((err) => {
  console.error("❌ Upsert failed.");
  if (err?.status) console.error("Status:", err.status);
  if (err?.response) console.error("Response:", JSON.stringify(err.response, null, 2));
  console.error(err);
  process.exit(1);
});
