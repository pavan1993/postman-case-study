import fs from "fs";

const SERVICE_KEY = process.env.POSTMAN_SERVICE_KEY || "payment-refund-api";

const inPath = "artifacts/collection.generated.json";
const outJwt = "artifacts/collection.jwt_mock.json";
const outOauth = "artifacts/collection.oauth2_ready.json";

const rawDoc = JSON.parse(fs.readFileSync(inPath, "utf8"));

const PRE_REQUEST = `
async function ensureAuth() {
  const now = Math.floor(Date.now() / 1000);
  const expRaw = pm.environment.get("token_exp");
  const expires = Number.isFinite(Number(expRaw)) ? Number(expRaw) : Infinity;
  let token = pm.environment.get("access_token");
  let tokenType = pm.environment.get("token_type") || "Bearer";
  const needsRefresh = !token || now >= (expires - 30);

  if (needsRefresh) {
    const logFn = pm.console && pm.console.log ? pm.console.log : console.log;
    logFn("Fetching new access token…");
    const response = await new Promise((resolve, reject) => {
      pm.sendRequest(
        {
          url: pm.environment.get("base_url") + "/auth/token",
          method: "POST",
          header: { "Content-Type": "application/json" },
          body: { mode: "raw", raw: JSON.stringify({ grant_type: "client_credentials" }) },
        },
        (err, res) => {
          if (err) return reject(err);
          if (!res) return reject(new Error("Empty auth response"));
          const json = res.json();
          if (!json?.access_token) {
            logFn("Auth response payload:", JSON.stringify(json));
            return reject(new Error("Auth response missing access_token"));
          }
          const type = json.token_type || "Bearer";
          pm.environment.set("access_token", json.access_token);
          pm.environment.set("token_type", type);
          pm.environment.set("token_exp", String(now + Number(json.expires_in || 300)));
          resolve({ token: json.access_token, tokenType: type });
        }
      );
    });

    token = response.token;
    tokenType = response.tokenType;
  }

  const headerVal = \`\${tokenType} \${token}\`.trim();
  pm.request.headers.upsert({ key: "Authorization", value: headerVal });
  pm.variables.set("last_attached_auth_header", pm.request.headers.get("Authorization") || "");
}

ensureAuth().catch((err) => {
  console.error("Auth pre-request failed:", err);
  throw err;
});
`.trim();

const COLLECTION_TEST = `
pm.test("Authorization header attached to outgoing request", () => {
  const header = pm.variables.get("last_attached_auth_header");
  pm.expect(header, "Missing Authorization header").to.match(/^Bearer\\s.+/);
});
`.trim();

function normalizeBaseUrlTokens(doc) {
  // Replace common variants to the one standard: {{base_url}}
  let s = JSON.stringify(doc);
  s = s.replaceAll("{{baseurl}}", "{{base_url}}");
  s = s.replaceAll("{{baseUrl}}", "{{base_url}}");
  s = s.replaceAll("{{baseURL}}", "{{base_url}}");
  return JSON.parse(s);
}

function removeConflictingCollectionVars(collection) {
  if (!Array.isArray(collection.variable)) return;
  collection.variable = collection.variable.filter((v) => {
    const k = v?.key;
    return k !== "baseurl" && k !== "baseUrl" && k !== "baseURL" && k !== "base_url";
  });
}

function ensureJwtEvents(collection) {
  collection.event = collection.event || [];

  if (!collection.event.some((e) => e.listen === "prerequest")) {
    collection.event.push({
      listen: "prerequest",
      script: { type: "text/javascript", exec: PRE_REQUEST.split("\n") },
    });
  }

  if (!collection.event.some((e) => e.listen === "test")) {
    collection.event.push({
      listen: "test",
      script: { type: "text/javascript", exec: COLLECTION_TEST.split("\n") },
    });
  }
}

function enforceJwtAuth(collection) {
  collection.auth = {
    type: "bearer",
    bearer: [{ key: "token", value: "{{access_token}}", type: "string" }],
  };
}

function addAuthFolder(collection) {
  collection.item = collection.item || [];
  if (collection.item.some((it) => it.name === "00 - Auth")) return;

  const authRequest = {
    name: "POST Get Token (Mocked)",
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      url: "{{base_url}}/auth/token",
      body: { mode: "raw", raw: JSON.stringify({ grant_type: "client_credentials" }, null, 2) },
    },
    response: [
      {
        name: "200 OK",
        originalRequest: { method: "POST", url: "{{base_url}}/auth/token" },
        status: "OK",
        code: 200,
        header: [{ key: "Content-Type", value: "application/json" }],
        body: JSON.stringify(
          { access_token: "demo.jwt.token", token_type: "Bearer", expires_in: 300 },
          null,
          2
        ),
      },
    ],
  };

  collection.item.unshift({ name: "00 - Auth", item: [authRequest] });
}

function addOauthSetupFolder(collection) {
  collection.item = collection.item || [];
  if (collection.item.some((it) => it.name === "00 - OAuth2 Setup")) return;

  const oauthRequest = {
    name: "OAuth2 Token Placeholder",
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/x-www-form-urlencoded" }],
      url: "{{oauth_token_url}}",
      body: {
        mode: "urlencoded",
        urlencoded: [
          { key: "grant_type", value: "client_credentials", type: "text" },
          { key: "client_id", value: "{{oauth_client_id}}", type: "text" },
          { key: "client_secret", value: "{{oauth_client_secret}}", type: "text" },
          { key: "scope", value: "{{oauth_scopes}}", type: "text" },
        ],
      },
    },
    event: [
      {
        listen: "test",
        script: {
          type: "text/javascript",
          exec: [
            'console.log("OAuth2 Token Placeholder: configure oauth_token_url/oauth_client_id/etc. with your IdP.");',
            'pm.test("OAuth2 placeholder noop", function () { pm.expect(true).to.be.true; });',
          ],
        },
      },
    ],
  };

  collection.item.unshift({ name: "00 - OAuth2 Setup", item: [oauthRequest] });
}

function setName(collection, name) {
  if (collection?.info?.name) collection.info.name = name;
}

function buildJwtVariant() {
  const doc = normalizeBaseUrlTokens(JSON.parse(JSON.stringify(rawDoc)));
  const col = doc.collection;
  removeConflictingCollectionVars(col);
  enforceJwtAuth(col);
  ensureJwtEvents(col);
  addAuthFolder(col);
  const fullName = `Payments / ${SERVICE_KEY} (JWT Mock)`;
  setName(col, fullName);
  return { doc, fullName };
}

function buildOauthVariant() {
  const doc = normalizeBaseUrlTokens(JSON.parse(JSON.stringify(rawDoc)));
  const col = doc.collection;
  removeConflictingCollectionVars(col);
  addOauthSetupFolder(col);
  const fullName = `Payments / ${SERVICE_KEY} (OAuth2 Ready)`;
  setName(col, fullName);
  return { doc, fullName };
}

const jwtVariant = buildJwtVariant();
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync(outJwt, JSON.stringify(jwtVariant.doc, null, 2));
console.log("✅ Wrote", outJwt, "name:", jwtVariant.fullName);

const oauthVariant = buildOauthVariant();
fs.writeFileSync(outOauth, JSON.stringify(oauthVariant.doc, null, 2));
console.log("✅ Wrote", outOauth, "name:", oauthVariant.fullName);
