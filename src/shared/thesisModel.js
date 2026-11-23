// Pure persisted user preference contract; thesis is a hypothesis, never a fact.
export const THESIS_VERSION = 1
export const THESIS_MAX_LENGTH = 1200

export function normalizeThesis(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ERR_THESIS_FORMAT')
  const text = raw.text
  if (typeof text !== 'string' || text.length > THESIS_MAX_LENGTH)
    throw new Error('ERR_THESIS_TEXT')
  const horizon = raw.horizon
  const focus = raw.focus
  if (!['unspecified', 'short', 'medium', 'long'].includes(horizon))
    throw new Error('ERR_THESIS_HORIZON')
  if (!['balanced', 'fundamentals', 'industry', 'risks'].includes(focus))
    throw new Error('ERR_THESIS_FOCUS')
  return { schemaVersion: THESIS_VERSION, text: text.trim(), horizon, focus }
}

export const EMPTY_THESIS = Object.freeze({
  schemaVersion: THESIS_VERSION,
  text: '',
  horizon: 'unspecified',
  focus: 'balanced'
})

export function createThesisRepository({ read, write, now = () => new Date().toISOString() }) {
  function get() {
    const data = read()
    if (data == null) return { ...EMPTY_THESIS, updatedAt: null }
    if (data.schemaVersion !== THESIS_VERSION) throw new Error('ERR_THESIS_VERSION')
    return { ...normalizeThesis(data), updatedAt: data.updatedAt || null }
  }
  function save(input) {
    const current = get()
    const next = normalizeThesis(input)
    const compare = ({ text, horizon, focus }) => JSON.stringify({ text, horizon, focus })
    if (compare(current) === compare(next)) return current
    const result = { ...next, updatedAt: now() }
    write(result)
    return result
  }
  return { get, save }
}
