# Payment Refund API Case Study
CI-driven template that turns OpenAPI specs into governed, versioned Postman workspaces for the Refund domain.  
Ships deterministic JWT Mock + OAuth2 Ready collections plus contracts/environments in one run.  
Designed for template reuse so Domain 2 and every domain after can onboard faster with the same guardrails.

## Quickstart (Template Flow)
1. Use the GitHub “Use this template” button to create your repository, clone it locally, and install dependencies if needed.
2. **Add secrets/vars** under repo settings:
   - `POSTMAN_API_KEY`: Postman key with workspace editor scope
   - `POSTMAN_WORKSPACE_ID`: Target domain workspace ID
   - `POSTMAN_SERVICE_KEY`: Stable API slug used for naming/environments (e.g., `payment-refund-api`)
   - Optional `SPEC_URL`: Remote OpenAPI URL (workflow falls back to repo spec if empty)
   - Optional `vars.POSTMAN_DEBUG`: Set to `true` for verbose logging in upsert scripts
3. **Run workflow**: Trigger “Ingest Refund API into Postman (Mock + Real Canonicals)” via `workflow_dispatch` (preferred). *Pushing to `main` with spec/script/workflow changes also runs it.*
4. **Verify in Postman**: Check the domain workspace for two new collections (`… (JWT Mock) v<run>` and `… (OAuth2 Ready) v<run>`), environments, and contract folders. Repeat per API—one API per run today.
5. *(Optional local dev)*: Run the same Node scripts/Newman command as CI if you need offline validation; otherwise rely on the workflow.

## What It Delivers
- ☑️ Deterministic OpenAPI ingestion + canonical “patching” step adds auth guards, health checks, tests, and folder layout.
- ☑️ Two auth-mode collections (JWT Mock, OAuth2 Ready) plus Dev/QA/UAT/Prod environments and `docs/contracts.md`.
- ☑️ Immutable, versioned POST publishing (no PUT) with build-number suffixes for audit.
- ☑️ Artifacts: `artifacts/collection.*.json`, `artifacts/newman-junit.xml`, `artifacts/summary.md`, `[TODO: link screenshots]`.
- ☑️ Governance guardrails: CI-only publishing, standard naming `<Domain>/<API>`, and contract enforcement folders.

## How It Works
1. **Spec resolution**: Workflow step writes `specs/_resolved/spec.yaml`. If `SPEC_URL` is set, it `curl`s the remote spec; otherwise it copies `payment-refund-api-openapi.yaml`. Planned extension: drop-in AWS (e.g., S3 pre-signed URL) fetch step using the same pattern.
2. **Generation**: `scripts/ingest.js` POSTs the spec to Postman, generates a base collection JSON, and stores it under `artifacts/collection.generated.json` (intermediate file—ignore outside CI).
3. **Patching step**: `scripts/patch_collection.js` applies canonical folders/tests/auth logic, emitting JWT Mock and OAuth2 Ready variants.
4. **Testing**: Local mock server + Newman run gates the build; results land in `artifacts/newman-junit.xml`.
5. **Publishing**: `scripts/upsert_collection.js` now always POSTs new collections with a `v<run>` suffix, preserving prior builds. This provides backward-compatible snapshots for incident debugging. If a “Latest” pointer is ever needed, add a follow-on job that aliases the freshest version—current flow deliberately keeps immutable versions.
6. **Environments & cleanup**: `scripts/upsert_envs.js` ensures one set of environments per API; `scripts/delete_generated_collection.js` removes only the temporary Postman generation artifact. Scheduled cleanup workflow trims old versions down to the last five.

## Business Value, ROI, and $480K Renewal Context
- Engineers burn ~47 minutes in a familiar domain and 2–4 hours cross-domain just to discover auth, endpoints, and execution order. CI-driven ingestion shrinks time-to-first-call to seconds, curbs workspace sprawl, and standardizes documentation.
- ROI (per domain, conservative): 14 engineers × $150/hr × (47−0.5)/60 ≈ 0.77 hrs saved per engineer per week ⇒ ~$1,617/week ⇒ **$84K/year**. This excludes the 2–4 hour discovery cases, MTTR improvements, onboarding acceleration, and defect prevention—$84K is the defensible floor.
- Renewal/expansion tie-in: Consistent collections and guardrails reduce integration risk, accelerate partner onboarding, and minimize regressions. Those reliability + speed gains underpin renewal conversations and expansion likelihood; leadership cites ~$480K upside across productivity, trust, and faster integrations, though this isn’t guaranteed revenue.

## Scaling Strategy
- Reference implementation covers one Payments API; each workflow run handles a single API boundary via `service_key` + spec path, producing two auth-mode collections per API.
- Scale to 15 Payments APIs by rerunning the workflow per API (one per run) while keeping contracts declarative—no platform rewrites required.
- Extend to other domains by pointing secrets at the domain workspace; collections remain API-scoped, workspaces remain domain-scoped, and the same CI guardrails apply to the remaining 46 APIs.

## 90-Day Scaling Roadmap (Ownership + Outcomes)
- **Ownership model**
  - **API Teams**: own OpenAPI specs in GitHub and define per-API output contracts that downstream systems rely on.
  - **Platform / DevProd**: own ingestion, patching, validation, publishing, cleanup, and governance rules so guardrails stay consistent.
  - **Consumers**: consume published collections/environments, rely on contracts instead of tribal knowledge, and run Newman where needed.
- **Days 0–30 (scale 1 → 15 Payments APIs)**
  - Technical: remaining Payments APIs flow through the same workflow, each publishing JWT Mock + OAuth2 Ready collections into the Payments workspace with the standardized folder/auth structure.
  - Technical: per-API output contracts are added declaratively so collections remain deterministic and versioned for every run.
  - Business: discovery cost stops scaling with API count, making Payments a known-good integration surface.
- **Days 31–60 (Payments becomes self-service)**
  - Technical: Postman is the default discovery/validation surface; CI enforces automation-only publishing, stale collection cleanup, and contract checks before consumers break.
  - Technical: platform team focuses on the shared pipeline while domain teams ship changes knowing breakage surfaces in CI.
  - Business: regressions fall, onboarding/support load flattens, and workspace consolidation (413 → N domains) begins in earnest.
- **Days 61–90 (replicate across domains)**
  - Technical: other domains reuse the same workflow, own their workspaces, and automatically publish two collections per API under the same governance model.
  - Technical: platform maintains one framework while new domains onboard faster than Payments did, inheriting the full guardrail set.
  - Business: API discovery feels consistent company-wide, workspace sprawl stabilizes at N domain workspaces, and the ~$480K renewal/expansion narrative shifts from reactive enablement to proactive platform maturity.
- **Why this roadmap works**: each phase removes a different cost (time → risk → coordination) while keeping ownership with API teams, guardrails with Platform, and trust high for consumers.

## Workspace Consolidation
- Move from 413 ad-hoc workspaces to N governed domain workspaces by identifying domain owners, provisioning domain workspaces, and ingesting collections/environments exclusively via CI.
- Lock or deprecate legacy ad-hoc workspaces once consumers receive redirects; rely on the scheduled cleanup workflow plus contract checks to purge duplicates.[TODO: governance diagram]

## Repeatability & Enablement
- Standardized naming (`<Domain>/<API>`), folder layout (Auth, Health, Flow, Reporting, Contract, Edge Cases), auth setup (JWT Mock + OAuth2 Ready), and contracts keep every API consistent.
- Enablement plan: 1-pager onboarding guide, weekly office hours, and an API-team checklist (spec ready, contract rules documented, secrets configured). Domains own specs/inputs; platform owns workflow/governance; consumers consume collections/environments.

## Auth Modes
- **JWT Mock**: Pre-request script hits `{{base_url}}/auth/token`, caches a demo token, and auto-attaches `Authorization: Bearer …` for every call—best for internal demos.
- **OAuth2 Ready**: Same requests but wired for OAuth via `{{oauth_token_url}}`, `{{oauth_client_id}}`, `{{oauth_scopes}}`, etc., plus a placeholder “00 - OAuth2 Setup”; requires real IdP endpoints before the token call succeeds.
- Planned extension: switch to OAuth2 Ready once partner-facing IdP details and scopes are available.

## Troubleshooting
- **SPEC_URL failures**: If the remote download step fails (`curl` non-zero), the workflow stops. Remove the secret or fix the URL; fallback to the repo spec happens only when `SPEC_URL` is empty.
- **Postman API rate limits**: Versioned POST publishing waits 1.5s before writes; if limits still occur, re-run—no cleanup needed because previous versions remain intact.
- **Auth mode confusion**: JWT Mock uses built-in token fetch from the mock server; OAuth2 Ready expects real IdP endpoints and fills `{{oauth_*}}` variables. Check `docs/contracts.md` for required outputs before rerunning.

[TODO: insert relevant screenshots, workflow badges, and workspace links]
