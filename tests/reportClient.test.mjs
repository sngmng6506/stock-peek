import test from 'node:test'
import assert from 'node:assert/strict'
import {
  prepareAnalysisBody,
  normalizeAnalysisResult,
  ANALYSIS_MAX_BODY_BYTES
} from '../src/shared/reportClient.js'
import {
  apiOriginFromEnv,
  createProClient,
  isCheckoutUrl,
  DEFAULT_API_ORIGIN
} from '../src/shared/proClient.js'
import { createAnalysisPipeline } from '../server/p4/pipeline.js'

const TOKEN = 'a'.repeat(40)

const request = (over = {}) => ({
  schemaVersion: 2,
  asOf: '2026-11-25T00:00:00.000Z',
  locale: 'ko',
  stocks: [
    { market: 'US', symbol: 'NVDA', key: 'US:NVDA' },
    { market: 'KR', symbol: '005930', key: 'KR:005930' }
  ],
  options: {
    includeHoldings: false,
    includeHistory: false,
    includeThesis: false,
    lookbackDays: 90
  },
  ...over
})

const secFiling = {
  id: 'sec:0001045810-26-000100',
  kind: 'filing',
  title: 'SEC Form 10-Q',
  publisher: 'U.S. SEC EDGAR',
  publishedAt: '2026-11-20T00:00:00.000Z',
  precision: 'date',
  url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000100/nvda-10q.htm',
  stockKeys: ['US:NVDA'],
  evidenceLevel: 'filing-metadata'
}

async function pipelineResult(records = [secFiling]) {
  const run = createAnalysisPipeline({
    filings: { collect: async (stock) => records.filter((r) => r.stockKeys[0] === stock.key) },
    now: () => '2026-11-25T00:00:00.000Z'
  })
  return run(request())
}

const okFetch =
  (result, status = 200) =>
  async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => (status === 200 ? { ok: true, result } : { ok: false, error: result })
  })

test('API origin override accepts https or a local wrangler dev server only', () => {
  assert.equal(apiOriginFromEnv({}), DEFAULT_API_ORIGIN)
  assert.equal(
    apiOriginFromEnv({ STOCKPEEK_API_URL: 'http://127.0.0.1:8787/x' }),
    'http://127.0.0.1:8787'
  )
  assert.equal(apiOriginFromEnv({ STOCKPEEK_API_URL: 'http://evil.example' }), DEFAULT_API_ORIGIN)
  assert.equal(
    apiOriginFromEnv({ STOCKPEEK_API_URL: 'https://staging.example/' }),
    'https://staging.example'
  )
  const tok = 'A'.repeat(43)
  assert.equal(isCheckoutUrl(DEFAULT_API_ORIGIN + '/pay/' + tok, DEFAULT_API_ORIGIN), true)
  assert.equal(isCheckoutUrl('https://evil.example/pay/' + tok, DEFAULT_API_ORIGIN), false)
  assert.equal(
    isCheckoutUrl(DEFAULT_API_ORIGIN + '/pay/' + tok + '?x=1', DEFAULT_API_ORIGIN),
    false
  )
})

test('body rejects unsupported markets and oversize payloads; drops empty thesis', () => {
  assert.throws(
    () =>
      prepareAnalysisBody(request({ stocks: [{ market: 'JP', symbol: '7203', key: 'JP:7203' }] })),
    /ERR_ANALYSIS_MARKET/
  )
  const thesisless = JSON.parse(
    prepareAnalysisBody(
      request({
        options: { ...request().options, includeThesis: true },
        investmentThesis: { text: '', horizon: 'long', focus: 'balanced' }
      })
    )
  )
  assert.equal(thesisless.investmentThesis, undefined)
  const activity = Array.from({ length: 100 }, () => ({
    type: 'watchlist_added',
    occurredAt: '2026-11-20T00:00:00.000Z',
    stock: { market: 'US', symbol: 'NVDA' },
    before: null,
    after: { market: 'US', symbol: 'NVDA' },
    semantic: 'watchlist_change'
  }))
  assert.throws(
    () =>
      prepareAnalysisBody(
        request({ options: { ...request().options, includeHistory: true }, activity })
      ),
    /ERR_ANALYSIS_TOO_LARGE/
  )
  assert.ok(ANALYSIS_MAX_BODY_BYTES <= 12_000)
})

test('normalizes a real pipeline result and keeps holdings out of the stored report', async () => {
  const result = await pipelineResult()
  const report = normalizeAnalysisResult(result, request())
  assert.equal(report.status, 'generated_unbilled')
  assert.equal(report.sources.length, 1)
  assert.equal(report.highlights[0].sourceIds[0], secFiling.id)
  assert.equal(report.noNewEvents, false)
  assert.deepEqual(
    report.stocks.map((s) => Object.keys(s)),
    [
      ['market', 'symbol', 'key'],
      ['market', 'symbol', 'key']
    ]
  )
  assert.deepEqual(
    report.coverage.map((c) => c.status),
    ['ok', 'ok']
  )
})

test('rejects responses citing unknown sources, foreign hosts or unrequested stocks', async () => {
  const result = await pipelineResult()
  const clone = () => structuredClone(result)
  const badCite = clone()
  badCite.report.highlights[0].sourceIds = ['sec:other']
  assert.throws(() => normalizeAnalysisResult(badCite, request()), /ERR_ANALYSIS_RESPONSE/)
  const badHost = clone()
  badHost.report.sources[0].url = 'https://evil.example/x'
  assert.throws(() => normalizeAnalysisResult(badHost, request()), /ERR_ANALYSIS_RESPONSE/)
  const badStock = clone()
  badStock.report.sources[0].stockKeys = ['US:TSLA']
  assert.throws(() => normalizeAnalysisResult(badStock, request()), /ERR_ANALYSIS_RESPONSE/)
  const billed = clone()
  billed.status = 'billed'
  assert.throws(() => normalizeAnalysisResult(billed, request()), /ERR_ANALYSIS_RESPONSE/)
  const note = clone()
  note.report.portfolioNote = 'Holdings note'
  assert.throws(() => normalizeAnalysisResult(note, request()), /ERR_ANALYSIS_RESPONSE/)
})

test('pro client sends bearer + idempotency key and maps errors to safe codes', async () => {
  let sent
  const result = { ...(await pipelineResult([])), status: 'generated_billed' }
  const client = (fetchImpl, token = TOKEN) =>
    createProClient({ fetchImpl, origin: DEFAULT_API_ORIGIN, getToken: () => token })
  const report = await client(async (url, init) => {
    sent = { url, init }
    return okFetch(result)()
  }).createReport(request(), 'key-0123456789abcdef')
  assert.equal(sent.url, DEFAULT_API_ORIGIN + '/v1/reports')
  assert.equal(sent.init.method, 'POST')
  assert.equal(sent.init.headers.authorization, 'Bearer ' + TOKEN)
  assert.equal(sent.init.headers['idempotency-key'], 'key-0123456789abcdef')
  assert.equal(JSON.parse(sent.init.body).schemaVersion, 2)
  assert.equal(report.status, 'generated_billed')
  assert.equal(report.noNewEvents, true)

  const cases = [
    [402, 'ERR_CREDITS_INSUFFICIENT', /ERR_CREDITS_INSUFFICIENT/],
    [401, 'ERR_SESSION_INVALID', /ERR_SESSION_INVALID/],
    [429, 'ERR_ANALYSIS_DAILY_LIMIT', /ERR_ANALYSIS_DAILY_LIMIT/],
    [502, 'ERR_MODEL_HTTP', /ERR_ANALYSIS_FAILED/],
    [500, 'ERR_INTERNAL', /ERR_ANALYSIS_FAILED/]
  ]
  for (const [status, code, expected] of cases)
    await assert.rejects(
      client(okFetch(code, status)).createReport(request(), 'k'.repeat(16)),
      expected
    )
  await assert.rejects(
    client(async () => {
      throw new Error('offline')
    }).me(),
    /ERR_PRO_NETWORK/
  )
  await assert.rejects(client(okFetch(result), null).me(), /ERR_SESSION_INVALID/)
  await assert.rejects(
    client(okFetch({ url: 'https://evil.example/pay/' + 'A'.repeat(43) })).checkout(),
    /ERR_PRO_FAILED/
  )
})
