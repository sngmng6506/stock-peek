import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPersonalizedPreview } from '../src/shared/personalizedPreview.js'
import { normalizeThesis, createThesisRepository, EMPTY_THESIS } from '../src/shared/thesisModel.js'

const asOf = '2026-11-22T07:00:00.000Z'
const items = [
  { market: 'KR', symbol: '005930', quantity: 10, avgPrice: 70000 },
  { market: 'US', symbol: 'NVDA', quantity: 3, avgPrice: 100 }
]
const activity = {
  schemaVersion: 1,
  events: [
    {
      eventId: 'base',
      type: 'baseline_imported',
      occurredAt: '2026-11-01T00:00:00Z',
      after: items
    },
    {
      eventId: 'add',
      type: 'watchlist_added',
      occurredAt: '2026-11-19T12:00:00Z',
      stock: { market: 'US', symbol: 'NVDA' },
      before: null,
      after: items[1]
    },
    {
      eventId: 'edit',
      type: 'holding_edited',
      occurredAt: '2026-11-20T12:00:00Z',
      stock: { market: 'KR', symbol: '005930' },
      before: { quantity: 9, avgPrice: 69000 },
      after: { quantity: 10, avgPrice: 70000 }
    },
    {
      eventId: 'other',
      type: 'watchlist_added',
      occurredAt: '2026-11-21T12:00:00Z',
      stock: { market: 'US', symbol: 'MSFT' },
      before: null,
      after: { market: 'US', symbol: 'MSFT' }
    },
    {
      eventId: 'bulk',
      type: 'watchlist_replaced',
      occurredAt: '2026-11-21T12:00:00Z',
      stock: null,
      before: items,
      after: items
    }
  ]
}
const thesis = { text: 'AI 반도체 수요가 증가한다.', horizon: 'long', focus: 'industry' }

test('all optional private data defaults to excluded', () => {
  const p = buildPersonalizedPreview(items, null, null, { asOf })
  assert.equal(p.status, 'preview_only')
  assert.equal(p.request.stocks.length, 2)
  assert.equal(p.request.stocks[0].holding, undefined)
  assert.equal('activity' in p.request, false)
  assert.equal('investmentThesis' in p.request, false)
  assert.equal(JSON.stringify(p).includes('70000'), false)
  assert.equal(JSON.stringify(p).includes('반도체'), false)
})

test('selected symbols only, 5 max with holdings opt-in', () => {
  const p = buildPersonalizedPreview(items, null, null, {
    asOf,
    selectedKeys: ['US:NVDA'],
    includeHoldings: true
  })
  assert.deepEqual(
    p.request.stocks.map((s) => s.key),
    ['US:NVDA']
  )
  assert.deepEqual(p.request.stocks[0].holding, { quantity: 3, avgPrice: 100 })
  assert.equal(p.scope.holdingsCount, 1)
  assert.throws(
    () => buildPersonalizedPreview(items, null, null, { asOf, selectedKeys: ['US:MSFT'] }),
    /ERR_REPORT_EMPTY|ERR_REPORT_SELECTION/
  )
})

test('activity exposes only selected stocks, drops bulk and baseline', () => {
  const p = buildPersonalizedPreview(items, activity, null, {
    asOf,
    selectedKeys: ['US:NVDA'],
    includeHistory: true
  })
  assert.equal(p.request.activity.length, 1)
  assert.equal(p.request.activity[0].type, 'watchlist_added')
  assert.equal(p.request.activity[0].after.avgPrice, undefined)
  assert.equal(p.request.activity[0].after.quantity, undefined)
  assert.equal(p.scope.eventCount, 1)
  assert.equal(JSON.stringify(p.request).includes('69000'), false)
})

test('holding edits are excluded without explicit holding consent', () => {
  const p = buildPersonalizedPreview(items, activity, null, { asOf, includeHistory: true })
  assert.equal(p.request.activity.length, 1)
  const q = buildPersonalizedPreview(items, activity, null, {
    asOf,
    includeHistory: true,
    includeHoldings: true
  })
  assert.equal(q.request.activity.length, 2)
  assert.equal(q.request.activity[1].before.quantity, 9)
})

test('thesis is included only by opt-in; freeform input is length-bounded', () => {
  const p = buildPersonalizedPreview(items, null, thesis, { asOf, includeThesis: true })
  assert.equal(p.request.investmentThesis.horizon, 'long')
  assert.equal(p.request.investmentThesis.text, thesis.text)
  assert.throws(() => normalizeThesis({ ...thesis, text: 'x'.repeat(1201) }), /ERR_THESIS_TEXT/)
  assert.throws(() => normalizeThesis({ ...thesis, focus: 'prediction' }), /ERR_THESIS_FOCUS/)
  assert.equal(
    buildPersonalizedPreview(items, null, thesis, { asOf }).request.investmentThesis,
    undefined
  )
})

test('history and date options validated rather than silently accepted', () => {
  assert.throws(
    () => buildPersonalizedPreview(items, undefined, null, { asOf, includeHistory: true }),
    /ERR_REPORT_HISTORY/
  )
  assert.throws(
    () => buildPersonalizedPreview(items, activity, null, { asOf, includeHistory: 'true' }),
    /ERR_REPORT_OPTIONS/
  )
  assert.throws(
    () => buildPersonalizedPreview(items, activity, null, { asOf, lookbackDays: 366 }),
    /ERR_REPORT_OPTIONS/
  )
  assert.throws(
    () => buildPersonalizedPreview(items, activity, null, { asOf: 'wrong' }),
    /ERR_REPORT_TIME/
  )
})

test('history outside lookback, future and malformed records are excluded', () => {
  const extended = {
    schemaVersion: 1,
    events: [
      ...activity.events,
      { ...activity.events[1], eventId: 'old', occurredAt: '2025-01-01T01:00:00Z' },
      { ...activity.events[1], eventId: 'future', occurredAt: '2027-01-01T01:00:00Z' },
      { ...activity.events[1], eventId: 'bad', occurredAt: 'garbage' }
    ]
  }
  const p = buildPersonalizedPreview(items, extended, null, { asOf, includeHistory: true })
  assert.equal(p.request.activity.length, 1)
})

test('thesis repository persists latest value and preserves it across restart', () => {
  let stored = null
  let writes = 0
  const create = () =>
    createThesisRepository({
      read: () => stored,
      write: (v) => {
        stored = structuredClone(v)
        writes++
      },
      now: () => asOf
    })
  const first = create()
  assert.equal(first.get().text, '')
  assert.deepEqual(normalizeThesis(EMPTY_THESIS), EMPTY_THESIS)
  first.save(thesis)
  assert.equal(create().get().text, thesis.text)
  first.save(thesis)
  assert.equal(writes, 1)
  assert.throws(() => first.save({ ...thesis, horizon: 'superlong' }), /ERR_THESIS_HORIZON/)
  assert.equal(writes, 1)
})

test('future-version thesis is not overwritten', () => {
  const repo = createThesisRepository({
    read: () => ({ schemaVersion: 99 }),
    write: () => assert.fail('unexpected write')
  })
  assert.throws(() => repo.get(), /ERR_THESIS_VERSION/)
})
