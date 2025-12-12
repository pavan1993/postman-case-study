import fs from "fs";
import fetch from "node-fetch";

const API_KEY = process.env.POSTMAN_API_KEY;
const WORKSPACE_ID = process.env.POSTMAN_WORKSPACE_ID;
const CANONICAL_NAME = process.env.POSTMAN_CANONICAL_COLLECTION_NAME;

if (!API_KEY) {
  console.error("Missing POSTMAN_API_KEY");
  process.exit(1);
}
if (!WORKSPACE_ID) {
  console.error("Missing POSTMAN_WORKSPACE_ID");
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

  if (!res.ok) {
    throw new Error(`${method} ${url} failed: ${res.status}\n${text}`);
  }
  return json;
}

async function listCollectionsInWorkspace() {
  // Workspace-scoped list (critical)
  const out = await http("GET", `${BASE}/collections?workspace=${WORKSPACE_ID}`);
  return out?.collections || [];
}

async function findCollectionUidByNameInWorkspace(name) {
  const items = await listCollectionsInWorkspace();
  const match = items.find((c) => c?.name === name);
  return match?.uid || null;
}

async function createCollectionInWorkspace(body) {
  // Workspace-scoped create (critical)
  return http("POST", `${BASE}/collections?workspace=${WORKSPACE_ID}`, body);
}

async function updateCollection(uid, body) {
  // Update by uid; this does not move workspaces (fine)
  return http("PUT", `${BASE}/collections/${uid}`, body);
}

async function main() {
  const patched = JSON.parse(fs.readFileSync(PATCHED_PATH, "utf8"));

  // Ensure the canonical name is applied
  if (patched?.collection?.info?.name) {
    patched.collection.info.name = CANONICAL_NAME;
  }

  // 1) Find canonical collection IN THE TARGET WORKSPACE
  const existingUid = await findCollectionUidByNameInWorkspace(CANONICAL_NAME);

  if (existingUid) {
    console.log("Updating canonical collection IN workspace:", WORKSPACE_ID);
    console.log("name:", CANONICAL_NAME);
    console.log("uid:", existingUid);
    await updateCollection(existingUid, patched);
    console.log("✅ Updated canonical collection");
    return;
  }

  // 2) If not found in workspace, create it in that workspace
  console.log("Canonical collection not found in workspace. Creating...");
  console.log("workspace:", WORKSPACE_ID);
  console.log("name:", CANONICAL_NAME);

  const created = await createCollectionInWorkspace(patched);
  const newUid = created?.collection?.uid;
  console.log("✅ Created canonical collection in workspace. uid:", newUid);
  console.log("👉 If you previously created the same name in 'My Workspace', delete that old one to avoid confusion.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});