# stockpeek-proxy — Cloudflare Worker source

The production URL `https://stockpeek-proxy.sngmng.workers.dev/` is a **standalone Cloudflare Worker**, separate from the `stock-peek` Pages website. The previous `functions/` proof-of-concept is **not** the production deployment entrypoint.

## Source of truth

- `src/worker.js`: **Worker entrypoint**, reconstructed from the existing Worker bundle supplied by the operator; preserves `GET /api/stock`, `GET /api/search`, `GET /` and `GET /health`, including quote/search CORS and caching behavior
- `GET /api/health`: new uncached read-only health endpoint (no keys or private bindings returned)
- `POST /api/analyze`: new **restricted operator test endpoint**, imported from `functions/api/analyze.js` (legacy Pages Function handler reused as a plain module)
- `lib/{filings,pipeline,openrouter}.js`: copies of canonical `../server/p4/` modules (enforced via `node scripts/check-proxy-sync.mjs` from repo root)
- `migrations/0001_rate_limits.sql`: D1 operator daily quota table, **not** billing credits
- `wrangler.example.jsonc`: template, **not** deployable before D1 configuration
- `tests/workerProxy.test.mjs`: integration-level router contract tests using mocked quotes/search; `tests/pagesProxy.test.mjs`: closed-by-default analyze tests

**The GitHub repo does not control the current Worker automatically.** GitHub commit is not a Cloudflare deployment. The bundle shown in the Cloudflare dashboard has no GitHub source attached, so use a deliberately verified Wrangler deployment or connect the Worker to GitHub only after comparing its current settings.

## Deploy safely (operator only)

1. In Cloudflare `stockpeek-proxy` → Settings / Bindings, record the existing binding names and **D1 database name + UUID**. Back up the current Worker code/version before deploying. Compare the reconstructed quote/search behavior against the currently deployed version (price/chart/search are independent and must keep working).
2. Copy `wrangler.example.jsonc` to `wrangler.jsonc` inside this directory. Replace **both** D1 placeholders with the **already existing** D1 database's name/UUID; do not create or bind an empty replacement. Confirm `ANALYSIS_DB` matches the current binding name. Leave `keep_vars: true` to preserve dashboard-set Variables. Wrangler does not delete Secrets during a normal code deploy (per Cloudflare documentation), but **review bindings in deployment output before confirming**.
3. Keep `ANALYSIS_ENABLED=0` in the existing Worker Variables. Verify the existing Secrets: `DART_API_KEY`, `OPENROUTER_API_KEY`, `ANALYSIS_TEST_TOKEN` (minimum 32 characters), as well as regular Variables `SEC_USER_AGENT`, `P4_MODEL=anthropic/claude-sonnet-5.5`, `ANALYSIS_DAILY_LIMIT=3`. Do **not** store secret values in source or Wrangler vars. Rotate previously displayed credentials.
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
