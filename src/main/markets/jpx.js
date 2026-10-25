import jpList from '../../../data/jp-stocks.json'
import { getMarket } from '../../shared/markets.js'
import { createYahooProvider } from './yahoo.js'

// 일본: 시세·차트는 Yahoo(.T, 20분 지연), 일본어 종목명·검색은 JPX 東証上場銘柄一覧
// (data/jp-stocks.json, update-jp-stocks.yml이 매월 갱신).

const market = getMarket('JP')
const yahoo = createYahooProvider({ market: 'JP', suffix: '.T', label: 'TSE' })

// [code, name, segment, sizeRank] — 5자리 우선주 등 Yahoo가 다루지 않는 코드는 제외
const LIST = jpList.items.filter(([code]) => market.symbolPattern.test(code))
const BY_CODE = new Map(LIST.map((it) => [it[0], it]))

// 검색용 정규화: 전각→반각, 대소문자, 히라가나→가타카나 (とよた → トヨタ)
function fold(s) {
  return String(s)
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/\s+/g, '')
}
const FOLDED = LIST.map((it) => [fold(it[1]), it])

const toResult = ([code, name, segment]) => ({
  market: 'JP',
  symbol: code,
  name,
  localName: name,
  localLang: 'ja',
  type: segment
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
  // 같은 매칭 단계 안에서는 대형주 먼저 (TOPIX 규모 순위), 다음 코드 순
  const bySize = (a, b) => (a[3] ?? 9) - (b[3] ?? 9) || (a[0] < b[0] ? -1 : 1)
  return [...(exact ? [exact] : []), ...starts.sort(bySize), ...contains.sort(bySize)]
    .slice(0, 10)
    .map(toResult)
}

async function search(keyword) {
  const local = searchLocal(keyword)
  // JPX 목록은 월 1회 갱신 → 목록에 없는 코드(신규 상장)는 Yahoo에서 찾음.
  // 영문 입력도 Yahoo 영문명 검색을 합침. 그 외 일본어 입력은 목록으로 충분
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
  return it ? { ...result, localName: it[1], localLang: 'ja' } : result
}

export const jpxProvider = { search, fetch: fetchQuote }
