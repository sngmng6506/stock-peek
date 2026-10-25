import { eFetch, USER_AGENT } from './http.js'

// Yahoo Finance 기반 시장 공용 provider.
// 시장마다 다른 건 티커 접미사(일본 '.T' 등)와 검색 결과에서 받을 거래소 코드뿐.

const CHART_URL = (ticker) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=3mo`

const SEARCH_URL = (kw) =>
  `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(kw)}&quotesCount=10&newsCount=0`

const HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' }

/**
 * @param {object} cfg
 * @param {string} cfg.market       시장 id ('US', 'JP' …)
 * @param {string} [cfg.suffix]     Yahoo 티커 접미사. 저장 심볼에는 붙이지 않음
 * @param {Record<string,string>} [cfg.exchanges]  Yahoo 거래소 코드 → 표시 이름. suffix가 있으면 생략 가능
 * @param {string} [cfg.label]  exchanges에 없는 거래소의 표시 이름
 */
export function createYahooProvider({ market, suffix = '', exchanges = {}, label = '' }) {
  const toTicker = (symbol) => `${symbol}${suffix}`
  const fromTicker = (ticker) =>
    suffix && ticker.endsWith(suffix) ? ticker.slice(0, -suffix.length) : ticker

  async function search(keyword) {
    const res = await eFetch(SEARCH_URL(keyword), { headers: HEADERS })
    if (!res.ok) throw new Error(`Yahoo search: ${res.status}`)
    const json = await res.json()
    return (json?.quotes || [])
      .filter(
        (q) =>
          (suffix ? q.symbol?.endsWith(suffix) : q.exchange in exchanges) &&
          (q.quoteType === 'EQUITY' || q.quoteType === 'ETF')
      )
      .slice(0, 10)
      .map((q) => ({
        market,
        symbol: fromTicker(q.symbol),
        name: q.shortname || q.longname || q.symbol,
        type: q.quoteType === 'ETF' ? 'ETF' : exchanges[q.exchange] || label
      }))
  }

  // 차트(일봉 3개월)가 시세와 같은 응답에 오므로 skipChart는 무시
  async function fetchQuote(symbol) {
    const ticker = toTicker(symbol)
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
    const prices = closes.filter((p) => p !== null && Number.isFinite(p))

    // 장 마감 후에는 regularMarketPrice가 비거나 stale할 수 있음 → 마지막 유효 종가로 폴백
    let price = Number(meta.regularMarketPrice)
    if (!Number.isFinite(price) && prices.length) price = prices[prices.length - 1]

    const prev = Number(meta.previousClose ?? meta.chartPreviousClose)
    const change = Number.isFinite(prev) ? price - prev : 0
    const changeRatio = Number.isFinite(prev) && prev !== 0 ? (change / prev) * 100 : 0

    return {
      market,
      symbol: fromTicker(ticker).toUpperCase(),
      currency: meta.currency,
      name: meta.shortName || meta.longName || meta.symbol || ticker,
      price,
      change,
      changeRatio,
      isUp: change >= 0,
      prices
    }
  }

  return { search, fetch: fetchQuote }
}
