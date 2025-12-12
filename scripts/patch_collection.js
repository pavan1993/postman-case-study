import fs from "fs";

const inPath = "artifacts/collection.generated.json";
const outPath = "artifacts/collection.patched.json";

const doc = JSON.parse(fs.readFileSync(inPath, "utf8"));
const col = doc.collection;

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

function ensureEvents() {
  col.event = col.event || [];
  const hasPre = col.event.some(e => e.listen === "prerequest");
  const hasTest = col.event.some(e => e.listen === "test");

  if (!hasPre) {
    col.event.push({
      listen: "prerequest",
      script: { type: "text/javascript", exec: PRE_REQUEST.split("\n") }
    });
  }
  if (!hasTest) {
    col.event.push({
      listen: "test",
      script: { type: "text/javascript", exec: COLLECTION_TEST.split("\n") }
    });
  }
}

function addAuthFolderAndRequest() {
  col.item = col.item || [];

  const authRequest = {
    name: "POST Get Token (Mocked)",
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      url: "{{base_url}}/auth/token",
      body: { mode: "raw", raw: JSON.stringify({ grant_type: "client_credentials" }, null, 2) }
    },
    response: [
      {
        name: "200 OK",
        originalRequest: {
          method: "POST",
          url: "{{base_url}}/auth/token"
        },
        status: "OK",
        code: 200,
        header: [{ key: "Content-Type", value: "application/json" }],
        body: JSON.stringify({
          access_token: "demo.jwt.token",
          token_type: "Bearer",
          expires_in: 300
        }, null, 2)
      }
    ]
  };

  const authFolder = {
    name: "00 - Auth",
    item: [authRequest]
  };

  const exists = col.item.some(it => it.name === "00 - Auth");
  if (!exists) col.item.unshift(authFolder);
}

ensureEvents();
addAuthFolderAndRequest();

fs.writeFileSync(outPath, JSON.stringify(doc, null, 2));
console.log("Wrote", outPath);