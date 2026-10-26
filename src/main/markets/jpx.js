import jpList from '../../../data/jp-stocks.json'
import { createListProvider } from './listed.js'

// 일본: 시세·차트는 Yahoo(.T, 20분 지연), 일본어 종목명·검색은 JPX 東証上場銘柄一覧
// (data/jp-stocks.json, update-jp-stocks.yml이 매월 갱신). 순위는 TOPIX 규모(대형주 먼저).

// 검색용 정규화: 전각→반각, 대소문자, 히라가나→가타카나 (とよた → トヨタ)
function fold(s) {
  return String(s)
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/\s+/g, '')
}

export const jpxProvider = createListProvider({
  market: 'JP',
  suffix: '.T',
  label: 'TSE',
  items: jpList.items,
  fold
})
