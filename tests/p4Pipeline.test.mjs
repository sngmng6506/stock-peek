import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findSecCik,
  parseSecSubmissions,
  parseDartList,
  createOfficialFilingProvider
} from '../server/p4/filings.js'
import {
  createAnalysisPipeline,
  validateAnalysisRequest,
  metadataOnlyReport
} from '../server/p4/pipeline.js'

const asOf = '2026-11-22T12:00:00.000Z'
const since = '2026-11-01T00:00:00.000Z'
const stock = { market: 'US', symbol: 'NVDA', key: 'US:NVDA' }
const kr = { market: 'KR', symbol: '005930', key: 'KR:005930' }
const request = {
  schemaVersion: 2,
  locale: 'ko',
  stocks: [stock],
  options: { includeHoldings: false, includeHistory: false, includeThesis: false, lookbackDays: 20 }
}
const filing = (overrides = {}) => ({
  id: 'sec:0001045810-26-000010',
  kind: 'filing',
  title: 'SEC Form 8-K',
  publisher: 'U.S. SEC EDGAR',
  publishedAt: '2026-11-20T00:00:00.000Z',
  precision: 'date',
  url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000010/one.htm',
  stockKeys: ['US:NVDA'],
  evidenceLevel: 'filing-metadata',
  ...overrides
})
test('SEC company identifier is mapped by ticker, not an unverified guessed CIK', () => {
  const map = {
    fields: ['cik', 'name', 'ticker', 'exchange'],
    data: [
      [1045810, 'NVIDIA CORP', 'NVDA', 'Nasdaq'],
      [320193, 'APPLE INC', 'AAPL', 'Nasdaq']
    ]
  }
  assert.equal(findSecCik(map, 'NVDA'), '0001045810')
  assert.throws(() => findSecCik(map, 'INVALID'), /ERR_SEC_UNMAPPED/)
  assert.throws(() => findSecCik({ fields: ['name'], data: [] }, 'NVDA'), /ERR_SEC_MAPPING/)
})
test('SEC filing metadata has official accession and URL but no inferred contents', () => {
  const result = parseSecSubmissions(
    {
      cik: 1045810,
      filings: {
        recent: {
          accessionNumber: ['0001045810-26-000010', 'INVALID'],
          form: ['8-K', '8-K'],
          primaryDocument: ['one.htm', 'bad.htm'],
          filingDate: ['2026-11-20', '2026-11-20']
        }
      }
    },
    stock,
    asOf,
    since
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].precision, 'date')
  assert.equal(result[0].evidenceLevel, 'filing-metadata')
  assert.match(result[0].url, /sec.gov\/Archives\/edgar/)
  assert.equal(result[0].excerpt, undefined)
})
test('DART date-only filing is not fictionalized as article contents', () => {
  const result = parseDartList(
    {
      status: '000',
      list: [
        { rcept_no: '20261120000001', report_nm: '정기보고서', rcept_dt: '20261120' },
        { rcept_no: 'oops', report_nm: '기타', rcept_dt: '20261120' }
      ]
    },
    kr,
    asOf,
    since
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].precision, 'date')
  assert.match(result[0].url, /dart.fss.or.kr/)
  assert.deepEqual(parseDartList({ status: '013' }, kr, asOf, since), [])
  assert.throws(
    () => parseDartList({ status: '999', message: 'bad key' }, kr, asOf, since),
    /ERR_DART_RESPONSE/
  )
})
test('DART unmapped stock and missing key refuse to guess', async () => {
  const mock = async () => {
    throw Error('network should not run')
  }
  const f = createOfficialFilingProvider({ fetchJson: mock, dartApiKey: 'demo', dartCorpMap: {} })
  await assert.rejects(() => f.collect(kr, { asOf, since }), /ERR_DART_UNMAPPED/)
})
test('DART query is constrained and pagination fails closed', async () => {
  let url
  const f = createOfficialFilingProvider({
    fetchJson: async (u) => {
      url = u
      return { status: '000', total_page: 2, list: [] }
    },
    dartApiKey: 'demo',
    dartCorpMap: { '005930': '00126380' }
  })
  await assert.rejects(() => f.collect(kr, { asOf, since }), /ERR_DART_PAGINATION/)
  assert.equal(new URL(url).hostname, 'opendart.fss.or.kr')
  assert.equal(new URL(url).searchParams.get('corp_code'), '00126380')
})
test('SEC provider requires identifiable contact user agent', async () => {
  const f = createOfficialFilingProvider({ fetchJson: async () => ({}), secUserAgent: 'NoContact' })
  await assert.rejects(() => f.collect(stock, { asOf, since }), /ERR_SEC_USER_AGENT/)
})
test('analysis request rejects unconsented holdings and thesis', () => {
  assert.throws(
    () =>
      validateAnalysisRequest({
        ...request,
        stocks: [{ ...stock, holding: { quantity: 2, avgPrice: 50 } }]
      }),
    /ERR_ANALYSIS_CONSENT/
  )
  assert.throws(
    () => validateAnalysisRequest({ ...request, investmentThesis: { text: 'x' } }),
    /ERR_ANALYSIS_CONSENT/
  )
  assert.throws(
    () =>
      validateAnalysisRequest({
        ...request,
        options: { ...request.options, includeHistory: true },
        activity: [{ type: 'holding_edited', stock, occurredAt: asOf }]
      }),
    /ERR_ANALYSIS_CONSENT/
  )
})
test('normal metadata report only states filings were submitted', () => {
  const result = metadataOnlyReport(request, [filing()])
  assert.equal(result.highlights.length, 1)
  assert.match(result.summary, /metadata/)
  assert.equal(result.portfolioNote, null)
})
test('pipeline builds strictly attributed report without billing', async () => {
  const pipeline = createAnalysisPipeline({
    filings: { collect: async () => [filing()] },
    now: () => asOf
  })
  const output = await pipeline(request)
  assert.equal(output.status, 'generated_unbilled')
  assert.equal(output.report.highlights[0].sourceIds[0], filing().id)
  assert.equal(output.report.sources.length, 1)
  assert.equal(output.dataLevel, 'filing_metadata_only')
})
test('incomplete source coverage is visible; total loss fails closed', async () => {
  const partial = createAnalysisPipeline({
    filings: {
      collect: async (s) => {
        if (s.market === 'KR') throw new Error('ERR_DART_UNMAPPED')
        return [filing()]
      }
    },
    now: () => asOf
  })
  const expanded = { ...request, stocks: [stock, kr] }
  const result = await partial(expanded)
  assert.equal(result.failures[0].code, 'ERR_DART_UNMAPPED')
  assert.equal(result.coverage[1].status, 'unavailable')
  const none = createAnalysisPipeline({
    filings: {
      collect: async () => {
        throw Error('blocked')
      }
    },
    now: () => asOf
  })
  await assert.rejects(() => none(request), /ERR_ANALYSIS_NO_COVERAGE/)
})
test('news cannot be enabled without licensed provider contract', async () => {
  const p = createAnalysisPipeline({
    filings: { collect: async () => [] },
    news: {},
    now: () => asOf
  })
  await assert.rejects(() => p(request), /ERR_NEWS_NOT_LICENSED/)
})
test('unknown source URL and fabricated model citations are rejected', async () => {
  const malicious = createAnalysisPipeline({
    filings: { collect: async () => [filing({ url: 'https://evil.example/fake' })] },
    now: () => asOf
  })
  const result = await malicious(request)
  assert.equal(result.evidence.length, 0)
  const generated = createAnalysisPipeline({
    filings: { collect: async () => [filing()] },
    generate: async () => ({
      schemaVersion: 1,
      summary: 'A new report',
      highlights: [{ text: 'Fake', sourceIds: ['unknown'] }],
      watchItems: []
    }),
    now: () => asOf
  })
  await assert.rejects(() => generated(request), /ERR_ANALYSIS_CITATIONS/)
})
