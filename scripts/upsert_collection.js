import fs from "fs";
import fetch from "node-fetch";

const API_KEY = process.env.POSTMAN_API_KEY;
const WORKSPACE_ID = process.env.POSTMAN_WORKSPACE_ID;
const COLLECTION_FILE = process.env.POSTMAN_COLLECTION_FILE; // e.g. artifacts/collection.mock.json
const COLLECTION_NAME = process.env.POSTMAN_COLLECTION_NAME; // e.g. Payments / payment-refund-api (Mock)

if (!API_KEY || !WORKSPACE_ID || !COLLECTION_FILE || !COLLECTION_NAME) {
  console.error("Missing one of: POSTMAN_API_KEY, POSTMAN_WORKSPACE_ID, POSTMAN_COLLECTION_FILE, POSTMAN_COLLECTION_NAME");
  process.exit(1);
}

const BASE = "https://api.getpostman.com";

function headers() {
  return {
    "X-Api-Key": API_KEY,
    "Content-Type": "application/json",
    "Accept": "application/vnd.api.v10+json",
  };
}

async function http(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status}\n${text}`);
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

async function createInWorkspace(body) {
  return http("POST", `${BASE}/collections?workspace=${WORKSPACE_ID}`, body);
}

async function update(uid, body) {
  return http("PUT", `${BASE}/collections/${uid}`, body);
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(COLLECTION_FILE, "utf8"));

  // Defensive: ensure name is what we expect
  if (payload?.collection?.info?.name) {
    payload.collection.info.name = COLLECTION_NAME;
  }

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
  console.error(e);
  process.exit(1);
});