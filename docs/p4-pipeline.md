# P4 — Official filing collection and metadata-only AI prototype

Status: **server-side prototype, not a deployed user feature**. No user login, credit ledger, license-gated news, commercial release, background processing or PDF export.

## Scope and sources

- SEC EDGAR: resolve the **exact** ticker → CIK from `https://www.sec.gov/files/company_tickers_exchange.json` (official) and obtain `https://data.sec.gov/submissions/CIK##########.json`. Use a properly identifying `SEC_USER_AGENT` with a contact email and respect SEC access policies. Each result is **filing metadata only**: form type, accession, filing date and official archive link.
- OpenDART: `https://opendart.fss.or.kr/api/list.json` with your own API key and **verified** 8-digit corporation code. `013` means no filings; other errors are surfaced. For now, configure the ticker-to-corporation-code map explicitly; do **not** guess codes. If paginated, fail closed instead of showing only first-page results as complete.
- News: **disabled**, until commercial AI summarization and text reuse rights are settled and a provider contract is established. No scraping.
- US and KR are supported. Other markets continue working in the existing price widget but cannot generate P4 official filing reports.
- Source timestamps with only a date are marked `precision:'date'`. Do not manufacture an intraday acceptance time. Filing metadata alone cannot establish sales growth, margin change, guidance or investment impact.

Official references:
- https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
- https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001

## Local operator test (private files, no public endpoints)

Create a private input JSON file under the ignored `.private/` directory (do not commit personal holdings or theses). Minimal example:

```json
{
  "schemaVersion":2,
  "locale":"ko",
  "stocks":[{"market":"US","symbol":"NVDA","key":"US:NVDA"}],
  "options":{"includeHoldings":false,"includeHistory":false,"includeThesis":false,"lookbackDays":20}
}
```

Execute on a trusted server or a development machine with recent Node:

```bash
mkdir -p .private
export SEC_USER_AGENT="Stock Peek research you@example.com"
node scripts/p4-analyze.mjs .private/request.json .private/report.json
```

For KR, additionally configure `DART_API_KEY` and `DART_CORP_MAP_JSON` as a JSON mapping of listed ticker to the verified 8-digit `corp_code`, e.g. `{"005930":"<your verified corp code>"}` (placeholder is **not** a runnable code).

Optional experimental LLM narration (server-side only):

```bash
export OPENAI_API_KEY="(secret in environment, never git)"
export P4_ENABLE_MODEL=1
export P4_MODEL=gpt-4o-mini
node scripts/p4-analyze.mjs .private/request.json .private/report-llm.json
```

The CLI produces a local private JSON report file with creation-exclusive writes. It never starts an HTTP listener. Output contains public filing metadata and may include the user's selected holdings in generated report context. Treat input and output as sensitive and do not commit them. The default mode builds a **deterministic metadata report without calling an LLM**.

## Safety, reliability and gaps

- A report requires at least one successfully queried stock. Per-stock errors are explicitly returned under `coverage` and `failures`; partial coverage is *not* described as "no news".
- Request contract: max 5 unique KR/US stocks, bounded activity, explicit consent flags for holdings, history and investment thesis. All user details remain opt-in.
- Official source URLs are validated against known domains. Unknown URLs and invented citation IDs are rejected.
- The optional OpenAI Responses adapter uses strict JSON Schema, `store:false`, a request timeout and server-only API key; model errors/refusals fail closed. **Schema/citation checks do not prove the factual truth of a natural-language interpretation**. Keep this model output experimental until semantic auditing and reliable article/filing content extraction are added.
- No API token belongs in Electron, renderer, preload, public environment variables, GitHub, or a client-requested URL.
- There is **no authenticated Worker API yet**. Do not expose the CLI as a network service or wire the renderer's analysis button directly to it. User authentication, cost ceilings, idempotency and credit settlement are the P6 prerequisites for production.
- Data freshness: from the last requested `lookbackDays` (capped at 30 for official provider fetch) to the server's current time; daily delta vs the **last successful report** requires persistent report metadata and remains pending.
- This version does not parse full SEC/DART document bodies, structured financial statements, earnings, FX rates, licensed news, or user history analytics. It cannot produce the originally promised personalized *impact* judgment. Do not describe it as such.
- Offline tests: `tests/p4Pipeline.test.mjs`, `tests/p4Model.test.mjs`. Live API, key permissions, response changes, rate limits, Windows/macOS integration and API cost are not yet validated.

Next: verified corpus mapping refresh / pagination; official filing body or XBRL financial facts; licensed news; persistent previous-report delta; semantic fact checking; authenticated Worker; UI results; PDF and P6 credit ledger.
