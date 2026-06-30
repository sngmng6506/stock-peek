// Stock Peek — Cloudflare Worker proxy
// IP를 Cloudflare edge로 분산하고 Cache API로 응답 캐싱.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const TTL_STOCK = 5 // seconds — quote는 5초마다 갱신
const TTL_SEARCH = 60 // seconds — 검색은 자주 안 바뀜

// 포트폴리오 한 줄 평 (LLM)
const REVIEW_MODEL = 'anthropic/claude-3.5-haiku' // OpenRouter 모델 ID
const REVIEW_DAILY_CAP = 2000 // 전체 일일 호출 상한 (killswitch)

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

function parseNum(raw, formatted) {
  const r = Number(raw)
  if (Number.isFinite(r)) return r
  return Number(String(formatted ?? '').replace(/,/g, ''))
}

function pickQuote(data) {
  const main = {
    price: parseNum(data.closePriceRaw, data.closePrice),
    change: parseNum(
      data.compareToPreviousClosePriceRaw,
      data.compareToPreviousClosePrice
    ),
    changeRatio: parseNum(data.fluctuationsRatioRaw, data.fluctuationsRatio),
    direction: data.compareToPreviousPrice?.code,
    time: data.localTradedAt
  }
  const over = data.overMarketPriceInfo
    ? {
        price: parseNum(
          data.overMarketPriceInfo.overPriceRaw,
          data.overMarketPriceInfo.overPrice
        ),
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
  ) {
    return over
  }
  return main
}

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

  const q = pickQuote(data)
  const price = q.price
  const change = q.change
  const changeRatio = q.changeRatio
  const direction = q.direction
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

// ----- 포트폴리오 한 줄 평 (LLM via OpenRouter) -----

// KST 기준 오늘 날짜 문자열 (YYYY-MM-DD)
function kstDateStr() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

// 통계 객체 → LLM 프롬프트용 사실 요약 (한국어/영어 공통, 숫자 위주)
function statsToFacts(stats, lang) {
  const f = []
  if (stats.pnl?.hasHolding) {
    const r = stats.pnl.pnlRatio
    f.push(`평가손익 ${r >= 0 ? '+' : ''}${r.toFixed(1)}%`)
  }
  if (stats.concentration) {
    const c = stats.concentration
    if (c.topName && c.holdingBased) {
      f.push(`최대 비중: ${c.topName} ${c.topWeight.toFixed(0)}%`)
    }
    if (c.hhi >= 0.4) f.push('집중도 높음(분산 약함)')
    else if (c.hhi <= 0.2) f.push('비교적 분산됨')
  }
  if (stats.trend?.available) {
    const m = { up: '상승', down: '하락', mixed: '혼조' }
    f.push(`추세: ${m[stats.trend.direction] || stats.trend.direction}`)
  }
  if (stats.volatility?.available) {
    const m = { low: '낮음', normal: '보통', high: '높음' }
    f.push(`변동성: ${m[stats.volatility.level] || stats.volatility.level}`)
  }
  return f.join(', ')
}

async function generateReview(stats, lang, env) {
  const facts = statsToFacts(stats, lang)
  const sys =
    lang === 'en'
      ? 'You are a concise portfolio commentator. Given factual portfolio statistics, write ONE short neutral sentence (under 25 words) describing the portfolio state. Never give buy/sell advice or predictions. State only what the facts say. Output only the sentence.'
      : '너는 간결한 포트폴리오 코멘터다. 주어진 포트폴리오 통계 사실을 바탕으로, 포트폴리오 상태를 묘사하는 중립적인 한 문장(40자 내외)을 쓴다. 매수/매도 조언이나 예측은 절대 하지 않는다. 사실만 서술한다. 문장만 출력한다.'

  const body = {
    model: REVIEW_MODEL,
    max_tokens: 120,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: `통계: ${facts}` }
    ]
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://stock-peek.com',
      'X-Title': 'Stock Peek'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`LLM ${res.status}: ${t.slice(0, 200)}`)
  }
  const json = await res.json()
  const text = json?.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('LLM empty response')
  return text
}

async function handleReview(request, env) {
  if (!env.OPENROUTER_API_KEY) {
    return errResponse('review not configured', 503)
  }
  if (!env.REVIEW_KV) {
    return errResponse('storage not configured', 503)
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return errResponse('invalid json')
  }
  const deviceId = String(payload?.deviceId || '').trim()
  const stats = payload?.stats
  const lang = payload?.lang === 'en' ? 'en' : 'ko'
  if (!deviceId || deviceId.length > 100) return errResponse('invalid deviceId')
  if (!stats || stats.empty) return errResponse('no stats')

  const today = kstDateStr()

  // 1) 디바이스별 하루 1회 제한
  const userKey = `rv:${deviceId}`
  const lastDate = await env.REVIEW_KV.get(userKey)
  if (lastDate === today) {
    return jsonResponse(
      { error: 'already_used_today', nextAvailable: 'tomorrow' },
      { status: 429 }
    )
  }

  // 2) 전체 일일 호출 상한 (killswitch)
  const capKey = `cap:${today}`
  const usedRaw = await env.REVIEW_KV.get(capKey)
  const used = Number(usedRaw) || 0
  if (used >= REVIEW_DAILY_CAP) {
    return jsonResponse({ error: 'daily_cap_reached' }, { status: 503 })
  }

  // 3) LLM 호출
  let review
  try {
    review = await generateReview(stats, lang, env)
  } catch (e) {
    return errResponse(e?.message || 'review failed', 502)
  }

  // 4) 기록 갱신 (성공 시에만 차감)
  //    유저 마지막 날짜 = 오늘 (48h TTL로 자동 정리)
  await env.REVIEW_KV.put(userKey, today, { expirationTtl: 60 * 60 * 48 })
  //    전체 카운터 +1 (48h TTL)
  await env.REVIEW_KV.put(capKey, String(used + 1), {
    expirationTtl: 60 * 60 * 48
  })

  return jsonResponse({ review, date: today })
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

    if (url.pathname === '/api/review' && request.method === 'POST') {
      return handleReview(request, env)
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return jsonResponse({ ok: true, name: 'stockpeek-proxy' })
    }

    return errResponse('not found', 404)
  }
}
