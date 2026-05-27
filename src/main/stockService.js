import { fetchKoreanStock } from './api/naver.js'
import { fetchUSStock } from './api/yahoo.js'
import { getItems } from './watchlist.js'

const REFRESH_FAST = 3_000 // 어느 한 시장이라도 열려있을 때
const REFRESH_SLOW = 60_000 // 한/미 모두 닫혔을 때
const JITTER = 250 // ms, 다중 사용자 호출 분산용
const CHART_TTL = 60_000 // 차트(일봉)는 1분만 캐시해도 충분 — 하루에 1번 변함

let polling = false
let timer = null
let cache = []
const listeners = new Set()

// 일봉 prices 캐시. key: "KR-005930", value: { prices, ts }
const chartCache = new Map()

// --- 시장 시간 판단 (KST 기준) ----------------------------------

function kstNow() {
  // UTC time + 9h 보정 → kst.getUTC*() 호출하면 KST 시각.
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
}

function isKoreanMarketOpen() {
  const k = kstNow()
  const day = k.getUTCDay() // 0=일, 6=토
  if (day === 0 || day === 6) return false
  const min = k.getUTCHours() * 60 + k.getUTCMinutes()
  return min >= 9 * 60 && min < 15 * 60 + 30
}

function isUSMarketOpen() {
  // 미국 정규장은 KST 22:30~24:00 (월~금) + 00:00~06:00 (화~토)
  // 서머타임 차이는 단순화. 충분히 근사.
  const k = kstNow()
  const day = k.getUTCDay()
  const min = k.getUTCHours() * 60 + k.getUTCMinutes()
  if (day >= 1 && day <= 5 && min >= 22 * 60 + 30) return true // 평일 밤
  if (day >= 2 && day <= 6 && min < 6 * 60) return true // 새벽 (다음날)
  return false
}

function anyMarketOpen() {
  return isKoreanMarketOpen() || isUSMarketOpen()
}

// --- Fetch logic --------------------------------------------------

async function fetchOne(item) {
  try {
    let result
    if (item.market === 'KR') {
      const key = `${item.market}-${item.symbol}`
      const cached = chartCache.get(key)
      const useCachedChart = cached && Date.now() - cached.ts < CHART_TTL
      result = await fetchKoreanStock(item.symbol, {
        skipChart: useCachedChart
      })
      if (useCachedChart) {
        result.prices = cached.prices
      } else if (result.prices?.length) {
        chartCache.set(key, { prices: result.prices, ts: Date.now() })
      }
    } else if (item.market === 'US') {
      result = await fetchUSStock(item.symbol)
    } else {
      return { ...item, error: 'unknown market' }
    }
    // 보유 정보 (watchlist에 기록된 quantity/avgPrice)를 합쳐서 렌더러로 전달.
    if (item.quantity != null) result.quantity = item.quantity
    if (item.avgPrice != null) result.avgPrice = item.avgPrice
    return result
  } catch (e) {
    return { ...item, error: e.message || String(e) }
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
  cache = order
    .map((o) => map.get(`${o.market}-${o.symbol}`))
    .filter(Boolean)
  for (const fn of listeners) {
    try {
      fn(cache)
    } catch (e) {
      console.error('stockService listener error:', e)
    }
  }
}
