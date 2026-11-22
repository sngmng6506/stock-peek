# stockpeek-proxy — restricted Cloudflare Pages Functions prototype

This directory is an **independently deployable Pages project**. Nothing here is deployed merely by committing to GitHub. Existing `stockpeek-proxy` Pages settings, connected repository and root directory have **not** been verified by API. Do not overwrite a live project's build configuration or existing routes without first comparing its deployment.

## Repository layout

- `functions/api/health.js` → public `GET /api/health` (status only)
- `functions/api/analyze.js` → **operator-only** `POST /api/analyze` (off by default)
- `functions/_lib/` → exact copies of `server/p4/` (required because Pages project root is this directory)
- `public/` → minimal static page
- `migrations/0001_rate_limits.sql` → D1 quota table; does **not** implement payment credits

Run `node scripts/check-proxy-sync.mjs` from the repository root after modifying canonical P4 modules. The test and deployment must fail if local copies diverge.

## Before enabling any external request

1. In Cloudflare Workers & Pages, inspect **stockpeek-proxy → Settings → Builds**: connected repository, root directory, build command, output directory and production branch. For this directory layout on a Git-connected project: **root directory `stockpeek-proxy`**, output `public`, no build command. Confirm no preexisting Functions or critical proxy routes are being overwritten.
2. The user's `DART_API_KEY` and `OPENROUTER_API_KEY` belong to **production Secret** bindings on this exact Pages project. Never place them in `vars` or Git. If previously displayed in plaintext, rotate the provider credentials. Pages Functions access values with `context.env`.
3. Create a D1 database (e.g. `stockpeek-analysis-test`) and add it as the **`ANALYSIS_DB`** D1 binding to the **same** Pages project's production environment. Apply `migrations/0001_rate_limits.sql` to the database using the Cloudflare D1 console/CLI.
4. Add a **new independent, randomly generated token of at least 32 ASCII characters** as the Secret `ANALYSIS_TEST_TOKEN`. This is NOT an OpenRouter or DART token; keep it off clients and browser JavaScript. For operator testing only, not a scalable user-login design.
5. Configure normal Variables: `SEC_USER_AGENT` (identifiable app and contact email; SEC requirement), `P4_MODEL=anthropic/claude-sonnet-5.5`, `ANALYSIS_DAILY_LIMIT=3` (hard capped at 10 by code), and optionally `DART_CORP_MAP_JSON` (JSON of stock code → **verified** 8-digit OpenDART corporation code). Do not put API keys in `DART_CORP_MAP_JSON`.
6. Keep `ANALYSIS_ENABLED` **absent or `0`** until all other setup and offline tests are ready. When testing, set `ANALYSIS_ENABLED=1`; set back to `0` afterwards.
7. Restrict access via the operator token. **No public Electron UI is connected** and there is no end-user authentication, checkout, billing ledger, refund management or per-account isolation. Do not publish this as a paid user service.

**Important:** The Cloudflare screenshot previously displayed values in a `wrangler.jsonc` `vars` example. Ensure secrets are not present in any config file or Pages project's plain Variables. Changing the UI type does not revoke previously exposed tokens; rotate both in their provider dashboards.

## Test endpoint behavior

| Route | Method | Result |
|---|---|---|
| `/api/health` | GET | `{"ok":true,"service":"stockpeek-proxy","mode":"restricted"}` |
| `/api/analyze` | POST | Disabled by default; requires no Origin header, bearer test token, D1 quota, valid JSON v2, configured upstream Secrets. |
| `/api/analyze` | GET/OPTIONS | 405. Browser-origin requests are denied. No CORS allowed. |

Maximum request body: **12 KB**. Up to five KR/US stocks, maximum 1–10 operator requests/day (D1-enforced), maximum 1200 model output tokens, short upstream timeouts. Each request counts against the **testing quota even if the upstream provider fails**. Testing quota is *not* a monetary credit charge. Nothing is persisted except the daily token hash/quota count in D1; no reports are saved.

Example manual request using an operator shell after deployment (no real token shown):

```bash
curl -sS -X POST 'https://<confirmed-stockpeek-proxy-domain>/api/analyze' \
  -H "Authorization: Bearer ${ANALYSIS_TEST_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data-binary @.private/request.json
```

Do not use an Electron client secret or embedded test token. Use a disposable operator-only shell, not a public website's frontend code. Raw responses may contain user-selected portfolio context; use private files and avoid telemetry.

## Deployment and diagnostics

- Use a Git-integrated Cloudflare Pages project with root `stockpeek-proxy` and output `public`. Pages automatically discovers the project-root `functions/` directory.
- If the existing `stockpeek-proxy` is a **Direct Upload** project or is connected to a different repository/root, changing its setup is a separate Cloudflare operation. This Git commit will not automatically attach or deploy the new project.
- `GET /api/health` must return the JSON response above **after deployment**; only then enable authorized tests. A 404 means Functions have not been deployed at that location.
- Production Secrets can differ from Preview Secrets; use the right environment. Cloudflare may require redeploying after binding changes.
- `ERR_ANALYSIS_DISABLED`: set to 1 only after safe setup; `ERR_UNAUTHORIZED`: missing/wrong test token; `ERR_RATE_DB`: D1 binding/migration missing; `ERR_ANALYSIS_DAILY_LIMIT`: quota exceeded; `ERR_ANALYSIS_FAILED`: upstream/data/model error with details intentionally hidden from public response. Use private diagnostics, never log API URLs containing DART keys.

Source modules remain **filing metadata only** and are not a verified financial analysis. The code blocks unauthorized paid inference by default, but an authorized operator can still spend OpenRouter tokens. News, source-document content verification, real user authorization, report persistence, PDF and billing remain pending.

Official Cloudflare documentation:
- https://developers.cloudflare.com/pages/functions/get-started/
- https://developers.cloudflare.com/pages/functions/bindings/
- https://developers.cloudflare.com/pages/functions/routing/
- https://developers.cloudflare.com/d1/platform/client-api/
