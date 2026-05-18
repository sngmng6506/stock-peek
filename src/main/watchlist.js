import Store from 'electron-store'

const DEFAULTS = [
  { market: 'KR', symbol: '005930' },
  { market: 'KR', symbol: '000660' },
  { market: 'US', symbol: 'AAPL' },
  { market: 'US', symbol: 'NVDA' }
]

const store = new Store({
  name: 'watchlist',
  defaults: { items: DEFAULTS }
})

function normalize(market, symbol) {
  const m = String(market || '').toUpperCase()
  let s = String(symbol || '').trim()
  if (m === 'KR') s = s.replace(/\D/g, '')
  else s = s.toUpperCase()
  return { market: m, symbol: s }
}

function validate({ market, symbol }) {
  if (market === 'KR') {
    if (!/^\d{6}$/.test(symbol)) throw new Error('한국 종목코드는 6자리 숫자')
  } else if (market === 'US') {
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error('미국 티커는 1~10자 영문/숫자')
  } else {
    throw new Error(`unknown market: ${market}`)
  }
}

export function getItems() {
  return store.get('items')
}

export function addItem(market, symbol) {
  const item = normalize(market, symbol)
  validate(item)
  const list = getItems()
  if (list.some((i) => i.market === item.market && i.symbol === item.symbol)) {
    throw new Error('이미 추가된 종목')
  }
  const next = [...list, item]
  store.set('items', next)
  return next
}

export function setItems(items) {
  // 외부에서 전달된 array를 신뢰하지 않고 정규화 + 검증 통과한 항목만 저장.
  const seen = new Set()
  const next = []
  for (const raw of Array.isArray(items) ? items : []) {
    try {
      const item = normalize(raw.market, raw.symbol)
      validate(item)
      const key = `${item.market}-${item.symbol}`
      if (seen.has(key)) continue
      seen.add(key)
      next.push(item)
    } catch {
      // skip invalid entries
    }
  }
  store.set('items', next)
  return next
}

export function removeItem(market, symbol) {
  const item = normalize(market, symbol)
  const next = getItems().filter(
    (i) => !(i.market === item.market && i.symbol === item.symbol)
  )
  store.set('items', next)
  return next
}
