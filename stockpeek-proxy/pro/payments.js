// Toss Payments (KRW) credit packs. The app opens /pay/<one-time token> in the user's browser;
// Toss redirects to /pay/success, where the server confirms and credits exactly once.
import {
  ApiError,
  addMs,
  db,
  escapeHtml,
  flag,
  intVar,
  json,
  nowIso,
  randomToken,
  sha256Hex
} from './util.js'
import { requireUser } from './auth.js'

const CHECKOUT_TTL_MS = 30 * 60 * 1000
const TOSS_SDK = 'https://js.tosspayments.com/v2/standard'
const TOSS_CONFIRM = 'https://api.tosspayments.com/v1/payments/confirm'

export function creditPack(env) {
  return {
    price: intVar(env, 'PRO_PACK_PRICE_KRW', 990, 100, 1_000_000),
    credits: intVar(env, 'PRO_PACK_CREDITS', 10, 1, 1000),
    currency: 'KRW'
  }
}

function paymentsReady(env) {
  return (
    flag(env, 'PAYMENTS_ENABLED') &&
    /^(test|live)_(gck|ck)_/.test(env.TOSS_CLIENT_KEY || '') &&
    /^(test|live)_(gsk|sk)_/.test(env.TOSS_SECRET_KEY || '')
  )
}

export async function createCheckout(request, env, { now = Date.now() } = {}) {
  if (!paymentsReady(env)) throw new ApiError(503, 'ERR_PAYMENTS_DISABLED')
  const user = await requireUser(request, env, { now })
  const pack = creditPack(env)
  const orderId = 'sp_' + randomToken(18) // 27 chars: [A-Za-z0-9_-], within Toss's 6–64 rule
  const token = randomToken(32)
  const at = nowIso(now)
  await db(env)
    .prepare(
      `INSERT INTO orders (id, user_id, provider, amount, currency, credits, status,
         checkout_token_hash, checkout_expires_at, created_at, updated_at)
       VALUES (?, ?, 'toss', ?, ?, ?, 'created', ?, ?, ?, ?)`
    )
    .bind(
      orderId,
      user.id,
      pack.price,
      pack.currency,
      pack.credits,
      await sha256Hex(token),
      addMs(at, CHECKOUT_TTL_MS),
      at,
      at
    )
    .run()
  const origin = new URL(request.url).origin
  return json({ ok: true, url: `${origin}/pay/${token}`, orderId, ...pack })
}

function page(title, body, { status = 200, script = '' } = {}) {
  const csp = script
    ? `default-src 'none'; script-src ${TOSS_SDK} 'nonce-${script.nonce}' https://*.tosspayments.com; connect-src https://*.tosspayments.com; frame-src https://*.tosspayments.com; style-src 'unsafe-inline'; img-src https: data:`
    : "default-src 'none'; style-src 'unsafe-inline'"
  return new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,"Malgun Gothic",sans-serif;max-width:440px;margin:12vh auto;padding:0 20px;color:#1d2430;line-height:1.6}h1{font-size:20px}p{color:#475467}</style></head>
<body><h1>${escapeHtml(title)}</h1>${body}${script ? `<script src="${TOSS_SDK}"></script><script nonce="${script.nonce}">${script.code}</script>` : ''}</body></html>`,
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': csp,
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY'
      }
    }
  )
}

async function orderForToken(env, token, now) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null
  return db(env)
    .prepare(
      `SELECT o.*, u.email, u.customer_key FROM orders o JOIN users u ON u.id = o.user_id
       WHERE o.checkout_token_hash = ? AND o.checkout_expires_at > ?`
    )
    .bind(await sha256Hex(token), nowIso(now))
    .first()
}

export async function checkoutPage(env, token, { now = Date.now(), origin }) {
  if (!paymentsReady(env))
    return page('결제를 사용할 수 없어요', '<p>잠시 후 다시 시도해 주세요.</p>', { status: 503 })
  const order = await orderForToken(env, token, now)
  if (!order || order.status !== 'created')
    return page('결제 링크가 만료됐어요', '<p>앱에서 다시 충전을 눌러 주세요.</p>', { status: 410 })
  const nonce = randomToken(16)
  const params = {
    clientKey: env.TOSS_CLIENT_KEY,
    customerKey: order.customer_key,
    request: {
      method: 'CARD',
      amount: { currency: 'KRW', value: order.amount },
      orderId: order.id,
      orderName: `몰래주식 AI 리포트 ${order.credits}회`,
      successUrl: origin + '/pay/success',
      failUrl: origin + '/pay/fail',
      customerEmail: order.email.length <= 100 ? order.email : undefined
    }
  }
  // JSON embedded in a script: escape '<' so no value can close the tag.
  const data = JSON.stringify(params).replaceAll('<', '\\u003c')
  const code = `(async()=>{const p=${data};try{const t=TossPayments(p.clientKey);await t.payment({customerKey:p.customerKey}).requestPayment(p.request)}catch(e){document.getElementById('msg').textContent='결제창을 열지 못했어요: '+(e&&e.message||'')}})()`
  return page(
    '결제 진행 중',
    `<p>${escapeHtml(order.amount.toLocaleString('ko-KR'))}원 · AI 리포트 ${escapeHtml(order.credits)}회</p><p id="msg">토스페이먼츠 결제창을 여는 중이에요.</p>`,
    { script: { nonce, code } }
  )
}

async function tossConfirm(env, fetchImpl, { paymentKey, orderId, amount }) {
  let res
  try {
    res = await fetchImpl(TOSS_CONFIRM, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + btoa(env.TOSS_SECRET_KEY + ':'),
        'content-type': 'application/json',
        'idempotency-key': 'confirm-' + orderId
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    return { ok: false, code: 'ERR_PAYMENT_NETWORK' }
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    // fall through
  }
  if (!res.ok)
    return {
      ok: false,
      code: typeof data?.code === 'string' ? data.code.slice(0, 60) : 'ERR_PAYMENT_CONFIRM'
    }
  if (
    data?.status !== 'DONE' ||
    data.orderId !== orderId ||
    data.totalAmount !== amount ||
    data.paymentKey !== paymentKey
  )
    return { ok: false, code: 'ERR_PAYMENT_MISMATCH' }
  return { ok: true, approvedAt: typeof data.approvedAt === 'string' ? data.approvedAt : null }
}

const DONE_PAGE = (credits) =>
  page(
    '충전이 끝났어요',
    `<p>AI 리포트 ${escapeHtml(credits)}회가 추가됐어요. 이 창을 닫고 몰래주식 앱으로 돌아가 주세요.</p>`
  )

export async function paymentSuccess(env, url, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!paymentsReady(env)) return page('결제를 사용할 수 없어요', '', { status: 503 })
  const paymentKey = url.searchParams.get('paymentKey') || ''
  const orderId = url.searchParams.get('orderId') || ''
  const amount = Number(url.searchParams.get('amount'))
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(orderId) || !paymentKey || paymentKey.length > 200)
    return page('잘못된 결제 요청이에요', '', { status: 400 })
  const database = db(env)
  const order = await database.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first()
  if (!order) return page('주문을 찾을 수 없어요', '', { status: 404 })
  if (order.status === 'paid') return DONE_PAGE(order.credits)
  // The redirect amount is user-controllable: it must equal the server-side order.
  if (amount !== order.amount)
    return page('결제 금액이 주문과 달라요', '<p>결제가 승인되지 않았어요.</p>', { status: 400 })
  const at = nowIso(now)
  // Only one redirect may confirm. A concurrent duplicate sees no change.
  const claim = await database
    .prepare(
      `UPDATE orders SET status = 'confirming', updated_at = ? WHERE id = ? AND status = 'created'`
    )
    .bind(at, orderId)
    .run()
  if ((claim?.meta?.changes ?? 0) !== 1)
    return page('결제를 처리하고 있어요', '<p>잠시 후 앱에서 잔액을 새로고침해 주세요.</p>', {
      status: 409
    })

  const confirmed = await tossConfirm(env, fetchImpl, { paymentKey, orderId, amount: order.amount })
  if (!confirmed.ok) {
    await database
      .prepare(
        `UPDATE orders SET status = 'failed', failure_code = ?, updated_at = ? WHERE id = ? AND status = 'confirming'`
      )
      .bind(confirmed.code, nowIso(now), orderId)
      .run()
    return page(
      '결제가 완료되지 않았어요',
      `<p>결제 승인에 실패했어요 (${escapeHtml(confirmed.code)}). 청구되지 않았다면 다시 시도해 주세요.</p>`,
      { status: 402 }
    )
  }
  await database.batch([
    database
      .prepare(
        `UPDATE orders SET status = 'paid', payment_key = ?, approved_at = ?, updated_at = ?
         WHERE id = ? AND status = 'confirming'`
      )
      .bind(paymentKey, confirmed.approvedAt, nowIso(now), orderId),
    database
      .prepare(
        `INSERT INTO credit_ledger (id, user_id, kind, amount, ref, created_at)
         VALUES (?, ?, 'purchase', ?, ?, ?) ON CONFLICT(kind, ref) DO NOTHING`
      )
      .bind(crypto.randomUUID(), order.user_id, order.credits, 'toss:' + orderId, nowIso(now))
  ])
  return DONE_PAGE(order.credits)
}

export async function paymentFail(env, url, { now = Date.now() } = {}) {
  const orderId = url.searchParams.get('orderId') || ''
  const code = (url.searchParams.get('code') || 'PAY_PROCESS_CANCELED').slice(0, 60)
  if (/^[A-Za-z0-9_-]{6,64}$/.test(orderId))
    await db(env)
      .prepare(
        `UPDATE orders SET status = 'failed', failure_code = ?, updated_at = ? WHERE id = ? AND status = 'created'`
      )
      .bind(code, nowIso(now), orderId)
      .run()
  return page('결제가 취소됐어요', '<p>청구된 금액은 없어요. 앱에서 다시 충전할 수 있어요.</p>')
}
