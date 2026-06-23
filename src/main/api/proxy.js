import { net } from 'electron'

// Electron의 net.fetch → Chromium 네트워크 스택 사용 → 시스템 프록시/인증서 자동 적용.
// Node.js 내장 fetch는 시스템 프록시를 무시하므로 회사 네트워크 등에서 실패할 수 있음.
export function eFetch(url, options = {}) {
  return net.fetch(url, options)
}

// Cloudflare Worker로 라우팅할 때 사용. 빈 문자열이면 클라이언트에서 직접 호출.
export const WORKER_URL = 'https://stockpeek-proxy.sngmng.workers.dev'

export function useProxy() {
  return Boolean(WORKER_URL)
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
