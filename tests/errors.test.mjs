import assert from 'node:assert/strict'
import test from 'node:test'
import { codedError, errorCodeOf } from '../src/shared/errors.js'
import { errorText } from '../src/renderer/src/lib/errors.js'

const t = (key) => `T(${key})`

test('IPC-prefixed error messages are translated by code', () => {
  const err = new Error("Error invoking remote method 'search:stocks': Error: ERR_SEARCH_FAILED")
  assert.equal(errorCodeOf(err), 'ERR_SEARCH_FAILED')
  assert.equal(errorText(err, t), 'T(error.ERR_SEARCH_FAILED)')
})

test('provider errors without a code become the fallback code, existing codes are kept', () => {
  assert.equal(
    codedError(new Error('Naver search: 500'), 'ERR_SEARCH_FAILED').message,
    'ERR_SEARCH_FAILED'
  )
  assert.equal(
    codedError(new Error('ERR_UNKNOWN_MARKET'), 'ERR_SEARCH_FAILED').message,
    'ERR_UNKNOWN_MARKET'
  )
  assert.equal(errorCodeOf(null), null)
})
