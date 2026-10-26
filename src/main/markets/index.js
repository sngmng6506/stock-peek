import { getMarket } from '../../shared/markets.js'
import { naverProvider } from './naver.js'
import { createYahooProvider } from './yahoo.js'
import { jpxProvider } from './jpx.js'
import { tadawulProvider } from './tadawul.js'

// 시장 id → 데이터 provider ({ search(keyword), fetch(symbol, { skipChart }) }).
// 시장 메타데이터(통화·장 시간·심볼 규칙)는 src/shared/markets.js.
const PROVIDERS = {
  KR: naverProvider,
  US: createYahooProvider({
    market: 'US',
    exchanges: {
      NMS: 'NASDAQ',
      NGM: 'NASDAQ',
      NCM: 'NASDAQ',
      NYQ: 'NYSE',
      PCX: 'NYSE',
      ASE: 'NYSE',
      BTS: 'NYSE'
    }
  }),
  JP: jpxProvider,
  // NSE만 (BSE .BO는 같은 종목 중복 + 15분 지연)
  IN: createYahooProvider({ market: 'IN', suffix: '.NS', label: 'NSE' }),
  SA: tadawulProvider
}

export function getProvider(marketId) {
  const m = getMarket(marketId)
  return m ? PROVIDERS[m.id] || null : null
}
