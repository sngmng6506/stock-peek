import { getMarket } from './markets.js'

// Shared, deterministic contract. Neither quotes nor holdings leave the device by default.
export const REPORT_LIMITS = Object.freeze({
  maxStocks: 5,
  maxEvidence: 12,
  maxHighlights: 5,
  evidenceWindowHours: 72
})

function fail(code) {
  throw new Error(code)
}

function iso(value) {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function text(value, max) {
  const s = typeof value === 'string' ? value.trim() : ''
  return s && s.length <= max ? s : null
}

function stockKey(market, symbol) {
  return `${market}:${symbol}`
}

export function buildReportRequest(watchlist, options = {}) {
  if (!Array.isArray(watchlist)) fail('ERR_REPORT_WATCHLIST')
  const { includeHoldings = false, selectedKeys = null, locale = 'ko' } = options
  if (typeof includeHoldings !== 'boolean' || !text(locale, 12)) fail('ERR_REPORT_OPTIONS')
  if (
    selectedKeys != null &&
    (!Array.isArray(selectedKeys) || selectedKeys.some((v) => typeof v !== 'string'))
  ) {
    fail('ERR_REPORT_SELECTION')
  }
  const selected = selectedKeys == null ? null : new Set(selectedKeys)
  const stocks = []
  const seen = new Set()
  for (const raw of watchlist) {
    const market = getMarket(raw?.market)
    if (!market) continue
    const symbol = market.normalizeSymbol(String(raw?.symbol || ''))
    if (!market.symbolPattern.test(symbol)) continue
    const key = stockKey(market.id, symbol)
    if (seen.has(key) || (selected && !selected.has(key))) continue
    seen.add(key)
    const stock = { market: market.id, symbol, key }
    if (includeHoldings && raw?.quantity != null && raw?.avgPrice != null) {
      const quantity = Number(raw.quantity)
      const avgPrice = Number(raw.avgPrice)
      if (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(avgPrice) && avgPrice > 0) {
        stock.holding = { quantity, avgPrice }
      }
    }
    stocks.push(stock)
  }
  if (stocks.length === 0) fail('ERR_REPORT_EMPTY')
  if (stocks.length > REPORT_LIMITS.maxStocks) fail('ERR_REPORT_TOO_MANY')
  if (selected && [...selected].some((key) => !seen.has(key))) fail('ERR_REPORT_SELECTION')
  return { schemaVersion: 1, locale, includeHoldings, stocks }
}

// Evidence comes from a licensed provider or an official disclosure source.
// News headlines alone are only evidence that an article was published, not proof of its claims.
export function prepareReportEvidence(request, records, options = {}) {
  if (!Array.isArray(records)) fail('ERR_REPORT_EVIDENCE')
  const asOf = iso(options.asOf || new Date().toISOString())
  if (!asOf) fail('ERR_REPORT_TIME')
  const previous = new Set(Array.isArray(options.previousEventIds) ? options.previousEventIds : [])
  const allowed = new Set(request.stocks.map((stock) => stock.key))
  const earliest = Date.parse(asOf) - REPORT_LIMITS.evidenceWindowHours * 3600000
  const seenUrls = new Set()
  const items = []
  for (const raw of records) {
    const kind = raw?.kind
    if (kind !== 'news' && kind !== 'filing') continue
    const title = text(raw.title, 250)
    const publisher = text(raw.publisher, 100)
    const publishedAt = iso(raw.publishedAt)
    if (!title || !publisher || !publishedAt) continue
    if (Date.parse(publishedAt) > Date.parse(asOf) || Date.parse(publishedAt) < earliest) continue
    let url
    try {
      url = new URL(raw.url)
      if (url.protocol !== 'https:' || url.username || url.password) continue
    } catch {
      continue
    }
    const keys = [...new Set(Array.isArray(raw.stockKeys) ? raw.stockKeys : [])].filter((key) =>
      allowed.has(key)
    )
    if (!keys.length || seenUrls.has(url.href)) continue
    // Provider-supplied IDs need to be stable across days. Fall back to canonical URL.
    const id = text(raw.id, 256) || url.href
    const excerpt = raw.reusePermitted === true ? text(raw.excerpt, 600) : null
    items.push({
      id,
      kind,
      title,
      publisher,
      publishedAt,
      url: url.href,
      stockKeys: keys,
      evidenceLevel: excerpt ? 'verified-extract' : 'headline-only',
      ...(excerpt ? { excerpt } : {}),
      isNew: !previous.has(id)
    })
    seenUrls.add(url.href)
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  const evidence = items.slice(0, REPORT_LIMITS.maxEvidence)
  return {
    asOf,
    evidence,
    hasNewEvents: evidence.some((item) => item.isNew),
    coverage: {
      requestedStocks: request.stocks.length,
      matchedStocks: new Set(evidence.flatMap((item) => item.stockKeys)).size,
      windowHours: REPORT_LIMITS.evidenceWindowHours
    }
  }
}

function checkedLine(value, max, code) {
  const result = text(value, max)
  if (!result) fail(code)
  return result
}

export function validateReportOutput(report, request, context) {
  if (!report || typeof report !== 'object' || report.schemaVersion !== 1) {
    fail('ERR_REPORT_SCHEMA')
  }
  const summary = checkedLine(report.summary, 450, 'ERR_REPORT_SUMMARY')
  const highlights = report.highlights
  if (!Array.isArray(highlights) || highlights.length > REPORT_LIMITS.maxHighlights) {
    fail('ERR_REPORT_HIGHLIGHTS')
  }
  const evidenceById = new Map(context.evidence.map((item) => [item.id, item]))
  const normalized = highlights.map((item) => {
    const line = checkedLine(item?.text, 240, 'ERR_REPORT_HIGHLIGHTS')
    const ids = item?.sourceIds
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !evidenceById.get(id)?.isNew)) {
      fail('ERR_REPORT_CITATIONS')
    }
    // A dated headline-only source must never be treated as a verified article-content claim.
    return { text: line, sourceIds: [...new Set(ids)] }
  })
  if (!context.evidence.length && normalized.length) fail('ERR_REPORT_CITATIONS')
  const watchItems = Array.isArray(report.watchItems) ? report.watchItems : []
  if (watchItems.length > 4) fail('ERR_REPORT_WATCH_ITEMS')
  const portfolioNote =
    report.portfolioNote == null
      ? null
      : checkedLine(report.portfolioNote, 350, 'ERR_REPORT_PORTFOLIO')
  if (!request.includeHoldings && portfolioNote != null) fail('ERR_REPORT_PORTFOLIO')
  return {
    schemaVersion: 1,
    asOf: context.asOf,
    locale: request.locale,
    stocks: request.stocks,
    summary,
    highlights: normalized,
    watchItems: watchItems.map((s) => checkedLine(s, 180, 'ERR_REPORT_WATCH_ITEMS')),
    portfolioNote,
    sources: context.evidence.filter((item) =>
      normalized.some((highlight) => highlight.sourceIds.includes(item.id))
    ),
    noNewEvents: !context.hasNewEvents
  }
}
