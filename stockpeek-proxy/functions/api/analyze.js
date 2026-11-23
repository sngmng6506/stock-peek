import { createOfficialFilingProvider } from '../../lib/filings.js'
import { createAnalysisPipeline, validateAnalysisRequest } from '../../lib/pipeline.js'
import { createOpenRouterNarrator } from '../../lib/openrouter.js'

const MAX_BODY_BYTES = 12_000
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
const response = (status, error) => new Response(JSON.stringify({ ok: false, error }), { status, headers: JSON_HEADERS })

async function digest(value) {
  const raw = new TextEncoder().encode(value)
  const bytes = await crypto.subtle.digest('SHA-256', raw)
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
}

function fixedTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

async function authenticate(request, env) {
  const token = env.ANALYSIS_TEST_TOKEN
  if (typeof token !== 'string' || token.length < 32) return null
  const match = /^Bearer ([A-Za-z0-9_\-.]{32,256})$/.exec(request.headers.get('authorization') || '')
  if (!match) return null
  const [expected, presented] = await Promise.all([digest(token), digest(match[1])])
  if (!fixedTimeEqual(expected, presented)) return null
  return expected
}

async function checkLimit(env, tokenHash) {
  // D1 is mandatory. An in-memory counter is NOT a safe distributed rate limit.
  const db = env.ANALYSIS_DB
  if (!db || typeof db.prepare !== 'function') throw new Error('ERR_RATE_DB')
  const day = new Date().toISOString().slice(0, 10)
  const limit = Math.min(10, Math.max(1, Number(env.ANALYSIS_DAILY_LIMIT) || 3))
  // Atomic UPSERT: concurrent requests cannot bypass the quota.
  const result = await db.prepare(`
    INSERT INTO analysis_daily_usage (day, token_hash, used, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(day, token_hash) DO UPDATE SET
      used = used + 1, updated_at = excluded.updated_at
    WHERE used < ?
    RETURNING used
  `).bind(day, tokenHash, new Date().toISOString(), limit).first()
  return Boolean(result)
}

async function readLimitedBody(request) {
  if (!request.body) throw new Error('ERR_REQUEST_JSON')
  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) throw new Error('ERR_REQUEST_TOO_LARGE')
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally {
    reader.releaseLock()
  }
}

async function safeFetchJson(url, options = {}) {
  // Only preconstructed official source URLs from the filing adapter are accepted.
  const u = new URL(url)
  if (u.protocol !== 'https:' || !['data.sec.gov', 'www.sec.gov', 'opendart.fss.or.kr'].includes(u.hostname))
    throw new Error('ERR_SOURCE_URL')
  const res = await fetch(u.href, { ...options, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error('ERR_SOURCE_HTTP')
  const size = Number(res.headers.get('content-length') || 0)
  if (size > 5_000_000) throw new Error('ERR_SOURCE_SIZE')
  const data = await res.text()
  if (data.length > 5_000_000) throw new Error('ERR_SOURCE_SIZE')
  try { return JSON.parse(data) } catch { throw new Error('ERR_SOURCE_JSON') }
}

export async function onRequestPost({ request, env }) {
  // Closed by default: even correct API credentials cannot enable paid calls by themselves.
  if (env.ANALYSIS_ENABLED !== '1') return response(503, 'ERR_ANALYSIS_DISABLED')
  if (request.headers.has('origin')) return response(403, 'ERR_BROWSER_DISABLED')
  const auth = await authenticate(request, env)
  if (!auth) return response(401, 'ERR_UNAUTHORIZED')
  if (!env.DART_API_KEY || !env.OPENROUTER_API_KEY) return response(503, 'ERR_SECRETS_MISSING')
  if (!env.ANALYSIS_DB?.prepare) return response(503, 'ERR_RATE_DB')
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return response(415, 'ERR_CONTENT_TYPE')
  const headerSize = Number(request.headers.get('content-length'))
  if (Number.isFinite(headerSize) && headerSize > MAX_BODY_BYTES) return response(413, 'ERR_REQUEST_TOO_LARGE')
  let input
  try { input = JSON.parse(await readLimitedBody(request)) }
  catch (error) {
    return error?.message === 'ERR_REQUEST_TOO_LARGE'
      ? response(413, 'ERR_REQUEST_TOO_LARGE')
      : response(400, 'ERR_REQUEST_JSON')
  }

  // Rebuild the request from an explicit allowlist. Unknown JSON fields never
  // reach upstream models, even when an operator's client sends extra properties.
  try {
    validateAnalysisRequest(input)
    const options = input.options
    const limitedSnapshot = item => {
      if (!item || typeof item !== 'object') return null
      const out = {}
      if (typeof item.market === 'string') out.market = item.market.slice(0, 8)
      if (typeof item.symbol === 'string') out.symbol = item.symbol.slice(0, 20)
      if (options.includeHoldings) {
        if (typeof item.quantity === 'number' && Number.isFinite(item.quantity))
          out.quantity = item.quantity
        if (typeof item.avgPrice === 'number' && Number.isFinite(item.avgPrice))
          out.avgPrice = item.avgPrice
      }
      return out
    }
    input = {
      schemaVersion: 2,
      locale: ['ko', 'en', 'ja', 'ar'].includes(input.locale) ? input.locale : 'ko',
      stocks: input.stocks.map(stock => ({
        market: stock.market, symbol: stock.symbol, key: stock.key,
        ...(options.includeHoldings && stock.holding
          ? { holding: { quantity: stock.holding.quantity, avgPrice: stock.holding.avgPrice } }
          : {})
      })),
      options: {
        includeHoldings: options.includeHoldings, includeHistory: options.includeHistory,
        includeThesis: options.includeThesis, lookbackDays: options.lookbackDays
      },
      ...(options.includeThesis && input.investmentThesis ? {
        investmentThesis: {
          text: input.investmentThesis.text, horizon: input.investmentThesis.horizon,
          focus: input.investmentThesis.focus
        }
      } : {}),
      ...(options.includeHistory ? {
        activity: input.activity.map(event => ({
          type: event.type, occurredAt: event.occurredAt,
          stock: { market: event.stock.market, symbol: event.stock.symbol },
          before: limitedSnapshot(event.before), after: limitedSnapshot(event.after)
        }))
      } : {})
    }
  } catch { return response(400, 'ERR_ANALYSIS_REQUEST') }

  try {
    if (!(await checkLimit(env, auth))) return response(429, 'ERR_ANALYSIS_DAILY_LIMIT')
  } catch { return response(503, 'ERR_RATE_DB') }

  try {
    let map
    try { map = env.DART_CORP_MAP_JSON ? JSON.parse(env.DART_CORP_MAP_JSON) : {} }
    catch { return response(503, 'ERR_DART_MAPPING_CONFIG') }
    const filing = createOfficialFilingProvider({
      fetchJson: safeFetchJson,
      secUserAgent: env.SEC_USER_AGENT,
      dartApiKey: env.DART_API_KEY,
      dartCorpMap: map
    })
    const narrator = createOpenRouterNarrator({
      fetchImpl: fetch,
      apiKey: env.OPENROUTER_API_KEY,
      model: env.P4_MODEL || 'anthropic/claude-sonnet-5.5'
    })
    const run = createAnalysisPipeline({ filings: filing, generate: narrator })
    const output = await run(input)
    return new Response(JSON.stringify({ ok: true, result: output }), { status: 200, headers: JSON_HEADERS })
  } catch (error) {
    // Return only known, non-sensitive error codes to an authenticated operator.
    // Never include upstream response bodies, DART URLs with credentials or prompts.
    const code = error instanceof Error &&
      /^(ERR_ANALYSIS_NO_COVERAGE|ERR_MODEL_(HTTP|INCOMPLETE|REFUSAL|RESPONSE|JSON|NOT_CONFIGURED)|ERR_NEWS_NOT_LICENSED)$/.test(error.message)
      ? error.message
      : 'ERR_ANALYSIS_FAILED'
    return response(502, code)
  }
}

// All other methods stay disabled, including OPTIONS/CORS preflight.
export function onRequest() {
  return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } })
}
