import { getLanguageInfo } from './languages.js'

// 시장 정의 — main(데이터·장 시간)과 renderer(표기·탭 순서)가 함께 쓰는 순수 데이터.
// 시장 추가: 여기에 항목 하나 + src/main/markets/index.js에 provider 연결 + 번역 키(market.<ID> 등).
// 선택 항목: maxDecimals(소수 표시 최대), delayMinutes(시세 지연 표시), localLang(원어 종목명 언어),
// numberLocale(영어 화면에서 쓸 숫자 표기 로케일).
// 배열 순서 = 기본 표시 순서. 화면 언어별 순서(자국 시장 먼저)는 languages.js marketOrder.

export const MARKETS = [
  {
    id: 'KR',
    currency: 'KRW',
    decimals: 0,
    timeZone: 'Asia/Seoul',
    weekdays: [1, 2, 3, 4, 5],
    sessions: [['09:00', '15:30']],
    examplePrice: 72400,
    symbolPattern: /^[0-9A-Z]{6}$/,
    // ETF 코드에 알파벳 포함 가능 (0023A0 등)
    normalizeSymbol: (s) => s.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  },
  {
    id: 'US',
    currency: 'USD',
    decimals: 2,
    timeZone: 'America/New_York',
    weekdays: [1, 2, 3, 4, 5],
    sessions: [['09:30', '16:00']],
    examplePrice: 189.2,
    symbolPattern: /^[A-Z][A-Z0-9.-]{0,9}$/,
    normalizeSymbol: (s) => s.toUpperCase()
  },
  {
    id: 'JP',
    currency: 'JPY',
    decimals: 0,
    maxDecimals: 1, // ETF 등 0.5엔 단위 가격
    timeZone: 'Asia/Tokyo',
    weekdays: [1, 2, 3, 4, 5],
    sessions: [
      ['09:00', '11:30'],
      ['12:30', '15:30']
    ],
    delayMinutes: 20, // Yahoo 도쿄증권거래소 시세 지연
    localLang: 'ja', // 종목명 원어 (JPX 목록)
    examplePrice: 2850,
    // 4자리: 숫자 또는 영문 포함 신규 코드(130A 등)
    symbolPattern: /^[0-9][0-9A-Z]{3}$/,
    normalizeSymbol: (s) =>
      s
        .replace(/\.T$/i, '')
        .replace(/[^0-9A-Za-z]/g, '')
        .toUpperCase()
  },
  {
    id: 'IN',
    currency: 'INR',
    decimals: 2,
    numberLocale: 'en-IN', // 영어 화면에서 인도식 자릿수 (12,34,567.00)
    timeZone: 'Asia/Kolkata',
    weekdays: [1, 2, 3, 4, 5],
    sessions: [['09:15', '15:30']],
    examplePrice: 2450.5,
    // NSE 심볼: 영문·숫자에 & - 포함 가능 (M&M, BAJAJ-AUTO)
    symbolPattern: /^[A-Z0-9][A-Z0-9&-]{0,19}$/,
    normalizeSymbol: (s) =>
      s
        .replace(/\.NS$/i, '')
        .replace(/[^0-9A-Za-z&-]/g, '')
        .toUpperCase()
  },
  {
    id: 'SA',
    currency: 'SAR',
    decimals: 2,
    timeZone: 'Asia/Riyadh',
    weekdays: [0, 1, 2, 3, 4], // 일–목 (금·토 휴장)
    sessions: [['10:00', '15:00']], // 라마단 기간 시간 변경은 미반영
    localLang: 'ar', // 종목명 원어 (data/sa-stocks.json)
    delayMinutes: 15, // Yahoo 사우디 증권거래소(Tadawul) 시세 지연
    examplePrice: 27.5,
    // 4자리 숫자 (2222 아람코 등)
    symbolPattern: /^[0-9]{4}$/,
    normalizeSymbol: (s) => s.replace(/\.SR$/i, '').replace(/[^0-9]/g, '')
  }
]

const BY_ID = new Map(MARKETS.map((m) => [m.id, m]))

export function getMarket(id) {
  return BY_ID.get(String(id || '').toUpperCase()) || null
}

// 정렬 순위: 화면 언어의 marketOrder 순, 거기 없는 시장은 그 뒤에 등록 순서
export function marketOrder(id, lang) {
  const order = (lang && getLanguageInfo(lang).marketOrder) || []
  const j = order.indexOf(id)
  if (j >= 0) return j
  const i = MARKETS.findIndex((m) => m.id === id)
  return order.length + (i < 0 ? MARKETS.length : i)
}

export function marketsFor(lang) {
  return [...MARKETS].sort((a, b) => marketOrder(a.id, lang) - marketOrder(b.id, lang))
}

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const formatters = new Map()

function localClock(timeZone, now) {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
    formatters.set(timeZone, f)
  }
  const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]))
  return {
    weekday: WEEKDAY[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  }
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// 정규장 여부 (현지 시간대 기준, 서머타임 자동 반영). 공휴일은 판단하지 않음.
export function isMarketOpen(market, now = new Date()) {
  const m = typeof market === 'string' ? getMarket(market) : market
  if (!m) return false
  const { weekday, minutes } = localClock(m.timeZone, now)
  if (!m.weekdays.includes(weekday)) return false
  return m.sessions.some(
    ([open, close]) => minutes >= toMinutes(open) && minutes < toMinutes(close)
  )
}
