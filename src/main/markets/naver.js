import { fetchJson, USER_AGENT } from './http.js'
import { finiteNumber, positivePrice } from './numbers.js'

const QUOTE_URL = (code) => `https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`

// 모바일 네이버 일봉 엔드포인트. 휴장일/거래시간 외에도 직전 거래일들 데이터를 반환.
// (siseJson의 timeframe=minute는 평일 거래시간 외엔 빈 응답이라 sparkline이 안 그려짐)
const CHART_URL = (code) => `https://m.stock.naver.com/api/stock/${code}/price?pageSize=30&page=1`

const QUOTE_HEADERS = {
  Referer: 'https://finance.naver.com',
  'User-Agent': USER_AGENT
}

const CHART_HEADERS = {
  Referer: 'https://m.stock.naver.com',
  'User-Agent': USER_AGENT
}

function parseNumber(raw, formatted) {
  const r = finiteNumber(raw)
  if (Number.isFinite(r)) return r
  return finiteNumber(formatted)
}

function quoteFromMain(data) {
  return {
    price: parseNumber(data.closePriceRaw, data.closePrice),
    change: parseNumber(data.compareToPreviousClosePriceRaw, data.compareToPreviousClosePrice),
    changeRatio: parseNumber(data.fluctuationsRatioRaw, data.fluctuationsRatio),
    direction: data.compareToPreviousPrice?.code,
    time: data.localTradedAt
  }
}

function quoteFromOver(over) {
  return {
    price: parseNumber(over.overPriceRaw, over.overPrice),
    change: parseNumber(over.compareToPreviousClosePriceRaw, over.compareToPreviousClosePrice),
    changeRatio: parseNumber(over.fluctuationsRatioRaw, over.fluctuationsRatio),
    direction: over.compareToPreviousPrice?.code,
    time: over.localTradedAt
  }
}

function extractQuote(json) {
  const data = json?.datas?.[0] || json?.result?.areas?.[0]?.datas?.[0]
  if (!data) return null

  // 정규장 + 시간외 단일가 둘 다 받아서 더 최신 거래 기준으로 표시.
  // (장 마감 후엔 시간외 가격이 토스 등 다른 앱에서 보이는 "현재 가격"과 일치)
  const mainQ = quoteFromMain(data)
  const overQ = data.overMarketPriceInfo ? quoteFromOver(data.overMarketPriceInfo) : null

  let chosen = mainQ
  if (overQ && Number.isFinite(positivePrice(overQ.price)) && overQ.time && mainQ.time) {
    if (new Date(overQ.time).getTime() > new Date(mainQ.time).getTime()) {
      chosen = overQ
    }
  }

  // 1: 상한, 2: 상승, 3: 보합, 4: 하한, 5: 하락
  const isUp =
    chosen.direction === '1' || chosen.direction === '2' || (!chosen.direction && chosen.change > 0)

  return {
    name: data.stockName,
    price: chosen.price,
    change: chosen.change,
    changeRatio: chosen.changeRatio,
    isUp
  }
}

function extractCloses(rows) {
  if (!Array.isArray(rows)) return []
  // 응답은 최신 → 과거 순. sparkline은 좌→우 시간순으로 그려야 하므로 reverse.
  return rows
    .map((r) => positivePrice(r.closePrice))
    .filter((n) => Number.isFinite(n))
    .reverse()
}

const SEARCH_URL = (kw) => `https://ac.stock.naver.com/ac?q=${encodeURIComponent(kw)}&target=stock`

async function search(keyword) {
  const res = await fetchJson(SEARCH_URL(keyword), { headers: CHART_HEADERS })
  if (!res.ok) throw new Error(`Naver search: ${res.status}`)
  const json = res.data
  return (json?.items || [])
    .filter((i) => i.nationCode === 'KOR' && i.category === 'stock')
    .map((i) => ({
      market: 'KR',
      symbol: i.code,
      name: i.name,
      type: i.typeName || ''
    }))
}

// Chart requests never block quote delivery. Publish cached chart on the next poll.
const charts = new Map()
const chartRequests = new Map()
const chartRetryAt = new Map()
function refreshChart(code) {
  if (chartRequests.has(code) || Date.now() < (chartRetryAt.get(code) || 0)) return
  const request = fetchJson(CHART_URL(code), { headers: CHART_HEADERS })
    .then((res) => {
      if (!res.ok) throw new Error('chart unavailable')
      const prices = extractCloses(res.data)
      if (!prices.length) throw new Error('empty chart')
      charts.set(code, prices)
      chartRetryAt.set(code, Date.now() + 600_000)
    })
    .catch(() => chartRetryAt.set(code, Date.now() + 60_000))
    .finally(() => chartRequests.delete(code))
  chartRequests.set(code, request)
}

async function fetchQuote(code) {
  refreshChart(code)
  const quotePromise = fetchJson(QUOTE_URL(code), { headers: QUOTE_HEADERS })

  const quoteRes = await quotePromise
  if (!quoteRes.ok) throw new Error(`Naver quote ${code}: ${quoteRes.status}`)

  const quoteJson = quoteRes.data
  const quote = extractQuote(quoteJson)
  if (!quote) throw new Error(`Naver quote ${code}: empty payload`)

  const prices = charts.get(code) || []

  return {
    market: 'KR',
    symbol: code,
    currency: 'KRW',
    ...quote,
    prices
  }
}

export const naverProvider = { search, fetch: fetchQuote }
