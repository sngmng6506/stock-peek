// Local snapshot archive of generated reports. A stored report is never rewritten when
// new filings appear; re-opening or re-printing it does not call the server again.
export const REPORT_ARCHIVE_VERSION = 1
export const REPORT_ARCHIVE_LIMIT = 20

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/

function isEntry(entry) {
  return (
    entry &&
    typeof entry === 'object' &&
    ID_PATTERN.test(entry.id) &&
    typeof entry.createdAt === 'string' &&
    entry.report?.schemaVersion === 1 &&
    Array.isArray(entry.report.stocks)
  )
}

export function summarizeEntry(entry) {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    asOf: entry.report.asOf,
    stocks: entry.report.stocks.map((s) => s.key),
    noNewEvents: entry.report.noNewEvents === true,
    summary: entry.report.summary
  }
}

export function createReportArchive({
  read,
  write,
  makeId,
  now = () => new Date().toISOString(),
  limit = REPORT_ARCHIVE_LIMIT
}) {
  function load() {
    const data = read()
    if (data == null) return []
    if (data.schemaVersion !== REPORT_ARCHIVE_VERSION || !Array.isArray(data.entries))
      throw new Error('ERR_REPORT_ARCHIVE')
    return data.entries.filter(isEntry)
  }
  function save(entries) {
    write({ schemaVersion: REPORT_ARCHIVE_VERSION, entries })
  }
  function list() {
    return load().map(summarizeEntry)
  }
  function get(id) {
    const entry = load().find((e) => e.id === id)
    if (!entry) throw new Error('ERR_REPORT_NOT_FOUND')
    return entry
  }
  function add(report) {
    const entry = { id: makeId(), createdAt: now(), report }
    if (!isEntry(entry)) throw new Error('ERR_REPORT_ARCHIVE')
    // Newest first; oldest snapshots fall off once the local limit is reached.
    save([entry, ...load()].slice(0, limit))
    return entry
  }
  function remove(id) {
    const entries = load()
    const next = entries.filter((e) => e.id !== id)
    if (next.length === entries.length) throw new Error('ERR_REPORT_NOT_FOUND')
    save(next)
    return next.map(summarizeEntry)
  }
  function clear() {
    save([])
  }
  return { list, get, add, remove, clear }
}
