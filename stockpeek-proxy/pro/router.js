// Pro API router: /v1/* (JSON, bearer sessions) and /pay/* (browser pages for Toss).
// No wildcard CORS: the desktop app calls from the main process, never from a web origin.
import { ApiError, db, fail, flag, json } from './util.js'
import { createDeviceSession, logout, requestCode, requireUser, verifyCode } from './auth.js'
import { adminCredits, balance, reconcileStaleJobs } from './credits.js'
import { createReport } from './reports.js'
import {
  checkoutPage,
  createCheckout,
  creditPack,
  paymentFail,
  paymentSuccess
} from './payments.js'

const ROUTES = {
  'GET /v1/config': (request, env) =>
    json({
      ok: true,
      // PRO_PUBLIC shows Pro in released apps; PRO_ENABLED alone opens the API for a closed beta.
      pro: flag(env, 'PRO_ENABLED') && flag(env, 'PRO_PUBLIC'),
      reports: flag(env, 'PRO_REPORTS_ENABLED'),
      payments: flag(env, 'PAYMENTS_ENABLED'),
      pack: creditPack(env)
    }),
  'POST /v1/auth/device': (request, env, deps) => createDeviceSession(request, env, deps),
  'POST /v1/auth/request-code': (request, env, deps) => requestCode(request, env, deps),
  'POST /v1/auth/verify': (request, env, deps) => verifyCode(request, env, deps),
  'POST /v1/auth/logout': (request, env, deps) => logout(request, env, deps),
  'GET /v1/me': async (request, env, deps) => {
    const user = await requireUser(request, env, deps)
    const database = db(env)
    await reconcileStaleJobs(database, user.id, deps.now)
    return json({ ok: true, email: user.email, credits: await balance(database, user.id) })
  },
  'POST /v1/reports': (request, env, deps) => createReport(request, env, deps),
  'POST /v1/credits/checkout': (request, env, deps) => createCheckout(request, env, deps),
  'POST /v1/admin/credits': (request, env, deps) => adminCredits(request, env, deps)
}

export function isProPath(pathname) {
  return pathname.startsWith('/v1/') || pathname.startsWith('/pay/')
}

export async function handlePro(request, env, deps = {}) {
  const url = new URL(request.url)
  const options = { ...deps, now: deps.now ?? Date.now() }
  try {
    if (url.pathname.startsWith('/pay/')) {
      if (request.method !== 'GET') return fail(405, 'ERR_METHOD')
      if (url.pathname === '/pay/success') return await paymentSuccess(env, url, options)
      if (url.pathname === '/pay/fail') return await paymentFail(env, url, options)
      return await checkoutPage(env, url.pathname.slice('/pay/'.length), {
        ...options,
        origin: url.origin
      })
    }
    // Account sign-up is closed until PRO_ENABLED, except for the public config probe.
    const route = ROUTES[`${request.method} ${url.pathname}`]
    if (!route) return fail(404, 'ERR_NOT_FOUND')
    if (
      !flag(env, 'PRO_ENABLED') &&
      url.pathname !== '/v1/config' &&
      url.pathname !== '/v1/admin/credits'
    )
      return fail(503, 'ERR_PRO_DISABLED')
    if (request.headers.has('origin')) return fail(403, 'ERR_BROWSER_DISABLED')
    return await route(request, env, options)
  } catch (error) {
    if (error instanceof ApiError) return fail(error.status, error.message)
    console.error('pro api error', error?.message)
    return fail(500, 'ERR_INTERNAL')
  }
}
