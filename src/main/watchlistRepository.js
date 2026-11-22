import { randomUUID } from 'node:crypto'
import { getMarket } from '../shared/markets.js'
import { holdingFields, reorderItems } from './watchlistModel.js'

// Keep the existing "items" key, but write both items and activityHistory together.
export const DEFAULT_ITEMS = [
  { market: 'KR', symbol: '005930' },
  { market: 'KR', symbol: '000660' },
  { market: 'US', symbol: 'AAPL' },
  { market: 'US', symbol: 'NVDA' }
]

const HISTORY_VERSION = 1

function fail(code) {
  throw new Error(code)
}

function normalize(market, symbol) {
  const m = getMarket(market)
  const raw = String(symbol || '').trim()
  return {
    market: m ? m.id : String(market || '').toUpperCase(),
    symbol: m ? m.normalizeSymbol(raw) : raw
  }
}

function validate({ market, symbol }) {
  const m = getMarket(market)
  if (!m) fail('ERR_UNKNOWN_MARKET')
  if (!m.symbolPattern.test(symbol)) fail('ERR_INVALID_SYMBOL')
}

function itemSnapshot(item) {
  const value = { market: item.market, symbol: item.symbol }
  for (const key of ['quantity', 'avgPrice']) {
    if (typeof item[key] === 'number' && Number.isFinite(item[key]) && item[key] > 0) {
      value[key] = item[key]
    }
  }
  return value
}

function holdingSnapshot(item) {
  const snapshot = itemSnapshot(item)
  delete snapshot.market
  delete snapshot.symbol
  return snapshot
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isHistory(value) {
  return value?.schemaVersion === HISTORY_VERSION &&
    typeof value.startedAt === 'string' && Array.isArray(value.events)
}

// All behavior is dependency-injected so it can be tested without Electron.
export function createWatchlistRepository({
  read, write, now = () => new Date().toISOString(), newId = randomUUID
}) {
  if (typeof read !== 'function' || typeof write !== 'function') {
    throw new TypeError('Watchlist persistence requires read and write')
  }

  function root() {
    return read() || {}
  }

  function itemsOf(data) {
    return Array.isArray(data.items) ? data.items : DEFAULT_ITEMS
  }

  function record(type, at, details) {
    return {
      schemaVersion: HISTORY_VERSION,
      eventId: newId(),
      occurredAt: at,
      type,
      origin: type === 'watchlist_replaced' ? 'system' : 'user',
      semantic: type === 'holding_edited' ? 'holding_snapshot_change' : 'watchlist_change',
      ...details
    }
  }

  function historyOf(data, at) {
    const existing = data.activityHistory
    if (isHistory(existing)) return existing
    if (existing !== undefined) fail('ERR_ACTIVITY_INVALID_HISTORY')
    // Existing watchlist has no historical timestamps. Only preserve a baseline snapshot.
    return {
      schemaVersion: HISTORY_VERSION,
      startedAt: at,
      events: [record('baseline_imported', at, {
        stock: null,
        before: null,
        after: itemsOf(data).map(itemSnapshot),
        origin: 'migration',
        semantic: 'initial_snapshot_not_trade'
      })]
    }
  }

  function commit(nextItems, change = null) {
    const data = root()
    const beforeItems = itemsOf(data)
    if (same(beforeItems, nextItems) && isHistory(data.activityHistory)) return nextItems
    const at = now()
    const activityHistory = historyOf(data, at)
    const changed = change && !same(beforeItems, nextItems)
    const nextHistory = changed
      ? { ...activityHistory, events: [...activityHistory.events, record(change.type, at, change.details)] }
      : activityHistory
    // One whole-store assignment, never separate list and history writes.
    write({ ...data, items: nextItems, activityHistory: nextHistory })
    return nextItems
  }

  function ensureHistory() {
    const data = root()
    if (isHistory(data.activityHistory)) return data.activityHistory
    if (data.activityHistory !== undefined) fail('ERR_ACTIVITY_INVALID_HISTORY')
    const at = now()
    const activityHistory = historyOf(data, at)
    write({ ...data, items: itemsOf(data), activityHistory })
    return activityHistory
  }

  function getItems() {
    return itemsOf(root())
  }

  function addItem(market, symbol, holding) {
    const item = normalize(market, symbol)
    validate(item)
    Object.assign(item, holdingFields(holding))
    const list = getItems()
    if (list.some((i) => i.market === item.market && i.symbol === item.symbol)) fail('ERR_DUPLICATE')
    return commit([...list, item], {
      type: 'watchlist_added',
      details: { stock: normalize(item.market, item.symbol), before: null, after: itemSnapshot(item) }
    })
  }

  function setItems(rawItems) {
    const seen = new Set()
    const next = []
    for (const raw of Array.isArray(rawItems) ? rawItems : []) {
      try {
        const item = normalize(raw.market, raw.symbol)
        validate(item)
        const key = item.market + '-' + item.symbol
        if (seen.has(key)) continue
        seen.add(key)
        Object.assign(item, holdingFields(raw))
        next.push(item)
      } catch {
        // Existing import behavior: skip invalid entries.
      }
    }
    if (same(getItems(), next)) return next
    return commit(next, {
      type: 'watchlist_replaced',
      details: { stock: null, before: getItems().map(itemSnapshot), after: next.map(itemSnapshot) }
    })
  }

  function updateHolding(market, symbol, holding) {
    const target = normalize(market, symbol)
    const list = getItems()
    const idx = list.findIndex((i) => i.market === target.market && i.symbol === target.symbol)
    if (idx < 0) fail('ERR_NOT_FOUND')
    // Validate first. Invalid edits must never erase holdings or make a history entry.
    const fields = holdingFields(holding)
    const before = holdingSnapshot(list[idx])
    const next = list.map((item) => ({ ...item }))
    delete next[idx].quantity
    delete next[idx].avgPrice
    Object.assign(next[idx], fields)
    const after = holdingSnapshot(next[idx])
    if (same(before, after)) return next
    return commit(next, { type: 'holding_edited', details: { stock: target, before, after } })
  }

  function removeItem(market, symbol) {
    const target = normalize(market, symbol)
    const list = getItems()
    const old = list.find((i) => i.market === target.market && i.symbol === target.symbol)
    if (!old) return list
    const next = list.filter((i) => i !== old)
    return commit(next, {
      type: 'watchlist_removed',
      details: { stock: target, before: itemSnapshot(old), after: null }
    })
  }

  function reorderWatchlist(order) {
    const next = reorderItems(getItems(), order)
    const data = root()
    if (!same(itemsOf(data), next)) write({ ...data, items: next })
    return next
  }

  function getActivitySummary() {
    const history = ensureHistory()
    const events = history.events.filter((event) => event.type !== 'baseline_imported')
    return {
      schemaVersion: HISTORY_VERSION,
      startedAt: history.startedAt,
      count: events.length,
      recent: events.slice(-5).reverse()
    }
  }

  function exportActivity() {
    const activityHistory = ensureHistory()
    return {
      schemaVersion: HISTORY_VERSION,
      exportedAt: now(),
      watchlist: getItems().map(itemSnapshot),
      activityHistory
    }
  }

  function clearActivity() {
    const data = root()
    const at = now()
    if (data.activityHistory !== undefined && !isHistory(data.activityHistory)) {
      fail('ERR_ACTIVITY_INVALID_HISTORY')
    }
    const fresh = historyOf({ items: itemsOf(data) }, at)
    write({ ...data, items: itemsOf(data), activityHistory: fresh })
    return { schemaVersion: HISTORY_VERSION, startedAt: fresh.startedAt, count: 0, recent: [] }
  }

  return {
    getItems, addItem, setItems, updateHolding, removeItem, reorderWatchlist,
    getActivitySummary, exportActivity, clearActivity
  }
}
