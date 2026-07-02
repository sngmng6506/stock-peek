import { net } from 'electron'

// Electron의 net.fetch → Chromium 네트워크 스택 사용 → 시스템 프록시/인증서 자동 적용.
// Node.js 내장 fetch는 시스템 프록시를 무시하므로 회사 네트워크 등에서 실패할 수 있음.
export function eFetch(url, options = {}) {
  return net.fetch(url, options)
}

// Cloudflare Worker URL — /api/review (포트폴리오 한 줄 평)에서 사용.
export const WORKER_URL = 'https://stockpeek-proxy.sngmng.workers.dev'

// 시세/검색 프록시 경유 여부.
// 네이버/야후가 Cloudflare edge IP를 차단해 프록시 시세 요청이 항상 실패하고
// 직접 호출로 폴백됨 → 폴링마다 무의미한 왕복 + CF 무료 티어 소모만 발생.
// 직접 호출(net.fetch)은 시스템 프록시/인증서를 쓰므로 사내망에서도 동작.
// 프록시를 되살리려면 true로 바꾸면 됨 (worker.js 코드는 유지되어 있음).
const USE_QUOTE_PROXY = false

export function useProxy() {
  return USE_QUOTE_PROXY && Boolean(WORKER_URL)
}

async function getJson(url) {
  const res = await eFetch(url)
  if (!res.ok) {
    let detail
    try {
      const j = await res.json()
      detail = j?.error
    } catch {
      // ignore
    }
    throw new Error(detail || `Proxy ${res.status}`)
  }
  return res.json()
}

export async function proxyStock(market, symbol, { skipChart = false } = {}) {
  const u = new URL(`${WORKER_URL}/api/stock`)
  u.searchParams.set('market', market)
  u.searchParams.set('symbol', symbol)
  if (skipChart) u.searchParams.set('skipChart', '1')
  return getJson(u.toString())
}

export async function proxySearch(market, q) {
  const u = new URL(`${WORKER_URL}/api/search`)
  u.searchParams.set('market', market)
  u.searchParams.set('q', q)
  return getJson(u.toString())
}
