import fetch from "node-fetch";

const API_KEY = process.env.POSTMAN_API_KEY;
const WORKSPACE_ID = process.env.POSTMAN_WORKSPACE_ID;
if (!API_KEY || !WORKSPACE_ID) {
  console.error("Missing POSTMAN_API_KEY or POSTMAN_WORKSPACE_ID");
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

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}\n${text}`);
  return JSON.parse(text);
}

// Minimal environment payload
function envPayload(name, baseUrlValue) {
  return {
    environment: {
      name,
      values: [
        { key: "base_url", value: baseUrlValue, enabled: true },
        { key: "access_token", value: "", enabled: true },
        { key: "token_exp", value: "", enabled: true }
      ],
    },
  };
}

async function main() {
  // We don’t have mock URL yet; put a placeholder and update later.
  const PLACEHOLDER = "REPLACE_WITH_MOCK_BASEURL/v2";

  const envNames = ["Dev", "QA", "UAT", "Prod"];
  for (const env of envNames) {
    const name = `Payments Refund API - ${env}`;
    console.log("Creating environment:", name);

    // IMPORTANT: Postman env create endpoint uses `workspace` query param
    await post(`${BASE}/environments?workspace=${WORKSPACE_ID}`, envPayload(name, PLACEHOLDER));
  }

  console.log("✅ Environments created.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});