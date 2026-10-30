// 오류 코드(ERR_*) 추출. IPC를 거치면 메시지 앞에 접두어가 붙으므로 메시지 안에서 찾는다.
export function errorCodeOf(err) {
  const msg = err?.message ?? (err == null ? '' : String(err))
  return msg.match(/ERR_[A-Z_]+/)?.[0] || null
}

// 코드가 있으면 그대로, 없으면(외부 API 오류 문구 등) fallback 코드로 바꿔 던질 오류를 만든다.
export function codedError(err, fallback) {
  return new Error(errorCodeOf(err) || fallback)
}
