// Shared helpers for the Pro API (/v1/*, /pay/*). Workers runtime and Node 22 compatible.

export const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } })
}

export const fail = (status, error) => json({ ok: false, error }, status)

// Thrown inside handlers; the router turns it into { ok:false, error } with this status.
export class ApiError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
  }
}

export const nowIso = (now = Date.now()) => new Date(now).toISOString()
export const addMs = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString()

export async function sha256Hex(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomToken(bytes = 32) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  let s = ''
  for (const b of raw) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

// Uniform 6-digit code (rejection sampling avoids modulo bias).
export function randomCode() {
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf)
  while (buf[0] >= limit)
  return String(buf[0] % 1_000_000).padStart(6, '0')
}

export function fixedTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

const MAX_JSON_BYTES = 12_000

export async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new ApiError(415, 'ERR_CONTENT_TYPE')
  const size = Number(request.headers.get('content-length'))
  if (Number.isFinite(size) && size > maxBytes) throw new ApiError(413, 'ERR_REQUEST_TOO_LARGE')
  const buffer = await request.arrayBuffer()
  if (buffer.byteLength > maxBytes) throw new ApiError(413, 'ERR_REQUEST_TOO_LARGE')
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
  } catch {
    throw new ApiError(400, 'ERR_REQUEST_JSON')
  }
}

export function bearer(request) {
  const match = /^Bearer ([A-Za-z0-9_\-.]{20,256})$/.exec(
    request.headers.get('authorization') || ''
  )
  return match ? match[1] : null
}

export function db(env) {
  const database = env.ANALYSIS_DB
  if (!database || typeof database.prepare !== 'function') throw new ApiError(503, 'ERR_DB')
  return database
}

// Fixed-window counter. Returns false when the bucket is already at its limit.
export async function takeRate(database, bucket, limit, windowMs, now = Date.now()) {
  const windowStart = nowIso(Math.floor(now / windowMs) * windowMs)
  const row = await database
    .prepare(
      `INSERT INTO rate_counters (bucket, window_start, used) VALUES (?, ?, 1)
       ON CONFLICT(bucket, window_start) DO UPDATE SET used = used + 1 WHERE used < ?
       RETURNING used`
    )
    .bind(bucket, windowStart, limit)
    .first()
  return Boolean(row)
}

export function flag(env, name) {
  return env[name] === '1'
}

export function intVar(env, name, fallback, min, max) {
  const n = Number(env[name])
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

export const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
