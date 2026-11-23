import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildReportRequest,
  prepareReportEvidence,
  validateReportOutput,
  REPORT_LIMITS
} from '../src/shared/aiReport.js'
import { renderReportHtml } from '../src/shared/reportHtml.js'

const kr = { market: 'KR', symbol: '005930', quantity: 10, avgPrice: 70000 }
const us = { market: 'US', symbol: 'NVDA', quantity: 3, avgPrice: 100 }
const stamp = '2026-11-22T05:00:00Z'
const news = {
  kind: 'news',
  id: 'provider:123',
  title: 'Company earnings announcement',
  publisher: 'Example Publisher',
  publishedAt: '2026-11-22T04:00:00Z',
  url: 'https://example.com/news/123',
  stockKeys: ['US:NVDA'],
  excerpt: 'Licensed excerpt',
  reusePermitted: false
}
function context(request, records = [news], opts = {}) {
  return prepareReportEvidence(request, records, { asOf: stamp, ...opts })
}

test('portfolio fields are never sent unless explicitly opted in', () => {
  const base = buildReportRequest([kr, us])
  assert.equal(base.includeHoldings, false)
  assert.deepEqual(base.stocks[0], { market: 'KR', symbol: '005930', key: 'KR:005930' })
  assert.equal(JSON.stringify(base).includes('70000'), false)
  const opted = buildReportRequest([kr, us], { includeHoldings: true, selectedKeys: ['KR:005930'] })
  assert.deepEqual(opted.stocks[0].holding, { quantity: 10, avgPrice: 70000 })
  assert.equal(opted.stocks.length, 1)
})

test('selection, invalid holdings and maximum A4 universe are validated', () => {
  assert.throws(
    () => buildReportRequest([kr], { selectedKeys: ['US:FAKE'] }),
    /ERR_REPORT_EMPTY|ERR_REPORT_SELECTION/
  )
  assert.throws(() => buildReportRequest([kr], { includeHoldings: 'yes' }), /ERR_REPORT_OPTIONS/)
  const invalid = buildReportRequest([{ ...kr, quantity: -3 }], { includeHoldings: true })
  assert.equal(invalid.stocks[0].holding, undefined)
  const tooMany = ['AAPL', 'MSFT', 'NVDA', 'GOOG', 'AMZN', 'META'].map((symbol) => ({
    market: 'US',
    symbol
  }))
  assert.equal(REPORT_LIMITS.maxStocks, 5)
  assert.throws(() => buildReportRequest(tooMany), /ERR_REPORT_TOO_MANY/)
})

test('only time-valid, relevant, https and attributed sources are admitted', () => {
  const req = buildReportRequest([kr, us])
  const data = context(req, [
    news,
    { ...news, id: 'dup', url: news.url },
    { ...news, id: 'wrong', stockKeys: ['KR:000660'] },
    { ...news, id: 'old', url: 'https://example.com/old', publishedAt: '2026-11-18T04:00:00Z' },
    {
      ...news,
      id: 'future',
      url: 'https://example.com/future',
      publishedAt: '2026-11-23T04:00:00Z'
    },
    { ...news, id: 'insecure', url: 'http://example.com' },
    { ...news, id: 'unattributed', url: 'https://example.com/x', publisher: '' }
  ])
  assert.equal(data.evidence.length, 1)
  assert.equal(data.evidence[0].id, news.id)
  assert.equal(data.evidence[0].evidenceLevel, 'headline-only')
  assert.equal(data.evidence[0].excerpt, undefined)
  assert.equal(data.hasNewEvents, true)
  assert.equal(data.coverage.matchedStocks, 1)
})

test('licensed material can be included explicitly; otherwise it is stripped', () => {
  const req = buildReportRequest([us])
  const data = context(req, [{ ...news, reusePermitted: true }])
  assert.equal(data.evidence[0].evidenceLevel, 'verified-extract')
  assert.equal(data.evidence[0].excerpt, 'Licensed excerpt')
})

test('daily comparison uses stable source IDs and forbids old event as new evidence', () => {
  const req = buildReportRequest([us])
  const data = context(req, [news], { previousEventIds: [news.id] })
  assert.equal(data.hasNewEvents, false)
  const result = {
    schemaVersion: 1,
    summary: 'No newly published evidence found.',
    highlights: [{ text: 'Yesterday changed', sourceIds: [news.id] }]
  }
  assert.throws(() => validateReportOutput(result, req, data), /ERR_REPORT_CITATIONS/)
  const safe = validateReportOutput({ ...result, highlights: [] }, req, data)
  assert.equal(safe.noNewEvents, true)
})

test('hallucinated citations, missing attribution and unsolicited portfolio notes are blocked', () => {
  const req = buildReportRequest([us])
  const data = context(req)
  const report = {
    schemaVersion: 1,
    summary: 'Today one new headline was published.',
    highlights: [{ text: 'New earnings article', sourceIds: ['fabricated'] }]
  }
  assert.throws(() => validateReportOutput(report, req, data), /ERR_REPORT_CITATIONS/)
  const valid = { ...report, highlights: [{ text: 'New headline posted', sourceIds: [news.id] }] }
  assert.equal(validateReportOutput(valid, req, data).sources.length, 1)
  assert.throws(
    () => validateReportOutput({ ...valid, portfolioNote: 'Your investment risk' }, req, data),
    /ERR_REPORT_PORTFOLIO/
  )
})

test('A4 HTML is escaped and includes traceable source links', () => {
  const req = buildReportRequest([kr, us], { includeHoldings: true })
  const malicious = { ...news, title: '<img src=x onerror=alert(1)>', publisher: 'Publisher' }
  const data = context(req, [malicious])
  const report = validateReportOutput(
    {
      schemaVersion: 1,
      summary: 'A news headline was published.',
      highlights: [{ text: 'Read & verify the headline', sourceIds: [news.id] }],
      portfolioNote: 'Holding concentration is based on user-provided values only.',
      watchItems: ['Review the full original article']
    },
    req,
    data
  )
  const html = renderReportHtml(report)
  assert.match(html, /@page \{ size: A4/)
  assert.match(html, /Read &amp; verify/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(html, /<img src=x onerror/)
  assert.match(html, /https:\/\/example.com\/news\/123/)
  assert.match(html, /내 포트폴리오 관점/)
})

test('no source does not pretend new events exist', () => {
  const req = buildReportRequest([kr])
  const data = context(req, [])
  const report = validateReportOutput(
    {
      schemaVersion: 1,
      summary: 'No newly available source.',
      highlights: [],
      watchItems: []
    },
    req,
    data
  )
  assert.equal(report.noNewEvents, true)
  assert.equal(report.sources.length, 0)
  assert.match(renderReportHtml(report), /확인된 신규 근거 자료가 없습니다/)
})
