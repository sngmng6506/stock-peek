// Stock Peek — Cloudflare Worker proxy
// 클라이언트가 비공식 API를 직접 호출하지 않고 이 Worker를 거치도록 해서:
// 1) IP를 Cloudflare edge로 분산 (단일 백엔드 IP 문제 회피)
// 2) Cache API로 응답 캐싱 (같은 종목 보는 사용자 다수일 때 효과 큼)
// 3) 비공식 API 약관 위반 노출은 Worker 한 곳에만 (README에 명시할 것)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const TTL_STOCK = 5 // seconds — quote는 5초마다 갱신
const TTL_SEARCH = 60 // seconds — 검색은 자주 안 바뀜

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS,
      ...(init.headers || {})
    }
  })
}

function errResponse(message, status = 400) {
  return jsonResponse({ error: message }, { status })
}

// ----- Naver (KR) -----

async function fetchKR(code, { skipChart = false } = {}) {
  const quoteP = fetch(
    `https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`,
    { headers: { Referer: 'https://finance.naver.com', 'User-Agent': UA } }
  )
  const chartP = skipChart
    ? null
    : fetch(
        `https://m.stock.naver.com/api/stock/${code}/price?pageSize=30&page=1`,
        { headers: { Referer: 'https://m.stock.naver.com', 'User-Agent': UA } }
      )

  const quoteRes = await quoteP
  if (!quoteRes.ok) throw new Error(`Naver quote ${code}: ${quoteRes.status}`)
  const quoteJson = await quoteRes.json()
  const data = quoteJson?.datas?.[0]
  if (!data) throw new Error(`Naver quote ${code}: empty`)

  const price = Number(data.closePriceRaw)
  const change = Number(data.compareToPreviousClosePriceRaw)
  const changeRatio = Number(data.fluctuationsRatioRaw)
  const direction = data.compareToPreviousPrice?.code
  const isUp =
    direction === '1' || direction === '2' || (!direction && change > 0)

  let prices = []
  if (chartP) {
    const chartRes = await chartP
    if (chartRes.ok) {
      try {
        const rows = await chartRes.json()
        prices = (rows || [])
          .map((r) => Number(String(r.closePrice ?? '').replace(/,/g, '')))
          .filter((n) => Number.isFinite(n))
          .reverse()
      } catch (e) {
        // ignore chart parse errors
      }
    }
  }

  return {
    market: 'KR',
    symbol: code,
    currency: 'KRW',
    name: data.stockName,
    price,
    change,
    changeRatio,
    isUp,
    prices
  }
}

async function searchKR(q) {
  const res = await fetch(
    `https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`,
    { headers: { 'User-Agent': UA } }
  )
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

// ----- Yahoo (US) -----

async function fetchUS(ticker) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      ticker
    )}?interval=5m&range=1d`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' } }
  )
  if (!res.ok) throw new Error(`Yahoo ${ticker}: ${res.status}`)
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) throw new Error(`Yahoo ${ticker}: no data`)

  const meta = result.meta || {}
  const price = Number(meta.regularMarketPrice)
  const prev = Number(meta.previousClose ?? meta.chartPreviousClose)
  const change = Number.isFinite(prev) ? price - prev : 0
  const changeRatio =
    Number.isFinite(prev) && prev !== 0 ? (change / prev) * 100 : 0
  const name = meta.shortName || meta.longName || meta.symbol || ticker
  const closes = result.indicators?.quote?.[0]?.close || []
  const prices = closes.filter((p) => p !== null && Number.isFinite(p))

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

const US_EXCHANGES = new Set(['NMS', 'NGM', 'NCM', 'NYQ', 'PCX', 'ASE', 'BTS'])

async function searchUS(q) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      q
    )}&quotesCount=10&newsCount=0`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' } }
  )
  if (!res.ok) throw new Error(`Yahoo search: ${res.status}`)
  const json = await res.json()
  return (json?.quotes || [])
    .filter(
      (qu) =>
        US_EXCHANGES.has(qu.exchange) &&
        (qu.quoteType === 'EQUITY' || qu.quoteType === 'ETF')
    )
    .slice(0, 10)
    .map((qu) => ({
      market: 'US',
      symbol: qu.symbol,
      name: qu.shortname || qu.longname || qu.symbol,
      type:
        qu.quoteType === 'ETF'
          ? 'ETF'
          : ['NMS', 'NGM', 'NCM'].includes(qu.exchange)
            ? 'NASDAQ'
            : 'NYSE'
    }))
}

// ----- Cache helper -----

async function withCache(request, ctx, ttl, fetcher) {
  const cache = caches.default
  const hit = await cache.match(request)
  if (hit) return hit

  let data
  try {
    data = await fetcher()
  } catch (e) {
    return errResponse(e?.message || 'fetch failed', 502)
  }

  const res = jsonResponse(data, {
    headers: { 'Cache-Control': `public, max-age=${ttl}` }
  })
  ctx.waitUntil(cache.put(request, res.clone()))
  return res
}

// ----- Router -----

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }

    const url = new URL(request.url)
    const market = url.searchParams.get('market')

    if (url.pathname === '/api/stock') {
      const symbol = url.searchParams.get('symbol')
      const skipChart = url.searchParams.get('skipChart') === '1'
      if (!market || !symbol) return errResponse('missing market/symbol')
      return withCache(request, ctx, TTL_STOCK, async () => {
        if (market === 'KR') return await fetchKR(symbol, { skipChart })
        if (market === 'US') return await fetchUS(symbol)
        throw new Error(`unknown market: ${market}`)
      })
    }

    if (url.pathname === '/api/search') {
      const q = url.searchParams.get('q')
      if (!market || !q) return errResponse('missing market/q')
      return withCache(request, ctx, TTL_SEARCH, async () => {
        if (market === 'KR') return await searchKR(q)
        if (market === 'US') return await searchUS(q)
        throw new Error(`unknown market: ${market}`)
      })
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return jsonResponse({ ok: true, name: 'stockpeek-proxy' })
    }

    return errResponse('not found', 404)
  }
}
