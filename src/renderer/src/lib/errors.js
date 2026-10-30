import { errorCodeOf } from '../../../shared/errors.js'

// main이 던진 오류 코드(ERR_*)를 화면 언어로. 코드가 없으면 원문
export function errorText(err, t) {
  const code = errorCodeOf(err)
  return code ? t(`error.${code}`) : err?.message || String(err)
}
