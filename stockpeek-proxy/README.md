# stockpeek-proxy — Cloudflare Worker source

The production URL `https://stockpeek-proxy.sngmng.workers.dev/` is a **standalone Cloudflare Worker**, separate from the `stock-peek` Pages website. The previous `functions/` proof-of-concept is **not** the production deployment entrypoint.

## Source of truth

- `src/worker.js`: **Worker entrypoint**, reconstructed from the existing Worker bundle supplied by the operator; preserves `GET /api/stock`, `GET /api/search`, `GET /` and `GET /health`, including quote/search CORS and caching behavior
- `GET /api/health`: new uncached read-only health endpoint (no keys or private bindings returned)
- `POST /api/analyze`: new **restricted operator test endpoint**, imported from `functions/api/analyze.js` (legacy Pages Function handler reused as a plain module)
- `lib/{filings,pipeline,openrouter}.js`: copies of canonical `../server/p4/` modules (enforced via `node scripts/check-proxy-sync.mjs` from repo root)
- `migrations/0001_rate_limits.sql`: D1 operator daily quota table, **not** billing credits
- `wrangler.jsonc`: production-target Worker configuration with existing D1 binding (`ANALYSIS_DB` → `stock-peek`); no credentials or operator tokens
- `tests/workerProxy.test.mjs`: integration-level router contract tests using mocked quotes/search; `tests/pagesProxy.test.mjs`: closed-by-default analyze tests

**The GitHub repo does not control the current Worker automatically.** GitHub commit is not a Cloudflare deployment. The bundle shown in the Cloudflare dashboard did not show a GitHub source attached, so use a deliberately verified Wrangler deployment or connect the Worker to GitHub only after comparing its current settings.

## Deploy safely (operator only)

1. In Cloudflare `stockpeek-proxy` → Settings / Bindings, record the existing binding names and **D1 database name + UUID**. Back up the current Worker code/version before deploying. Compare the reconstructed quote/search behavior against the currently deployed version (price/chart/search are independent and must keep working).
2. The tracked `wrangler.jsonc` already points to the existing database `stock-peek` (UUID `22cd62c8-82f0-4708-9849-4fce7c952ce4`) as `ANALYSIS_DB`. **Confirm this UUID belongs to the same Cloudflare account as the running Worker before deploying.** The non-secret runtime Variables are explicitly declared in `wrangler.jsonc`. Cloudflare Secrets remain dashboard-managed. Do not edit `wrangler.jsonc` to include Secrets. Review every binding in the deployment output before proceeding.
3. Keep `ANALYSIS_ENABLED=0` in `wrangler.jsonc`. Verify the existing Secrets: `DART_API_KEY`, `OPENROUTER_API_KEY`, `ANALYSIS_TEST_TOKEN` (minimum 32 characters), as well as regular Variables `SEC_USER_AGENT`, `P4_MODEL=anthropic/claude-sonnet-5.5`, `ANALYSIS_DAILY_LIMIT=3`. Do **not** store secret values in source or Wrangler vars. Rotate previously displayed credentials.
4. Confirm the `analysis_daily_usage` table exists in the **same** D1 database configured above.
5. Run from the repository root: `node --test tests/pagesProxy.test.mjs tests/workerProxy.test.mjs` and `node scripts/check-proxy-sync.mjs`. Run regular `npm test` and lint/build if dependencies are installed. A GitHub push does not prove tests or upstream connectivity.
6. From the `stockpeek-proxy/` directory, run `npx wrangler deploy --dry-run` using the completed local config. Inspect the Worker entrypoint and D1 binding. Only then, with explicit intent to replace the currently running Worker code, run `npx wrangler deploy`. This is a **live code replacement** and may affect stock quotes; make sure the previous Worker version can be restored.
7. Test `GET /health` and `GET /api/health`. Check `/api/stock?market=KR&symbol=005930&skipChart=1` and `/api/search?market=US&q=MSFT` before any AI experiment. Use the normal service's stock-data smoke tests if available.

**Do not paste the entire production bundle into the Cloudflare Editor with additional `import` statements.** That editor shows a built single-file artifact; the new entrypoint is a multi-file ES module whose imports must be bundled by Wrangler.

## Live safety gate and test order

- By default `POST /api/analyze` yields HTTP **503** `ERR_ANALYSIS_DISABLED` without initiating any paid upstream requests.
- `GET/OPTIONS /api/analyze` yields HTTP **405**, **no CORS**. No browser-based API testing; this test token must **never** be embedded in a public website or Electron app.
- After deployment: verify disabled response, D1 availability and valid token using an **operator-only** client; then temporarily set `ANALYSIS_ENABLED=1` for a minimal JSON v2 test. Calls are quota-counted before the upstream attempt and may consume OpenRouter credits.
- `DART_CORP_MAP_JSON` is needed for Korean stocks (verified 8-digit corporation codes); US SEC requests require a valid `SEC_USER_AGENT` with contact email.
- All reports are **metadata-only** and `generated_unbilled`. There is no news license, filing content extraction, report persistence, end-user identity, paid credits ledger, or actual Electron AI report API integration. API failures intentionally avoid disclosing upstream details; use private debugging.

## Rollback

If deployment breaks legacy stock/search behavior, restore the previous Worker deployment/version using Cloudflare's deployment history and verify both `/api/stock` and `/api/search`. Do not blindly redeploy another revision.

Cloudflare docs: https://developers.cloudflare.com/workers/wrangler/configuration/ | https://developers.cloudflare.com/workers/wrangler/commands/workers/


## Configuration verified 2026-11-23

The operator confirmed Cloudflare Workers binding `ANALYSIS_DB` points to the D1 database named `stock-peek`, UUID `22cd62c8-82f0-4708-9849-4fce7c952ce4`. This is **configuration evidence, not live API validation**. The Secrets `DART_API_KEY`, `OPENROUTER_API_KEY`, `ANALYSIS_TEST_TOKEN` are **not** stored in this repository. Non-secret configuration (`ANALYSIS_ENABLED`, `ANALYSIS_DAILY_LIMIT`, `P4_MODEL`, `SEC_USER_AGENT`) is versioned in `wrangler.jsonc` so a deploy cannot accidentally remove it. No Cloudflare authenticated deployment has been executed from this environment.


## Wrangler 4.166.0 deployment warning (2026-11-23)

The first live deployment warned that the locally configured Worker **removed** all four dashboard plain Variables. Therefore `wrangler.jsonc` now declares those exact public Variables. Confirm they are present in the next `wrangler deploy --dry-run` output and then deploy this configuration. Dashboard Secrets must be checked separately; this change does not validate or expose them. Do not enable analysis until the health endpoint and legacy quote/search routes have been tested.

## One-shot live test on Windows PowerShell 5.1

The operator has already verified that `/health`, `/api/health`, Korean stock quote and US stock search return valid responses, and an unauthenticated `POST /api/analyze` returns HTTP 503 while disabled. These checks do not prove D1 query execution or OpenRouter model connectivity.

**Before live testing:** confirm Secrets `DART_API_KEY`, `OPENROUTER_API_KEY` and `ANALYSIS_TEST_TOKEN` still exist in the same Worker. Know the **actual token value** locally, or rotate it in Cloudflare before using the script. The token must be at least 32 characters (supported alphabet: ASCII letters, digits, underscore, hyphen or period). Do not send it through chat or commit it.

From `stockpeek-proxy` in PowerShell 5.1:

```powershell
.\scripts\smoke-analysis.ps1 -Mode Disabled
.\scripts\run-live-test.ps1 -ConfirmLiveCosts
```

The one-shot runner checks disabled mode first; temporarily changes `ANALYSIS_ENABLED` to `1` in the **local** `wrangler.jsonc`, deploys; verifies missing-token rejection (HTTP 401); prompts for `ANALYSIS_TEST_TOKEN` as a secure input; calls one MSFT 30-day metadata-only report; **restores the original config and deploys disabled mode again in a finally block**, including most error cases. On power loss / forced termination / rollback failure, manually restore `ANALYSIS_ENABLED=0` and run `npx wrangler deploy`, then verify HTTP 503. A live request consumes one daily quota slot before provider calls and may incur API charges even on failures. The script prints result metadata only.

If live request fails, the authenticated endpoint returns allowlisted error codes (e.g. `ERR_ANALYSIS_NO_COVERAGE`, `ERR_MODEL_HTTP`) without raw upstream response or secrets. For D1 quota verification, in the D1 console run:

```sql
SELECT day, used, updated_at FROM analysis_daily_usage ORDER BY updated_at DESC LIMIT 5;
```

Do not paste D1 `token_hash` or private report bodies in bug reports. Investigate `ERR_ANALYSIS_NO_COVERAGE` as SEC fetch/access failures; `ERR_MODEL_HTTP` as provider/authorization/model/JSON Schema issues. Neither indicates successful paid report generation.

Latest known OpenRouter model is `anthropic/claude-sonnet-5.5`. Deployment remains operator-only; do not copy the token into Electron/website assets.

## P6 Pro API (`/v1/*`, `/pay/*`) — not deployed yet

Source: `pro/` (router, auth, credits, reports, payments) and `migrations/0002_pro_accounts.sql`. Everything is closed by default (`PRO_ENABLED=0`, `PRO_PUBLIC=0`, `PRO_REPORTS_ENABLED=0`, `PAYMENTS_ENABLED=0` in `wrangler.jsonc`). `/v1/*` never sends wildcard CORS and rejects requests with an `Origin` header; `/pay/*` are browser pages.

### One-time setup (operator)

1. **Migration**: `npx wrangler d1 execute stock-peek --remote --file=migrations/0002_pro_accounts.sql` (same database as `ANALYSIS_DB`). It only creates new tables.
2. **Secrets** (`npx wrangler secret put <NAME>` — never in `wrangler.jsonc`):
   - `AUTH_PEPPER`: 32+ random characters. Changing it invalidates pending codes only.
   - `ADMIN_TOKEN`: 32+ random characters, for `/v1/admin/credits`.
   - `RESEND_API_KEY`: Resend API key. Verify the `stock-peek.com` sending domain in Resend (DNS records) so `MAIL_FROM` (`몰래주식 <login@stock-peek.com>`) is accepted.
   - `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`: start with **test** keys (`test_ck_`/`test_sk_` or widget `test_gck_`/`test_gsk_`).
3. **Local run**: `npx wrangler dev` with `MAIL_MODE=log` in `.dev.vars` prints sign-in codes to the console instead of sending mail. Never set `MAIL_MODE` on the deployed Worker.

### Rollout order

1. Deploy with all flags 0, check `GET /v1/config` and that `/api/stock`, `/api/search` still work.
2. Closed beta: `PRO_ENABLED=1`, `PRO_REPORTS_ENABLED=1` (keep `PRO_PUBLIC=0`). Testers on Windows set `STOCKPEEK_PRO=1`; grant credits:
   ```bash
   curl -X POST https://stockpeek-proxy.sngmng.workers.dev/v1/admin/credits \
     -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
     -d '{"email":"tester@example.com","amount":5,"kind":"grant","ref":"beta-2026-11-tester"}'
   ```
   Use `"userId":"<id>"` instead of `email` for device-only accounts (no e-mail linked). The account must exist (created on the user's first top-up or report). `kind` is `grant`, `refund` (negative) or `adjust`; `ref` is unique per kind.
3. Payments with Toss **test keys**: `PAYMENTS_ENABLED=1`, complete a test card payment from the app, confirm the balance rises once and reloading `/pay/success` does not add more.
4. Public launch (`PRO_PUBLIC=1`, live keys) only after: Toss merchant review, terms/refund/e-commerce notice pages, privacy pages in 4 languages, account deletion, and the P0 licensing review in `docs/stock-peek-pro.md`.

Refunds: cancel in the Toss dashboard, then record `kind:"refund"` with a negative amount and `ref:"refund-<orderId>"`. The ledger refuses to go below zero.
