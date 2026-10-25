import Store from 'electron-store'
import { getMarket } from '../shared/markets.js'

const DEFAULTS = [
  { market: 'KR', symbol: '005930' },
  { market: 'KR', symbol: '000660' },
  { market: 'US', symbol: 'AAPL' },
  { market: 'US', symbol: 'NVDA' }
]

const store = new Store({
  name: 'watchlist',
  defaults: { items: DEFAULTS }
})

// 에러 메시지는 코드로 던지고 화면에서 번역 (i18n error.<CODE>)
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

function applyHolding(item, raw) {
  const q = Number(raw?.quantity)
  const p = Number(raw?.avgPrice)
  if (Number.isFinite(q) && q > 0) item.quantity = q
  if (Number.isFinite(p) && p > 0) item.avgPrice = p
  return item
}

export function getItems() {
  return store.get('items')
}

export function addItem(market, symbol, holding) {
  const item = normalize(market, symbol)
  validate(item)
  applyHolding(item, holding)
  const list = getItems()
  if (list.some((i) => i.market === item.market && i.symbol === item.symbol)) {
    fail('ERR_DUPLICATE')
  }
  const next = [...list, item]
  store.set('items', next)
  return next
}

export function setItems(items) {
  const seen = new Set()
  const next = []
  for (const raw of Array.isArray(items) ? items : []) {
    try {
      const item = normalize(raw.market, raw.symbol)
      validate(item)
      const key = `${item.market}-${item.symbol}`
      if (seen.has(key)) continue
      seen.add(key)
      applyHolding(item, raw)
      next.push(item)
    } catch {
      // skip invalid entries
    }
  }
  store.set('items', next)
  return next
}

export function updateHolding(market, symbol, holding) {
  const target = normalize(market, symbol)
  const list = getItems()
  const idx = list.findIndex((i) => i.market === target.market && i.symbol === target.symbol)
  if (idx < 0) fail('ERR_NOT_FOUND')
  const next = list.map((it) => ({ ...it }))
  const item = next[idx]
  const q = Number(holding?.quantity)
  const p = Number(holding?.avgPrice)
  if (Number.isFinite(q) && q > 0) item.quantity = q
  else delete item.quantity
  if (Number.isFinite(p) && p > 0) item.avgPrice = p
  else delete item.avgPrice
  store.set('items', next)
  return next
}

export function removeItem(market, symbol) {
  const item = normalize(market, symbol)
  const next = getItems().filter((i) => !(i.market === item.market && i.symbol === item.symbol))
  store.set('items', next)
  return next
}
