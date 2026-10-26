import { getMarket } from '../../shared/markets.js'
import { createYahooProvider } from './yahoo.js'

/**
 * 현지어 종목 목록 + Yahoo 시세를 합친 provider (일본 JPX, 사우디 등).
 * - 현지어·코드 검색은 목록에서 (오프라인, 즉시)
 * - 영문 입력, 목록에 없는 코드(신규 상장 등)는 Yahoo 검색도 합침
 * - 시세는 Yahoo, 목록에 있으면 현지어 이름(localName)을 붙임 → 화면 언어가 같으면 그 이름으로 표시
 *
 * @param {object} cfg
 * @param {string} cfg.market      시장 id
 * @param {string} cfg.suffix      Yahoo 티커 접미사
 * @param {string} cfg.label       Yahoo 결과의 거래소 표시 이름
 * @param {Array<[string,string,string,number?]>} cfg.items  [코드, 현지어 이름, 구분, 정렬 순위?]
 * @param {(s: string) => string} cfg.fold  검색용 정규화 (표기 차이 흡수)
 */
export function createListProvider({ market: id, suffix, label, items, fold }) {
  const market = getMarket(id)
  const yahoo = createYahooProvider({ market: id, suffix, label })
  const LIST = items.filter(([code]) => market.symbolPattern.test(code))
  const BY_CODE = new Map(LIST.map((it) => [it[0], it]))
  const FOLDED = LIST.map((it) => [fold(it[1]), it])

  const toResult = ([code, name, type]) => ({
    market: id,
    symbol: code,
    name,
    localName: name,
    localLang: market.localLang,
    type
  })

  function searchLocal(keyword) {
    const q = fold(keyword)
    if (!q) return []
    const exact = BY_CODE.get(q)
    const starts = []
    const contains = []
    for (const [folded, it] of FOLDED) {
      if (it === exact) continue
      if (it[0].startsWith(q) || folded.startsWith(q)) starts.push(it)
      else if (folded.includes(q)) contains.push(it)
    }
    // 같은 매칭 단계 안에서는 정렬 순위(대형주 등) 먼저, 다음 코드 순
    const byRank = (a, b) => (a[3] ?? 9) - (b[3] ?? 9) || (a[0] < b[0] ? -1 : 1)
    return [...(exact ? [exact] : []), ...starts.sort(byRank), ...contains.sort(byRank)]
      .slice(0, 10)
      .map(toResult)
  }

  async function search(keyword) {
    const local = searchLocal(keyword)
    const code = market.normalizeSymbol(keyword.trim())
    const newCode = market.symbolPattern.test(code) && !BY_CODE.has(code)
    if (!newCode && !/[A-Za-z]/.test(keyword)) return local
    let remote = []
    try {
      remote = await yahoo.search(keyword)
    } catch {
      if (!local.length) throw new Error('ERR_SEARCH_FAILED')
    }
    const seen = new Set(local.map((r) => r.symbol))
    const merged = [...local]
    for (const r of remote) {
      if (seen.has(r.symbol)) continue
      const it = BY_CODE.get(r.symbol)
      merged.push(it ? { ...toResult(it), name: r.name } : r)
      seen.add(r.symbol)
    }
    return merged.slice(0, 10)
  }

  async function fetchQuote(symbol, opts) {
    const result = await yahoo.fetch(symbol, opts)
    const it = BY_CODE.get(symbol)
    return it ? { ...result, localName: it[1], localLang: market.localLang } : result
  }

  return { search, fetch: fetchQuote }
}
