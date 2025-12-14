import fs from "fs";
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
  const name = globalThis.__resolvedCollectionName || COLLECTION_NAME;
  console.log(`Publishing collection '${name}' via ${method} | Payload size: ${Math.round(kb)} KB (${mb.toFixed(2)} MB, ${bytes} bytes)`);
}

function versionedName(base) {
  const run =
    process.env.GITHUB_RUN_NUMBER ||
    (process.env.GITHUB_SHA ? process.env.GITHUB_SHA.substring(0, 7) : null) ||
    `${Date.now()}`;
  return `${base} v${run}`;
}

async function main() {
  const rawPayload = fs.readFileSync(COLLECTION_FILE, "utf8");
  const payload = JSON.parse(rawPayload);
  globalThis.__payloadMetrics = {
    bytes: Buffer.byteLength(rawPayload, "utf8"),
    kb: Buffer.byteLength(rawPayload, "utf8") / 1024,
    mb: Buffer.byteLength(rawPayload, "utf8") / 1024 / 1024,
  };

  const resolvedName = versionedName(COLLECTION_NAME);
  globalThis.__resolvedCollectionName = resolvedName;

  if (payload?.collection?.info?.name) {
    payload.collection.info.name = resolvedName;
  }

  console.log(`Payload size: ${Math.round(globalThis.__payloadMetrics.kb)} KB (${globalThis.__payloadMetrics.bytes} bytes)`);
  console.log(`Resolved collection name: ${resolvedName}`);
  console.log(`Pausing ${PRE_WRITE_DELAY_MS}ms before publish to avoid Postman API burst limits.`);
  await sleep(PRE_WRITE_DELAY_MS);
  const res = await postCollection(payload);
  const uid =
    res?.collection?.uid ||
    res?.collectionUid ||
    res?.data?.id ||
    res?.uid ||
    null;
  console.log(`✅ Created collection '${resolvedName}' via POST${uid ? ` (uid: ${uid})` : ""}.`);
}

main().catch((err) => {
  console.error("❌ Upsert failed.");
  if (err?.status) console.error("Status:", err.status);
  if (err?.response) console.error("Response:", JSON.stringify(err.response, null, 2));
  console.error(err);
  process.exit(1);
});
