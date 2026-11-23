import assert from 'node:assert/strict'
import test from 'node:test'
import { createAlertRepository, evaluateAlert, isValidQuote } from '../src/main/alertEngine.js'

const now = '2026-11-22T05:00:00Z'
const quote = (price, marketAt = '2026-11-22T04:59:00Z') => ({
  market: 'US',
  symbol: 'NVDA',
  price,
  marketAt
})

function fixture() {
  let data
  let seq = 0
  let writes = 0
  let fail = false
  const build = () =>
    createAlertRepository({
      read: () => data && structuredClone(data),
      write: (next) => {
        if (fail) throw new Error('disk failure')
        data = structuredClone(next)
        writes += 1
      },
      now: () => now,
      newId: () => String(++seq)
    })
  return {
    repo: build(),
    build,
    setFail: (yes) => {
      fail = yes
    },
    writes: () => writes
  }
}

test('validates input and rejects duplicate active condition', () => {
  const { repo } = fixture()
  assert.throws(
    () => repo.add({ market: 'US', symbol: 'NVDA', direction: 'above', target: NaN }),
    /ERR_ALERT_TARGET/
  )
  assert.throws(
    () => repo.add({ market: 'US', symbol: 'INVALID$$', direction: 'above', target: 50 }),
    /ERR_ALERT_SYMBOL/
  )
  assert.throws(
    () => repo.add({ market: 'US', symbol: 'NVDA', direction: 'high', target: 50 }),
    /ERR_ALERT_DIRECTION/
  )
  const a = repo.add({ market: 'US', symbol: 'NVDA', direction: 'above', target: 100 })
  assert.equal(a.status, 'waiting')
  assert.throws(
    () => repo.add({ market: 'US', symbol: 'NVDA', direction: 'above', target: 100 }),
    /ERR_ALERT_DUPLICATE/
  )
})

test('initial target-side price does not fire until opposite-side then crossing', () => {
  const f = fixture()
  f.repo.add({ market: 'US', symbol: 'NVDA', direction: 'above', target: 100 })
  assert.equal(f.repo.process([quote(110)]).length, 0)
  assert.equal(f.repo.process([quote(110, '2026-11-22T04:59:01Z')]).length, 0)
  assert.equal(f.repo.process([quote(90, '2026-11-22T04:59:02Z')]).length, 0)
  assert.equal(f.repo.process([quote(100, '2026-11-22T04:59:03Z')]).length, 1)
  assert.equal(f.repo.process([quote(101, '2026-11-22T04:59:04Z')]).length, 0)
  assert.equal(f.build().list()[0].status, 'triggered')
})

test('below condition triggers only once on crossing', () => {
  const f = fixture()
  f.repo.add({ market: 'US', symbol: 'NVDA', direction: 'below', target: 100 })
  assert.equal(f.repo.process([quote(120)]).length, 0)
  assert.equal(f.repo.process([quote(99, '2026-11-22T04:59:01Z')]).length, 1)
  assert.equal(f.repo.process([quote(102, '2026-11-22T04:59:02Z')]).length, 0)
})

test('stale, missing timestamps, future, old and mismatched quotes never trigger', () => {
  const f = fixture()
  const alert = f.repo.add({ market: 'US', symbol: 'NVDA', direction: 'above', target: 100 })
  f.repo.process([quote(90)])
  const candidates = [
    { ...quote(120, '2026-11-22T04:59:01Z'), stale: true },
    { ...quote(120, '2026-11-22T04:59:01Z'), loading: true },
    { ...quote(120, '2026-11-22T04:59:01Z'), errorCode: 'ERR_FETCH' },
    { ...quote(120, '2026-11-22T04:59:01Z'), market: 'JP' },
    { ...quote(120, '2026-11-22T04:59:01Z'), symbol: 'AAPL' },
    { ...quote(120), marketAt: null },
    quote(120, '2026-11-22T03:00:00Z'),
    quote(120, '2026-11-22T06:00:00Z')
  ]
  for (const c of candidates) {
    assert.equal(isValidQuote(alert, c, now), false)
    assert.equal(f.repo.process([c]).length, 0)
  }
  assert.equal(f.repo.process([quote(120, '2026-11-22T04:59:02Z')]).length, 1)
})

test('source timestamp same as previous is not a second observation', () => {
  const f = fixture()
  f.repo.add({ market: 'US', symbol: 'NVDA', direction: 'above', target: 100 })
  f.repo.process([quote(80)])
  assert.equal(f.repo.process([quote(110)]).length, 0)
  assert.equal(f.repo.process([quote(110, '2026-11-22T04:59:01Z')]).length, 1)
})

test('state is persisted before delivery; restart blocks duplicate notification', () => {
  const f = fixture()
  f.repo.add({ market: 'US', symbol: 'NVDA', direction: 'above', target: 100 })
  f.repo.process([quote(90)])
  f.repo.process([quote(101, '2026-11-22T04:59:01Z')])
  assert.equal(f.build().process([quote(110, '2026-11-22T04:59:02Z')]).length, 0)
})

test('store errors never send unpersisted notifications', () => {
  const f = fixture()
  f.repo.add({ market: 'US', symbol: 'NVDA', direction: 'above', target: 100 })
  f.repo.process([quote(90)])
  f.setFail(true)
  assert.throws(() => f.repo.process([quote(120, '2026-11-22T04:59:01Z')]), /disk failure/)
  f.setFail(false)
  assert.equal(f.repo.process([quote(120, '2026-11-22T04:59:01Z')]).length, 1)
})

test('stock deletion removes alerts, removal idempotent', () => {
  const f = fixture()
  const a = f.repo.add({ market: 'US', symbol: 'NVDA', direction: 'above', target: 100 })
  f.repo.add({ market: 'US', symbol: 'AAPL', direction: 'below', target: 100 })
  f.repo.removeStock('US', 'NVDA')
  assert.deepEqual(
    f.repo.list().map((x) => x.symbol),
    ['AAPL']
  )
  f.repo.remove(a.id)
  assert.equal(f.repo.list().length, 1)
})

test('corrupt or future state refuses writes', () => {
  const repo = createAlertRepository({
    read: () => ({ schemaVersion: 2, alerts: [] }),
    write: () => assert.fail('must not overwrite'),
    now: () => now,
    newId: () => 'x'
  })
  assert.throws(() => repo.list(), /ERR_ALERT_STORE/)
  assert.throws(
    () => repo.add({ market: 'US', symbol: 'NVDA', direction: 'above', target: 100 }),
    /ERR_ALERT_STORE/
  )
})

test('long gaps rebase the alert instead of retroactively notifying after sleep', () => {
  const f = fixture()
  const a = f.repo.add({ market: 'US', symbol: 'NVDA', direction: 'above', target: 100 })
  const earlier = { ...a, lastSide: 'other', lastMarketAt: '2026-11-22T04:30:00Z' }
  const first = evaluateAlert(earlier, quote(125, '2026-11-22T04:59:00Z'), now)
  assert.equal(first.triggered, false)
  assert.equal(first.next.lastSide, 'target')
  const second = evaluateAlert(first.next, quote(90, '2026-11-22T04:59:01Z'), now)
  assert.equal(second.triggered, false)
  const third = evaluateAlert(second.next, quote(101, '2026-11-22T04:59:02Z'), now)
  assert.equal(third.triggered, true)
})
