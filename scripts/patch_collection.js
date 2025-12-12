import fs from "fs";

const SERVICE_KEY = process.env.POSTMAN_SERVICE_KEY || "payment-refund-api";

const inPath = "artifacts/collection.generated.json";
const outMock = "artifacts/collection.mock.json";
const outReal = "artifacts/collection.real.json";

const rawDoc = JSON.parse(fs.readFileSync(inPath, "utf8"));

const PRE_REQUEST = `
const now = Math.floor(Date.now() / 1000);
const exp = Number(pm.environment.get("token_exp") || 0);
const token = pm.environment.get("access_token");

function attach(t) {
  pm.request.headers.upsert({ key: "Authorization", value: \`Bearer \${t}\` });
}

if (!token || now > exp - 30) {
  pm.sendRequest({
    url: pm.environment.get("base_url") + "/auth/token",
    method: "POST",
    header: { "Content-Type": "application/json" },
    body: { mode: "raw", raw: JSON.stringify({ grant_type: "client_credentials" }) }
  }, (err, res) => {
    if (err) throw err;
    const j = res.json();
    pm.environment.set("access_token", j.access_token);
    pm.environment.set("token_exp", String(now + (j.expires_in || 300)));
    attach(j.access_token);
  });
} else {
  attach(token);
}
`.trim();

const COLLECTION_TEST = `
pm.test("Authorization header attached", () => {
  pm.expect(pm.request.headers.get("Authorization")).to.match(/^Bearer\\s.+/);
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

function ensureEvents(collection) {
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

function setName(collection, name) {
  if (collection?.info?.name) collection.info.name = name;
}

function buildVariant(variantName) {
  // Start from normalized base_url tokens
  const doc = normalizeBaseUrlTokens(rawDoc);
  const col = doc.collection;

  // Force env-var usage only
  removeConflictingCollectionVars(col);

  // Add auth + scripts (both variants get them; real backend can later swap token endpoint)
  ensureEvents(col);
  addAuthFolder(col);

  // Name the collection deterministically
  const fullName = `Payments / ${SERVICE_KEY} (${variantName})`;
  setName(col, fullName);

  return { doc, fullName };
}

const mock = buildVariant("Mock");
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync(outMock, JSON.stringify(mock.doc, null, 2));
console.log("✅ Wrote", outMock, "name:", mock.fullName);

const real = buildVariant("Real");
fs.writeFileSync(outReal, JSON.stringify(real.doc, null, 2));
console.log("✅ Wrote", outReal, "name:", real.fullName);