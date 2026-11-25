// Report request/response contract shared by the Pro client (src/shared/proClient.js).
// Pure module: request body checks before upload and strict re-validation of the server result.

export const ANALYSIS_MARKETS = Object.freeze(['US', 'KR'])
export const ANALYSIS_MAX_BODY_BYTES = 12_000
const SOURCE_HOSTS = Object.freeze({
  'U.S. SEC EDGAR': 'www.sec.gov',
  OpenDART: 'dart.fss.or.kr'
})
const fail = (code) => {
  throw new Error(code)
}
const isText = (value, max) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
const isoOrNull = (value) => {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

// Input: personalizedPreview request (schemaVersion 2). Output: JSON string to POST.
export function prepareAnalysisBody(request) {
  if (!request || request.schemaVersion !== 2 || !Array.isArray(request.stocks))
    fail('ERR_ANALYSIS_REQUEST')
  if (request.stocks.some((stock) => !ANALYSIS_MARKETS.includes(stock?.market)))
    fail('ERR_ANALYSIS_MARKET')
  const body = { ...request }
  // The server rejects an empty thesis text; sending less than consented is always allowed.
  if (body.investmentThesis && !isText(body.investmentThesis.text, 1200))
    delete body.investmentThesis
  const json = JSON.stringify(body)
  if (new TextEncoder().encode(json).byteLength > ANALYSIS_MAX_BODY_BYTES)
    fail('ERR_ANALYSIS_TOO_LARGE')
  return json
}

function normalizeSource(source, allowedKeys) {
  if (
    !source ||
    !isText(source.id, 100) ||
    source.kind !== 'filing' ||
    source.evidenceLevel !== 'filing-metadata' ||
    !isText(source.title, 250) ||
    !Object.hasOwn(SOURCE_HOSTS, source.publisher) ||
    !Array.isArray(source.stockKeys) ||
    source.stockKeys.length !== 1 ||
    !allowedKeys.has(source.stockKeys[0])
  )
    fail('ERR_ANALYSIS_RESPONSE')
  const publishedAt = isoOrNull(source.publishedAt)
  if (!publishedAt) fail('ERR_ANALYSIS_RESPONSE')
  let url
  try {
    url = new URL(source.url)
  } catch {
    fail('ERR_ANALYSIS_RESPONSE')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hostname !== SOURCE_HOSTS[source.publisher]
  )
    fail('ERR_ANALYSIS_RESPONSE')
  return {
    id: source.id,
    kind: 'filing',
    title: source.title.trim(),
    publisher: source.publisher,
    publishedAt,
    precision: source.precision === 'date' ? 'date' : 'time',
    url: url.href,
    stockKeys: [source.stockKeys[0]],
    evidenceLevel: 'filing-metadata'
  }
}

// Re-validate everything the server says. Only this normalized shape is stored or rendered.
export function normalizeAnalysisResult(result, request) {
  if (
    !result ||
    result.schemaVersion !== 1 ||
    !['generated_unbilled', 'generated_billed'].includes(result.status) ||
    result.dataLevel !== 'filing_metadata_only'
  )
    fail('ERR_ANALYSIS_RESPONSE')
  const report = result.report
  if (!report || report.schemaVersion !== 1) fail('ERR_ANALYSIS_RESPONSE')
  const asOf = isoOrNull(result.asOf)
  const periodStart = isoOrNull(result.periodStart)
  if (!asOf || !periodStart || periodStart > asOf) fail('ERR_ANALYSIS_RESPONSE')
  const stocks = request.stocks.map(({ market, symbol, key }) => ({ market, symbol, key }))
  const allowedKeys = new Set(stocks.map((s) => s.key))
  if (!isText(report.summary, 450)) fail('ERR_ANALYSIS_RESPONSE')
  if (!Array.isArray(report.sources) || report.sources.length > 12) fail('ERR_ANALYSIS_RESPONSE')
  const sources = report.sources.map((s) => normalizeSource(s, allowedKeys))
  const sourceIds = new Set(sources.map((s) => s.id))
  if (!Array.isArray(report.highlights) || report.highlights.length > 3)
    fail('ERR_ANALYSIS_RESPONSE')
  const highlights = report.highlights.map((h) => {
    if (
      !isText(h?.text, 240) ||
      !Array.isArray(h.sourceIds) ||
      !h.sourceIds.length ||
      h.sourceIds.some((id) => !sourceIds.has(id))
    )
      fail('ERR_ANALYSIS_RESPONSE')
    return { text: h.text.trim(), sourceIds: [...new Set(h.sourceIds)] }
  })
  if (!Array.isArray(report.watchItems) || report.watchItems.length > 3)
    fail('ERR_ANALYSIS_RESPONSE')
  const watchItems = report.watchItems.map((w) => {
    if (!isText(w, 180)) fail('ERR_ANALYSIS_RESPONSE')
    return w.trim()
  })
  let portfolioNote = null
  if (report.portfolioNote != null) {
    if (!request.options?.includeHoldings || !isText(report.portfolioNote, 350))
      fail('ERR_ANALYSIS_RESPONSE')
    portfolioNote = report.portfolioNote.trim()
  }
  const coverage = (Array.isArray(result.coverage) ? result.coverage : [])
    .filter((c) => allowedKeys.has(c?.key) && ['ok', 'unavailable'].includes(c?.status))
    .map(({ key, status }) => ({ key, status }))
  const locale = typeof report.locale === 'string' ? report.locale : request.locale
  return {
    schemaVersion: 1,
    status: result.status,
    dataLevel: 'filing_metadata_only',
    asOf,
    periodStart,
    locale: isText(locale, 12) ? locale : 'ko',
    stocks,
    summary: report.summary.trim(),
    highlights,
    watchItems,
    portfolioNote,
    sources,
    coverage,
    noNewEvents: sources.length === 0 && report.noNewEvents !== false
  }
}
