// 번역 누락 검사: 모든 언어가 한국어(기준)와 같은 키·같은 {자리표시자}를 갖는지,
// 등록된 시장·언어마다 필요한 키·파일이 있는지 확인. CI에서 실행.
import { translations } from '../src/shared/i18n/index.js'
import { LANGUAGES } from '../src/shared/languages.js'
import { MARKETS } from '../src/shared/markets.js'

const base = translations.ko
const problems = []
const placeholders = (s) =>
  [...String(s).matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',')

for (const { code } of LANGUAGES) {
  const dict = translations[code]
  if (!dict) {
    problems.push(`${code}: src/shared/i18n/${code}.js 없음 또는 index.js 미등록`)
    continue
  }
  for (const key of Object.keys(base)) {
    if (!(key in dict)) problems.push(`${code}: 키 누락 ${key}`)
    else if (placeholders(dict[key]) !== placeholders(base[key]))
      problems.push(`${code}: 자리표시자 불일치 ${key}`)
  }
  for (const key of Object.keys(dict)) {
    if (!(key in base)) problems.push(`${code}: 기준(ko)에 없는 키 ${key}`)
  }
}

for (const { id } of MARKETS) {
  for (const key of [`market.${id}`, `add.searchPlaceholder.${id}`]) {
    if (!(key in base)) problems.push(`시장 ${id}: 키 누락 ${key}`)
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(
  `i18n ok: ${LANGUAGES.length} languages, ${Object.keys(base).length} keys, ${MARKETS.length} markets`
)
