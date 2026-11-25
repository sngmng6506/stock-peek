import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analysisConfigFromEnv,
  prepareAnalysisBody,
  normalizeAnalysisResult,
  requestAnalysis,
  ANALYSIS_MAX_BODY_BYTES,
  DEFAULT_ANALYSIS_ENDPOINT
} from '../src/shared/reportClient.js'
import { createAnalysisPipeline } from '../server/p4/pipeline.js'

const TOKEN = 'a'.repeat(40)
const config = { endpoint: DEFAULT_ANALYSIS_ENDPOINT, token: TOKEN }

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

test('config requires an operator token from the environment and https endpoint', () => {
  assert.equal(analysisConfigFromEnv({}), null)
  assert.equal(analysisConfigFromEnv({ STOCKPEEK_ANALYSIS_TOKEN: 'short' }), null)
  assert.deepEqual(analysisConfigFromEnv({ STOCKPEEK_ANALYSIS_TOKEN: TOKEN }), config)
  assert.equal(
    analysisConfigFromEnv({
      STOCKPEEK_ANALYSIS_TOKEN: TOKEN,
      STOCKPEEK_ANALYSIS_URL: 'http://example.com/api/analyze'
    }),
    null
  )
  assert.equal(
    analysisConfigFromEnv({
      STOCKPEEK_ANALYSIS_TOKEN: TOKEN,
      STOCKPEEK_ANALYSIS_URL: 'http://127.0.0.1:8787/api/analyze'
    }).endpoint,
    'http://127.0.0.1:8787/api/analyze'
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

test('requestAnalysis sends bearer JSON and maps server errors to safe codes', async () => {
  let sent
  const result = await pipelineResult([])
  const report = await requestAnalysis({
    fetchImpl: async (url, init) => {
      sent = { url, init }
      return okFetch(result)()
    },
    config,
    request: request()
  })
  assert.equal(sent.url, DEFAULT_ANALYSIS_ENDPOINT)
  assert.equal(sent.init.method, 'POST')
  assert.equal(sent.init.headers.authorization, 'Bearer ' + TOKEN)
  assert.equal(JSON.parse(sent.init.body).schemaVersion, 2)
  assert.equal(report.noNewEvents, true)

  const cases = [
    [503, 'ERR_ANALYSIS_DISABLED', /ERR_ANALYSIS_DISABLED/],
    [401, 'ERR_UNAUTHORIZED', /ERR_UNAUTHORIZED/],
    [429, 'ERR_ANALYSIS_DAILY_LIMIT', /ERR_ANALYSIS_DAILY_LIMIT/],
    [503, 'ERR_SECRETS_MISSING', /ERR_ANALYSIS_FAILED/],
    [502, 'ERR_MODEL_HTTP', /ERR_ANALYSIS_FAILED/],
    [413, 'ERR_REQUEST_TOO_LARGE', /ERR_ANALYSIS_TOO_LARGE/]
  ]
  for (const [status, code, expected] of cases) {
    await assert.rejects(
      requestAnalysis({ fetchImpl: okFetch(code, status), config, request: request() }),
      expected
    )
  }
  await assert.rejects(
    requestAnalysis({
      fetchImpl: async () => {
        throw new Error('offline')
      },
      config,
      request: request()
    }),
    /ERR_ANALYSIS_NETWORK/
  )
  await assert.rejects(
    requestAnalysis({
      fetchImpl: (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason))
        ),
      config,
      request: request(),
      timeoutMs: 10
    }),
    /ERR_ANALYSIS_TIMEOUT/
  )
  await assert.rejects(
    requestAnalysis({ fetchImpl: okFetch(result), config: null, request: request() }),
    /ERR_ANALYSIS_UNAVAILABLE/
  )
})
