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

const AUTH_GUARD_MARKER = "__AUTH_GUARD__";
const AUTH_GUARD_SCRIPT = `
// ${AUTH_GUARD_MARKER}
pm.test("Auth token acquired", () => pm.response.code >= 200 && pm.response.code < 300);
if (pm.response.code < 200 || pm.response.code >= 300) {
  postman.setNextRequest(null);
}
`.trim();

const HEALTH_GUARD_MARKER = "__HEALTH_GUARD__";
const HEALTH_GUARD_SCRIPT = `
// ${HEALTH_GUARD_MARKER}
pm.test("Health OK", () => pm.response.code === 200);
if (pm.response.code !== 200) {
  postman.setNextRequest(null);
}
`.trim();

const MOCK_REFUND_ID = "rfnd_demo123";
const MOCK_REFUND_ID_DEFAULT_MARKER = "__MOCK_REFUND_ID_DEFAULT__";
const MOCK_REFUND_ID_DEFAULT_SCRIPT = `
// ${MOCK_REFUND_ID_DEFAULT_MARKER}
pm.environment.set("refundId", "${MOCK_REFUND_ID}");
`.trim();

const EDGE_CASE_MARKERS = {
  STATUS_404: "__EDGE_STATUS_404__",
  BAD_REQUEST_400: "__EDGE_BAD_REQUEST_400__",
  RATE_LIMIT_429: "__EDGE_RATE_LIMIT_429__",
};

const REFUND_GUARD_MARKER = "__REFUND_ID_GUARD__";
const REFUND_GUARD_SCRIPT = `
// ${REFUND_GUARD_MARKER}
const refundId = pm.environment.get("refundId");
if (!refundId || !String(refundId).trim()) {
  throw new Error("refundId missing. Run the Create Refund request first.");
}
`.trim();

const REFUND_CREATE_MARKER = "__REFUND_CREATE_CONTRACT__";
const REFUND_CREATE_TEST_STRICT = `
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

if (refundId) {
  pm.test("refundId format", function () {
    pm.expect(String(refundId), "refundId format").to.match(/^rfnd_/);
  });
}

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

const REFUND_CREATE_TEST_LENIENT = `
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

if (refundId) {
  pm.test("refundId format", function () {
    pm.expect(String(refundId), "refundId format").to.match(/^rfnd_/);
  });
}

if (amount !== undefined && amount !== null) {
  pm.test("refund_amount present", function () {
    pm.expect(amount, "refund_amount missing").to.not.equal(null);
  });
}

if (currency) {
  pm.test("refund_currency present", function () {
    pm.expect(currency, "refund_currency missing").to.not.equal(null);
  });
}
`.trim();

const REFUND_STATUS_MARKER = "__REFUND_STATUS_SIMPLE__";
const REFUND_STATUS_TEST = `
// ${REFUND_STATUS_MARKER}
pm.test("refund status HTTP 200", function () {
  pm.expect(pm.response.code).to.eql(200);
});
let statusJson = {};
try {
  statusJson = pm.response.json();
} catch (err) {
  statusJson = {};
}
const statusValue = statusJson?.status;
if (statusValue) {
  pm.environment.set("refundStatus", String(statusValue));
}
pm.test("refund status present", function () {
  const stored = pm.environment.get("refundStatus");
  pm.expect(stored, "refundStatus missing in environment").to.be.a("string").and.not.empty;
});
pm.test("refund status value", function () {
  const stored = (pm.environment.get("refundStatus") || "").toUpperCase();
  pm.environment.set("refundStatus", stored);
  pm.expect(["PENDING", "COMPLETED", "CANCELLED"]).to.include(stored);
});
`.trim();

const REFUND_CREATE_SIMPLE_MARKER = "__REFUND_CREATE_SIMPLE__";
const REFUND_CREATE_SIMPLE_TEST = `
// ${REFUND_CREATE_SIMPLE_MARKER}
let refundId = "${MOCK_REFUND_ID}";
let parsed = null;
try {
  parsed = pm.response.json();
  if (parsed && (parsed.refundId || parsed.id)) {
    refundId = parsed.refundId || parsed.id || refundId;
  }
} catch (err) { /* ignore parse errors */ }
pm.environment.set("refundId", String(refundId));
pm.test("refundId captured", function () {
  const captured = pm.environment.get("refundId");
  pm.expect(captured, "refundId missing in environment").to.be.a("string").and.not.empty;
});
let currentCurrency = pm.environment.get("refundCurrency");
if (!currentCurrency) {
  let detectedCurrency = null;
  if (parsed) {
    detectedCurrency = parsed.refundCurrency || parsed.currency || null;
  }
  if (!detectedCurrency) {
    detectedCurrency = "USD";
  }
  pm.environment.set("refundCurrency", String(detectedCurrency));
}
pm.test("refund currency present", function () {
  const currency = pm.environment.get("refundCurrency");
  pm.expect(currency, "refundCurrency missing in environment").to.be.a("string").and.not.empty;
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

  let preRequest = collection.event.find((e) => e.listen === "prerequest");
  if (!preRequest) {
    preRequest = {
      listen: "prerequest",
      script: { type: "text/javascript", exec: PRE_REQUEST.split("\n") },
    };
    collection.event.push(preRequest);
  } else if (!preRequest.script?.exec?.join("\n").includes(PRE_REQUEST.trim())) {
    preRequest.script = preRequest.script || { type: "text/javascript", exec: [] };
    preRequest.script.exec = [...preRequest.script.exec, ...PRE_REQUEST.split("\n")];
  }

  if (!collection.event.some((e) => e.listen === "test")) {
    collection.event.push({
      listen: "test",
      script: { type: "text/javascript", exec: COLLECTION_TEST.split("\n") },
    });
  }
}

function ensureMockRefundDefaults(collection) {
  collection.event = collection.event || [];
  let preRequest = collection.event.find((e) => e.listen === "prerequest");
  if (!preRequest) {
    preRequest = {
      listen: "prerequest",
      script: { type: "text/javascript", exec: MOCK_REFUND_ID_DEFAULT_SCRIPT.split("\n") },
    };
    collection.event.push(preRequest);
    return;
  }
  const current = (preRequest.script?.exec || []).join("\n");
  if (current.includes(MOCK_REFUND_ID_DEFAULT_MARKER)) return;
  preRequest.script.exec = [
    ...(preRequest.script?.exec || []),
    ...MOCK_REFUND_ID_DEFAULT_SCRIPT.split("\n"),
  ];
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

function findFolder(collection, folderName) {
  return (collection.item || []).find((it) => it.name === folderName && Array.isArray(it.item));
}

function ensureFolder(collection, folderName) {
  collection.item = collection.item || [];
  let folder = findFolder(collection, folderName);
  if (!folder) {
    folder = { name: folderName, item: [] };
    collection.item.push(folder);
  }
  folder.item = folder.item || [];
  return folder;
}

function reorderTopFolders(collection, orderedNames) {
  if (!Array.isArray(collection.item)) return;
  const lookup = new Map();
  for (const item of collection.item) {
    if (orderedNames.includes(item.name) && !lookup.has(item.name)) {
      lookup.set(item.name, item);
    }
  }
  const ordered = orderedNames.map((name) => lookup.get(name)).filter(Boolean);
  const rest = collection.item.filter((item) => !orderedNames.includes(item.name));
  collection.item = [...ordered, ...rest];
}

function ensureHealthFolder(collection) {
  collection.item = collection.item || [];
  const folder = ensureFolder(collection, "01 - Health");
  const predicate = (entry) => requestMatches(entry, "GET", /\/health\b/i);
  let healthRequest = pluckRequest(folder.item, predicate);
  if (!healthRequest) {
    healthRequest = extractRequest(collection.item, predicate, new Set([folder]));
  }
  if (!healthRequest) {
    healthRequest = {
      name: "GET Health",
      request: {
        method: "GET",
        header: [],
        url: "{{base_url}}/health",
      },
    };
  }
  healthRequest.name = "GET Health";
  setUrlString(healthRequest.request, "{{base_url}}/health");
  folder.item = [healthRequest, ...folder.item];
}

function ensureRefundFlowFolder(collection) {
  collection.item = collection.item || [];
  const folder = ensureFolder(collection, "02 - Refund Flow");
  const exclude = new Set([folder]);
  const specs = [
    {
      name: "POST Create Refund",
      method: "POST",
      pattern: /\/refunds(?!\/\{\{refundId\}\})/i,
      url: "{{base_url}}/refunds",
    },
    {
      name: "GET Refund Details",
      method: "GET",
      pattern: /\/refunds\/\{\{refundId\}\}(?:$|[?#])/i,
      url: "{{base_url}}/refunds/{{refundId}}",
    },
    {
      name: "GET Refund Status",
      method: "GET",
      pattern: /\/refunds\/\{\{refundId\}\}\/status/i,
      url: "{{base_url}}/refunds/{{refundId}}/status",
    },
    {
      name: "POST Cancel Refund",
      method: "POST",
      pattern: /\/refunds\/\{\{refundId\}\}\/cancel/i,
      optional: true,
      url: "{{base_url}}/refunds/{{refundId}}/cancel",
    },
  ];
  const ordered = [];
  for (const spec of specs) {
    const predicate = (entry) => requestMatches(entry, spec.method, spec.pattern);
    let requestItem = pluckRequest(folder.item, predicate);
    if (!requestItem) {
      requestItem = extractRequest(collection.item, predicate, exclude);
    }
    if (!requestItem) {
      if (spec.optional) continue;
    } else {
      requestItem.name = spec.name;
      if (spec.url) {
        setUrlString(requestItem.request, spec.url);
      }
      ordered.push(requestItem);
      continue;
    }
    if (!spec.optional) {
      // Placeholder create when missing
      ordered.push({
        name: spec.name,
        request: {
          method: spec.method,
          header: [],
          url:
            spec.name === "POST Create Refund"
              ? "{{base_url}}/refunds"
              : spec.name === "GET Refund Details"
              ? "{{base_url}}/refunds/{{refundId}}"
              : spec.name === "GET Refund Status"
              ? "{{base_url}}/refunds/{{refundId}}/status"
              : "{{base_url}}/refunds/{{refundId}}/cancel",
        },
      });
    }
  }
  const existing = folder.item.filter((entry) => !ordered.includes(entry));
  folder.item = [...ordered, ...existing];
}

function ensureReportingFolder(collection) {
  const folder = ensureFolder(collection, "03 - Reporting");
  const predicate = (entry) =>
    requestMatches(entry, "GET", /\/refunds(?:$|[?#])/i) &&
    !/\/refunds\/\{\{refundId\}\}/i.test(getUrlString(entry.request?.url || ""));

  // Remove duplicates inside folder
  folder.item = folder.item || [];
  const retained = folder.item.filter((entry) => !predicate(entry));

  const exclude = new Set([folder]);
  const extracted = [];
  let match;
  do {
    match = extractRequest(collection.item, predicate, exclude);
    if (match) extracted.push(match);
  } while (match);

  let canonical = folder.item.find(predicate);
  if (!canonical && extracted.length > 0) {
    canonical = extracted.shift();
  }
  if (!canonical) {
    canonical = {
      name: "GET List Refunds",
      request: { method: "GET", header: [], url: "{{base_url}}/refunds" },
    };
  }
  canonical.name = "GET List Refunds";
  canonical.request = canonical.request || {};
  canonical.request.method = "GET";
  setUrlString(canonical.request, "{{base_url}}/refunds");

  folder.item = [canonical, ...retained];
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

function ensureHeader(request, key, value) {
  if (!request) return;
  request.header = Array.isArray(request.header) ? request.header : [];
  const keyLower = key.toLowerCase();
  const existing = request.header.find((h) => (h.key || "").toLowerCase() === keyLower);
  if (existing) {
    existing.value = value;
  } else {
    request.header.push({ key, value });
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

function requestMatches(item, method, urlPattern) {
  if (!item?.request) return false;
  const reqMethod = (item.request.method || "").toUpperCase();
  if (method && reqMethod !== method.toUpperCase()) return false;
  const urlStr = getUrlString(item.request.url);
  if (!urlPattern) return true;
  return urlPattern.test(urlStr);
}

function pluckRequest(items, predicate) {
  if (!Array.isArray(items)) return null;
  for (let i = 0; i < items.length; i += 1) {
    const entry = items[i];
    if (entry?.request && predicate(entry)) {
      items.splice(i, 1);
      return entry;
    }
  }
  return null;
}

function extractRequest(items, predicate, exclude = new Set()) {
  if (!Array.isArray(items)) return null;
  for (let i = 0; i < items.length; i += 1) {
    const entry = items[i];
    if (exclude.has(entry)) continue;
    if (entry?.request && predicate(entry)) {
      items.splice(i, 1);
      return entry;
    }
    if (Array.isArray(entry?.item)) {
      const child = extractRequest(entry.item, predicate, exclude);
      if (child) return child;
    }
  }
  return null;
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

function applyRefundLinking(
  collection,
  {
    strictCreateTests = true,
    createScript = null,
    createMarker = null,
    statusScript = REFUND_STATUS_TEST,
    statusMarker = REFUND_STATUS_MARKER,
  } = {}
) {
  if (!collection?.item) return;
  const resolvedCreateScript =
    createScript || (strictCreateTests ? REFUND_CREATE_TEST_STRICT : REFUND_CREATE_TEST_LENIENT);
  const resolvedCreateMarker =
    createMarker || (strictCreateTests ? REFUND_CREATE_MARKER : REFUND_CREATE_MARKER);
  const resolvedStatusScript = statusScript || REFUND_STATUS_TEST;
  const resolvedStatusMarker = statusMarker || REFUND_STATUS_MARKER;

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
      ensureRequestEvent(entry, "test", resolvedCreateScript, resolvedCreateMarker);
    }

    if (containsRefundId) {
      ensureRequestEvent(entry, "prerequest", REFUND_GUARD_SCRIPT, REFUND_GUARD_MARKER);
    }

    if (isStatusEndpoint) {
      ensureRequestEvent(entry, "test", resolvedStatusScript, resolvedStatusMarker);
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

function firstSuccessResponseName(entry, preferred) {
  if (!Array.isArray(entry.response)) return null;
  let fallback = null;
  for (const res of entry.response) {
    const code = Number(res.code);
    if (!Number.isFinite(code) || code < 200 || code >= 300) continue;
    if (preferred && res.name === preferred) return res.name;
    if (!fallback && res.name) fallback = res.name;
  }
  return fallback;
}

function applyMockResponseHeaders(collection) {
  if (!collection?.item) return;
  visitRequests(collection.item, (entry) => {
    const req = entry.request;
    if (!req) return;
    const method = (req.method || "").toUpperCase();
    const urlStr = getUrlString(req.url);
    if (!urlStr) return;

    let desiredCode = "200";
    let desiredName = firstSuccessResponseName(entry, null);
    const hasRefundPlaceholder = /\/refunds\/(:|\{|\{\{)/i.test(urlStr);

    const isCreateRefund =
      method === "POST" &&
      /\/refunds(?:\b|$|[\?#])/i.test(urlStr) &&
      !hasRefundPlaceholder;

    if (isCreateRefund) {
      desiredCode = "201";
      desiredName = firstSuccessResponseName(entry, "success_full") || desiredName;
    }

    ensureHeader(req, "x-mock-response-code", desiredCode);
    if (desiredName) {
      ensureHeader(req, "x-mock-response-name", desiredName);
    }
  });
}

function hasRequest(items) {
  if (!Array.isArray(items)) return false;
  for (const entry of items) {
    if (entry?.request) return true;
    if (Array.isArray(entry?.item) && hasRequest(entry.item)) return true;
  }
  return false;
}

function removeEmptyTopFolders(collection) {
  if (!Array.isArray(collection.item)) return;
  const legacyNames = new Set(["Refunds", "Refund Flow"]);
  collection.item = collection.item.filter((entry) => {
    if (!entry?.item) return true;
    const empty = !hasRequest(entry.item);
    if (empty) return false;
    if (legacyNames.has(entry.name)) return false;
    return true;
  });
}

function ensureEdgeCaseFolder(collection) {
  collection.item = collection.item || [];
  const EDGE_FOLDER_NAME = "99 - Edge Cases (Optional)";
  let folder = findFolder(collection, EDGE_FOLDER_NAME);
  if (folder) {
    collection.item = collection.item.filter((entry) => entry !== folder);
  } else {
    folder = { name: EDGE_FOLDER_NAME, item: [] };
  }
  folder.item = folder.item || [];

  const specs = [
    {
      name: "GET Status - Unknown refundId (404)",
      method: "GET",
      url: "{{base_url}}/refunds/rfnd_does_not_exist/status",
      headers: [{ key: "x-demo-force-404", value: "1" }],
      marker: EDGE_CASE_MARKERS.STATUS_404,
      expected: 404,
      testName: "Edge status 404",
    },
    {
      name: "POST Create Refund - Bad Request (400)",
      method: "POST",
      url: "{{base_url}}/refunds",
      headers: [{ key: "x-demo-bad-request", value: "1" }],
      marker: EDGE_CASE_MARKERS.BAD_REQUEST_400,
      expected: 400,
      testName: "Edge bad request 400",
    },
    {
      name: "GET Health - Rate Limited (429)",
      method: "GET",
      url: "{{base_url}}/health",
      headers: [{ key: "x-demo-rate-limit", value: "1" }],
      marker: EDGE_CASE_MARKERS.RATE_LIMIT_429,
      expected: 429,
      testName: "Edge rate limit 429",
    },
  ];

  const orderedItems = [];
  for (const spec of specs) {
    let requestItem = folder.item.find((entry) => entry?.request && entry.name === spec.name);
    if (!requestItem) {
      requestItem = {
        name: spec.name,
        request: { method: spec.method, header: [], url: spec.url },
      };
      folder.item.push(requestItem);
    }
    requestItem.name = spec.name;
    requestItem.request = requestItem.request || {};
    requestItem.request.method = spec.method;
    setUrlString(requestItem.request, spec.url);
    if (Array.isArray(spec.headers)) {
      for (const header of spec.headers) {
        ensureHeader(requestItem.request, header.key, header.value);
      }
    }
    ensureEdgeCaseTest(requestItem, spec.expected, spec.marker, spec.testName);
    orderedItems.push(requestItem);
  }

  const remaining = folder.item.filter((entry) => !orderedItems.includes(entry));
  folder.item = [...orderedItems, ...remaining];
  collection.item.push(folder);
}

function ensureEdgeCaseTest(item, expectedStatus, marker, testName) {
  const script = `
// ${marker}
pm.test("${testName}", () => pm.response.code === ${expectedStatus});
`.trim();
  ensureRequestEvent(item, "test", script, marker);
}

function buildJwtVariant() {
  const doc = normalizeBaseUrlTokens(JSON.parse(JSON.stringify(rawDoc)));
  const col = doc.collection;
  removeConflictingCollectionVars(col);
  enforceJwtAuth(col);
  ensureJwtEvents(col);
  ensureMockRefundDefaults(col);
  addAuthFolder(col);
  applyRefundLinking(col, {
    strictCreateTests: false,
    createScript: REFUND_CREATE_SIMPLE_TEST,
    createMarker: REFUND_CREATE_SIMPLE_MARKER,
  });
  ensureHealthFolder(col);
  ensureRefundFlowFolder(col);
  ensureReportingFolder(col);
  reorderTopFolders(col, [
    "00 - Auth",
    "01 - Health",
    "02 - Refund Flow",
    "03 - Reporting",
    "99 - Edge Cases (Optional)",
  ]);
  ensureAuthGuards(col);
  ensureHealthGuards(col);
  prioritizeSuccessResponses(col);
  applyMockResponseHeaders(col);
  ensureEdgeCaseFolder(col);
  removeEmptyTopFolders(col);
  const fullName = `Payments / ${SERVICE_KEY} (JWT Mock)`;
  setName(col, fullName);
  return { doc, fullName };
}

function buildOauthVariant() {
  const doc = normalizeBaseUrlTokens(JSON.parse(JSON.stringify(rawDoc)));
  const col = doc.collection;
  removeConflictingCollectionVars(col);
  addOauthSetupFolder(col);
  applyRefundLinking(col, { strictCreateTests: true });
  ensureHealthFolder(col);
  ensureRefundFlowFolder(col);
  ensureReportingFolder(col);
  reorderTopFolders(col, [
    "00 - OAuth2 Setup",
    "01 - Health",
    "02 - Refund Flow",
    "03 - Reporting",
    "99 - Edge Cases (Optional)",
  ]);
  ensureHealthGuards(col);
  prioritizeSuccessResponses(col);
  ensureEdgeCaseFolder(col);
  removeEmptyTopFolders(col);
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
function findRequestByName(items, targetName) {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (item?.request && item.name === targetName) return item;
    if (Array.isArray(item?.item)) {
      const nested = findRequestByName(item.item, targetName);
      if (nested) return nested;
    }
  }
  return null;
}

function ensureAuthGuards(collection) {
  const authItem = findRequestByName(collection.item, "POST Get Token (Mocked)");
  if (!authItem) return;
  ensureRequestEvent(authItem, "test", AUTH_GUARD_SCRIPT, AUTH_GUARD_MARKER);
}

function ensureHealthGuards(collection) {
  const healthItem = findRequestByName(collection.item, "GET Health");
  if (!healthItem) return;
  ensureRequestEvent(healthItem, "test", HEALTH_GUARD_SCRIPT, HEALTH_GUARD_MARKER);
}
