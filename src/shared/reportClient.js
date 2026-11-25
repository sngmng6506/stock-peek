// P5 client contract for the restricted analysis API (stockpeek-proxy /api/analyze).
// Pure module: the caller injects fetch (Electron net.fetch in main). Never bundle a token;
// operators supply it through the environment of their own machine only.

export const ANALYSIS_MARKETS = Object.freeze(['US', 'KR'])
export const ANALYSIS_MAX_BODY_BYTES = 12_000
export const ANALYSIS_TIMEOUT_MS = 90_000
export const DEFAULT_ANALYSIS_ENDPOINT = 'https://stockpeek-proxy.sngmng.workers.dev/api/analyze'

const TOKEN_PATTERN = /^[A-Za-z0-9_\-.]{32,256}$/
const SOURCE_HOSTS = Object.freeze({
  'U.S. SEC EDGAR': 'www.sec.gov',
  OpenDART: 'dart.fss.or.kr'
})
// Server error codes that are safe and meaningful to show. Everything else collapses.
const PASS_THROUGH = new Set([
  'ERR_ANALYSIS_DISABLED',
  'ERR_UNAUTHORIZED',
  'ERR_ANALYSIS_DAILY_LIMIT',
  'ERR_ANALYSIS_NO_COVERAGE',
  'ERR_ANALYSIS_REQUEST'
])

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

// env: process.env-like object. Returns null when the operator beta is not configured.
export function analysisConfigFromEnv(env = {}) {
  const token = typeof env.STOCKPEEK_ANALYSIS_TOKEN === 'string' ? env.STOCKPEEK_ANALYSIS_TOKEN : ''
  if (!TOKEN_PATTERN.test(token)) return null
  const raw = env.STOCKPEEK_ANALYSIS_URL || DEFAULT_ANALYSIS_ENDPOINT
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  // Plain http only for a local `wrangler dev` server on this machine.
  const local =
    url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !local) || url.username || url.password) return null
  return { endpoint: url.href, token }
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
    result.status !== 'generated_unbilled' ||
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
    status: 'generated_unbilled',
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

export function analysisErrorCode(status, serverCode) {
  if (typeof serverCode === 'string' && PASS_THROUGH.has(serverCode)) return serverCode
  if (serverCode === 'ERR_REQUEST_TOO_LARGE' || status === 413) return 'ERR_ANALYSIS_TOO_LARGE'
  if (status === 401) return 'ERR_UNAUTHORIZED'
  if (status === 429) return 'ERR_ANALYSIS_DAILY_LIMIT'
  return 'ERR_ANALYSIS_FAILED'
}

export async function requestAnalysis({
  fetchImpl,
  config,
  request,
  timeoutMs = ANALYSIS_TIMEOUT_MS
}) {
  if (typeof fetchImpl !== 'function' || !config) fail('ERR_ANALYSIS_UNAVAILABLE')
  const body = prepareAnalysisBody(request)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  let data
  try {
    try {
      res = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + config.token
        },
        body,
        signal: controller.signal,
        redirect: 'error'
      })
    } catch {
      fail(controller.signal.aborted ? 'ERR_ANALYSIS_TIMEOUT' : 'ERR_ANALYSIS_NETWORK')
    }
    try {
      data = await res.json()
    } catch {
      fail(controller.signal.aborted ? 'ERR_ANALYSIS_TIMEOUT' : 'ERR_ANALYSIS_FAILED')
    }
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok || data?.ok !== true) fail(analysisErrorCode(res.status, data?.error))
  return normalizeAnalysisResult(data.result, request)
}
