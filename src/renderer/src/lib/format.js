import { getMarket } from '../../../shared/markets.js'
import { getLanguageInfo } from '../../../shared/languages.js'

// 금액·숫자 표기. 통화와 자릿수는 시장(src/shared/markets.js), 숫자 모양은 화면 언어를 따름.

// 숫자는 모든 언어에서 라틴 숫자(0-9): 아랍어 화면도 시세·금액은 라틴 숫자가 관례
const formatters = new Map()
function nf(locale, options) {
  const key = locale + JSON.stringify(options)
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, { numberingSystem: 'latn', ...options })
    formatters.set(key, f)
  }
  return f
}

// 한국어 화면의 원화는 관례대로 숫자 뒤에 '원'
const usesWonSuffix = (currency, lang) => currency === 'KRW' && lang === 'ko'

export function formatMoney(value, marketId, lang, { signed = false } = {}) {
  if (!Number.isFinite(value)) return '—'
  const market = getMarket(marketId)
  const currency = market?.currency || 'USD'
  const digits = market?.decimals ?? 2
  const maxDigits = market?.maxDecimals ?? digits
  const signDisplay = signed ? 'exceptZero' : 'auto'
  if (usesWonSuffix(currency, lang)) {
    return `${nf('ko-KR', { maximumFractionDigits: 0, signDisplay }).format(Math.round(value))}원`
  }
  // 시장 고유 자릿수 표기(인도 lakh 등)는 영어 화면에서만: 그 시장 사용자가 쓰는 화면 언어
  const locale =
    market?.numberLocale && lang === 'en' ? market.numberLocale : getLanguageInfo(lang).locale
  return nf(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: maxDigits,
    signDisplay
  }).format(value)
}

// 입력칸 라벨용 통화 기호 ('원', '$', '¥' …)
export function currencySymbol(marketId, lang) {
  const currency = getMarket(marketId)?.currency || 'USD'
  if (usesWonSuffix(currency, lang)) return '원'
  const parts = nf(getLanguageInfo(lang).locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol'
  }).formatToParts(0)
  return parts.find((p) => p.type === 'currency')?.value || currency
}

export function formatNumber(value, lang) {
  return Number.isFinite(Number(value)) ? nf(getLanguageInfo(lang).locale, {}).format(value) : '—'
}

export function formatRatio(r) {
  if (!Number.isFinite(r)) return ''
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}%`
}

export function formatQuoteTime(timestamp, lang) {
  if (!Number.isFinite(timestamp)) return null
  return new Intl.DateTimeFormat(getLanguageInfo(lang).locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    calendar: 'gregory',
    numberingSystem: 'latn'
  }).format(new Date(timestamp))
}

// 입력 예시용 숫자 (구분 기호 없이: 입력칸에 그대로 칠 수 있게)
export function examplePrice(marketId) {
  const m = getMarket(marketId)
  return m ? m.examplePrice.toFixed(m.decimals) : ''
}

// 종목명: 화면 언어가 시장 원어와 같으면 원어 이름(예: 일본어 UI의 トヨタ自動車), 아니면 기본 이름
export function displayName(stock, lang) {
  if (stock.localName && stock.localLang === lang) return stock.localName
  return stock.name || stock.localName || stock.symbol
}
