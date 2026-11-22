# Stock Peek AI daily report (MVP, stage 1)

Status: **domain contract + one-page HTML template only**. No production news integration, no LLM calls, no payment, no PDF download UI yet. This is an intentionally non-deployed foundation.

## Product promise

An on-demand A4 report: **what changed since the previous report**, **why it matters to these watchlist companies**, and optionally **what the changes mean for the holdings the user supplied**.

- Pricing hypothesis: KRW 990 per month.
- Daily entitlement hypothesis: one new report per user per calendar day (Asia/Seoul); retry/duplicate requests must not spend a second credit.
- Up to five selected stocks per A4 page; additional stocks require a separate product decision.
- Read-only analysis; no buy/sell instructions, target prices, automatic trading, or fabricated news.
- No new, substantiated items? State this explicitly rather than inventing changes. Weekends/holidays are expected.

## Stage 1, implemented

- `src/shared/aiReport.js`:
  - Builds a strict and normalized watchlist request. `includeHoldings` defaults to `false`.
  - When explicitly enabled and available, sends only `quantity` and `avgPrice` together with the stock key. No brokerage login, account numbers, or direct portfolio collection.
  - Prepares attributed, ticker-matched evidence within a 72-hour window. Rejects invalid timestamps, insecure URLs, unrelated entities, duplicates, and undated items.
  - Preserves published-at time and stable source ID; compares against `previousEventIds` for daily deltas.
  - **News headline metadata is not proof of article content.** Article excerpts only enter the context when the upstream rights gate sets `reusePermitted: true`.
  - Validates report shape, length, and citation ID references; only **new** events can be cited as today's changes; portfolio paragraph requires explicit user opt-in.
- `src/shared/reportHtml.js`: escapes untrusted text, emits print-targeted A4 HTML with cited source URLs and timestamps. The HTML template is not itself a PDF file.
- `tests/aiReport.test.mjs`: covers opt-in, daily comparison, missing sources, URL/time validation, citation grounding and HTML escaping.

## Implementation plan (subsequent stages)

1. **Provider integration.** Select and commercially license a news feed with stable story IDs, source URLs, explicit publication times and ticker mapping. Add OpenDART/SEC official filing connectors and company identifier maps. Do not scrape publisher article text. Preserve original links. The current stage includes no live news.
2. **Server-side generation.** Cloudflare Workers with authenticated user/license entitlements, daily quota and idempotency keys; D1 tracks permitted usage and previous report IDs; scheduled refresh/cache with per-provider throttles. LLM credentials only in Worker secrets, not app or repo. Fetch data and run deterministic checks before asking the LLM to explain; validate returned JSON against the stage-1 contract.
3. **PDF export and UI.** Electron settings/report view with selected tickers, check box \"Include my holdings\", disclosure of transmitted fields, and request preview. Use a hidden BrowserWindow + `webContents.printToPDF({ pageSize: 'A4' })` and a save dialog. Reject overflow before claiming exactly one page; allow re-download without spending a second credit. Support KO/EN/JA/AR font rendering.
4. **Reliability and pricing.** Persist successful report and its evidence snapshot; compare source IDs to the preceding report for that user; retries after timeouts must not consume quota. Measure token/news API/FX cost; ensure paid news reuse rights and regulatory review before charging.

## Portfolio analysis rules

Interest list != holdings: only rows with a valid quantity and average acquisition price are holdings. If `includeHoldings` is off, holdings data must never be sent.

Cost basis = quantity × average purchase price **in the instrument's currency**. Portfolio value weights require a trustworthy **valuation price**, price time and FX conversion for mixed currencies; never sum KRW and USD numerically. If licensed prices/FX are unavailable, omit portfolio-value weights and only discuss cost-basis composition per currency, clearly labelled.

Do not infer financial suitability, risk tolerance or buy/sell advice from holdings. Report company and sector exposures as factual information.

## Security and validation

- The local request builder enforces convenience and minimization, **not authorization**. The server must re-validate every symbol, ownership of subscription, allowed request size and quota.
- HTTPS source links and attribution metadata are necessary but not sufficient to establish news authenticity; providers must be vetted.
- Treat provider text/LLM text as untrusted data. No HTML from the model is inserted as raw markup.
- Log request IDs, timings, source IDs and errors; avoid logging user's holdings or full generated PDF unless explicitly necessary and consented.
- Fail closed if news licensing, evidence freshness, model verification or quota state is unknown.
- For user-facing outputs distinguish `article published` from `event confirmed`. A headline-only item cannot support a substantive financial claim without checking a permitted full source.
