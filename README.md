# Configuration / Environment Setup
Prerequisites:
- Domain-owned Postman workspace aligned to the API’s business domain.
- Postman API key with editor scope.
- Workspace ID for the governed workspace above.
- Chosen `service_key` slug for the API being onboarded.

1. `git clone https://github.com/pavan1993/postman-case-study.git` (or pull latest) and confirm you can target the chosen workspace.
2. Populate repo secrets/vars:
   - `POSTMAN_API_KEY` (workspace editor scope),
   - `POSTMAN_WORKSPACE_ID` (domain workspace receiving the assets),
   - `POSTMAN_SERVICE_KEY` (stable slug per API),
   - optional `vars.POSTMAN_DEBUG=true` for verbose logging.
3. Trigger the **Ingest Refund API into Postman (Mock + Real Canonicals)** workflow via `workflow_dispatch` (manual run is the cleanest control point). *Note: pushing to `main` with changes to `payment-refund-api-openapi.yaml`, `scripts/**`, or `.github/workflows/ingest.yml` also triggers the same workflow.*
4. Each run performs spec ingestion, collection patching, mock validation, workspace upserts, and cleanup:
   - `node scripts/ingest.js` writes `artifacts/collection.generated.json` (transient; ignore outside CI).
   - `node scripts/patch_collection.js` emits `artifacts/collection.jwt_mock.json` and `artifacts/collection.oauth2_ready.json` (mirrors of the published collections).
   - `node scripts/mock_server.js`/`npx newman run ...` produce `artifacts/newman-junit.xml` for evidence.
   - `node scripts/upsert_collection.js` + `node scripts/upsert_envs.js` publish collections and Dev/QA/UAT/Prod environments, then `node scripts/delete_generated_collection.js` removes the intermediate collection.
   - `artifacts/summary.md` captures the run summary/ROI trace; contracts live in `docs/contracts.md` for quick reference.
5. Confirm the Postman workspace shows both auth-mode collections and the governed environments; repeat the workflow per API (one API per run today) or per domain workspace as needed.
6. Leave ongoing retention to the scheduled **Cleanup Postman Collections** workflow (`node scripts/cleanup_collections.js` with `RETAIN_LAST_N=5`), which keeps only the last five versions per collection.

# Business Value (Problem and Outcome)
- Engineers lose time during API discovery: confirming auth flows, endpoints, schemas, errors, and execution order.
- Discovery takes ~47 min when engineers already know the domain, and 2–4 hrs when ownership is unclear or cross-domain.
- That delay multiplies across onboarding, incident response, cross-team integrations, and spec-change rollouts.
- CI-driven ingestion converts OpenAPI files into governed Postman collections and workspaces, shrinking time-to-first-successful-call to seconds while shrinking workspace sprawl.

# ROI Calculation (Per Domain, Conservative)
- Inputs: 14 engineers × $150/hr × (47 min − 0.5 min)/60 ≈ 0.77 hrs saved per engineer per week.
- Weekly savings: 0.77 × 14 × $150 ≈ $1,617.
- Annual savings: $1,617 × 52 ≈ **$84,000** per domain.
- This excludes the harder 2–4 hr discovery cases, MTTR reductions, onboarding speedups, and defect avoidance—$84K is a defensible per-domain floor.

# Scaling Strategy (Apply Pattern to Remaining 46 APIs + Other Domains)
- Reference implementation covers 1 API; each collection maps to an API boundary, each workspace maps to a domain boundary.
- Current run mode: one API per workflow run with parameters `service_key` (stable API identifier) and `spec_path` (OpenAPI file path); collections stay within the owning domain workspace.
- Scale to the remaining 14 APIs in this domain (and the remaining 46 overall) by re-running the workflow per API and defining each API’s output contract declaratively—no platform rewrites.
- Extend to other domains: each domain stands up its workspace, each API lands in its collection, and the platform keeps one ingestion/governance framework.
- Planned extension: batch onboarding via a `services.json` registry and GitHub Actions matrix runs once ready.

# Workspace Consolidation (Migration Plan + Governance)
- Starting point: 413 ad-hoc workspaces causing fragmentation.
- Target: map those assets into governed workspaces, one per domain (not a single monolith).
- Governance:
  - Standard naming `<Domain>/<API>` with folders for Auth, Health, Flow, Reporting, Contract, Edge Cases.
  - CI-only publishing; manual uploads discouraged.
  - Automated retention/cleanup to purge stale or duplicate collections.
  - Contract checks in CI to protect downstream consumers.
- Migration plan:
  - Identify domain owners and map each API to its domain.
  - Stand up the domain workspaces and drive ingestion through CI.
  - Lock/deprecate old ad-hoc workspaces and redirect consumers.
  - Keep enforcing through automation and cleanup jobs.
- [TODO: insert consolidation diagram or screenshot]

# Auth Modes
- This pipeline emits two Postman collections so teams can pick the right auth path per API boundary.
- **JWT Mock** collection: pre-request script hits `{{base_url}}/auth/token`, caches a demo token in the environment, and auto-attaches `Authorization: Bearer ...` for every call—best for internal demos.
- **OAuth2 Ready** collection: same requests but wired for OAuth via `{{oauth_token_url}}`, `{{oauth_client_id}}`, `{{oauth_scopes}}`, etc., plus a placeholder “00 - OAuth2 Setup” token request; requires real IdP endpoints before the token call succeeds.
- Planned extension: switch to OAuth2 Ready once partner-facing IdP details and scopes are available.
