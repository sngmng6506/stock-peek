// GitHub Releases 기반 간단한 업데이트 알림.
// 자동 다운로드/설치는 안 하고, 새 버전이 있으면 트레이/설정에서 사용자가 직접 받게 유도.

const REPO = 'sngmng6506/stock-peek'
const CHECK_INTERVAL = 24 * 60 * 60 * 1000 // 24h

let latestUpdate = null

function parseVersion(v) {
  return String(v || '')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
}

function isNewer(remote, local) {
  const r = parseVersion(remote)
  const l = parseVersion(local)
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true
    if ((r[i] || 0) < (l[i] || 0)) return false
  }
  return false
}

async function checkOnce(currentVersion) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'stock-peek'
        }
      }
    )
    if (!res.ok) return null
    const json = await res.json()
    const tag = json?.tag_name
    if (!tag) return null
    if (!isNewer(tag, currentVersion)) return null
    return {
      version: tag,
      name: json.name || tag,
      url: json.html_url
    }
  } catch {
    return null
  }
}

export function startUpdateChecker(currentVersion, onAvailable) {
  const run = async () => {
    const update = await checkOnce(currentVersion)
    if (update && (!latestUpdate || update.version !== latestUpdate.version)) {
      latestUpdate = update
      onAvailable(update)
    }
  }
  run()
  setInterval(run, CHECK_INTERVAL)
}

export function getLatestUpdate() {
  return latestUpdate
}
