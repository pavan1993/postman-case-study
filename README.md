# Payment Refund API Case Study  
**From 47-minute API discovery to 30-second, CI-driven onboarding — at domain scale**

This repository demonstrates a **production-grade, CI-driven pattern** that turns OpenAPI specifications into **governed, versioned Postman workspaces**.  
It eliminates API discovery friction, reduces integration risk, and scales cleanly across domains without increasing platform burden.

**What changes:**  
- Manual discovery (47 minutes in-domain, 2–4 hours cross-domain) → deterministic, automated onboarding  
- 413 ad-hoc workspaces → N governed domain workspaces  
- Tribal knowledge → contracts enforced in CI  

**What scales:**  
- 1 API → 15 APIs in Payments → 46 more across domains  
- Productivity gains compound while governance stays constant  

---

## Quickstart (Template Flow — < 5 minutes)

1. Click **“Use this template”** on GitHub to create your own repo.
2. Add **GitHub Actions secrets**:
   - `POSTMAN_API_KEY` – editor scope
   - `POSTMAN_WORKSPACE_ID` – target domain workspace
   - `POSTMAN_SERVICE_KEY` – stable API slug (e.g., `payment-refund-api`)
   - *(Optional)* `SPEC_URL` – public OpenAPI URL (falls back to repo spec if unset)
   - *(Optional)* `vars.POSTMAN_DEBUG=true` – verbose logging
3. Run **Actions → “Ingest Refund API into Postman (Mock + Real Canonicals)”**  
   *(Manual run recommended for demos; pushes to `main` also trigger it.)*
4. Verify in Postman:
   - Two new collections:  
     `… (JWT Mock) v<run>` and `… (OAuth2 Ready) v<run>`
   - Dev / QA / UAT / Prod environments
   - Contract and edge-case folders

> This same flow is reused per API. No local execution is required.

## Testing the JWT Mock Collection in Postman (30 seconds)

The JWT Mock collection is designed to be runnable immediately using Postman’s built-in Mock Server.

1. In Postman, open the **JWT Mock** collection created by the workflow.
2. Click **Create Mock Server** for the collection (Postman → Mock Servers).
3. Copy the generated Mock Server URL.
4. Open the corresponding environment (Dev/QA/UAT/Prod) and set:
   - `base_url = <Mock Server URL>`
5. Run the collection:
   - The pre-request script fetches a mock JWT token
   - The token is automatically attached to all requests
   - Requests return deterministic mock responses

This allows engineers to validate auth wiring, request flow, contracts, and tests **without a live backend or IdP**.

---

## What This Delivers (At a Glance)

- **Deterministic ingestion**: OpenAPI → Postman via CI, not manual clicks  
- **Canonical patching**: Auth, health checks, folder layout, tests, contracts  
- **Two auth modes**: JWT Mock (internal/demo) + OAuth2 Ready (partner-facing)  
- **Immutable versioning**: POST-only publishing with build numbers (no PUT)  
- **CI validation**: Mock server + Newman gates before publish  
- **Governance by default**: Naming, lifecycle, cleanup, and contracts enforced automatically  

**Artifacts produced per run**
- `artifacts/collection.generated.json` **(IGNORE — intermediate build artifact)**
- `artifacts/collection.jwt_mock.json` **(Use for mock server testing)**
- `artifacts/collection.oauth2_ready.json` **(Use for IdP-ready testing)**
- `artifacts/newman-junit.xml` **(Test cases)**
- `artifacts/summary.md` **(Test summary)**
- `docs/contracts.md` **(Input and output contracts)**

---

## How It Works (System View)

1. **Spec resolution**  
   CI resolves a single OpenAPI input:
   - If `SPEC_URL` is set → fetch via GitHub raw URL  
   - Else → use repo-local spec  
   *(Same pattern supports AWS/S3 later without changing the pipeline.)*

2. **Generation (transient)**  
   `scripts/ingest.js` creates a base collection JSON.  
   This artifact is **never published** — it exists only for build-time processing.

3. **Patching (governance layer)**  
   `scripts/patch_collection.js` applies:
   - Canonical folder structure
   - Auth wiring
   - Health + flow tests
   - Contract enforcement

4. **Validation**  
   Mock server + Newman run in CI.  
   Failures stop publishing before consumers are impacted.

5. **Publishing (immutable by design)**  
   Each run **POSTs new collections** with a `v<run>` suffix.  
   Older versions remain available for audit and incident debugging.

6. **Environments & lifecycle**  
   Environments are idempotent; scheduled cleanup retains only the last N versions.  
   A scheduled workflow, **“Cleanup Postman Collections,”** automatically removes collection versions older than the most recent five to prevent workspace sprawl while preserving recent history.

---

## Business Value and ROI

### The Problem
- API discovery costs **~47 minutes** even in a known domain
- Cross-domain discovery routinely costs **2–4 hours**
- Manual Postman usage leads to sprawl, inconsistency, and regressions

### The Outcome
- Time-to-first-successful-call drops to **seconds** (~30 seconds)
- Collections become **predictable, governed entry points**
- Consumers trust contracts instead of reverse-engineering APIs

### ROI (Conservative, Per Domain)
- 14 engineers × $150/hr × (47 − 0.5)/60 ≈ **0.77 hrs saved/engineer/week**
- Weekly: ~$1,617  
- Annual: **~$84,000 per domain**

This excludes:
- 2–4 hour discovery cases
- Faster onboarding
- MTTR reductions
- Defect and regression avoidance

####Justification for “seconds to first call”
The “seconds” claim reflects the time required to open a published Postman collection, select the JWT Mock environment, and execute a pre-configured request that already includes authentication, base URLs, headers, and execution order.

This does not assume zero learning time. It measures the first successful API response once discovery artifacts exist—removing manual steps such as reading docs, finding auth flows, constructing requests, or guessing execution order.

In practice, this consistently falls well under one minute for a new engineer or consumer using the governed workspace.

### Why This Matters to Customers
Beyond direct productivity savings, the primary value is **risk reduction and confidence**:
- Fewer breaking changes introduced unknowingly
- Faster, more predictable integrations
- Clear contracts that downstream teams can safely depend on

This leads to stronger developer trust, faster adoption of APIs, and more reliable integrations over time.

---

## Scaling Strategy (Designed, Not Bolted On)

- **Unit of scale**: one API per workflow run
- **Boundary model**:
  - Workspace = domain
  - Collection = API
- **What stays constant as scale grows**:
  - CI workflow
  - Governance rules
  - Validation gates
- **What grows linearly**:
  - Specs
  - Collections
- **What does NOT grow**:
  - Platform effort
  - Consumer learning curve
  - Governance overhead

Scaling from 1 → 15 Payments APIs → 46 more requires **rerunning**, not redesigning.

---

## 90-Day Scaling Roadmap (Ownership + Outcomes)

### Ownership Model (Applies Throughout)
- **API Teams**: own OpenAPI specs and define per-API output contracts  
- **Platform / Dev Productivity**: own ingestion, validation, publishing, cleanup, governance  
- **Consumers**: rely on published collections and contracts, not tribal knowledge  

This keeps autonomy high and bottlenecks low.

### Days 0–30: Scale 1 → 15 Payments APIs
- All Payments APIs onboard via the same CI workflow
- Each publishes JWT Mock + OAuth2 Ready collections
- Contracts are added declaratively per API  
**Outcome:** Discovery cost stops scaling with API count

### Days 31–60: Payments Becomes Self-Service
- CI enforces automation-only publishing and contract checks
- Stale or duplicate assets are removed automatically  
**Outcome:** Fewer regressions, faster incident triage, lower support load

### Days 61–90: Replicate Across Domains
- Other domains reuse the same workflow
- Each domain owns its workspace and APIs  
**Outcome:** Workspace sprawl stabilizes (413 → N domains); discovery becomes consistent company-wide

**Why this works:** each phase removes a different cost — **time → risk → coordination**.

---

## Workspace Consolidation & Governance

- Move from 413 ad-hoc workspaces to **N governed domain workspaces**
- Redirect consumers to CI-published collections
- Deprecate legacy workspaces gradually, not abruptly
- Enforce via automation, not manual policing

> Governance here removes cognitive load — it does not remove autonomy.

---

## Unasked Problems Solved Proactively

- **Spec drift** → CI regeneration from source of truth  
- **Breaking changes** → immutable, versioned collections  
- **Auth confusion** → explicit JWT Mock vs OAuth2 Ready paths  
- **Debugging old incidents** → historical collections preserved  
- **Workspace sprawl** → domain ownership + automated cleanup  

---

## Auth Modes

- **JWT Mock**  
  Internal/demo flow using a mock token endpoint; auto-injects `Authorization` header.

- **OAuth2 Ready**  
  Partner-facing wiring using `{{oauth_*}}` variables and a placeholder setup step.  
  Activates once real IdP endpoints and scopes are available.

---

## Troubleshooting (Top Issues)

- **SPEC_URL failures**: If remote fetch fails, the workflow stops. Remove the secret to fall back to repo spec.
- **Postman API rate limits**: Versioned POST publishing reduces churn; re-run safely — prior versions remain intact.
- **OAuth confusion**: JWT Mock works out of the box; OAuth2 Ready requires real IdP details. Check `docs/contracts.md`.