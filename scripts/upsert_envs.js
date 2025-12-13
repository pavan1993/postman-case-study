import fetch from "node-fetch";

const API_KEY = process.env.POSTMAN_API_KEY;
const WORKSPACE_ID = process.env.POSTMAN_WORKSPACE_ID;
const SERVICE_KEY = process.env.POSTMAN_SERVICE_KEY || "payment-refund-api";

if (!API_KEY || !WORKSPACE_ID) {
  console.error("Missing POSTMAN_API_KEY or POSTMAN_WORKSPACE_ID");
  process.exit(1);
}

const BASE = "https://api.getpostman.com";

// For demo, keep placeholder; you’ll replace with mock URL after creating mock server.
const BASE_URL_VALUE = "REPLACE_WITH_MOCK_BASEURL/v2";

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

function envName(env) {
  return `Payments / ${SERVICE_KEY} - ${env}`;
}

function envBody(name, baseUrl) {
  return {
    environment: {
      name,
      values: [
        { key: "base_url", value: baseUrl, enabled: true },
        { key: "access_token", value: "", enabled: true },
        { key: "token_exp", value: "", enabled: true },
        { key: "oauth_client_id", value: "REPLACE_ME", enabled: true },
        { key: "oauth_client_secret", value: "REPLACE_ME", enabled: true },
        { key: "oauth_token_url", value: "https://example.com/oauth/token", enabled: true },
        { key: "oauth_auth_url", value: "https://example.com/oauth/authorize", enabled: true },
        { key: "oauth_scopes", value: "refunds.read refunds.write", enabled: true },
        { key: "oauth_redirect_uri", value: "https://oauth.pstmn.io/v1/callback", enabled: true },
      ],
    },
  };
}

async function findEnvIdByName(name) {
  const list = await http("GET", `${BASE}/environments`);
  const envs = list?.environments || [];
  const match = envs.find((e) => e?.name === name);
  return match?.id || null;
}

async function createEnv(name) {
  // Create is workspace-scoped
  return http("POST", `${BASE}/environments?workspace=${WORKSPACE_ID}`, envBody(name, BASE_URL_VALUE));
}

async function updateEnv(id, name) {
  return http("PUT", `${BASE}/environments/${id}`, envBody(name, BASE_URL_VALUE));
}

async function main() {
  const targets = ["Dev", "QA", "UAT", "Prod"];

  for (const t of targets) {
    const name = envName(t);
    const existingId = await findEnvIdByName(name);

    if (existingId) {
      console.log("Updating env:", name, "id:", existingId);
      await updateEnv(existingId, name);
    } else {
      console.log("Creating env:", name);
      await createEnv(name);
    }
  }

  console.log("✅ Environments upserted.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
