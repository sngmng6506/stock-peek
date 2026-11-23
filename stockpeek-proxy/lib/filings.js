// Official filing provider adapters. No personal portfolio data is sent to issuers.
// All network I/O is injected for predictable offline tests and backend deployment.
const SEC_TICKERS = 'https://www.sec.gov/files/company_tickers_exchange.json'
const SEC_BASE = 'https://data.sec.gov/submissions'
const DART_BASE = 'https://opendart.fss.or.kr/api/list.json'

const iso = (value) => {
  const n = Date.parse(value)
  return Number.isFinite(n) ? new Date(n).toISOString() : null
}
const ymd = (time) => new Date(time).toISOString().slice(0, 10).replaceAll('-', '')
function error(code) {
  throw new Error(code)
}
function correctStock(stock) {
  if (!stock || !['KR', 'US'].includes(stock.market) || !/^[A-Z0-9.&-]{1,20}$/.test(stock.symbol))
    error('ERR_FILING_UNSUPPORTED')
}
function safeAccession(value) {
  return typeof value === 'string' && /^\d{10}-\d{2}-\d{6}$/.test(value)
}
function safeDoc(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]+\.(htm|html|txt)$/i.test(value)
}
function cikNumber(raw) {
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 && n < 10000000000 ? n : null
}
export function findSecCik(payload, ticker) {
  const fields = payload?.fields
  const rows = payload?.data
  if (!Array.isArray(fields) || !Array.isArray(rows)) error('ERR_SEC_MAPPING')
  const ti = fields.indexOf('ticker'),
    ci = fields.indexOf('cik')
  if (ti < 0 || ci < 0) error('ERR_SEC_MAPPING')
  const matches = rows.filter(
    (row) => typeof row?.[ti] === 'string' && row[ti].toUpperCase() === ticker.toUpperCase()
  )
  const ciks = [...new Set(matches.map((row) => cikNumber(row[ci])).filter(Boolean))]
  if (ciks.length !== 1) error('ERR_SEC_UNMAPPED')
  return String(ciks[0]).padStart(10, '0')
}

export function parseSecSubmissions(payload, stock, asOf, since) {
  const cik = cikNumber(payload?.cik)
  if (!cik || !payload?.filings?.recent) error('ERR_SEC_RESPONSE')
  const r = payload.filings.recent
  const lists = ['accessionNumber', 'form', 'primaryDocument', 'filingDate']
  if (lists.some((name) => !Array.isArray(r[name]))) error('ERR_SEC_RESPONSE')
  const out = []
  const cutoff = Date.parse(since),
    latest = Date.parse(asOf)
  for (let i = 0; i < Math.min(r.form.length, 400); i++) {
    const accession = r.accessionNumber[i],
      doc = r.primaryDocument[i],
      form = r.form[i]
    const filingDate = r.filingDate[i]
    if (
      !safeAccession(accession) ||
      !safeDoc(doc) ||
      typeof filingDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(filingDate) ||
      !/^\d{1,4}[A-Z/-]{0,10}$/.test(form)
    )
      continue
    // SEC acceptanceDateTime is a filing time when available; otherwise date-only precision.
    // The response's acceptanceDateTime has no explicit timezone; do not invent UTC.
    const time = iso(filingDate + 'T00:00:00Z')
    if (!time || Date.parse(time) > latest || Date.parse(time) < cutoff) continue
    const url =
      'https://www.sec.gov/Archives/edgar/data/' +
      cik +
      '/' +
      accession.replaceAll('-', '') +
      '/' +
      doc
    out.push({
      id: 'sec:' + accession,
      kind: 'filing',
      title: 'SEC Form ' + form,
      publisher: 'U.S. SEC EDGAR',
      publishedAt: time,
      precision: 'date',
      url,
      stockKeys: [stock.market + ':' + stock.symbol],
      evidenceLevel: 'filing-metadata',
      accession,
      form
    })
  }
  return out
}

export function parseDartList(payload, stock, asOf, since) {
  if (payload?.status === '013') return []
  if (payload?.status !== '000' || !Array.isArray(payload.list)) error('ERR_DART_RESPONSE')
  const out = []
  const min = Date.parse(since),
    max = Date.parse(asOf)
  for (const item of payload.list) {
    const id = item?.rcept_no,
      name = item?.report_nm,
      date = item?.rcept_dt
    if (
      !/^\d{14}$/.test(id) ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 240 ||
      !/^\d{8}$/.test(date)
    )
      continue
    // DART provides a filing date, not a trustworthy intraday publication time.
    const time = iso(
      date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6) + 'T00:00:00+09:00'
    )
    if (!time || Date.parse(time) < min || Date.parse(time) > max) continue
    out.push({
      id: 'dart:' + id,
      kind: 'filing',
      title: name.trim(),
      publisher: 'OpenDART',
      publishedAt: time,
      precision: 'date',
      url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + id,
      stockKeys: [stock.market + ':' + stock.symbol],
      evidenceLevel: 'filing-metadata',
      accession: id
    })
  }
  return out
}

export function createOfficialFilingProvider({
  fetchJson,
  secUserAgent,
  dartApiKey,
  dartCorpMap = {}
}) {
  if (typeof fetchJson !== 'function') error('ERR_FILING_FETCH')
  const usAgent = typeof secUserAgent === 'string' ? secUserAgent.trim() : ''
  async function us(stock, context) {
    if (!usAgent || !usAgent.includes('@')) error('ERR_SEC_USER_AGENT')
    const headers = { 'User-Agent': usAgent, Accept: 'application/json' }
    const mapping = await fetchJson(SEC_TICKERS, { headers })
    const cik = findSecCik(mapping, stock.symbol)
    const submissions = await fetchJson(SEC_BASE + '/CIK' + cik + '.json', { headers })
    return parseSecSubmissions(submissions, stock, context.asOf, context.since)
  }
  async function kr(stock, context) {
    if (!dartApiKey) error('ERR_DART_KEY')
    const corp = dartCorpMap[stock.symbol]
    if (typeof corp !== 'string' || !/^\d{8}$/.test(corp)) error('ERR_DART_UNMAPPED')
    const u = new URL(DART_BASE)
    u.searchParams.set('crtfc_key', dartApiKey)
    u.searchParams.set('corp_code', corp)
    u.searchParams.set('bgn_de', ymd(context.since))
    u.searchParams.set('end_de', ymd(context.asOf))
    u.searchParams.set('page_count', '100')
    u.searchParams.set('page_no', '1')
    const response = await fetchJson(u.toString())
    // Don't falsely report complete coverage when API pagination has more pages.
    if (response?.status === '000' && Number(response.total_page) > 1) error('ERR_DART_PAGINATION')
    return parseDartList(response, stock, context.asOf, context.since)
  }
  return {
    async collect(stock, context) {
      correctStock(stock)
      if (stock.market === 'US') return us(stock, context)
      return kr(stock, context)
    }
  }
}
