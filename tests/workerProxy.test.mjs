import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../stockpeek-proxy/src/worker.js'

function request(path, { method = 'GET', headers = {}, body } = {}) {
  return new Request('https://stockpeek-proxy.sngmng.workers.dev' + path, { method, headers, body })
}
const context = { waitUntil() {} }
const env = { ANALYSIS_ENABLED: '0' }

test('legacy root health and legacy /health remain unchanged', async () => {
  for (const path of ['/', '/health']) {
    const result = await worker.fetch(request(path), env, context)
    assert.equal(result.status, 200)
    assert.deepEqual(await result.json(), { ok: true, name: 'stockpeek-proxy' })
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), '*')
  }
})
test('new /api/health is publicly readable without exposing configuration', async () => {
  const result = await worker.fetch(request('/api/health'), env, context)
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { ok: true, service: 'stockpeek-proxy', mode: 'restricted' })
  assert.equal(result.headers.get('access-control-allow-origin'), null)
  assert.equal(result.headers.get('cache-control'), 'no-store')
})
test('AI analyze is disabled before authentication and CORS', async () => {
  const result = await worker.fetch(request('/api/analyze', { method: 'POST' }), env, context)
  assert.equal(result.status, 503)
  assert.equal((await result.json()).error, 'ERR_ANALYSIS_DISABLED')
  assert.equal(result.headers.get('access-control-allow-origin'), null)
})
test('AI route refuses GET and OPTIONS (does not inherit legacy wildcard CORS)', async () => {
  for (const method of ['GET', 'OPTIONS']) {
    const result = await worker.fetch(request('/api/analyze', { method }), env, context)
    assert.equal(result.status, 405)
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), null)
  }
})
test('legacy OPTIONS and missing parameter behavior remain intact', async () => {
  const preflight = await worker.fetch(request('/api/stock', { method: 'OPTIONS' }), env, context)
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*')
  for (const path of ['/api/stock?market=KR', '/api/search?market=US']) {
    const result = await worker.fetch(request(path), env, context)
    assert.equal(result.status, 400)
  }
})
test('legacy KR/US quote and search data shape preserved with mocked upstream', async () => {
  const originalFetch = globalThis.fetch
  const originalCaches = globalThis.caches
  const received = []
  const cache = new Map()
  globalThis.caches = { default: {
    match: async req => cache.get(req.url)?.clone(),
    put: async (req, res) => { cache.set(req.url, res.clone()) }
  } }
  globalThis.fetch = async url => {
    received.push(String(url))
    if (String(url).includes('polling.finance.naver.com'))
      return Response.json({ datas: [{stockName: 'Samsung Electronics',
        closePriceRaw: '70000', compareToPreviousClosePriceRaw: '1000',
        fluctuationsRatioRaw: '1.45', compareToPreviousPrice: {code: '2'},
        localTradedAt: '2026-11-20T15:30:00+09:00'}] })
    if (String(url).includes('ac.stock.naver.com'))
      return Response.json({items:[{nationCode:'KOR',category:'stock',code:'005930',name:'Samsung Electronics'}]})
    if (String(url).includes('/v8/finance/chart/'))
      return Response.json({chart:{result:[{meta:{
        regularMarketPrice:200, previousClose:195, symbol:'MSFT', currency:'USD'
      }, indicators:{quote:[{close:[190,200]}]}}]}})
    if (String(url).includes('/v1/finance/search?'))
      return Response.json({quotes:[{exchange:'NMS',quoteType:'EQUITY',symbol:'MSFT',shortname:'Microsoft'}]})
    throw Error('Unexpected URL: ' + url)
  }
  try {
    const kr = await (await worker.fetch(request('/api/stock?market=KR&symbol=005930&skipChart=1'),env,context)).json()
    assert.equal(kr.market, 'KR')
    assert.equal(kr.symbol, '005930')
    assert.deepEqual(kr.prices, [])
    const us = await (await worker.fetch(request('/api/stock?market=US&symbol=MSFT'),env,context)).json()
    assert.equal(us.market, 'US')
    assert.equal(us.price, 200)
    assert.deepEqual(us.prices, [190,200])
    const krSearch = await (await worker.fetch(request('/api/search?market=KR&q=Samsung'),env,context)).json()
    assert.equal(krSearch[0].symbol, '005930')
    const usSearch = await (await worker.fetch(request('/api/search?market=US&q=Microsoft'),env,context)).json()
    assert.equal(usSearch[0].symbol, 'MSFT')
    assert.equal(received.length, 4)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.caches = originalCaches
  }
})
