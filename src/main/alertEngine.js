import { getMarket } from '../shared/markets.js'

const VERSION = 1
export const ALERT_LIMIT = 50

const stockId = (market, symbol) => market + ':' + symbol

function validMarket(market, symbol) {
  const meta = getMarket(market)
  if (!meta || typeof symbol !== 'string') throw new Error('ERR_ALERT_SYMBOL')
  const normalized = meta.normalizeSymbol(symbol)
  if (!meta.symbolPattern.test(normalized)) throw new Error('ERR_ALERT_SYMBOL')
  return { market: meta.id, symbol: normalized }
}

function validateDirection(direction) {
  if (direction !== 'above' && direction !== 'below') throw new Error('ERR_ALERT_DIRECTION')
}

export function makeAlert(input, id, now) {
  const { market, symbol } = validMarket(input?.market, input?.symbol)
  validateDirection(input?.direction)
  const target = input?.target
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0)
    throw new Error('ERR_ALERT_TARGET')
  return {
    id, market, symbol, direction: input.direction, target,
    createdAt: new Date(now).toISOString(), status: 'waiting', lastSide: null,
    lastMarketAt: null, triggeredAt: null
  }
}

export function isValidQuote(alert, quote, now) {
  if (!quote || quote.stale || quote.loading || quote.errorCode || quote.error ||
      quote.market !== alert.market || quote.symbol !== alert.symbol ||
      !Number.isFinite(quote.price) || quote.price <= 0) return false
  const time = Date.parse(quote.marketAt)
  const nowMs = Date.parse(now)
  if (!Number.isFinite(time) || !Number.isFinite(nowMs) || time > nowMs + 60_000) return false
  const maxAge = ((getMarket(alert.market)?.delayMinutes || 0) + 10) * 60_000
  return time >= nowMs - maxAge
}

export function evaluateAlert(alert, quote, now) {
  if (alert.status === 'triggered' || !isValidQuote(alert, quote, now)) return { next: alert, triggered: false }
  const time = new Date(quote.marketAt).toISOString()
  if (alert.lastMarketAt && Date.parse(time) <= Date.parse(alert.lastMarketAt))
    return { next: alert, triggered: false }
  const side = alert.direction === 'above'
    ? quote.price >= alert.target ? 'target' : 'other'
    : quote.price <= alert.target ? 'target' : 'other'
  // A new alert never fires immediately when the initial quote is already beyond the target.
  const triggered = alert.lastSide === 'other' && side === 'target'
  return {
    next: { ...alert, lastSide: side, lastMarketAt: time,
      ...(triggered ? { status: 'triggered', triggeredAt: new Date(now).toISOString() } : {}) },
    triggered
  }
}

export function createAlertRepository({ read, write, now = () => new Date().toISOString(), newId }) {
  const state = () => {
    const result = read()
    if (result == null) return { schemaVersion: VERSION, alerts: [] }
    if (result.schemaVersion !== VERSION || !Array.isArray(result.alerts))
      throw new Error('ERR_ALERT_STORE')
    return result
  }
  const list = () => state().alerts
  const persist = (alerts) => write({ schemaVersion: VERSION, alerts })
  const add = (input) => {
    const alerts = list()
    if (alerts.length >= ALERT_LIMIT) throw new Error('ERR_ALERT_LIMIT')
    const item = makeAlert(input, newId(), now())
    if (alerts.some(a => stockId(a.market, a.symbol) === stockId(item.market, item.symbol) &&
      a.direction === item.direction && a.status !== 'triggered'))
      throw new Error('ERR_ALERT_DUPLICATE')
    persist([...alerts, item])
    return item
  }
  const remove = (id) => {
    if (typeof id !== 'string') throw new Error('ERR_ALERT_ID')
    const alerts = list()
    if (alerts.some(a => a.id === id)) persist(alerts.filter(a => a.id !== id))
    return list()
  }
  const removeStock = (market, symbol) => {
    const alerts = list()
    const next = alerts.filter(a => stockId(a.market, a.symbol) !== stockId(market, symbol))
    if (next.length !== alerts.length) persist(next)
  }
  const process = (quotes) => {
    if (!Array.isArray(quotes) || !quotes.length) return []
    const current = list()
    let dirty = false
    const triggered = []
    const next = current.map(a => {
      // Find a non-stale quote; a partial update may contain stale cache entries.
      const quote = quotes.find(q => q.market === a.market && q.symbol === a.symbol)
      const result = evaluateAlert(a, quote, now())
      if (result.next !== a) dirty = true
      if (result.triggered) triggered.push({ alert: result.next, price: quote.price })
      return result.next
    })
    // Persist the triggered state BEFORE attempting to display a system notification.
    if (dirty) persist(next)
    return triggered
  }
  return { list, add, remove, removeStock, process }
}
