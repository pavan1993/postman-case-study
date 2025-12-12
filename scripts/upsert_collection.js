import fs from "fs";
import fetch from "node-fetch";

const API_KEY = process.env.POSTMAN_API_KEY;
const CANONICAL_NAME = process.env.POSTMAN_CANONICAL_COLLECTION_NAME;

if (!API_KEY) {
  console.error("Missing POSTMAN_API_KEY");
  process.exit(1);
}
if (!CANONICAL_NAME) {
  console.error("Missing POSTMAN_CANONICAL_COLLECTION_NAME");
  process.exit(1);
}

const BASE = "https://api.getpostman.com";
const PATCHED_PATH = "artifacts/collection.patched.json";

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

async function findCollectionUidByName(name) {
  // NOTE: This lists all collections accessible by the API key. In large orgs you'd page/filter.
  const list = await http("GET", `${BASE}/collections`);
  const items = list?.collections || [];
  const match = items.find((c) => c?.name === name);
  return match?.uid || null;
}

async function main() {
  const patched = JSON.parse(fs.readFileSync(PATCHED_PATH, "utf8"));

  // Ensure name is canonical (defensive)
  if (patched?.collection?.info?.name) {
    patched.collection.info.name = CANONICAL_NAME;
  }

  const existingUid = await findCollectionUidByName(CANONICAL_NAME);

  if (existingUid) {
    console.log("Updating canonical collection:", CANONICAL_NAME);
    console.log("uid:", existingUid);
    await http("PUT", `${BASE}/collections/${existingUid}`, patched);
    console.log("✅ Updated collection");
  } else {
    console.log("Creating canonical collection:", CANONICAL_NAME);
    const out = await http("POST", `${BASE}/collections`, patched);
    const uid = out?.collection?.uid;
    console.log("✅ Created collection uid:", uid);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});