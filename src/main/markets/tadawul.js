import saList from '../../../data/sa-stocks.json'
import { createListProvider } from './listed.js'

// 사우디: 시세·차트는 Yahoo(.SR, 15분 지연), 아랍어 종목명·검색은 data/sa-stocks.json
// (Argaam 목록을 손으로 복사해 scripts/import_sa_stocks.py로 변환. 거래소가 자동 수집을 막음).
// 목록에 없는 Nomu·신규 상장 종목은 4자리 코드로 Yahoo에서 찾음.

// 검색용 정규화: 아랍어 표기 차이 흡수
// 모음 부호·타트윌 제거, 알리프 변형(أ إ آ ٱ)→ا, ة→ه, ى·ی·ئ→ي, ؤ→و, ک→ك, 공백 제거
function fold(s) {
  return String(s)
    .normalize('NFKC')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىیئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ک/g, 'ك')
    .toUpperCase()
    .replace(/\s+/g, '')
}

export const tadawulProvider = createListProvider({
  market: 'SA',
  suffix: '.SR',
  label: 'Tadawul',
  items: saList.items,
  fold
})
