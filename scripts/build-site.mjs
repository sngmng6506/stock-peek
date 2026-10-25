// 웹사이트 생성: site/ 원본 → website/ (Cloudflare Pages가 배포하는 폴더, 결과물도 커밋).
//   site/site.json             도메인·페이지 경로·기준 언어·갱신일
//   site/strings/<lang>.json   언어별 공통 문구 (메뉴, 푸터, 다운로드 버튼)
//   site/pages/<lang>/<page>.html  페이지 본문 + 메타 (맨 위 JSON 주석, <!-- @slot --> 구역)
// 공통 head·hreflang·언어 전환·푸터·sitemap.xml은 여기서 만듦. 언어 목록은 src/shared/languages.js.
//
//   node scripts/build-site.mjs           생성
//   node scripts/build-site.mjs --check   결과물이 최신인지 검사 (CI)
//   node scripts/build-site.mjs --touch   갱신일을 오늘로 바꾸고 생성 (릴리즈 때)
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LANGUAGES } from '../src/shared/languages.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(root, 'site')
const OUT = join(root, 'website')
const args = new Set(process.argv.slice(2))

const site = JSON.parse(await readFile(join(SITE, 'site.json'), 'utf8'))
if (args.has('--touch')) {
  site.updated = new Date().toISOString().slice(0, 10)
  await writeFile(join(SITE, 'site.json'), JSON.stringify(site, null, 2) + '\n')
}
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

// 사이트가 있는 언어 = 문구 파일이 있는 언어
const langs = LANGUAGES.filter((l) => existsSync(join(SITE, 'strings', `${l.code}.json`)))
const strings = {}
const pages = {} // pages[lang][page] = { meta, slots }
for (const l of langs) {
  strings[l.code] = JSON.parse(await readFile(join(SITE, 'strings', `${l.code}.json`), 'utf8'))
  pages[l.code] = {}
  for (const file of await readdir(join(SITE, 'pages', l.code))) {
    if (!file.endsWith('.html')) continue
    const page = file.replace(/\.html$/, '')
    if (!(page in site.pages)) throw new Error(`site.json에 없는 페이지: ${l.code}/${file}`)
    pages[l.code][page] = parsePage(await readFile(join(SITE, 'pages', l.code, file), 'utf8'))
  }
}

function parsePage(src) {
  const m = src.match(/^<!--\n([\s\S]*?)\n-->\n/)
  if (!m) throw new Error('페이지 맨 위 메타 JSON 주석 없음')
  const slots = {}
  const re = /<!-- @([\w-]+) -->\n([\s\S]*?)(?=\n<!-- @[\w-]+ -->\n|$)/g
  for (const [, name, body] of src.slice(m[0].length).matchAll(re)) slots[name] = body.trim()
  return { meta: JSON.parse(m[1]), slots }
}

const isDefault = (lang) => lang === site.defaultLang
const prefix = (lang) => (isDefault(lang) ? '' : `/${lang}`)
const pathOf = (lang, page) =>
  page === 'home' ? prefix(lang) || '/' : `${prefix(lang)}/${site.pages[page]}`
const urlOf = (lang, page) => site.origin + pathOf(lang, page)
const fileOf = (lang, page) =>
  page === 'home'
    ? isDefault(lang)
      ? 'index.html'
      : `${lang}.html`
    : `${prefix(lang).slice(1)}${prefix(lang) ? '/' : ''}${site.pages[page]}index.html`
const langsWith = (page) => langs.filter((l) => pages[l.code][page])
const ogLocale = (l) => l.locale.replace('-', '_')
const esc = (s) =>
  String(s)
    .replace(/&(?!\w+;|#\d+;)/g, '&amp;')
    .replace(/"/g, '&quot;')
const indent = (text, n) =>
  text
    .split('\n')
    .map((line) => (line ? ' '.repeat(n) + line : line))
    .join('\n')
const fill = (text) =>
  text.replaceAll('{{version}}', version).replaceAll('{{dateModified}}', site.updated)

// Windows·Mac 버튼 한 쌍. 방문자 OS 쪽이 앞·채움 스타일이 되도록 demo.js가 순서를 바꿈
const downloadButtons = (s) =>
  `<span class="dl-pair"><a href="${site.downloadUrl}" class="btn-dl" data-dl-os="win">${s.downloadWin}</a>` +
  `<a href="${site.downloadUrlMac}" class="btn-dl btn-dl-alt" data-dl-os="mac">${s.downloadMac}</a></span>`

function render(lang, page) {
  const l = langs.find((x) => x.code === lang)
  const s = strings[lang]
  const { meta, slots } = pages[lang][page]
  const others = langsWith(page).filter((x) => x.code !== lang)
  const url = urlOf(lang, page)
  const head = [
    `<meta charset="UTF-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
    `<title>${meta.title}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    meta.keywords && `<meta name="keywords" content="${esc(meta.keywords)}" />`,
    `<meta name="author" content="${site.author}" />`,
    `<meta name="robots" content="${meta.robots}" />`,
    `<link rel="canonical" href="${url}" />`,
    ...langsWith(page).map(
      (x) => `<link rel="alternate" hreflang="${x.code}" href="${urlOf(x.code, page)}" />`
    ),
    `<link rel="alternate" hreflang="x-default" href="${urlOf(site.defaultLang, page)}" />`,
    meta.naverVerification &&
      `<meta name="naver-site-verification" content="${meta.naverVerification}" />`,
    `<meta property="og:type" content="${meta.ogType}" />`,
    `<meta property="og:locale" content="${ogLocale(l)}" />`,
    ...others.map((x) => `<meta property="og:locale:alternate" content="${ogLocale(x)}" />`),
    `<meta property="og:site_name" content="${esc(s.brand)}" />`,
    `<meta property="og:title" content="${esc(meta.ogTitle)}" />`,
    `<meta property="og:description" content="${esc(meta.ogDescription)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${site.origin}/og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.twitterTitle)}" />`,
    `<meta name="twitter:description" content="${esc(meta.twitterDescription)}" />`,
    `<meta name="twitter:image" content="${site.origin}/og.png" />`,
    `<link rel="preconnect" href="https://fonts.googleapis.com" />`,
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`,
    `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+KR:wght@400;500;700${s.font ? `&family=${s.font}` : ''}&display=swap" rel="stylesheet" />`,
    `<link rel="icon" href="/favicon.ico" sizes="any" />`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`,
    `<link rel="stylesheet" href="/style.css?v=${site.assetVersion}" />`,
    slots.head
  ].filter(Boolean)

  const nav = [
    ...(slots.nav ? slots.nav.split('\n') : []),
    ...others.map(
      (x) =>
        `<a href="${pathOf(x.code, page)}" class="lang" lang="${x.code}" hreflang="${x.code}">${strings[x.code].navLabel}</a>`
    ),
    `<a href="${site.downloadUrl}" class="nav-dl" data-dl>${s.download}</a>`
  ]
  const footLinks =
    (slots.footer ? slots.footer.split('\n').join('') : '') +
    others.map((x) => `<a href="${pathOf(x.code, page)}" lang="${x.code}">${x.label}</a>`).join('')

  const html = `<!DOCTYPE html>
<html lang="${lang}" dir="${l.dir}">
<head>
${indent(head.join('\n'), 2)}
</head>
<body>
  <nav class="nav" aria-label="${esc(s.navAria)}">
    <div class="nav-inner">
      <a href="${pathOf(lang, 'home')}" class="brand"><img class="brand-mark" src="/apple-touch-icon.png" alt="" width="24" height="24" /><span class="brand-name">${s.brand}</span></a>
      <div class="nav-right">
${indent(nav.join('\n'), 8)}
      </div>
    </div>
  </nav>

${indent(slots.main || '', 2)}

  <footer class="wrap">
    <div class="foot"><div class="foot-left">© ${site.updated.slice(0, 4)} ${s.copyright}</div><div class="foot-links">${footLinks}</div></div>
${slots['after-footer'] ? indent(slots['after-footer'], 4) + '\n' : ''}  </footer>
${slots.scripts ? indent(slots.scripts, 2) + '\n' : ''}  <script src="/demo.js?v=${site.assetVersion}" defer></script>
</body>
</html>
`
  return fill(html.replaceAll('{{downloadButtons}}', downloadButtons(s)))
}

function sitemap() {
  const entries = []
  for (const page of Object.keys(site.pages)) {
    for (const l of langsWith(page)) {
      const alts = [
        ...langsWith(page).map(
          (x) =>
            `    <xhtml:link rel="alternate" hreflang="${x.code}" href="${urlOf(x.code, page)}" />`
        ),
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${urlOf(site.defaultLang, page)}" />`
      ]
      entries.push(
        `  <url>\n    <loc>${urlOf(l.code, page)}</loc>\n${alts.join('\n')}\n    <lastmod>${site.updated}</lastmod>\n  </url>`
      )
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`
}

const outputs = new Map()
for (const l of langs) {
  for (const page of Object.keys(pages[l.code]))
    outputs.set(fileOf(l.code, page), render(l.code, page))
}
outputs.set('sitemap.xml', sitemap())

if (args.has('--check')) {
  const stale = []
  for (const [file, content] of outputs) {
    const path = join(OUT, file)
    if (!existsSync(path) || (await readFile(path, 'utf8')) !== content) stale.push(file)
  }
  if (stale.length) {
    console.error(`website/가 site/와 다름: ${stale.join(', ')}\nnpm run build:site 실행 후 커밋`)
    process.exit(1)
  }
  console.log(`site ok: ${outputs.size} files up to date`)
} else {
  for (const [file, content] of outputs) {
    await mkdir(dirname(join(OUT, file)), { recursive: true })
    await writeFile(join(OUT, file), content)
  }
  console.log(`site built: ${outputs.size} files (v${version}, ${site.updated})`)
}
