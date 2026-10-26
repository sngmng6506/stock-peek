import assert from 'node:assert/strict'
import test from 'node:test'
import { formatQuoteTime } from '../src/renderer/src/lib/format.js'

const now = new Date(2026, 9, 26, 15, 40).getTime()

test('today: time only', () => {
  const s = formatQuoteTime(new Date(2026, 9, 26, 15, 37).getTime(), 'en', now)
  assert.match(s, /3:37/)
  assert.doesNotMatch(s, /26|\//)
})

test('another day: date and time', () => {
  const s = formatQuoteTime(new Date(2026, 9, 23, 16, 0).getTime(), 'en', now)
  assert.match(s, /23/)
})

test('no timestamp: null', () => {
  assert.equal(formatQuoteTime(undefined, 'en', now), null)
})
