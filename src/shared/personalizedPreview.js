import { buildReportRequest } from './aiReport.js'
import { normalizeThesis } from './thesisModel.js'

const MAX_ACTIVITY = 100
const MAX_LOOKBACK_DAYS = 365

function iso(value) {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function cleanSnapshot(value, includeHoldings) {
  if (value === null) return null
  if (Array.isArray(value)) return value.slice(0, 30).map(x => cleanSnapshot(x, includeHoldings))
  if (!value || typeof value !== 'object') return null
  const result = {}
  if (typeof value.market === 'string') result.market = value.market
  if (typeof value.symbol === 'string') result.symbol = value.symbol
  if (includeHoldings) {
    if (Number.isFinite(value.quantity) && value.quantity > 0) result.quantity = value.quantity
    if (Number.isFinite(value.avgPrice) && value.avgPrice > 0) result.avgPrice = value.avgPrice
  }
  return result
}

function normalizeActivity(history, selected, includeHoldings, asOf, lookbackDays) {
  if (!history || history.schemaVersion !== 1 || !Array.isArray(history.events))
    throw new Error('ERR_REPORT_HISTORY')
  const sinceMs = Date.parse(asOf) - lookbackDays * 86400000
  const safe = []
  for (const event of history.events) {
    if (!event || typeof event !== 'object') continue
    if (!['watchlist_added','watchlist_removed','holding_edited','watchlist_replaced'].includes(event.type))
      continue
    const at = iso(event.occurredAt)
    if (!at || Date.parse(at) < sinceMs || Date.parse(at) > Date.parse(asOf)) continue
    if (event.type === 'watchlist_replaced') continue // bulk import is not a user action
    const stock = event.stock
    if (!stock || !selected.has(stock.market + ':' + stock.symbol)) continue
    // Holdings edits are only meaningful when the user opts into holdings disclosure.
    if (event.type === 'holding_edited' && !includeHoldings) continue
    safe.push({
      type: event.type, occurredAt: at,
      stock: { market: stock.market, symbol: stock.symbol },
      before: cleanSnapshot(event.before, includeHoldings),
      after: cleanSnapshot(event.after, includeHoldings),
      semantic: event.type === 'holding_edited' ? 'holding_snapshot_change' : 'watchlist_change'
    })
  }
  // Bounded most-recent events; never infer trades.
  return safe.slice(-MAX_ACTIVITY)
}

export function buildPersonalizedPreview(watchlist, history, thesis, options = {}) {
  if (!options || typeof options !== 'object') throw new Error('ERR_REPORT_OPTIONS')
  const includeHistory = options.includeHistory === true
  const includeThesis = options.includeThesis === true
  const includeHoldings = options.includeHoldings === true
  for (const name of ['includeHistory','includeThesis','includeHoldings']) {
    if (options[name] !== undefined && typeof options[name] !== 'boolean')
      throw new Error('ERR_REPORT_OPTIONS')
  }
  const lookbackDays = options.lookbackDays ?? 90
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > MAX_LOOKBACK_DAYS)
    throw new Error('ERR_REPORT_OPTIONS')
  const asOf = iso(options.asOf || new Date().toISOString())
  if (!asOf) throw new Error('ERR_REPORT_TIME')
  const request = buildReportRequest(watchlist, {
    selectedKeys: options.selectedKeys, includeHoldings, locale: options.locale || 'ko'
  })
  const selected = new Set(request.stocks.map(s => s.key))
  const detail = includeThesis ? normalizeThesis(thesis) : null
  const activity = includeHistory
    ? normalizeActivity(history, selected, includeHoldings, asOf, lookbackDays)
    : []
  const payload = {
    schemaVersion: 2, asOf, locale: request.locale,
    stocks: request.stocks, options: { includeHoldings, includeHistory, includeThesis, lookbackDays },
    ...(detail && (detail.text || detail.horizon !== 'unspecified' || detail.focus !== 'balanced')
      ? { investmentThesis: { text: detail.text, horizon: detail.horizon, focus: detail.focus } }
      : {}),
    ...(includeHistory ? { activity } : {})
  }
  // No network or credits touched. UI can display exact candidate payload.
  return {
    status: 'preview_only',
    request: payload,
    scope: {
      stockCount: request.stocks.length,
      eventCount: activity.length,
      historyTruncated: includeHistory && history.events.length > MAX_ACTIVITY,
      holdingsCount: request.stocks.filter(s => !!s.holding).length,
      disclaimer: 'watchlist and holding edits are not executions or trading history'
    }
  }
}
