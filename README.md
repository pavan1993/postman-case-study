# Business Value (Problem and Outcome)
- Engineers lose time during API discovery: confirming auth flows, endpoints, schemas, errors, and execution order.
- Discovery takes ~47 min when engineers already know the domain, and 2–4 hrs when ownership is unclear or cross-domain.
- That delay multiplies across onboarding, incident response, cross-team integrations, and spec-change rollouts.
- CI-driven ingestion converts OpenAPI files into governed Postman collections and workspaces, shrinking time-to-first-successful-call to seconds while shrinking workspace sprawl.

# ROI Calculation (Per Domain, Conservative)
- Inputs: 14 engineers × $150/hr × (47 min − 0.5 min)/60 ≈ 0.77 hrs saved per engineer per week.
- Weekly savings: 0.77 × 14 × $150 ≈ $1,617.
- Annual savings: $1,617 × 52 ≈ **$84,000** per domain.
- This excludes the harder 2–4 hr discovery cases, MTTR reductions, onboarding speedups, and defect avoidance—$84K is a defensible floor.

# Scaling Strategy (Apply Pattern to Remaining 46 APIs + Other Domains)
- Reference implementation covers 1 API; each collection maps to an API boundary, each workspace maps to a domain boundary.
- Current run mode: one API per workflow run with parameters `service_key` (stable API identifier) and `spec_path` (OpenAPI file path); collections stay within the owning domain workspace.
- Scale to the remaining 14 APIs in this domain by re-running the workflow per API and defining each API’s output contract declaratively—no platform rewrites.
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


# Configuration / Environment Setup
- GitHub secrets and vars:
  - `POSTMAN_API_KEY`: Postman key with workspace editor scope (used by all scripts).
  - `POSTMAN_WORKSPACE_ID`: target domain workspace receiving spec, collections, and environments.
  - `POSTMAN_SERVICE_KEY`: stable slug per API (used for naming collections/environments).
  - Optional `vars.POSTMAN_DEBUG`: set to `true` for verbose logging from upsert scripts.
- CI execution path (GitHub Actions `Ingest Refund API into Postman (Mock + Real Canonicals)`):
  1. Trigger manually (`workflow_dispatch`) or by pushing changes to `payment-refund-api-openapi.yaml`, `scripts/**`, or `.github/workflows/ingest.yml` on `main`.
  2. Key subprocesses per run:
     - `node scripts/ingest.js`: pushes the OpenAPI spec and emits `artifacts/collection.generated.json` (transient; ignore this file outside CI).
     - `node scripts/patch_collection.js`: generates `artifacts/collection.jwt_mock.json` and `artifacts/collection.oauth2_ready.json`.
     - `node scripts/mock_server.js` + `npx newman run ...`: validates the JWT Mock collection; JUnit output lands in `artifacts/newman-junit.xml`.
     - `node scripts/upsert_collection.js`: publishes both auth-mode collections to the workspace.
     - `node scripts/upsert_envs.js`: ensures Dev/QA/UAT/Prod environments exist once per API.
     - `node scripts/delete_generated_collection.js`: cleans up the intermediate generated collection.
     - Artifacts persist under `artifacts/` (collections, Newman reports, `summary.md`), and contractual expectations live in `docs/contracts.md`.
  3. Weekly hygiene (`Cleanup Postman Collections` workflow) runs `node scripts/cleanup_collections.js` (`RETAIN_LAST_N=5`) to prune legacy versions.

# Auth Modes
- This pipeline emits two Postman collections so teams can pick the right auth path per API boundary.
- **JWT Mock** collection: pre-request script hits `{{base_url}}/auth/token`, caches a demo token in the environment, and auto-attaches `Authorization: Bearer ...` for every call—best for internal demos.
- **OAuth2 Ready** collection: same requests but wired for OAuth via `{{oauth_token_url}}`, `{{oauth_client_id}}`, `{{oauth_scopes}}`, etc., plus a placeholder “00 - OAuth2 Setup” token request; requires real IdP endpoints before the token call succeeds.
- Planned extension: switch to OAuth2 Ready once partner-facing IdP details and scopes are available.
