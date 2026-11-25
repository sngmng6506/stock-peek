// Append-only credit ledger. Every movement has a unique (kind, ref); balance = SUM(amount).
// A reservation is a -1 row; success adds a 0-amount 'use' row (settlement record),
// failure adds a +1 'release' row. A reservation never becomes negative balance.
import { ApiError, db, json, nowIso, readJson, fixedTimeEqual } from './util.js'
import { normalizeEmail } from './auth.js'

const STALE_JOB_MS = 15 * 60 * 1000

export async function balance(database, userId) {
  const row = await database
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS available,
        (SELECT COUNT(*) FROM credit_ledger r WHERE r.user_id = ? AND r.kind = 'reserve'
          AND NOT EXISTS (SELECT 1 FROM credit_ledger s WHERE s.ref = r.ref AND s.kind IN ('use', 'release'))
        ) AS pending
       FROM credit_ledger WHERE user_id = ?`
    )
    .bind(userId, userId)
    .first()
  return { available: Number(row?.available || 0), pending: Number(row?.pending || 0) }
}

// Atomic: a single statement inserts the reservation only when funds exist.
export async function reserve(database, userId, ref, now = Date.now()) {
  const result = await database
    .prepare(
      `INSERT INTO credit_ledger (id, user_id, kind, amount, ref, created_at)
       SELECT ?, ?, 'reserve', -1, ?, ?
       WHERE (SELECT COALESCE(SUM(amount), 0) FROM credit_ledger WHERE user_id = ?) >= 1`
    )
    .bind(crypto.randomUUID(), userId, ref, nowIso(now), userId)
    .run()
  return (result?.meta?.changes ?? 0) === 1
}

export function settleStatement(database, userId, ref, now = Date.now()) {
  return database
    .prepare(
      `INSERT INTO credit_ledger (id, user_id, kind, amount, ref, created_at)
       VALUES (?, ?, 'use', 0, ?, ?) ON CONFLICT(kind, ref) DO NOTHING`
    )
    .bind(crypto.randomUUID(), userId, ref, nowIso(now))
}

export function releaseStatement(database, userId, ref, now = Date.now()) {
  return database
    .prepare(
      `INSERT INTO credit_ledger (id, user_id, kind, amount, ref, created_at)
       SELECT ?, ?, 'release', 1, ?, ?
       WHERE EXISTS (SELECT 1 FROM credit_ledger WHERE kind = 'reserve' AND ref = ?)
         AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE kind IN ('use', 'release') AND ref = ?)`
    )
    .bind(crypto.randomUUID(), userId, ref, nowIso(now), ref, ref)
}

// A Worker can be evicted mid-request. Jobs stuck in 'processing' get their credit back.
export async function reconcileStaleJobs(database, userId, now = Date.now()) {
  const cutoff = nowIso(now - STALE_JOB_MS)
  const { results = [] } = await database
    .prepare(
      `SELECT id FROM analysis_jobs WHERE user_id = ? AND status = 'processing' AND updated_at < ?`
    )
    .bind(userId, cutoff)
    .all()
  for (const job of results) {
    await database.batch([
      releaseStatement(database, userId, job.id, now),
      database
        .prepare(
          `UPDATE analysis_jobs SET status = 'failed', error = 'ERR_ANALYSIS_TIMEOUT', updated_at = ?
           WHERE id = ? AND status = 'processing'`
        )
        .bind(nowIso(now), job.id)
    ])
  }
}

// Operator-only: beta grants, refunds and corrections. Never exposed to the app.
export async function adminCredits(request, env, { now = Date.now() } = {}) {
  const token = env.ADMIN_TOKEN
  const presented = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '')?.[1]
  if (typeof token !== 'string' || token.length < 32 || !fixedTimeEqual(presented || '', token))
    throw new ApiError(401, 'ERR_UNAUTHORIZED')
  const input = await readJson(request, 2_000)
  // Device-only accounts have no e-mail; operators can address them by user id.
  const userId = typeof input?.userId === 'string' ? input.userId : null
  const email = userId ? null : normalizeEmail(input?.email)
  const amount = input?.amount
  const kind = input?.kind
  const ref = typeof input?.ref === 'string' ? input.ref.trim() : ''
  if (!['grant', 'refund', 'adjust'].includes(kind) || !Number.isInteger(amount) || !amount)
    throw new ApiError(400, 'ERR_ADMIN_INPUT')
  if (Math.abs(amount) > 1000 || !/^[A-Za-z0-9_\-.:]{4,80}$/.test(ref))
    throw new ApiError(400, 'ERR_ADMIN_INPUT')
  if (kind === 'grant' && amount < 0) throw new ApiError(400, 'ERR_ADMIN_INPUT')
  const note = typeof input?.note === 'string' ? input.note.slice(0, 200) : null
  const database = db(env)
  const user = userId
    ? await database.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()
    : await database.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (!user) throw new ApiError(404, 'ERR_USER_NOT_FOUND')
  // Negative corrections may not push the balance below zero.
  const result = await database
    .prepare(
      `INSERT INTO credit_ledger (id, user_id, kind, amount, ref, note, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE ? > 0 OR (SELECT COALESCE(SUM(amount), 0) FROM credit_ledger WHERE user_id = ?) + ? >= 0
       ON CONFLICT(kind, ref) DO NOTHING`
    )
    .bind(
      crypto.randomUUID(),
      user.id,
      kind,
      amount,
      ref,
      note,
      nowIso(now),
      amount,
      user.id,
      amount
    )
    .run()
  if ((result?.meta?.changes ?? 0) !== 1) throw new ApiError(409, 'ERR_ADMIN_REJECTED')
  return json({ ok: true, credits: await balance(database, user.id) })
}
