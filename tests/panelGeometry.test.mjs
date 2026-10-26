import assert from 'node:assert/strict'
import test from 'node:test'
import { panelGeometry } from '../src/main/panelGeometry.js'
test('display changes clamp a tall panel and restore requested height on a larger display', () => {
  const small = panelGeometry(
    { x: -1280, y: 0, width: 1280, height: 720 },
    { edge: 'left', y: 900 },
    800
  )
  assert.equal(small.shownX, -1280)
  assert.ok(small.y + small.height <= 680)
  const large = panelGeometry(
    { x: 0, y: -1080, width: 1920, height: 1080 },
    { edge: 'right', y: 100 },
    800
  )
  assert.equal(large.height, 800)
  assert.equal(large.shownX, 1640)
  assert.equal(large.y, -980)
})
