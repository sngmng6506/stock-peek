import { useProxy, proxyStock, proxySearch, eFetch } from './proxy.js'

const CHART_URL = (ticker) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?interval=1d&range=3mo`

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'application/json'
}

const SEARCH_URL = (kw) =>
  `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    kw
  )}&quotesCount=10&newsCount=0`

// 미국 주요 거래소만 (외국/암호화폐 제외)
const US_EXCHANGES = new Set(['NMS', 'NGM', 'NCM', 'NYQ', 'PCX', 'ASE', 'BTS'])

export async function searchUSStocks(keyword) {
  if (useProxy()) {
    try {
      return await proxySearch('US', keyword)
    } catch {
      // 프록시 실패 시 직접 호출로 폴백
    }
  }
  const res = await eFetch(SEARCH_URL(keyword), { headers: HEADERS })
  if (!res.ok) throw new Error(`Yahoo search: ${res.status}`)
  const json = await res.json()
  return (json?.quotes || [])
    .filter(
      (q) =>
        US_EXCHANGES.has(q.exchange) &&
        (q.quoteType === 'EQUITY' || q.quoteType === 'ETF')
    )
    .slice(0, 10)
    .map((q) => ({
      market: 'US',
      symbol: q.symbol,
      name: q.shortname || q.longname || q.symbol,
      type:
        q.quoteType === 'ETF'
          ? 'ETF'
          : ['NMS', 'NGM', 'NCM'].includes(q.exchange)
            ? 'NASDAQ'
            : 'NYSE'
    }))
}

// 통계용 일봉 종가 배열만 반환 (최근 3개월). 실패 시 빈 배열.
export async function fetchUSDailyCloses(ticker) {
  try {
    const res = await eFetch(CHART_URL(ticker), { headers: HEADERS })
    if (!res.ok) return []
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    const closes = result?.indicators?.quote?.[0]?.close || []
    return closes.filter((p) => p !== null && Number.isFinite(p))
  } catch {
    return []
  }
}

export async function fetchUSStock(ticker) {
  if (useProxy()) {
    try {
      return await proxyStock('US', ticker)
    } catch {
      // 프록시 실패 시 직접 호출로 폴백
    }
  }
  const res = await eFetch(CHART_URL(ticker), { headers: HEADERS })
  if (!res.ok) throw new Error(`Yahoo ${ticker}: ${res.status}`)

  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) {
    const err = json?.chart?.error?.description || 'no data'
    throw new Error(`Yahoo ${ticker}: ${err}`)
  }

  const meta = result.meta || {}
  const closes = result.indicators?.quote?.[0]?.close || []
  const validCloses = closes.filter((p) => p !== null && Number.isFinite(p))

  // 장 마감 후에는 regularMarketPrice가 비거나 stale할 수 있음 →
  // 마지막 유효 종가를 폴백으로 사용.
  let price = Number(meta.regularMarketPrice)
  if (!Number.isFinite(price) && validCloses.length) {
    price = validCloses[validCloses.length - 1]
  }

  const prev = Number(meta.previousClose ?? meta.chartPreviousClose)
  const change = Number.isFinite(prev) ? price - prev : 0
  const changeRatio = Number.isFinite(prev) && prev !== 0 ? (change / prev) * 100 : 0
  const name = meta.shortName || meta.longName || meta.symbol || ticker

  // 차트: 일봉 3개월치. (한국과 동일하게 일봉으로 통일 → 마감 후에도 유지)
  const prices = validCloses

  return {
    market: 'US',
    symbol: ticker.toUpperCase(),
    currency: meta.currency || 'USD',
    name,
    price,
    change,
    changeRatio,
    isUp: change >= 0,
    prices
  }
}


