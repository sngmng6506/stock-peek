// 전일 종가. range=3mo 응답에는 previousClose가 없고 chartPreviousClose는 3개월 전 종가라
// 그대로 쓰면 등락률이 3개월 변동이 됨 → 일봉에서 현재 거래일보다 앞선 마지막 종가를 씀
export function previousClose(meta, bars) {
  const tz = meta.exchangeTimezoneName || 'UTC'
  const day = (t) => new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: tz })
  const now = Number(meta.regularMarketTime) || bars[bars.length - 1]?.[0]
  if (Number.isFinite(now)) {
    const today = day(now)
    for (let i = bars.length - 1; i >= 0; i--) {
      if (day(bars[i][0]) < today) return bars[i][1]
    }
  }
  return Number(meta.previousClose ?? meta.chartPreviousClose)
}
