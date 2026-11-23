// Pure A4 layout; print this document with Electron webContents.printToPDF({ pageSize: 'A4' }).
// Call only with validateReportOutput() output, never raw LLM HTML.
const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

export function renderReportHtml(report) {
  const safe = escapeHtml
  const stocks = report.stocks.map((s) => safe(`${s.market}:${s.symbol}`)).join(' · ')
  const sourceNumbers = new Map(report.sources.map((source, index) => [source.id, index + 1]))
  const highlights = report.highlights
    .map((item) => {
      const refs = item.sourceIds.map((id) => sourceNumbers.get(id)).filter(Boolean)
      return `<li>${safe(item.text)} <small>[${refs.join(', ')}]</small></li>`
    })
    .join('')
  const watchItems = report.watchItems.map((item) => `<li>${safe(item)}</li>`).join('')
  const sources = report.sources
    .map(
      (item, i) =>
        `<li><span>[${i + 1}] ${safe(item.publisher)} · ${safe(item.publishedAt.slice(0, 16).replace('T', ' '))} UTC · ${safe(item.evidenceLevel === 'headline-only' ? '제목·메타데이터만 확인' : '이용 허가된 발췌 자료')}</span><a href="${safe(item.url)}">${safe(item.title)}</a></li>`
    )
    .join('')
  return `<!doctype html>
<html lang="${safe(report.locale)}">
<head><meta charset="utf-8"><title>Stock Peek AI Report</title>
<style>
@page { size: A4; margin: 13mm 15mm; }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; background:#fff; color:#1d2430; font-family: Arial, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; font-size:10pt; line-height:1.48; }
header { border-bottom:2px solid #27364d; padding-bottom:9px; display:flex; justify-content:space-between; align-items:baseline; }
h1 { font-size:17pt; margin:0; letter-spacing:-.025em; }
h2 { font-size:10.5pt; margin:12px 0 4px; color:#27364d; }
.meta { color:#667085; font-size:8pt; }
p { margin:4px 0 7px; white-space:pre-wrap; }
ul { padding-left:19px; margin:5px 0; }
li { margin-bottom:5px; }
small { color:#667085; font-size:7pt; }
.summary { background:#f3f5f8; padding:10px 12px; border-radius:4px; margin-top:12px; }
.sources { list-style:none; padding:0; font-size:7.5pt; overflow-wrap:anywhere; }
.sources li { margin-bottom:3px; }
.sources span { display:block; color:#667085; }
a { color:#263d62; text-decoration:none; }
footer { border-top:1px solid #d5dce5; margin-top:12px; padding-top:6px; color:#667085; font-size:7.3pt; }
</style></head>
<body>
<header><h1>STOCK PEEK <span style="font-size:11pt">/ AI REPORT</span></h1><div class="meta">${safe(report.asOf.slice(0, 16).replace('T', ' '))} UTC</div></header>
<p class="meta">관심 종목: ${stocks}</p>
<section class="summary"><strong>오늘의 요약</strong><p>${safe(report.summary)}</p></section>
<section><h2>새로운 소식 및 변화</h2>${highlights ? `<ul>${highlights}</ul>` : '<p>확인된 신규 근거 자료가 없습니다. 임의로 변화를 생성하지 않았습니다.</p>'}</section>
${report.portfolioNote ? `<section><h2>내 포트폴리오 관점 (선택 정보)</h2><p>${safe(report.portfolioNote)}</p></section>` : ''}
<section><h2>추가로 확인할 항목</h2>${watchItems ? `<ul>${watchItems}</ul>` : '<p>추가 확인 항목이 없습니다.</p>'}</section>
<section><h2>근거 및 자료 시각</h2>${sources ? `<ul class="sources">${sources}</ul>` : '<p class="meta">선택한 종목에 대해 확인된 자료 없음</p>'}</section>
<footer>이 문서는 자료 탐색을 돕는 정보 요약이며 투자자문 또는 매수·매도 지시가 아닙니다. 기사 제목만으로 본문 내용이 검증되지는 않습니다. 사용한 자료의 출처·시각·이용 권한을 별도로 확인하세요.</footer>
</body></html>`
}
