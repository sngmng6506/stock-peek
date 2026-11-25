// Pure A4 layout; print this document with Electron webContents.printToPDF({ pageSize: 'A4' }).
// Call only with validated report objects (validateReportOutput / normalizeAnalysisResult),
// never raw LLM HTML. The document needs no JavaScript and loads no external resources.
import { translate } from './i18n/index.js'
import { getLanguageInfo, isSupportedLanguage } from './languages.js'

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

// Date-only filings are stamped at local midnight of the filing authority.
const SOURCE_TIME_ZONE = { OpenDART: 'Asia/Seoul', 'U.S. SEC EDGAR': 'UTC' }

function formatter(locale, options) {
  try {
    // Filings and exchanges use Gregorian dates; avoid locale default calendars (ar-SA = Hijri).
    return new Intl.DateTimeFormat(locale + '-u-ca-gregory-nu-latn', options)
  } catch {
    return new Intl.DateTimeFormat('en-US', options)
  }
}

export function renderReportHtml(report, { lang, compact = false } = {}) {
  const code = isSupportedLanguage(lang)
    ? lang
    : isSupportedLanguage(report.locale)
      ? report.locale
      : 'ko'
  const info = getLanguageInfo(code)
  const t = (key, vars) => translate(code, key, vars)
  const safe = escapeHtml
  const dateTime = formatter(info.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  })
  const dateOnly = (iso, zone = 'UTC') =>
    formatter(info.locale, { dateStyle: 'medium', timeZone: zone }).format(new Date(iso))
  const stamp = (iso) => `${dateTime.format(new Date(iso))} UTC`

  const stocks = report.stocks.map((s) => safe(`${s.market}:${s.symbol}`)).join(' · ')
  const sourceNumbers = new Map(report.sources.map((source, index) => [source.id, index + 1]))
  const highlights = report.highlights
    .map((item) => {
      const refs = item.sourceIds.map((id) => sourceNumbers.get(id)).filter(Boolean)
      return `<li><bdi>${safe(item.text)}</bdi> <small>[${refs.join(', ')}]</small></li>`
    })
    .join('')
  const watchItems = report.watchItems.map((item) => `<li><bdi>${safe(item)}</bdi></li>`).join('')
  const sources = report.sources
    .map((item, i) => {
      const when =
        item.precision === 'date'
          ? dateOnly(item.publishedAt, SOURCE_TIME_ZONE[item.publisher] || 'UTC')
          : stamp(item.publishedAt)
      const level = t('report.level.' + item.evidenceLevel)
      return `<li><span class="src-meta">[${i + 1}] ${safe(item.publisher)} · ${safe(when)}</span> <a href="${safe(item.url)}"><bdi>${safe(item.title)}</bdi></a> <span class="src-meta">· ${safe(level)}</span></li>`
    })
    .join('')
  const gaps = (report.coverage || []).filter((c) => c.status === 'unavailable').map((c) => c.key)
  const period = report.periodStart
    ? `${dateOnly(report.periodStart)} – ${dateOnly(report.asOf)}`
    : null
  const base = compact ? 9 : 10
  return `<!doctype html>
<html lang="${safe(code)}" dir="${safe(info.dir)}">
<head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Stock Peek ${safe(t('report.title'))}</title>
<style>
@page { size: A4; margin: ${compact ? '10mm 12mm' : '13mm 15mm'}; }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; background:#fff; color:#1d2430; font-family: Arial, "Malgun Gothic", "Apple SD Gothic Neo", "Hiragino Sans", "Yu Gothic", "Segoe UI", "Geeza Pro", Tahoma, sans-serif; font-size:${base}pt; line-height:${compact ? 1.4 : 1.48}; }
header { border-bottom:2px solid #27364d; padding-bottom:9px; display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
h1 { font-size:17pt; margin:0; letter-spacing:-.025em; }
h1 span { font-size:11pt; }
h2 { font-size:${base + 0.5}pt; margin:${compact ? 9 : 12}px 0 4px; color:#27364d; }
.meta { color:#667085; font-size:8pt; }
.badge { display:inline-block; border:1px solid #98a2b3; border-radius:3px; padding:0 5px; margin-inline-start:6px; }
p { margin:4px 0 7px; white-space:pre-wrap; }
ul { padding-inline-start:19px; margin:5px 0; }
li { margin-bottom:${compact ? 3 : 5}px; }
small { color:#667085; font-size:7pt; }
.summary { background:#f3f5f8; padding:10px 12px; border-radius:4px; margin-top:12px; }
.sources { list-style:none; padding:0; font-size:7.5pt; line-height:1.35; overflow-wrap:anywhere; column-count:2; column-gap:14px; }
.sources li { margin-bottom:3px; break-inside:avoid; }
.src-meta { color:#667085; }
a { color:#263d62; text-decoration:none; }
@media screen { body { max-width:210mm; margin:0 auto; padding:14mm 15mm; } }
footer { border-top:1px solid #d5dce5; margin-top:12px; padding-top:6px; color:#667085; font-size:7.3pt; }
</style></head>
<body>
<header><h1>STOCK PEEK <span>/ ${safe(t('report.title'))}</span></h1><div class="meta">${safe(t('report.generatedAt', { v: stamp(report.asOf) }))}${report.status === 'generated_unbilled' ? `<span class="badge">${safe(t('report.beta'))}</span>` : ''}</div></header>
<p class="meta">${safe(t('report.stocks'))}: <bdi>${stocks}</bdi>${period ? ` · ${safe(t('report.period', { v: period }))}` : ''}</p>
<section class="summary"><strong>${safe(t('report.summary'))}</strong><p><bdi>${safe(report.summary)}</bdi></p></section>
<section><h2>${safe(t('report.changes'))}</h2>${highlights ? `<ul>${highlights}</ul>` : `<p>${safe(t('report.noChanges'))}</p>`}</section>
${report.portfolioNote ? `<section><h2>${safe(t('report.portfolio'))}</h2><p><bdi>${safe(report.portfolioNote)}</bdi></p></section>` : ''}
<section><h2>${safe(t('report.watch'))}</h2>${watchItems ? `<ul>${watchItems}</ul>` : `<p>${safe(t('report.noWatch'))}</p>`}</section>
<section><h2>${safe(t('report.sources'))}</h2>${gaps.length ? `<p class="meta">${safe(t('report.coverageGap', { v: gaps.join(', ') }))}</p>` : ''}${sources ? `<ul class="sources">${sources}</ul>` : `<p class="meta">${safe(t('report.noSources'))}</p>`}</section>
<footer>${safe(t('report.disclaimer'))}</footer>
</body></html>`
}

// Page count of a Chromium-generated PDF (uncompressed page tree objects).
export function countPdfPages(buffer) {
  const text = Buffer.from(buffer).toString('latin1')
  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length
}
