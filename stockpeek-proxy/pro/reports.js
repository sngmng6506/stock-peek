// POST /v1/reports — paid report generation with Idempotency-Key.
// Order: validate → idempotency lookup → cost guards → reserve 1 credit → run → settle or release.
import { ApiError, db, flag, intVar, json, nowIso, readJson, sha256Hex, takeRate } from './util.js'
import { requireUser } from './auth.js'
import { reconcileStaleJobs, releaseStatement, reserve, settleStatement } from './credits.js'
import {
  analysisFailureCode,
  runAnalysis,
  sanitizeAnalysisInput
} from '../functions/api/analyze.js'

const DAY = 24 * 3600 * 1000
const RESULT_RETENTION_MS = 7 * DAY
const KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/

// Stored for idempotent replay only. Holdings never leave the request scope.
function storable(result) {
  return {
    ...result,
    report: {
      ...result.report,
      stocks: result.report.stocks.map(({ market, symbol, key }) => ({ market, symbol, key }))
    }
  }
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}

function replay(job) {
  if (job.status === 'succeeded')
    return json({ ok: true, replayed: true, result: JSON.parse(job.result_json) })
  if (job.status === 'processing') throw new ApiError(409, 'ERR_ANALYSIS_IN_PROGRESS')
  throw new ApiError(502, job.error || 'ERR_ANALYSIS_FAILED')
}

export async function createReport(request, env, deps = {}) {
  const now = deps.now ?? Date.now()
  const run = deps.run ?? ((input) => runAnalysis(input, env, deps))
  if (!flag(env, 'PRO_REPORTS_ENABLED')) throw new ApiError(503, 'ERR_ANALYSIS_DISABLED')
  const user = await requireUser(request, env, { now })
  const key = request.headers.get('idempotency-key') || ''
  if (!KEY_PATTERN.test(key)) throw new ApiError(400, 'ERR_IDEMPOTENCY_KEY')
  let input
  try {
    input = sanitizeAnalysisInput(await readJson(request))
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'ERR_ANALYSIS_REQUEST')
  }
  const database = db(env)
  // asOf is client clock metadata; the same click must hash the same across retries.
  const requestHash = await sha256Hex(canonical(input))
  const at = nowIso(now)

  await reconcileStaleJobs(database, user.id, now)
  await database
    .prepare(`UPDATE analysis_jobs SET result_json = NULL WHERE user_id = ? AND created_at < ?`)
    .bind(user.id, nowIso(now - RESULT_RETENTION_MS))
    .run()

  const existing = await database
    .prepare('SELECT * FROM analysis_jobs WHERE user_id = ? AND idempotency_key = ?')
    .bind(user.id, key)
    .first()
  if (existing) {
    if (existing.request_hash !== requestHash) throw new ApiError(422, 'ERR_IDEMPOTENCY_MISMATCH')
    return replay(existing)
  }

  // Spend guards before any paid upstream call: per user and service-wide per day.
  const userLimit = intVar(env, 'PRO_USER_DAILY_LIMIT', 20, 1, 200)
  const globalLimit = intVar(env, 'PRO_GLOBAL_DAILY_LIMIT', 300, 1, 100_000)
  if (!(await takeRate(database, 'report-user:' + user.id, userLimit, DAY, now)))
    throw new ApiError(429, 'ERR_ANALYSIS_DAILY_LIMIT')
  if (!(await takeRate(database, 'report-global', globalLimit, DAY, now)))
    throw new ApiError(503, 'ERR_ANALYSIS_BUSY')

  const jobId = crypto.randomUUID()
  const inserted = await database
    .prepare(
      `INSERT INTO analysis_jobs (id, user_id, idempotency_key, request_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'processing', ?, ?) ON CONFLICT(user_id, idempotency_key) DO NOTHING`
    )
    .bind(jobId, user.id, key, requestHash, at, at)
    .run()
  if ((inserted?.meta?.changes ?? 0) !== 1) {
    // Lost a race with the same key: answer like a retry.
    const other = await database
      .prepare('SELECT * FROM analysis_jobs WHERE user_id = ? AND idempotency_key = ?')
      .bind(user.id, key)
      .first()
    if (other.request_hash !== requestHash) throw new ApiError(422, 'ERR_IDEMPOTENCY_MISMATCH')
    return replay(other)
  }

  if (!(await reserve(database, user.id, jobId, now))) {
    // No charge happened; free the key so the same click can be retried after a top-up.
    await database.prepare('DELETE FROM analysis_jobs WHERE id = ?').bind(jobId).run()
    throw new ApiError(402, 'ERR_CREDITS_INSUFFICIENT')
  }

  let result
  try {
    result = await run(input)
    if (result?.status !== 'generated_unbilled' || !result.report)
      throw new Error('ERR_ANALYSIS_FAILED')
  } catch (error) {
    const code = analysisFailureCode(error)
    await database.batch([
      releaseStatement(database, user.id, jobId, now),
      database
        .prepare(
          `UPDATE analysis_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`
        )
        .bind(code, nowIso(now), jobId)
    ])
    throw new ApiError(502, code)
  }

  const billed = { ...storable(result), status: 'generated_billed', credits: 1 }
  await database.batch([
    settleStatement(database, user.id, jobId, now),
    database
      .prepare(
        `UPDATE analysis_jobs SET status = 'succeeded', result_json = ?, updated_at = ? WHERE id = ?`
      )
      .bind(JSON.stringify(billed), nowIso(now), jobId)
  ])
  return json({ ok: true, replayed: false, result: billed })
}
