import assert from 'node:assert/strict'
import test from 'node:test'
import { previousClose } from '../src/main/markets/previousClose.js'

const ts = (iso) => Date.parse(iso) / 1000
const meta = (now) => ({
  exchangeTimezoneName: 'America/New_York',
  regularMarketTime: ts(now),
  chartPreviousClose: 10 // 3개월 전 종가 — 쓰면 안 됨
})
const bars = [
  [ts('2026-10-21T13:30:00Z'), 20],
  [ts('2026-10-22T13:30:00Z'), 21],
  [ts('2026-10-23T13:30:00Z'), 22]
]

test('intraday: uses the previous trading day, not the 3-month-old close', () => {
  assert.equal(previousClose(meta('2026-10-23T18:00:00Z'), bars), 21)
})

test('before the open (no bar for today yet): last bar is the previous close', () => {
  assert.equal(previousClose(meta('2026-10-24T12:00:00Z'), bars.slice(0, 2)), 21)
})

test('exchange time zone decides the trading day (late US session is the next UTC day)', () => {
  const late = [...bars.slice(0, 2), [ts('2026-10-23T13:30:00Z'), 22]]
  assert.equal(previousClose(meta('2026-10-24T00:30:00Z'), late), 21)
})

test('falls back to meta when there are no bars', () => {
  assert.equal(previousClose({ previousClose: 5 }, []), 5)
})
