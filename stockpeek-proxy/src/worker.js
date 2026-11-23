// Canonical Cloudflare Worker entrypoint for the existing stockpeek-proxy Worker.
// Preserve legacy stock/search response contracts; add restricted AI API routes.
import { onRequestPost as analyze } from '../functions/api/analyze.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}
const TTL_STOCK = 5
const TTL_SEARCH = 60

function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...headers }
  })
}
function errResponse(message, status = 400) {
  return jsonResponse({ error: message }, { status })
}
function parseNum(raw, formatted) {
  const n = Number(raw)
  return Number.isFinite(n) ? n : Number(String(formatted ?? '').replace(/,/g, ''))
}
function pickQuote(data) {
  const main = {
    price: parseNum(data.closePriceRaw, data.closePrice),
    change: parseNum(data.compareToPreviousClosePriceRaw, data.compareToPreviousClosePrice),
    changeRatio: parseNum(data.fluctuationsRatioRaw, data.fluctuationsRatio),
    direction: data.compareToPreviousPrice?.code,
    time: data.localTradedAt
  }
  const over = data.overMarketPriceInfo
    ? {
        price: parseNum(data.overMarketPriceInfo.overPriceRaw, data.overMarketPriceInfo.overPrice),
        change: parseNum(
          data.overMarketPriceInfo.compareToPreviousClosePriceRaw,
          data.overMarketPriceInfo.compareToPreviousClosePrice
        ),
        changeRatio: parseNum(
          data.overMarketPriceInfo.fluctuationsRatioRaw,
          data.overMarketPriceInfo.fluctuationsRatio
        ),
        direction: data.overMarketPriceInfo.compareToPreviousPrice?.code,
        time: data.overMarketPriceInfo.localTradedAt
      }
    : null
  if (
    over &&
    Number.isFinite(over.price) &&
    over.time &&
    main.time &&
    new Date(over.time).getTime() > new Date(main.time).getTime()
  )
    return over
  return main
}
async function fetchKR(code, { skipChart = false } = {}) {
  const quoteP = fetch(
    'https://polling.finance.naver.com/api/realtime/domestic/stock/' + encodeURIComponent(code),
    {
      headers: { Referer: 'https://finance.naver.com', 'User-Agent': UA }
    }
  )
  const chartP = skipChart
    ? null
    : fetch(
        'https://m.stock.naver.com/api/stock/' +
          encodeURIComponent(code) +
          '/price?pageSize=30&page=1',
        {
          headers: { Referer: 'https://m.stock.naver.com', 'User-Agent': UA }
        }
      )
  const quoteRes = await quoteP
  if (!quoteRes.ok) throw new Error('Naver quote ' + code + ': ' + quoteRes.status)
  const quoteJson = await quoteRes.json()
  const data = quoteJson?.datas?.[0]
  if (!data) throw new Error('Naver quote ' + code + ': empty')
  const q = pickQuote(data)
  const isUp = q.direction === '1' || q.direction === '2' || (!q.direction && q.change > 0)
  let prices = []
  if (chartP) {
    const chartRes = await chartP
    if (chartRes.ok) {
      try {
        const rows = await chartRes.json()
        prices = (rows || [])
          .map((r) => Number(String(r.closePrice ?? '').replace(/,/g, '')))
          .filter(Number.isFinite)
          .reverse()
      } catch {
        /* Price quote remains available if chart cannot be parsed. */
      }
    }
  }
  return {
    market: 'KR',
    symbol: code,
    currency: 'KRW',
    name: data.stockName,
    price: q.price,
    change: q.change,
    changeRatio: q.changeRatio,
    isUp,
    prices
  }
}
async function searchKR(q) {
  const res = await fetch(
    'https://ac.stock.naver.com/ac?q=' + encodeURIComponent(q) + '&target=stock',
    {
      headers: { 'User-Agent': UA }
    }
  )
  if (!res.ok) throw new Error('Naver search: ' + res.status)
  const data = await res.json()
  return (data?.items || [])
    .filter((i) => i.nationCode === 'KOR' && i.category === 'stock')
    .map((i) => ({ market: 'KR', symbol: i.code, name: i.name, type: i.typeName || '' }))
}
async function fetchUS(ticker) {
  const res = await fetch(
    'https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(ticker) +
      '?interval=5m&range=1d',
    {
      headers: { 'User-Agent': UA, Accept: 'application/json' }
    }
  )
  if (!res.ok) throw new Error('Yahoo ' + ticker + ': ' + res.status)
  const data = await res.json()
  const result = data?.chart?.result?.[0]
  if (!result) throw new Error('Yahoo ' + ticker + ': no data')
  const meta = result.meta || {}
  const price = Number(meta.regularMarketPrice)
  const prev = Number(meta.previousClose ?? meta.chartPreviousClose)
  const change = Number.isFinite(prev) ? price - prev : 0
  const changeRatio = Number.isFinite(prev) && prev !== 0 ? (change / prev) * 100 : 0
  const name = meta.shortName || meta.longName || meta.symbol || ticker
  const prices = (result.indicators?.quote?.[0]?.close || []).filter(
    (p) => p !== null && Number.isFinite(p)
  )
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
    'https://query1.finance.yahoo.com/v1/finance/search?q=' +
      encodeURIComponent(q) +
      '&quotesCount=10&newsCount=0',
    {
      headers: { 'User-Agent': UA, Accept: 'application/json' }
    }
  )
  if (!res.ok) throw new Error('Yahoo search: ' + res.status)
  const data = await res.json()
  return (data?.quotes || [])
    .filter(
      (qu) => US_EXCHANGES.has(qu.exchange) && (qu.quoteType === 'EQUITY' || qu.quoteType === 'ETF')
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
  const res = jsonResponse(data, { headers: { 'Cache-Control': 'public, max-age=' + ttl } })
  ctx.waitUntil(cache.put(request, res.clone()))
  return res
}
const methodNotAllowed = (allow) =>
  new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: allow, 'Cache-Control': 'no-store' }
  })
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    // IMPORTANT: handle private routes before global GET/OPTIONS+CORS routing.
    if (url.pathname === '/api/analyze') {
      if (request.method !== 'POST') return methodNotAllowed('POST')
      return analyze({ request, env })
    }
    if (url.pathname === '/api/health') {
      if (request.method !== 'GET') return methodNotAllowed('GET')
      return new Response(
        JSON.stringify({ ok: true, service: 'stockpeek-proxy', mode: 'restricted' }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        }
      )
    }
    // Preserve existing public price/search routes and their CORS policy.
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    const market = url.searchParams.get('market')
    if (url.pathname === '/api/stock') {
      const symbol = url.searchParams.get('symbol')
      const skipChart = url.searchParams.get('skipChart') === '1'
      if (!market || !symbol) return errResponse('missing market/symbol')
      return withCache(request, ctx, TTL_STOCK, async () => {
        if (market === 'KR') return fetchKR(symbol, { skipChart })
        if (market === 'US') return fetchUS(symbol)
        throw new Error('unknown market: ' + market)
      })
    }
    if (url.pathname === '/api/search') {
      const q = url.searchParams.get('q')
      if (!market || !q) return errResponse('missing market/q')
      return withCache(request, ctx, TTL_SEARCH, async () => {
        if (market === 'KR') return searchKR(q)
        if (market === 'US') return searchUS(q)
        throw new Error('unknown market: ' + market)
      })
    }
    if (url.pathname === '/' || url.pathname === '/health')
      return jsonResponse({ ok: true, name: 'stockpeek-proxy' })
    return errResponse('not found', 404)
  }
}
