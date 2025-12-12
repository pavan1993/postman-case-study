import fs from "fs";
import fetch from "node-fetch";

const API_KEY = process.env.POSTMAN_API_KEY;
const WORKSPACE_ID = process.env.POSTMAN_WORKSPACE_ID;

if (!API_KEY || !WORKSPACE_ID) {
  console.error("Missing POSTMAN_API_KEY or POSTMAN_WORKSPACE_ID");
  process.exit(1);
}

const BASE = "https://api.getpostman.com";
const YAML_PATH = "payment-refund-api-openapi.yaml";

function headers() {
  return {
    "X-Api-Key": API_KEY,
    "Content-Type": "application/json",
    // Some endpoints require this accept header; harmless if not needed:
    "Accept": "application/vnd.api.v10+json"
  };
}

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`POST ${url} failed: ${res.status}\n${text}`);
  }
  return json;
}

async function get(url) {
  const res = await fetch(url, { method: "GET", headers: headers() });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status}\n${text}`);
  }
  return json;
}

async function main() {
  const yaml = fs.readFileSync(YAML_PATH, "utf8");

  // 1) Create spec
  const specCreateBody = {
    name: "Payment Refund API",
    type: "OPENAPI:3.0",
    files: [
      {
        path: "payment-refund-api-openapi.yaml",
        content: yaml
      }
    ]
  };

  console.log("Creating spec...");
  const specRes = await post(`${BASE}/specs?workspaceId=${WORKSPACE_ID}`, specCreateBody);

  const specId = specRes?.spec?.id || specRes?.id || specRes?.data?.id;
  if (!specId) {
    console.error("Could not find specId in response:", JSON.stringify(specRes, null, 2));
    process.exit(1);
  }
  console.log("specId:", specId);

  // 2) Generate collection from spec
  console.log("Generating collection...");
  const genBody = {
    name: "Payment Refund API - Generated",
    options: {
      folderStrategy: "Tags",
      enableOptionalParameters: true
    }
  };

  const genRes = await post(`${BASE}/specs/${specId}/generations/collection`, genBody);

  // Generation often returns a task object / id
  const taskId = genRes?.task?.id || genRes?.taskId || genRes?.id;
  const pollUrl = genRes?.task?.url || genRes?.url;

  if (!taskId && !pollUrl) {
    console.log("Generation response:", JSON.stringify(genRes, null, 2));
    console.error("Could not find taskId/url to poll. Paste this output back to ChatGPT.");
    process.exit(1);
  }

  // 3) Poll until done
  let status = "RUNNING";
  let task = null;

  const pollEndpoint = pollUrl || `${BASE}/tasks/${taskId}`;
  console.log("Polling:", pollEndpoint);

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    task = await get(pollEndpoint);
    status = task?.task?.status || task?.status || task?.data?.status;

    console.log("Status:", status);
    if (status === "SUCCESS" || status === "COMPLETED") break;
    if (status === "FAILED" || status === "ERROR") {
      console.error("Task failed:", JSON.stringify(task, null, 2));
      process.exit(1);
    }
  }

  // 4) Fetch generated collection
  // Depending on the API response, the task output may include a collection uid or collection id.
  // We'll attempt to locate it in common places.
  const out = task?.task?.result || task?.result || task?.data?.result || task;
  let collectionUid =
    out?.collectionUid ||
    out?.collection?.uid ||
    out?.collection_uid ||
    out?.generatedCollectionUid;

  // Fallback: ask Postman for the list of generated collections for this spec
  if (!collectionUid) {
    console.log("Looking up generated collections for spec...");
    const genList = await get(`${BASE}/specs/${specId}/generations/collection`);
    // If this endpoint returns a list, pick the most recent
    const items = genList?.collections || genList?.data || genList?.generatedCollections || [];
    if (Array.isArray(items) && items.length > 0) {
      collectionUid = items[0]?.uid || items[0]?.collectionUid || items[0]?.id;
    }
  }

  if (!collectionUid) {
    console.error("Could not determine collection UID. Task output:", JSON.stringify(task, null, 2));
    process.exit(1);
  }

  console.log("collectionUid:", collectionUid);

  const collection = await get(`${BASE}/collections/${collectionUid}`);

  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/collection.generated.json", JSON.stringify(collection, null, 2));
  console.log("Wrote artifacts/collection.generated.json");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});