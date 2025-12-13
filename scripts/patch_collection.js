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

const REFUND_GUARD_MARKER = "__REFUND_ID_GUARD__";
const REFUND_GUARD_SCRIPT = `
// ${REFUND_GUARD_MARKER}
const refundId = pm.environment.get("refundId");
if (!refundId || !String(refundId).trim()) {
  throw new Error("refundId missing. Run the Create Refund request first.");
}
`.trim();

const REFUND_CREATE_MARKER = "__REFUND_CREATE_CONTRACT__";
const REFUND_CREATE_TEST = `
// ${REFUND_CREATE_MARKER}
let createData = {};
try { createData = pm.response.json(); } catch (err) { createData = {}; }
const scopes = [
  createData,
  createData.refund,
  createData.data,
  createData.result,
  createData.payload,
  (createData.data && createData.data.refund) || null,
].filter(Boolean);

function pick(keys) {
  for (const scope of scopes) {
    for (const key of keys) {
      if (scope[key] !== undefined && scope[key] !== null) return scope[key];
    }
  }
  return undefined;
}

const refundId = pick(["refundId", "refund_id", "id"]);
const transactionId = pick(["transactionId", "transaction_id"]);
const status = pick(["status", "refundStatus", "refund_status"]);
const amount = pick(["amount", "refundAmount", "refund_amount"]);
const currency = pick(["currency", "refundCurrency", "refund_currency"]);

if (refundId) pm.environment.set("refundId", String(refundId));
if (transactionId) pm.environment.set("transactionId", String(transactionId));
if (status) pm.environment.set("refund_status", status);
if (amount !== undefined && amount !== null) pm.environment.set("refund_amount", amount);
if (currency) pm.environment.set("refund_currency", currency);

pm.test("refundId present", function () {
  pm.expect(refundId, "refundId missing in response").to.be.a("string").and.not.empty;
});

if (amount !== undefined && amount !== null) {
  const amountIsNumeric =
    typeof amount === "number" ||
    (typeof amount === "string" && amount.trim().length > 0 && !Number.isNaN(Number(amount)));
  pm.test("refund_amount numeric", function () {
    pm.expect(amountIsNumeric, "refund_amount must be numeric").to.be.true;
  });
}

if (currency) {
  pm.test("refund_currency present", function () {
    pm.expect(currency, "refund_currency missing").to.be.a("string").and.match(/^[A-Za-z]{3}$/);
  });
}
`.trim();

const REFUND_STATUS_MARKER = "__REFUND_STATUS_CONTRACT__";
const REFUND_STATUS_TEST = `
// ${REFUND_STATUS_MARKER}
let statusData = {};
try { statusData = pm.response.json(); } catch (err) { statusData = {}; }
const latestStatus = statusData.status || statusData.refundStatus || statusData.refund_status;
if (latestStatus) pm.environment.set("refund_status", latestStatus);
pm.test("refund status present", function () {
  pm.expect(latestStatus, "status missing in response").to.exist;
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

function visitRequests(items, cb) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item.request) cb(item);
    if (item.item) visitRequests(item.item, cb);
  }
}

function getUrlString(url) {
  if (!url) return "";
  if (typeof url === "string") return url;
  if (typeof url === "object") {
    if (url.raw) return url.raw;
    const protocol = url.protocol ? `${url.protocol}://` : "";
    const host = Array.isArray(url.host) ? url.host.join(".") : url.host || "";
    const path = Array.isArray(url.path) ? `/${url.path.join("/")}` : url.path || "";
    const query = Array.isArray(url.query)
      ? url.query.map((q) => `${q.key}=${q.value ?? ""}`).join("&")
      : "";
    return `${protocol}${host}${path}${query ? `?${query}` : ""}`;
  }
  return "";
}

function setUrlString(request, newRaw) {
  if (!request?.url) {
    request.url = newRaw;
    return;
  }
  if (typeof request.url === "string") {
    request.url = newRaw;
    return;
  }
  request.url.raw = newRaw;
}

function ensureRequestEvent(item, listen, scriptText, marker) {
  item.event = item.event || [];
  const exists = item.event.some(
    (e) => e.listen === listen && (e.script?.exec || []).join("\n").includes(marker)
  );
  if (exists) return;
  item.event.push({
    listen,
    script: { type: "text/javascript", exec: scriptText.split("\n") },
  });
}

function applyRefundLinking(collection) {
  if (!collection?.item) return;

  visitRequests(collection.item, (entry) => {
    const req = entry.request;
    if (!req) return;
    const method = (req.method || "").toUpperCase();
    let urlStr = getUrlString(req.url);
    if (!urlStr) return;

    const updatedUrl = urlStr
      .replace(/\/refunds\/:refundId/gi, "/refunds/{{refundId}}")
      .replace(/\/refunds\/\{refundId\}/gi, "/refunds/{{refundId}}")
      .replace(/\/refunds\/\{refund_id\}/gi, "/refunds/{{refundId}}")
      .replace(/\/refunds\/\{\{refund_id\}\}/gi, "/refunds/{{refundId}}");

    if (updatedUrl !== urlStr) {
      setUrlString(req, updatedUrl);
      urlStr = updatedUrl;
    }

    const containsRefundId = /\/refunds\/\{\{refundId\}\}/i.test(urlStr);
    const isStatusEndpoint = containsRefundId && /\/refunds\/\{\{refundId\}\}\/status\b/i.test(urlStr);
    const isCancelEndpoint = containsRefundId && /\/refunds\/\{\{refundId\}\}\/cancel\b/i.test(urlStr);
    const isCreateRefund =
      method === "POST" &&
      /\/refunds(?:\b|$|[\?#])/i.test(urlStr) &&
      !containsRefundId &&
      !/\/refunds\/.+/i.test(urlStr);

    if (isCreateRefund) {
      ensureRequestEvent(entry, "test", REFUND_CREATE_TEST, REFUND_CREATE_MARKER);
    }

    if (containsRefundId) {
      ensureRequestEvent(entry, "prerequest", REFUND_GUARD_SCRIPT, REFUND_GUARD_MARKER);
    }

    if (isStatusEndpoint) {
      ensureRequestEvent(entry, "test", REFUND_STATUS_TEST, REFUND_STATUS_MARKER);
    }

  });
}

function prioritizeSuccessResponses(collection) {
  if (!collection?.item) return;
  visitRequests(collection.item, (entry) => {
    if (!Array.isArray(entry.response) || entry.response.length < 2) return;
    const success = [];
    const rest = [];
    for (const res of entry.response) {
      const code = Number(res.code);
      if (Number.isFinite(code) && code >= 200 && code < 300) {
        success.push(res);
      } else {
        rest.push(res);
      }
    }
    if (success.length === 0) return;
    entry.response = [...success, ...rest];
  });
}

function buildJwtVariant() {
  const doc = normalizeBaseUrlTokens(JSON.parse(JSON.stringify(rawDoc)));
  const col = doc.collection;
  removeConflictingCollectionVars(col);
  enforceJwtAuth(col);
  ensureJwtEvents(col);
  addAuthFolder(col);
  applyRefundLinking(col);
  prioritizeSuccessResponses(col);
  const fullName = `Payments / ${SERVICE_KEY} (JWT Mock)`;
  setName(col, fullName);
  return { doc, fullName };
}

function buildOauthVariant() {
  const doc = normalizeBaseUrlTokens(JSON.parse(JSON.stringify(rawDoc)));
  const col = doc.collection;
  removeConflictingCollectionVars(col);
  addOauthSetupFolder(col);
  applyRefundLinking(col);
  prioritizeSuccessResponses(col);
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
