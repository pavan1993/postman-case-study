# Contracts

## Auth Contract (OAuth / JWT)

### Inputs
- `base_url` (required)
- **OAuth only**: `client_id`, `client_secret` (required)
- **JWT mock**: none (token issued by stub)

### Outputs (Environment variables)
- `access_token` – required bearer token value
- `token_exp` – epoch seconds when the token expires

### Rules
- Run auth before any Refund Flow request.
- Include `Authorization: Bearer {{access_token}}` on every request.
- Refresh the token when missing or past `token_exp`.

## Refund Flow Output Contract

### Outputs (Environment variables)
- `refundId` – captured after Create Refund; unique per run
- `refundCurrency` – currency for refund amounts; defaults to `USD` if missing
- `refundStatus` – status from the Refund Status request

### Enforcement
- Folder `98 - Contract Check` must succeed.
- `GET Contract Check (Health)` verifies HTTP 200 and asserts the three variables exist and are non-empty; failures list missing keys.

## Notes
- CI runs against a deterministic local stub server.
- Edge-case demos (404/400/429) live under `99 - Edge Cases (Optional)` and do not affect the main happy path.
