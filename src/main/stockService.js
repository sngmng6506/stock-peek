import { getProvider } from './markets/index.js'
import { isMarketOpen } from '../shared/markets.js'
import { getItems } from './watchlist.js'

const REFRESH_FAST = 3_000 // 관심 종목의 시장 중 하나라도 열려 있을 때
const REFRESH_SLOW = 60_000 // 모두 닫혔을 때
const JITTER = 250 // ms, 다중 사용자 호출 분산용
const CHART_TTL = 600_000 // 차트는 일봉(3개월)이라 10분 캐시로 충분

let polling = false
let timer = null
let cache = []
const listeners = new Set()

// 일봉 prices 캐시. key: "KR-005930", value: { prices, ts }
const chartCache = new Map()

// 관심 종목이 있는 시장 기준으로 판단 (없는 시장의 장중 여부로 빨리 돌지 않게)
function anyMarketOpen() {
  const markets = new Set(getItems().map((i) => i.market))
  for (const id of markets) if (isMarketOpen(id)) return true
  return false
}

// --- Fetch logic --------------------------------------------------

// 마지막으로 성공한 시세. key: "US-AAPL", value: 성공 결과 객체
const lastGood = new Map()

async function fetchOne(item) {
  const key = `${item.market}-${item.symbol}`
  // 보유 정보를 먼저 추출 — fetch 결과와 무관하게 항상 보존.
  const holding = {}
  if (item.quantity != null) holding.quantity = item.quantity
  if (item.avgPrice != null) holding.avgPrice = item.avgPrice

  try {
    const provider = getProvider(item.market)
    if (!provider) return { ...item, ...holding, error: 'unknown market' }
    const cached = chartCache.get(key)
    const useCachedChart = cached && Date.now() - cached.ts < CHART_TTL
    const result = await provider.fetch(item.symbol, { skipChart: useCachedChart })
    if (result.prices?.length) {
      chartCache.set(key, { prices: result.prices, ts: Date.now() })
    } else if (cached) {
      result.prices = cached.prices
    }
    // 성공 → 마지막 정상값으로 저장.
    const merged = { ...result, ...holding }
    lastGood.set(key, merged)
    return merged
  } catch (e) {
    // 네트워크 끊김 등 실패 → 마지막 정상 가격을 유지하고 stale 플래그만 표시.
    const prev = lastGood.get(key)
    if (prev) {
      return { ...prev, ...holding, stale: true }
    }
    // 한 번도 성공 못 한 경우에만 에러 표시.
    return { ...item, ...holding, error: e.message || String(e) }
  }
}

export async function refreshAll() {
  const list = getItems()
  const results = await Promise.all(list.map(fetchOne))
  cache = results
  for (const fn of listeners) {
    try {
      fn(results)
    } catch (e) {
      console.error('stockService listener error:', e)
    }
  }
  return results
}

// --- Adaptive scheduling -----------------------------------------

function scheduleNext() {
  if (!polling) return
  const base = anyMarketOpen() ? REFRESH_FAST : REFRESH_SLOW
  const jitter = Math.floor(Math.random() * (JITTER * 2)) - JITTER
  timer = setTimeout(tick, base + jitter)
}

function tick() {
  refreshAll().finally(() => {
    scheduleNext()
  })
}

export function startPolling() {
  if (polling) return
  polling = true
  tick() // 즉시 첫 fetch + 이후 자동 스케줄
}

export function stopPolling() {
  polling = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

export function getCache() {
  return cache
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function reorderCache(order) {
  const map = new Map(cache.map((c) => [`${c.market}-${c.symbol}`, c]))
  cache = order.map((o) => map.get(`${o.market}-${o.symbol}`)).filter(Boolean)
  for (const fn of listeners) {
    try {
      fn(cache)
    } catch (e) {
      console.error('stockService listener error:', e)
    }
  }
}
