import { net } from 'electron'

// Electron의 net.fetch → Chromium 네트워크 스택 사용 → 시스템 프록시/인증서 자동 적용.
// Node.js 내장 fetch는 시스템 프록시를 무시하므로 회사 네트워크 등에서 실패할 수 있음.
export function eFetch(url, options = {}) {
  return net.fetch(url, options)
}

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
