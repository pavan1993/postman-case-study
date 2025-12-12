import fetch from "node-fetch";

const API_KEY = process.env.POSTMAN_API_KEY;
const WORKSPACE_ID = process.env.POSTMAN_WORKSPACE_ID;
const GENERATED_NAME = "Payment Refund API - Generated";

if (!API_KEY || !WORKSPACE_ID) {
  console.error("Missing POSTMAN_API_KEY or POSTMAN_WORKSPACE_ID");
  process.exit(1);
}

const BASE = "https://api.getpostman.com";

function headers() {
  return {
    "X-Api-Key": API_KEY,
    "Accept": "application/vnd.api.v10+json",
  };
}

async function http(method, url) {
  const res = await fetch(url, { method, headers: headers() });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status}`);
  return json;
}

async function main() {
  const list = await http("GET", `${BASE}/collections?workspace=${WORKSPACE_ID}`);
  const collections = list.collections || [];

  const generated = collections.find(c => c.name === GENERATED_NAME);
  if (!generated) {
    console.log("No generated collection found. Nothing to delete.");
    return;
  }

  console.log("Deleting generated collection:", generated.uid);
  await http("DELETE", `${BASE}/collections/${generated.uid}`);
  console.log("✅ Deleted:", GENERATED_NAME);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});