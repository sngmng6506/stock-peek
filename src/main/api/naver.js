import { useProxy, proxyStock, proxySearch, eFetch } from './proxy.js'

const QUOTE_URL = (code) =>
  `https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`

// 모바일 네이버 일봉 엔드포인트. 휴장일/거래시간 외에도 직전 거래일들 데이터를 반환.
// (siseJson의 timeframe=minute는 평일 거래시간 외엔 빈 응답이라 sparkline이 안 그려짐)
const CHART_URL = (code) =>
  `https://m.stock.naver.com/api/stock/${code}/price?pageSize=30&page=1`

const QUOTE_HEADERS = {
  Referer: 'https://finance.naver.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
}

const CHART_HEADERS = {
  Referer: 'https://m.stock.naver.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
}

function parseNumber(raw, formatted) {
  const r = Number(raw)
  if (Number.isFinite(r)) return r
  return Number(String(formatted ?? '').replace(/,/g, ''))
}

function quoteFromMain(data) {
  return {
    price: parseNumber(data.closePriceRaw, data.closePrice),
    change: parseNumber(
      data.compareToPreviousClosePriceRaw,
      data.compareToPreviousClosePrice
    ),
    changeRatio: parseNumber(
      data.fluctuationsRatioRaw,
      data.fluctuationsRatio
    ),
    direction: data.compareToPreviousPrice?.code,
    time: data.localTradedAt
  }
}

function quoteFromOver(over) {
  return {
    price: parseNumber(over.overPriceRaw, over.overPrice),
    change: parseNumber(
      over.compareToPreviousClosePriceRaw,
      over.compareToPreviousClosePrice
    ),
    changeRatio: parseNumber(
      over.fluctuationsRatioRaw,
      over.fluctuationsRatio
    ),
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
  const overQ = data.overMarketPriceInfo
    ? quoteFromOver(data.overMarketPriceInfo)
    : null

  let chosen = mainQ
  if (overQ && Number.isFinite(overQ.price) && overQ.time && mainQ.time) {
    if (new Date(overQ.time).getTime() > new Date(mainQ.time).getTime()) {
      chosen = overQ
    }
  }

  // 1: 상한, 2: 상승, 3: 보합, 4: 하한, 5: 하락
  const isUp =
    chosen.direction === '1' ||
    chosen.direction === '2' ||
    (!chosen.direction && chosen.change > 0)

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
    .map((r) => Number(String(r.closePrice ?? '').replace(/,/g, '')))
    .filter((n) => Number.isFinite(n))
    .reverse()
}

const SEARCH_URL = (kw) =>
  `https://ac.stock.naver.com/ac?q=${encodeURIComponent(kw)}&target=stock`

// 통계(추세·변동성)용 일봉 종가 — 최근 ~3개월(70거래일 여유). 실패 시 빈 배열.
const DAILY_URL = (code) =>
  `https://m.stock.naver.com/api/stock/${code}/price?pageSize=70&page=1`

export async function fetchKoreanDailyCloses(code) {
  try {
    const res = await eFetch(DAILY_URL(code), { headers: CHART_HEADERS })
    if (!res.ok) return []
    const rows = await res.json()
    return extractCloses(rows)
  } catch {
    return []
  }
}

export async function searchKoreanStocks(keyword) {
  if (useProxy()) {
    try {
      return await proxySearch('KR', keyword)
    } catch {
      // 프록시 실패 시 직접 호출로 폴백
    }
  }
  const res = await eFetch(SEARCH_URL(keyword), { headers: CHART_HEADERS })
  if (!res.ok) throw new Error(`Naver search: ${res.status}`)
  const json = await res.json()
  return (json?.items || [])
    .filter((i) => i.nationCode === 'KOR' && i.category === 'stock')
    .map((i) => ({
      market: 'KR',
      symbol: i.code,
      name: i.name,
      type: i.typeName || ''
    }))
}

export async function fetchKoreanStock(code, { skipChart = false } = {}) {
  if (useProxy()) {
    try {
      return await proxyStock('KR', code, { skipChart })
    } catch {
      // 프록시 실패 시 직접 호출로 폴백
    }
  }
  const quotePromise = eFetch(QUOTE_URL(code), { headers: QUOTE_HEADERS })
  const chartPromise = skipChart
    ? null
    : eFetch(CHART_URL(code), { headers: CHART_HEADERS })

  const quoteRes = await quotePromise
  if (!quoteRes.ok) throw new Error(`Naver quote ${code}: ${quoteRes.status}`)

  const quoteJson = await quoteRes.json()
  const quote = extractQuote(quoteJson)
  if (!quote) throw new Error(`Naver quote ${code}: empty payload`)

  let prices = []
  if (chartPromise) {
    const chartRes = await chartPromise
    if (chartRes.ok) {
      try {
        const rows = await chartRes.json()
        prices = extractCloses(rows)
      } catch {
        prices = []
      }
    }
  }

  return {
    market: 'KR',
    symbol: code,
    currency: 'KRW',
    ...quote,
    prices
  }
}


