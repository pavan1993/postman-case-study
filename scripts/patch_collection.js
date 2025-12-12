import fs from "fs";

const SERVICE_KEY = process.env.POSTMAN_SERVICE_KEY || "payment-refund-api";

const inPath = "artifacts/collection.generated.json";
const outPath = "artifacts/collection.patched.json";

const doc = JSON.parse(fs.readFileSync(inPath, "utf8"));
const col = doc.collection;

const CANONICAL_NAME = `Payments / ${SERVICE_KEY} (Canonical)`;

// Pre-request: fetch mocked token if missing/expired, then attach Authorization header
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

function ensureEvents(targetCol) {
  targetCol.event = targetCol.event || [];

  if (!targetCol.event.some((e) => e.listen === "prerequest")) {
    targetCol.event.push({
      listen: "prerequest",
      script: { type: "text/javascript", exec: PRE_REQUEST.split("\n") },
    });
  }

  if (!targetCol.event.some((e) => e.listen === "test")) {
    targetCol.event.push({
      listen: "test",
      script: { type: "text/javascript", exec: COLLECTION_TEST.split("\n") },
    });
  }
}

function addAuthFolder(targetCol) {
  targetCol.item = targetCol.item || [];
  if (targetCol.item.some((it) => it.name === "00 - Auth")) return;

  const authRequest = {
    name: "POST Get Token (Mocked)",
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      url: "{{base_url}}/auth/token",
      body: {
        mode: "raw",
        raw: JSON.stringify({ grant_type: "client_credentials" }, null, 2),
      },
    },
    response: [
      {
        name: "200 OK",
        originalRequest: { method: "POST", url: "{{base_url}}/auth/token" },
        status: "OK",
        code: 200,
        header: [{ key: "Content-Type", value: "application/json" }],
        body: JSON.stringify(
          {
            access_token: "demo.jwt.token",
            token_type: "Bearer",
            expires_in: 300,
          },
          null,
          2
        ),
      },
    ],
  };

  targetCol.item.unshift({
    name: "00 - Auth",
    item: [authRequest],
  });
}

function removeConflictingCollectionVars(targetCol) {
  // Force env var usage by removing collection variables that might override environment
  if (Array.isArray(targetCol.variable)) {
    targetCol.variable = targetCol.variable.filter(
      (v) => v?.key !== "baseurl" && v?.key !== "base_url"
    );
  }
}

function setCanonicalName(targetCol) {
  if (targetCol?.info?.name) {
    targetCol.info.name = CANONICAL_NAME;
  }
}

// 1) Ensure scripts + auth folder
ensureEvents(col);
addAuthFolder(col);

// 2) Force env key name consistency
// Replace {{baseurl}} -> {{base_url}} anywhere in the JSON
const replacedStr = JSON.stringify(doc).replaceAll("{{baseurl}}", "{{base_url}}");
const doc2 = JSON.parse(replacedStr);

// Rebind after replacement
const col2 = doc2.collection;

// 3) Remove conflicting vars & set canonical name
removeConflictingCollectionVars(col2);
setCanonicalName(col2);

// Ensure events/folder still exist (in case replacement changed structure unexpectedly)
ensureEvents(col2);
addAuthFolder(col2);

fs.writeFileSync(outPath, JSON.stringify(doc2, null, 2));
console.log("✅ Wrote", outPath);
console.log("✅ Canonical collection name:", CANONICAL_NAME);