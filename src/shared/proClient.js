// Pro API client (accounts, credits, paid reports). Pure: the caller injects fetch
// (Electron net.fetch in main). The session token lives only in main, never in the renderer.
import { normalizeAnalysisResult, prepareAnalysisBody } from './reportClient.js'

export const DEFAULT_API_ORIGIN = 'https://stockpeek-proxy.sngmng.workers.dev'
export const PRO_TIMEOUT_MS = 15_000
export const REPORT_TIMEOUT_MS = 120_000

// Server codes worth showing as-is. Everything else collapses to a generic code.
const PASS_THROUGH = new Set([
  'ERR_EMAIL_INVALID',
  'ERR_CODE_INVALID',
  'ERR_RATE_LIMITED',
  'ERR_SESSION_INVALID',
  'ERR_PRO_DISABLED',
  'ERR_MAIL_FAILED',
  'ERR_CREDITS_INSUFFICIENT',
  'ERR_PAYMENTS_DISABLED',
  'ERR_ANALYSIS_DISABLED',
  'ERR_ANALYSIS_DAILY_LIMIT',
  'ERR_ANALYSIS_BUSY',
  'ERR_ANALYSIS_IN_PROGRESS',
  'ERR_ANALYSIS_NO_COVERAGE',
  'ERR_ANALYSIS_REQUEST'
])

const fail = (code) => {
  throw new Error(code)
}

// STOCKPEEK_API_URL: https origin, or http on this machine for `wrangler dev`.
export function apiOriginFromEnv(env = {}) {
  const raw = env.STOCKPEEK_API_URL
  if (!raw) return DEFAULT_API_ORIGIN
  let url
  try {
    url = new URL(raw)
  } catch {
    return DEFAULT_API_ORIGIN
  }
  const local =
    url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !local) || url.username || url.password)
    return DEFAULT_API_ORIGIN
  return url.origin
}

export function proErrorCode(serverCode, fallback = 'ERR_PRO_FAILED') {
  return typeof serverCode === 'string' && PASS_THROUGH.has(serverCode) ? serverCode : fallback
}

export function isCheckoutUrl(url, origin) {
  try {
    const u = new URL(url)
    return u.origin === origin && /^\/pay\/[A-Za-z0-9_-]{40,60}$/.test(u.pathname) && !u.search
  } catch {
    return false
  }
}

export function createProClient({ fetchImpl, origin = DEFAULT_API_ORIGIN, getToken = () => null }) {
  if (typeof fetchImpl !== 'function') fail('ERR_PRO_FAILED')

  async function call(
    method,
    path,
    { body, auth = false, headers = {}, timeoutMs, fallback } = {}
  ) {
    const token = auth ? getToken() : null
    if (auth && !token) fail('ERR_SESSION_INVALID')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs || PRO_TIMEOUT_MS)
    let res
    let data
    try {
      try {
        res = await fetchImpl(origin + path, {
          method,
          headers: {
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(token ? { authorization: 'Bearer ' + token } : {}),
            ...headers
          },
          body:
            body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
          signal: controller.signal,
          redirect: 'error'
        })
      } catch {
        fail(controller.signal.aborted ? 'ERR_PRO_TIMEOUT' : 'ERR_PRO_NETWORK')
      }
      try {
        data = await res.json()
      } catch {
        fail(controller.signal.aborted ? 'ERR_PRO_TIMEOUT' : fallback || 'ERR_PRO_FAILED')
      }
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok || data?.ok !== true) fail(proErrorCode(data?.error, fallback))
    return data
  }

  return {
    async config() {
      const data = await call('GET', '/v1/config')
      return {
        pro: data.pro === true,
        payments: data.payments === true,
        reports: data.reports === true,
        pack: {
          price: Number(data.pack?.price) || 0,
          credits: Number(data.pack?.credits) || 0,
          currency: typeof data.pack?.currency === 'string' ? data.pack.currency : 'KRW'
        }
      }
    },
    async requestCode(email, locale) {
      await call('POST', '/v1/auth/request-code', { body: { email, locale } })
    },
    async verifyCode(email, code) {
      const data = await call('POST', '/v1/auth/verify', { body: { email, code } })
      if (typeof data.token !== 'string' || typeof data.email !== 'string') fail('ERR_PRO_FAILED')
      return { token: data.token, email: data.email }
    },
    async me() {
      const data = await call('GET', '/v1/me', { auth: true })
      return {
        email: String(data.email || ''),
        credits: {
          available: Math.max(0, Number(data.credits?.available) || 0),
          pending: Math.max(0, Number(data.credits?.pending) || 0)
        }
      }
    },
    async logout() {
      await call('POST', '/v1/auth/logout', { auth: true })
    },
    async checkout() {
      const data = await call('POST', '/v1/credits/checkout', { auth: true })
      if (!isCheckoutUrl(data.url, origin)) fail('ERR_PRO_FAILED')
      return { url: data.url }
    },
    // request: personalizedPreview v2 request. Same idempotency key on retry never double-charges.
    async createReport(request, idempotencyKey) {
      const body = prepareAnalysisBody(request)
      const data = await call('POST', '/v1/reports', {
        auth: true,
        body,
        headers: { 'idempotency-key': idempotencyKey },
        timeoutMs: REPORT_TIMEOUT_MS,
        fallback: 'ERR_ANALYSIS_FAILED'
      })
      return normalizeAnalysisResult(data.result, request)
    }
  }
}
