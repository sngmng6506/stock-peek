import assert from 'node:assert/strict'
import test from 'node:test'
import { createD1 } from './helpers/d1.mjs'
import { handlePro } from '../stockpeek-proxy/pro/router.js'
import worker from '../stockpeek-proxy/src/worker.js'

const ORIGIN = 'https://stockpeek-proxy.example'
const ADMIN = 'admin_token_for_tests_only_0123456789abcdef'

function setup(extra = {}) {
  const database = createD1()
  const env = {
    ANALYSIS_DB: database,
    PRO_ENABLED: '1',
    PRO_REPORTS_ENABLED: '1',
    PAYMENTS_ENABLED: '1',
    AUTH_PEPPER: 'pepper_for_tests_only_0123456789abcdef',
    RESEND_API_KEY: 're_test',
    MAIL_FROM: 'Stock Peek <login@stock-peek.com>',
    ADMIN_TOKEN: ADMIN,
    TOSS_CLIENT_KEY: 'test_ck_client',
    TOSS_SECRET_KEY: 'test_sk_secret',
    ...extra
  }
  const mails = []
  const toss = []
  let tossReply = null
  let clock = Date.parse('2026-11-25T00:00:00.000Z')
  let analyses = 0
  let analysisFails = false
  const fetchImpl = async (url, init) => {
    if (url === 'https://api.resend.com/emails') {
      mails.push(JSON.parse(init.body))
      return new Response('{}', { status: 200 })
    }
    if (url === 'https://api.tosspayments.com/v1/payments/confirm') {
      const body = JSON.parse(init.body)
      toss.push({ body, auth: init.headers.authorization })
      return tossReply
        ? tossReply(body)
        : Response.json({ ...body, totalAmount: body.amount, status: 'DONE', approvedAt: 'x' })
    }
    throw new Error('unexpected fetch ' + url)
  }
  const run = async (input) => {
    analyses++
    if (analysisFails) throw new Error('ERR_MODEL_HTTP')
    return {
      schemaVersion: 1,
      status: 'generated_unbilled',
      report: { stocks: input.stocks, summary: 'ok' }
    }
  }
  const call = (method, path, { body, token, headers = {} } = {}) =>
    handlePro(
      new Request(ORIGIN + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: 'Bearer ' + token } : {}),
          'cf-connecting-ip': '203.0.113.7',
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      env,
      { fetchImpl, run, now: clock }
    )
  return {
    env,
    database,
    mails,
    toss,
    call,
    setTossReply: (fn) => (tossReply = fn),
    tick: (ms) => (clock += ms),
    analyses: () => analyses,
    failAnalyses: (v) => (analysisFails = v)
  }
}

async function signIn(ctx, email = 'User@Example.com') {
  assert.equal(
    (await ctx.call('POST', '/v1/auth/request-code', { body: { email, locale: 'ko' } })).status,
    202
  )
  const code = /(\d{6})/.exec(ctx.mails.at(-1).text)[1]
  const res = await ctx.call('POST', '/v1/auth/verify', { body: { email, code } })
  assert.equal(res.status, 200)
  return (await res.json()).token
}

const grant = (ctx, amount, ref = 'beta-' + amount, email = 'user@example.com') =>
  ctx.call('POST', '/v1/admin/credits', {
    body: { email, amount, kind: 'grant', ref },
    headers: { authorization: 'Bearer ' + ADMIN }
  })

const reportBody = {
  schemaVersion: 2,
  asOf: '2026-11-25T00:00:00.000Z',
  locale: 'ko',
  stocks: [
    { market: 'US', symbol: 'NVDA', key: 'US:NVDA', holding: { quantity: 3, avgPrice: 100 } }
  ],
  options: { includeHoldings: true, includeHistory: false, includeThesis: false, lookbackDays: 30 }
}
const report = (ctx, token, key, body = reportBody) =>
  ctx.call('POST', '/v1/reports', { body, token, headers: { 'idempotency-key': key } })
const me = async (ctx, token) => (await (await ctx.call('GET', '/v1/me', { token })).json()).credits

test('worker routes /v1 to the Pro API without wildcard CORS; disabled by default', async () => {
  const res = await worker.fetch(new Request(ORIGIN + '/v1/config'), {}, { waitUntil() {} })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), null)
  assert.deepEqual(await res.json(), {
    ok: true,
    pro: false,
    reports: false,
    payments: false,
    pack: { price: 990, credits: 10, currency: 'KRW' }
  })
  const closed = await worker.fetch(
    new Request(ORIGIN + '/v1/auth/request-code', { method: 'POST' }),
    {},
    { waitUntil() {} }
  )
  assert.equal(closed.status, 503)
  assert.equal((await closed.json()).error, 'ERR_PRO_DISABLED')
})

test('e-mail code sign-in: hashed single-use code, sessions, wrong-code lockout', async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  assert.equal(ctx.mails[0].to[0], 'user@example.com')
  assert.match(ctx.mails[0].subject, /로그인 코드/)
  const stored = ctx.database.raw.prepare('SELECT * FROM auth_codes').all()
  assert.equal(stored.length, 0, 'code consumed')
  assert.deepEqual(await me(ctx, token), { available: 0, pending: 0 })

  // Code cannot be replayed.
  const code = /(\d{6})/.exec(ctx.mails[0].text)[1]
  const replay = await ctx.call('POST', '/v1/auth/verify', {
    body: { email: 'user@example.com', code }
  })
  assert.equal(replay.status, 400)

  // Five wrong guesses burn the code, even if the sixth is correct.
  await ctx.call('POST', '/v1/auth/request-code', { body: { email: 'user@example.com' } })
  const fresh = /(\d{6})/.exec(ctx.mails.at(-1).text)[1]
  const wrong = fresh === '000000' ? '111111' : '000000'
  for (let i = 0; i < 5; i++)
    await ctx.call('POST', '/v1/auth/verify', { body: { email: 'user@example.com', code: wrong } })
  const late = await ctx.call('POST', '/v1/auth/verify', {
    body: { email: 'user@example.com', code: fresh }
  })
  assert.equal(late.status, 400)

  // Logout revokes.
  await ctx.call('POST', '/v1/auth/logout', { token })
  assert.equal((await ctx.call('GET', '/v1/me', { token })).status, 401)
})

test('code requests are rate limited per address and reject browsers/bad e-mail', async () => {
  const ctx = setup()
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await ctx.call('POST', '/v1/auth/request-code', { body: { email: 'a@b.co' } })).status,
      202
    )
  const limited = await ctx.call('POST', '/v1/auth/request-code', { body: { email: 'a@b.co' } })
  assert.equal(limited.status, 429)
  ctx.tick(3600_000)
  assert.equal(
    (await ctx.call('POST', '/v1/auth/request-code', { body: { email: 'a@b.co' } })).status,
    202
  )
  assert.equal(
    (await ctx.call('POST', '/v1/auth/request-code', { body: { email: 'nope' } })).status,
    400
  )
  const browser = await ctx.call('POST', '/v1/auth/request-code', {
    body: { email: 'a@b.co' },
    headers: { origin: 'https://evil.example' }
  })
  assert.equal(browser.status, 403)
})

test('reports reserve, settle and replay idempotently; failures release the credit', async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  assert.equal((await report(ctx, token, 'key-aaaaaaaaaaaaaaaa')).status, 402)
  assert.equal((await grant(ctx, 2)).status, 200)
  assert.deepEqual(await me(ctx, token), { available: 2, pending: 0 })

  const first = await report(ctx, token, 'key-aaaaaaaaaaaaaaaa')
  assert.equal(first.status, 200)
  const firstBody = await first.json()
  assert.equal(firstBody.result.status, 'generated_billed')
  assert.deepEqual(firstBody.result.report.stocks, [
    { market: 'US', symbol: 'NVDA', key: 'US:NVDA' }
  ])
  assert.deepEqual(await me(ctx, token), { available: 1, pending: 0 })

  // Same key + same body: stored result, no second charge or upstream call.
  const again = await (
    await report(ctx, token, 'key-aaaaaaaaaaaaaaaa', { ...reportBody, asOf: 'later' })
  ).json()
  assert.equal(again.replayed, true)
  assert.equal(ctx.analyses(), 1)
  assert.deepEqual(await me(ctx, token), { available: 1, pending: 0 })

  // Same key, different request.
  const other = {
    ...reportBody,
    stocks: [{ market: 'US', symbol: 'AAPL', key: 'US:AAPL' }],
    options: { ...reportBody.options, includeHoldings: false }
  }
  assert.equal((await report(ctx, token, 'key-aaaaaaaaaaaaaaaa', other)).status, 422)

  // Upstream failure: credit released, not charged.
  ctx.failAnalyses(true)
  const failed = await report(ctx, token, 'key-bbbbbbbbbbbbbbbb')
  assert.equal(failed.status, 502)
  assert.equal((await failed.json()).error, 'ERR_MODEL_HTTP')
  assert.deepEqual(await me(ctx, token), { available: 1, pending: 0 })

  // Holdings are never stored server-side.
  const stored = ctx.database.raw
    .prepare('SELECT result_json FROM analysis_jobs WHERE result_json IS NOT NULL')
    .all()
  for (const row of stored) assert.doesNotMatch(row.result_json, /avgPrice|quantity/)

  assert.equal((await report(ctx, token, 'bad')).status, 400)
})

test('stuck processing jobs are released after 15 minutes', async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  await grant(ctx, 1)
  const user = ctx.database.raw.prepare('SELECT id FROM users').get()
  ctx.database.raw.exec(
    `INSERT INTO analysis_jobs VALUES ('job1','${user.id}','k','h','processing',NULL,NULL,'2026-11-25T00:00:00.000Z','2026-11-25T00:00:00.000Z')`
  )
  ctx.database.raw.exec(
    `INSERT INTO credit_ledger VALUES ('r1','${user.id}','reserve',-1,'job1',NULL,'2026-11-25T00:00:00.000Z')`
  )
  assert.deepEqual(await me(ctx, token), { available: 0, pending: 1 })
  ctx.tick(16 * 60_000)
  assert.deepEqual(await me(ctx, token), { available: 1, pending: 0 })
})

test('admin endpoint requires its own token and cannot overdraw', async () => {
  const ctx = setup()
  await signIn(ctx)
  const denied = await ctx.call('POST', '/v1/admin/credits', {
    body: { email: 'user@example.com', amount: 5, kind: 'grant', ref: 'x1234' }
  })
  assert.equal(denied.status, 401)
  await grant(ctx, 3, 'grant-01')
  assert.equal((await grant(ctx, 3, 'grant-01')).status, 409, 'same ref only once')
  const overdraw = await ctx.call('POST', '/v1/admin/credits', {
    body: { email: 'user@example.com', amount: -4, kind: 'refund', ref: 'refund-1' },
    headers: { authorization: 'Bearer ' + ADMIN }
  })
  assert.equal(overdraw.status, 409)
})

test('toss checkout: server price, amount check, single confirmation and credit', async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  const checkout = await (await ctx.call('POST', '/v1/credits/checkout', { token })).json()
  assert.equal(checkout.price, 990)
  assert.match(checkout.url, new RegExp('^' + ORIGIN + '/pay/[A-Za-z0-9_-]{40,}$'))
  assert.match(checkout.orderId, /^[A-Za-z0-9_-]{6,64}$/)

  const pagePath = new URL(checkout.url).pathname
  const pay = await ctx.call('GET', pagePath)
  const html = await pay.text()
  assert.equal(pay.status, 200)
  assert.match(html, /js\.tosspayments\.com\/v2\/standard/)
  assert.match(html, new RegExp(checkout.orderId))
  assert.match(pay.headers.get('content-security-policy'), /nonce-/)

  const tampered = await ctx.call(
    'GET',
    `/pay/success?paymentKey=pk_1&orderId=${checkout.orderId}&amount=10`
  )
  assert.equal(tampered.status, 400)
  assert.equal(ctx.toss.length, 0)

  const ok = await ctx.call(
    'GET',
    `/pay/success?paymentKey=pk_1&orderId=${checkout.orderId}&amount=990`
  )
  assert.equal(ok.status, 200)
  assert.equal(ctx.toss[0].auth, 'Basic ' + btoa('test_sk_secret:'))
  assert.deepEqual(await me(ctx, token), { available: 10, pending: 0 })

  // Reloading the success page never credits twice or re-confirms.
  assert.equal(
    (await ctx.call('GET', `/pay/success?paymentKey=pk_1&orderId=${checkout.orderId}&amount=990`))
      .status,
    200
  )
  assert.equal(ctx.toss.length, 1)
  assert.deepEqual(await me(ctx, token), { available: 10, pending: 0 })
  // Paid checkout link is no longer usable.
  assert.equal((await ctx.call('GET', pagePath)).status, 410)
})

test('toss confirm rejection or mismatch credits nothing', async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  const a = await (await ctx.call('POST', '/v1/credits/checkout', { token })).json()
  ctx.setTossReply(() =>
    Response.json({ code: 'REJECT_CARD_PAYMENT', message: 'no' }, { status: 400 })
  )
  const rejected = await ctx.call(
    'GET',
    `/pay/success?paymentKey=pk&orderId=${a.orderId}&amount=990`
  )
  assert.equal(rejected.status, 402)
  assert.match(await rejected.text(), /REJECT_CARD_PAYMENT/)

  const b = await (await ctx.call('POST', '/v1/credits/checkout', { token })).json()
  ctx.setTossReply((body) => Response.json({ ...body, totalAmount: 1, status: 'DONE' }))
  assert.equal(
    (await ctx.call('GET', `/pay/success?paymentKey=pk&orderId=${b.orderId}&amount=990`)).status,
    402
  )

  const c = await (await ctx.call('POST', '/v1/credits/checkout', { token })).json()
  assert.equal(
    (await ctx.call('GET', `/pay/fail?code=PAY_PROCESS_CANCELED&orderId=${c.orderId}`)).status,
    200
  )
  assert.deepEqual(await me(ctx, token), { available: 0, pending: 0 })
})

test('payments stay closed without the flag and Toss keys', async () => {
  const ctx = setup({ PAYMENTS_ENABLED: '0' })
  const token = await signIn(ctx)
  assert.equal((await ctx.call('POST', '/v1/credits/checkout', { token })).status, 503)
})
