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
    // Often required by Postman API Builder endpoints; harmless otherwise.
    "Accept": "application/vnd.api.v10+json",
  };
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`POST ${url} failed: ${res.status}\n${text}`);
  }
  return json;
}

async function get(url) {
  const res = await fetch(url, { method: "GET", headers: headers() });
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status}\n${text}`);
  }
  return json;
}

function toAbsoluteUrl(maybeUrl) {
  if (!maybeUrl) return null;
  if (maybeUrl.startsWith("http://") || maybeUrl.startsWith("https://")) return maybeUrl;
  if (maybeUrl.startsWith("/")) return `${BASE}${maybeUrl}`;
  // Edge case: missing leading slash
  return `${BASE}/${maybeUrl}`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
        content: yaml,
      },
    ],
  };

  console.log("Creating spec...");
  const specRes = await post(`${BASE}/specs?workspaceId=${WORKSPACE_ID}`, specCreateBody);

  const specId = specRes?.spec?.id || specRes?.id || specRes?.data?.id;
  if (!specId) {
    console.error("Could not find specId in response:\n", JSON.stringify(specRes, null, 2));
    process.exit(1);
  }
  console.log("specId:", specId);

  // 2) Generate collection from spec
  console.log("Generating collection...");
  const genBody = {
    name: "Payment Refund API - Generated",
    options: {
      folderStrategy: "Tags",
      enableOptionalParameters: true,
    },
  };

  const genRes = await post(`${BASE}/specs/${specId}/generations/collection`, genBody);
  console.log("Generation response:\n", JSON.stringify(genRes, null, 2));

  // Generation often returns a task object with a URL (sometimes relative).
  const taskId = genRes?.task?.id || genRes?.taskId || genRes?.id;
  const pollUrlRaw = genRes?.task?.url || genRes?.url;

  // Build poll endpoint:
  // - Prefer provided pollUrl if present
  // - Otherwise fall back to /tasks/{taskId}
  const pollEndpointRaw = pollUrlRaw || (taskId ? `/tasks/${taskId}` : null);
  const pollEndpoint = toAbsoluteUrl(pollEndpointRaw);

  if (!pollEndpoint) {
    console.error("Could not determine poll endpoint (no taskId/url).");
    process.exit(1);
  }

  console.log("Polling:", pollEndpoint);

  // 3) Poll until done
  let status = "RUNNING";
  let task = null;

  for (let i = 0; i < 40; i++) {
    await sleep(2000);
    task = await get(pollEndpoint);

    // Try common shapes
    status =
      task?.task?.status ||
      task?.status ||
      task?.data?.status ||
      task?.result?.status ||
      "UNKNOWN";

    console.log(`Status [${i + 1}/40]:`, status);

    if (["SUCCESS", "COMPLETED", "DONE"].includes(status)) break;
    if (["FAILED", "ERROR"].includes(status)) {
      console.error("Task failed:\n", JSON.stringify(task, null, 2));
      process.exit(1);
    }
  }

  // 4) Determine generated collection UID
  const out = task?.task?.result || task?.result || task?.data?.result || task;
  let collectionUid =
    out?.collectionUid ||
    out?.collection?.uid ||
    out?.collection_uid ||
    out?.generatedCollectionUid ||
    out?.generated_collection_uid;

  // Fallback: ask Postman for the list of generated collections for this spec
  if (!collectionUid) {
    console.log("Looking up generated collections for spec...");
    // NOTE: Depending on Postman API behavior, this may return a list.
    // If it errors, paste the error back and we’ll adjust to the right listing endpoint.
    const genList = await get(`${BASE}/specs/${specId}/generations/collection`);
    const items =
      genList?.collections ||
      genList?.data ||
      genList?.generatedCollections ||
      genList?.generated_collections ||
      [];

    if (Array.isArray(items) && items.length > 0) {
      // pick the most recent-ish item (assumes first is most recent)
      collectionUid = items[0]?.uid || items[0]?.collectionUid || items[0]?.id;
    }
  }

  if (!collectionUid) {
    console.error("Could not determine collection UID.\nTask output:\n", JSON.stringify(task, null, 2));
    process.exit(1);
  }

  console.log("collectionUid:", collectionUid);

  // 5) Fetch generated collection JSON
  const collection = await get(`${BASE}/collections/${collectionUid}`);

  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/collection.generated.json", JSON.stringify(collection, null, 2));
  console.log("Wrote artifacts/collection.generated.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});