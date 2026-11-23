import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequestPost, onRequest as fallback } from '../stockpeek-proxy/functions/api/analyze.js'
import { onRequestGet } from '../stockpeek-proxy/functions/api/health.js'

const TOKEN = 'test_access_token_random_32_plus_characters_123456'
const baseEnv = () => ({
  ANALYSIS_ENABLED: '1',
  ANALYSIS_TEST_TOKEN: TOKEN,
  DART_API_KEY: 'fake_dart_key_for_testing_only',
  OPENROUTER_API_KEY: 'fake_openrouter_key_for_testing_only',
  P4_MODEL: 'anthropic/claude-sonnet-5.5',
  SEC_USER_AGENT: 'StockPeek Testing test@example.com'
})
const requestBody = () => ({
  schemaVersion: 2,
  locale: 'ko',
  stocks: [{ market: 'US', symbol: 'NVDA', key: 'US:NVDA' }],
  options: { includeHoldings: false, includeHistory: false, includeThesis: false, lookbackDays: 30 }
})
const req = (body = requestBody(), headers = {}) =>
  new Request('https://proxy.example/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
const answer = async (request, env) => {
  const response = await onRequestPost({ request, env })
  return [response.status, await response.json()]
}
test('health is static, no secrets or runtime configuration disclosed', async () => {
  const result = await onRequestGet()
  const text = await result.text()
  assert.equal(result.status, 200)
  assert.equal(JSON.parse(text).mode, 'restricted')
  assert.doesNotMatch(text, /DART_API_KEY|OPENROUTER_API_KEY/)
  assert.equal(fallback().status, 405)
})
test('disabled by default, even with a valid test token', async () => {
  assert.deepEqual(await answer(req(), { ...baseEnv(), ANALYSIS_ENABLED: undefined }), [
    503,
    { ok: false, error: 'ERR_ANALYSIS_DISABLED' }
  ])
})
test('missing or wrong bearer token is denied without calling API', async () => {
  const env = {
    ...baseEnv(),
    ANALYSIS_DB: {
      prepare: () => {
        throw Error('should not use DB')
      }
    }
  }
  const a = req()
  a.headers.delete('Authorization')
  assert.equal((await answer(a, env))[0], 401)
  assert.equal(
    (await answer(req(undefined, { Authorization: 'Bearer not-the-token' }), env))[0],
    401
  )
})
test('browser-origin access is forbidden even with the test token', async () => {
  const [code] = await answer(req(undefined, { Origin: 'https://evil.example' }), baseEnv())
  assert.equal(code, 403)
})
test('missing D1 always fails closed', async () => {
  assert.equal((await answer(req(), baseEnv()))[0], 503)
})
test('invalid and oversize bodies are rejected before quota consumption', async () => {
  const env = {
    ...baseEnv(),
    ANALYSIS_DB: {
      prepare: () => {
        throw Error('should not use DB')
      }
    }
  }
  assert.equal((await answer(req('not-json'), env))[0], 400)
  assert.equal((await answer(req('x'.repeat(12001)), env))[0], 413)
  assert.equal((await answer(req({ ...requestBody(), stocks: [] }), env))[0], 400)
})
test('configured secrets are required before quota', async () => {
  const env = { ...baseEnv(), OPENROUTER_API_KEY: undefined }
  const [code, body] = await answer(req(), env)
  assert.equal(code, 503)
  assert.equal(body.error, 'ERR_SECRETS_MISSING')
})
test('daily quota denies paid calls at the boundary', async () => {
  let used = 0
  const env = {
    ...baseEnv(),
    ANALYSIS_DAILY_LIMIT: '1',
    ANALYSIS_DB: {
      prepare: () => ({ bind: () => ({ first: async () => (++used <= 1 ? { used } : null) }) })
    }
  }
  // The first call will fail safely on official source fetch, still consuming one test quota.
  const oldFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw Error('network unavailable')
  }
  try {
    const [failedStatus, failedBody] = await answer(req(), env)
    assert.equal(failedStatus, 502)
    assert.equal(failedBody.error, 'ERR_ANALYSIS_NO_COVERAGE')
    assert.equal((await answer(req(), env))[0], 429)
    assert.equal(used, 2)
  } finally {
    globalThis.fetch = oldFetch
  }
})
test('valid mocked SEC + OpenRouter integration returns only citations and no billing', async () => {
  let d1 = 0
  const env = {
    ...baseEnv(),
    ANALYSIS_DB: { prepare: () => ({ bind: () => ({ first: async () => ({ used: ++d1 }) }) }) }
  }
  const oldFetch = globalThis.fetch
  const date = new Date().toISOString().slice(0, 10)
  const urls = []
  globalThis.fetch = async (url, options) => {
    urls.push(String(url))
    if (String(url).endsWith('company_tickers_exchange.json'))
      return new Response(
        JSON.stringify({
          fields: ['cik', 'name', 'ticker'],
          data: [[1045810, 'NVIDIA CORP', 'NVDA']]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    if (String(url).includes('CIK0001045810.json'))
      return new Response(
        JSON.stringify({
          cik: 1045810,
          filings: {
            recent: {
              accessionNumber: ['0001045810-26-000010'],
              primaryDocument: ['report.htm'],
              form: ['8-K'],
              filingDate: [date]
            }
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    if (String(url).includes('openrouter.ai')) {
      assert.equal(options.headers.Authorization, 'Bearer ' + env.OPENROUTER_API_KEY)
      const request = JSON.parse(options.body)
      assert.equal(request.model, 'anthropic/claude-sonnet-5.5')
      assert.equal(JSON.stringify(request).includes('should-never-appear'), false)
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  summary: 'One SEC filing was listed, contents not reviewed.',
                  highlights: [
                    { text: 'SEC form 8-K listed', sourceIds: ['sec:0001045810-26-000010'] }
                  ],
                  watchItems: ['Read original filing'],
                  portfolioNote: null
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    }
    throw Error('unexpected URL')
  }
  try {
    const raw = requestBody()
    raw.stocks[0].privateNote = 'should-never-appear'
    raw.unexpectedRootField = 'should-never-appear'
    const [status, body] = await answer(req(raw), env)
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.result.status, 'generated_unbilled')
    assert.equal(body.result.report.sources.length, 1)
    assert.equal(d1, 1)
    assert.equal(urls.filter((u) => u.includes('openrouter.ai')).length, 1)
    assert.equal(JSON.stringify(body).includes(env.OPENROUTER_API_KEY), false)
  } finally {
    globalThis.fetch = oldFetch
  }
})
