// 시장 정의 — main(데이터·장 시간)과 renderer(표기·탭 순서)가 함께 쓰는 순수 데이터.
// 시장 추가: 여기에 항목 하나 + src/main/markets/index.js에 provider 연결 + 번역 키(market.<ID> 등).
// 배열 순서 = 패널 그룹 순서 = 종목 추가 화면 탭 순서.

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
  }
]

const BY_ID = new Map(MARKETS.map((m) => [m.id, m]))

export function getMarket(id) {
  return BY_ID.get(String(id || '').toUpperCase()) || null
}

export function marketOrder(id) {
  const i = MARKETS.findIndex((m) => m.id === id)
  return i < 0 ? MARKETS.length : i
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
