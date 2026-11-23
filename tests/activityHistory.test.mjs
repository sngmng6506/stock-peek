import assert from 'node:assert/strict'
import test from 'node:test'
import { createWatchlistRepository, DEFAULT_ITEMS } from '../src/main/watchlistRepository.js'

function setup(
  initial = { items: [{ market: 'US', symbol: 'AAPL', quantity: 2, avgPrice: 100 }] }
) {
  let state = structuredClone(initial)
  let writes = 0
  let failing = false
  let sequence = 0
  const create = () =>
    createWatchlistRepository({
      read: () => structuredClone(state),
      write: (value) => {
        if (failing) throw new Error('DISK_WRITE_FAILED')
        state = structuredClone(value)
        writes += 1
      },
      now: () => '2026-11-22T07:00:00.000Z',
      newId: () => 'id-' + ++sequence
    })
  return {
    repo: create(),
    restart: create,
    data: () => state,
    writes: () => writes,
    failWrite: (value) => {
      failing = value
    }
  }
}

test('existing holdings are preserved as baseline, never invented trades', () => {
  const st = setup()
  assert.equal(st.repo.getItems()[0].avgPrice, 100)
  assert.equal(st.writes(), 0)
  assert.equal(st.repo.getActivitySummary().count, 0)
  const baseline = st.data().activityHistory.events[0]
  assert.equal(baseline.type, 'baseline_imported')
  assert.equal(baseline.origin, 'migration')
  assert.equal(baseline.semantic, 'initial_snapshot_not_trade')
  assert.deepEqual(baseline.after[0], { market: 'US', symbol: 'AAPL', quantity: 2, avgPrice: 100 })
  assert.equal(st.restart().getActivitySummary().count, 0)
  assert.equal(st.writes(), 1)
})

test('add, holding edit and remove have distinct meanings', () => {
  const st = setup()
  st.repo.addItem('KR', '005930', { quantity: 10, avgPrice: 80000 })
  st.repo.updateHolding('KR', '005930', { quantity: 11, avgPrice: 81000 })
  st.repo.removeItem('KR', '005930')
  const events = st.repo.exportActivity().activityHistory.events
  assert.deepEqual(
    events.map((e) => e.type),
    ['baseline_imported', 'watchlist_added', 'holding_edited', 'watchlist_removed']
  )
  assert.equal(events[2].semantic, 'holding_snapshot_change')
  assert.deepEqual(events[2].before, { quantity: 10, avgPrice: 80000 })
  assert.deepEqual(events[2].after, { quantity: 11, avgPrice: 81000 })
  assert.equal(events[3].semantic, 'watchlist_change')
  assert.equal(st.restart().getActivitySummary().count, 3)
})

test('no-op edits, missing removal and duplicate add do not append events', () => {
  const st = setup()
  st.repo.getActivitySummary()
  st.repo.updateHolding('US', 'AAPL', { quantity: 2, avgPrice: 100 })
  st.repo.removeItem('US', 'MSFT')
  assert.throws(() => st.repo.addItem('US', 'AAPL'), /ERR_DUPLICATE/)
  assert.throws(() => st.repo.updateHolding('US', 'MSFT', {}), /ERR_NOT_FOUND/)
  assert.equal(st.repo.getActivitySummary().count, 0)
  assert.equal(st.writes(), 1)
})

test('invalid holding cannot erase previously valid holding', () => {
  const st = setup()
  assert.throws(() => st.repo.updateHolding('US', 'AAPL', { quantity: -1 }), /ERR_INVALID_HOLDING/)
  assert.deepEqual(st.repo.getItems()[0], {
    market: 'US',
    symbol: 'AAPL',
    quantity: 2,
    avgPrice: 100
  })
  assert.equal(st.writes(), 0)
})

test('reordering preserves values without recording a trade or interest change', () => {
  const st = setup({
    items: [
      { market: 'US', symbol: 'AAPL', quantity: 2, avgPrice: 100 },
      { market: 'US', symbol: 'NVDA', quantity: 10, avgPrice: 50 }
    ]
  })
  st.repo.getActivitySummary()
  st.repo.reorderWatchlist([{ market: 'US', symbol: 'NVDA' }])
  assert.equal(st.repo.getItems()[0].symbol, 'NVDA')
  assert.equal(st.repo.getItems()[1].avgPrice, 100)
  assert.equal(st.repo.getActivitySummary().count, 0)
})

test('failed single persisted write changes neither stock list nor history', () => {
  const st = setup()
  st.failWrite(true)
  assert.throws(() => st.repo.addItem('US', 'NVDA'), /DISK_WRITE_FAILED/)
  assert.deepEqual(st.repo.getItems(), [
    { market: 'US', symbol: 'AAPL', quantity: 2, avgPrice: 100 }
  ])
  assert.equal(st.data().activityHistory, undefined)
  st.failWrite(false)
  st.repo.addItem('US', 'NVDA')
  assert.equal(st.repo.getActivitySummary().count, 1)
  assert.equal(st.writes(), 1)
})

test('clear removes past events but keeps current watchlist and new baseline', () => {
  const st = setup()
  st.repo.addItem('US', 'NVDA')
  assert.equal(st.repo.getActivitySummary().count, 1)
  assert.equal(st.repo.clearActivity().count, 0)
  assert.equal(st.repo.getItems().length, 2)
  assert.equal(st.restart().getActivitySummary().count, 0)
  const exported = st.repo.exportActivity()
  assert.equal(exported.activityHistory.events.length, 1)
  assert.equal(exported.activityHistory.events[0].type, 'baseline_imported')
})

test('bulk replacement is explicitly tagged system, not buy/sell', () => {
  const st = setup()
  st.repo.setItems([
    { market: 'US', symbol: 'NVDA', quantity: 5, avgPrice: 40 },
    { market: 'US', symbol: 'X'.repeat(100) }
  ])
  const event = st.repo.exportActivity().activityHistory.events.at(-1)
  assert.equal(event.type, 'watchlist_replaced')
  assert.equal(event.origin, 'system')
  assert.equal(st.repo.getItems().length, 1)
})

test('default example symbols do not count as user additions', () => {
  const st = setup({ items: structuredClone(DEFAULT_ITEMS) })
  assert.equal(st.repo.getActivitySummary().count, 0)
  assert.equal(st.repo.exportActivity().activityHistory.events.length, 1)
})

test('corrupted or future history version must never be silently overwritten', () => {
  const st = setup({
    items: [{ market: 'US', symbol: 'AAPL' }],
    activityHistory: { schemaVersion: 99, events: [] }
  })
  assert.throws(() => st.repo.addItem('US', 'NVDA'), /ERR_ACTIVITY_INVALID_HISTORY/)
  assert.throws(() => st.repo.getActivitySummary(), /ERR_ACTIVITY_INVALID_HISTORY/)
  assert.throws(() => st.repo.clearActivity(), /ERR_ACTIVITY_INVALID_HISTORY/)
  assert.equal(st.data().activityHistory.schemaVersion, 99)
  assert.equal(st.writes(), 0)
})
