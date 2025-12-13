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
- Required GitHub secrets (confirm exact names): Postman API key, target workspace ID, and workflow inputs for `service_key` / `spec_path`. Example placeholders: `[TODO: POSTMAN_API_KEY]`, `[TODO: WORKSPACE_ID]`.
- How to run:
  1. Ensure OpenAPI spec is committed and the workflow inputs (`service_key`, `spec_path`) point to the API being onboarded.
  2. Trigger the GitHub Actions workflow via manual dispatch or push to `main`, one API per run.
  3. Monitor workflow artifacts/logs; verify the governed collection and environment appear in the correct Postman workspace.
  4. Repeat for the remaining APIs; for other domains, supply the domain workspace ID before running.
- [TODO: link to workflow file or runbook]
- [TODO: screenshot of Postman workspace update]

# Auth Modes
- This pipeline emits two Postman collections so teams can pick the right auth path per API boundary.
- **JWT Mock** collection: pre-request script hits `{{base_url}}/auth/token`, caches a demo token in the environment, and auto-attaches `Authorization: Bearer ...` for every call—best for internal demos.
- **OAuth2 Ready** collection: same requests but wired for OAuth via `{{oauth_token_url}}`, `{{oauth_client_id}}`, `{{oauth_scopes}}`, etc., plus a placeholder “00 - OAuth2 Setup” token request; requires real IdP endpoints before the token call succeeds.
- Planned extension: switch to OAuth2 Ready once partner-facing IdP details and scopes are available.
