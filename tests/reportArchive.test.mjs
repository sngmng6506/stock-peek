import test from 'node:test'
import assert from 'node:assert/strict'
import { createReportArchive } from '../src/shared/reportArchive.js'
import { renderReportHtml, countPdfPages } from '../src/shared/reportHtml.js'

const report = (over = {}) => ({
  schemaVersion: 1,
  status: 'generated_unbilled',
  dataLevel: 'filing_metadata_only',
  asOf: '2026-11-25T00:00:00.000Z',
  periodStart: '2026-10-26T00:00:00.000Z',
  locale: 'ko',
  stocks: [{ market: 'KR', symbol: '005930', key: 'KR:005930' }],
  summary: 'Official filing metadata for 1 recent filing(s) was found.',
  highlights: [{ text: 'KR:005930: OpenDART published <분기보고서>.', sourceIds: ['dart:1'] }],
  watchItems: ['Open the original filings.'],
  portfolioNote: null,
  sources: [
    {
      id: 'dart:1',
      kind: 'filing',
      title: '분기보고서 (2026.09)',
      publisher: 'OpenDART',
      publishedAt: '2026-11-13T15:00:00.000Z',
      precision: 'date',
      url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261114000001',
      stockKeys: ['KR:005930'],
      evidenceLevel: 'filing-metadata'
    }
  ],
  coverage: [{ key: 'KR:005930', status: 'ok' }],
  noNewEvents: false,
  ...over
})

function memoryArchive(limit) {
  let data = null
  let n = 0
  const archive = createReportArchive({
    read: () => data,
    write: (v) => {
      data = structuredClone(v)
    },
    makeId: () => 'report-' + String(++n).padStart(4, '0'),
    now: () => `2026-11-25T00:00:0${n}.000Z`,
    limit
  })
  return { archive, raw: () => data }
}

test('archive stores newest first, caps size and deletes by id', () => {
  const { archive } = memoryArchive(2)
  archive.add(report())
  archive.add(report({ summary: 'second' }))
  archive.add(report({ summary: 'third' }))
  const list = archive.list()
  assert.deepEqual(
    list.map((x) => x.summary),
    ['third', 'second']
  )
  assert.equal(archive.get(list[0].id).report.summary, 'third')
  archive.remove(list[1].id)
  assert.equal(archive.list().length, 1)
  assert.throws(() => archive.get('missing-id'), /ERR_REPORT_NOT_FOUND/)
  assert.throws(() => archive.remove('missing-id'), /ERR_REPORT_NOT_FOUND/)
})

test('archive refuses unknown storage versions instead of overwriting them', () => {
  const archive = createReportArchive({
    read: () => ({ schemaVersion: 99, entries: [] }),
    write: () => assert.fail('must not write'),
    makeId: () => 'report-0001'
  })
  assert.throws(() => archive.list(), /ERR_REPORT_ARCHIVE/)
  assert.throws(() => archive.add(report()), /ERR_REPORT_ARCHIVE/)
})

test('filing report renders escaped, localized, script-free A4 HTML', () => {
  const ko = renderReportHtml(report())
  assert.match(ko, /@page \{ size: A4/)
  assert.match(ko, /공시 제목·접수일만 확인/)
  assert.match(ko, /베타 · 무과금/)
  // DART date-only filing stamped at KST midnight keeps its Korean filing date.
  assert.match(ko, /2026\. 11\. 14\./)
  assert.match(ko, /&lt;분기보고서&gt;/)
  assert.doesNotMatch(ko, /<script/i)
  assert.match(ko, /default-src 'none'/)

  const en = renderReportHtml(report(), { lang: 'en' })
  assert.match(en, /What changed/)
  assert.match(en, /Filing title and date only/)

  const ar = renderReportHtml(report({ coverage: [{ key: 'KR:005930', status: 'unavailable' }] }), {
    lang: 'ar'
  })
  assert.match(ar, /dir="rtl"/)
  assert.match(ar, /تعذر الحصول على بيانات: KR:005930/)

  assert.match(renderReportHtml(report(), { compact: true }), /font-size:9pt/)
})

test('countPdfPages counts page objects but not the page tree', () => {
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>\n' +
      '2 0 obj << /Type /Page /Parent 1 0 R >>\n3 0 obj <</Type/Page/Parent 1 0 R>>\n'
  )
  assert.equal(countPdfPages(pdf), 2)
})
