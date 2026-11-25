// E-mail one-time code sign-in and opaque bearer sessions.
import {
  ApiError,
  addMs,
  bearer,
  db,
  fixedTimeEqual,
  json,
  nowIso,
  randomCode,
  randomToken,
  readJson,
  sha256Hex,
  takeRate
} from './util.js'

const CODE_TTL_MS = 10 * 60 * 1000
const CODE_MAX_ATTEMPTS = 5
const SESSION_TTL_MS = 180 * 24 * 3600 * 1000
const HOUR = 3600 * 1000
const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/

const MAIL_TEXT = {
  ko: [
    '몰래주식 로그인 코드',
    '로그인 코드: {code}\n10분 동안 유효합니다. 요청하지 않았다면 이 메일을 무시하세요.'
  ],
  en: [
    'Stock Peek sign-in code',
    'Your sign-in code: {code}\nIt expires in 10 minutes. If you did not request it, ignore this e-mail.'
  ],
  ja: [
    'Stock Peek ログインコード',
    'ログインコード: {code}\n10分間有効です。心当たりがない場合はこのメールを無視してください。'
  ],
  ar: [
    'رمز تسجيل الدخول إلى Stock Peek',
    'رمز تسجيل الدخول: {code}\nصالح لمدة 10 دقائق. إذا لم تطلبه، تجاهل هذه الرسالة.'
  ]
}

export function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new ApiError(400, 'ERR_EMAIL_INVALID')
  return email
}

function pepper(env) {
  const value = env.AUTH_PEPPER
  if (typeof value !== 'string' || value.length < 32) throw new ApiError(503, 'ERR_AUTH_CONFIG')
  return value
}

async function sendCodeMail(env, fetchImpl, email, code, locale) {
  if (env.MAIL_MODE === 'log') {
    // Local wrangler dev only: never enable on the deployed Worker.
    console.log(`[dev] sign-in code for ${email}: ${code}`)
    return
  }
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new ApiError(503, 'ERR_MAIL_CONFIG')
  const [subject, body] = MAIL_TEXT[locale] || MAIL_TEXT.en
  const text = body.replace('{code}', code)
  let res
  try {
    res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + env.RESEND_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject, text }),
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    throw new ApiError(502, 'ERR_MAIL_FAILED')
  }
  if (!res.ok) throw new ApiError(502, 'ERR_MAIL_FAILED')
}

export async function requestCode(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const input = await readJson(request, 1_000)
  const email = normalizeEmail(input?.email)
  const locale = ['ko', 'en', 'ja', 'ar'].includes(input?.locale) ? input.locale : 'en'
  const database = db(env)
  const salt = pepper(env)
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const [emailBucket, ipBucket] = await Promise.all([
    sha256Hex(salt + ':mail:' + email),
    sha256Hex(salt + ':ip:' + ip)
  ])
  // Abuse and cost limits: per address and per client IP.
  if (!(await takeRate(database, 'code:' + emailBucket, 5, HOUR, now)))
    throw new ApiError(429, 'ERR_RATE_LIMITED')
  if (!(await takeRate(database, 'code-ip:' + ipBucket, 20, HOUR, now)))
    throw new ApiError(429, 'ERR_RATE_LIMITED')
  const code = randomCode()
  const created = nowIso(now)
  await database
    .prepare(
      `INSERT INTO auth_codes (email, code_hash, attempts, expires_at, created_at)
       VALUES (?, ?, 0, ?, ?)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0,
         expires_at = excluded.expires_at, created_at = excluded.created_at`
    )
    .bind(
      email,
      await sha256Hex(salt + ':code:' + email + ':' + code),
      addMs(created, CODE_TTL_MS),
      created
    )
    .run()
  await sendCodeMail(env, fetchImpl, email, code, locale)
  // Same answer whether or not an account exists.
  return json({ ok: true }, 202)
}

export async function verifyCode(request, env, { now = Date.now() } = {}) {
  const input = await readJson(request, 1_000)
  const email = normalizeEmail(input?.email)
  const code = typeof input?.code === 'string' ? input.code.trim() : ''
  if (!/^\d{6}$/.test(code)) throw new ApiError(400, 'ERR_CODE_INVALID')
  const database = db(env)
  const salt = pepper(env)
  const at = nowIso(now)
  const row = await database
    .prepare('SELECT code_hash, attempts, expires_at FROM auth_codes WHERE email = ?')
    .bind(email)
    .first()
  if (!row || row.expires_at <= at || row.attempts >= CODE_MAX_ATTEMPTS) {
    if (row) await database.prepare('DELETE FROM auth_codes WHERE email = ?').bind(email).run()
    throw new ApiError(400, 'ERR_CODE_INVALID')
  }
  const presented = await sha256Hex(salt + ':code:' + email + ':' + code)
  if (!fixedTimeEqual(presented, row.code_hash)) {
    await database
      .prepare('UPDATE auth_codes SET attempts = attempts + 1 WHERE email = ?')
      .bind(email)
      .run()
    throw new ApiError(400, 'ERR_CODE_INVALID')
  }
  // Single use: only the request that deletes the row may create a session.
  const consumed = await database
    .prepare('DELETE FROM auth_codes WHERE email = ? AND code_hash = ? RETURNING email')
    .bind(email, row.code_hash)
    .first()
  if (!consumed) throw new ApiError(400, 'ERR_CODE_INVALID')
  // Optional: the caller's current (possibly device-only) session.
  let current = null
  try {
    current = await requireUser(request, env, { now })
  } catch {
    current = null
  }
  const owner = await database.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  let userId
  if (owner) {
    userId = owner.id
    // Recovering an e-mail account on this PC: carry a device-only balance over, once.
    if (current && current.id !== owner.id && !current.email)
      await mergeDeviceBalance(database, current.id, owner.id, at)
  } else if (current && !current.email) {
    // Linking: the device account keeps its credits and gains a recoverable e-mail.
    await database
      .prepare('UPDATE users SET email = ? WHERE id = ? AND email IS NULL')
      .bind(email, current.id)
      .run()
    userId = current.id
  } else {
    userId = crypto.randomUUID()
    await database
      .prepare('INSERT INTO users (id, email, customer_key, created_at) VALUES (?, ?, ?, ?)')
      .bind(userId, email, 'cus_' + crypto.randomUUID(), at)
      .run()
  }
  if (current) await revokeBearer(database, request, at)
  return json({ ok: true, token: await createSession(database, userId, at), email })
}

async function createSession(database, userId, at) {
  const token = randomToken(32)
  await database
    .prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    )
    .bind(await sha256Hex(token), userId, at, addMs(at, SESSION_TTL_MS))
    .run()
  return token
}

async function revokeBearer(database, request, at) {
  const token = bearer(request)
  if (token)
    await database
      .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(at, await sha256Hex(token))
      .run()
}

async function mergeDeviceBalance(database, fromId, toId, at) {
  const row = await database
    .prepare('SELECT COALESCE(SUM(amount), 0) AS available FROM credit_ledger WHERE user_id = ?')
    .bind(fromId)
    .first()
  const amount = Number(row?.available || 0)
  if (amount <= 0) return
  // Paired adjustments with unique refs: applied at most once, in one transaction.
  await database.batch([
    database
      .prepare(
        `INSERT INTO credit_ledger (id, user_id, kind, amount, ref, note, created_at)
         VALUES (?, ?, 'adjust', ?, ?, 'merged into e-mail account', ?)`
      )
      .bind(crypto.randomUUID(), fromId, -amount, 'merge-out:' + fromId, at),
    database
      .prepare(
        `INSERT INTO credit_ledger (id, user_id, kind, amount, ref, note, created_at)
         VALUES (?, ?, 'adjust', ?, ?, 'merged from device account', ?)`
      )
      .bind(crypto.randomUUID(), toId, amount, 'merge-in:' + fromId, at)
  ])
}

// No sign-in: one anonymous account per installation. Paid credits only, so new accounts
// carry no value; still rate limited per IP to keep the table clean.
export async function createDeviceSession(request, env, { now = Date.now() } = {}) {
  const database = db(env)
  const salt = pepper(env)
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  if (
    !(await takeRate(database, 'device-ip:' + (await sha256Hex(salt + ':ip:' + ip)), 10, HOUR, now))
  )
    throw new ApiError(429, 'ERR_RATE_LIMITED')
  const at = nowIso(now)
  const userId = crypto.randomUUID()
  await database
    .prepare('INSERT INTO users (id, email, customer_key, created_at) VALUES (?, NULL, ?, ?)')
    .bind(userId, 'cus_' + crypto.randomUUID(), at)
    .run()
  return json({ ok: true, token: await createSession(database, userId, at), email: null })
}

// Returns { id, email, customerKey } or throws 401.
export async function requireUser(request, env, { now = Date.now() } = {}) {
  const token = bearer(request)
  if (!token) throw new ApiError(401, 'ERR_SESSION_INVALID')
  const row = await db(env)
    .prepare(
      `SELECT u.id, u.email, u.customer_key FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`
    )
    .bind(await sha256Hex(token), nowIso(now))
    .first()
  if (!row) throw new ApiError(401, 'ERR_SESSION_INVALID')
  return { id: row.id, email: row.email, customerKey: row.customer_key }
}

export async function logout(request, env, { now = Date.now() } = {}) {
  const token = bearer(request)
  if (token)
    await db(env)
      .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(nowIso(now), await sha256Hex(token))
      .run()
  return json({ ok: true })
}
