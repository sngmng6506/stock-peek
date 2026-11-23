import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'

const MAX_STOCKS = 5

export default function AiAnalysisModal({ onClose }) {
  const { t } = useI18n()
  const closeRef = useRef(null)
  const [stocks, setStocks] = useState([])
  const [selected, setSelected] = useState([])
  const [thesis, setThesis] = useState({ text: '', horizon: 'unspecified', focus: 'balanced' })
  const [includeHoldings, setIncludeHoldings] = useState(false)
  const [includeHistory, setIncludeHistory] = useState(false)
  const [includeThesis, setIncludeThesis] = useState(false)
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    closeRef.current?.focus()
    let active = true
    window.api
      .getAiContext()
      .then((data) => {
        if (!active) return
        const list = Array.isArray(data?.stocks) ? data.stocks : []
        setStocks(list)
        setSelected(list.slice(0, MAX_STOCKS).map((item) => item.market + ':' + item.symbol))
        if (data?.thesis)
          setThesis({
            text: data.thesis.text || '',
            horizon: data.thesis.horizon || 'unspecified',
            focus: data.thesis.focus || 'balanced'
          })
      })
      .catch(() => {
        if (active) setStatus('error')
      })
    return () => {
      active = false
    }
  }, [])

  function changeSelected(key) {
    setPreview(null)
    setStatus('')
    setSelected((current) =>
      current.includes(key)
        ? current.filter((x) => x !== key)
        : current.length < MAX_STOCKS
          ? [...current, key]
          : current
    )
  }

  async function saveThesis() {
    if (busy) return
    setBusy(true)
    setStatus('')
    setPreview(null)
    try {
      const saved = await window.api.saveInvestmentThesis(thesis)
      setThesis({ text: saved.text, horizon: saved.horizon, focus: saved.focus })
      setStatus('saved')
    } catch {
      setStatus('error')
    } finally {
      setBusy(false)
    }
  }

  async function makePreview() {
    if (busy || !selected.length) return
    setBusy(true)
    setStatus('')
    setPreview(null)
    try {
      const result = await window.api.buildAiPreview({
        selectedKeys: selected,
        includeHoldings,
        includeHistory,
        includeThesis,
        lookbackDays: 90,
        ...(includeThesis ? { thesisDraft: thesis } : {})
      })
      setPreview(result)
      setStatus('preview')
    } catch {
      setStatus('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div
        className="modal ai-analysis-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-title"
      >
        <header className="ai-modal-header">
          <h2 id="ai-title">{t('ai.title')}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('settings.close')}>
            ×
          </button>
        </header>
        <p className="ai-hint">{t('ai.previewOnly')}</p>
        <div className="ai-section">
          <strong>{t('ai.stocks')}</strong>
          <p className="ai-hint">{t('ai.stockLimit')}</p>
          {stocks.map((stock) => {
            const key = stock.market + ':' + stock.symbol
            return (
              <label className="ai-stock-row" key={key}>
                <input
                  type="checkbox"
                  checked={selected.includes(key)}
                  onChange={() => changeSelected(key)}
                  disabled={!selected.includes(key) && selected.length >= MAX_STOCKS}
                />
                <span>{key}</span>
              </label>
            )
          })}
          {!stocks.length && <p className="ai-hint">{t('ai.noStocks')}</p>}
        </div>
        <div className="ai-section">
          <strong>{t('ai.thesis')}</strong>
          <textarea
            className="ai-textarea"
            value={thesis.text}
            maxLength={1200}
            placeholder={t('ai.thesisPlaceholder')}
            onChange={(event) => {
              setThesis((v) => ({ ...v, text: event.target.value }))
              setPreview(null)
            }}
            rows={3}
          />
          <label className="ai-field-label">
            {t('ai.horizon')}
            <select
              value={thesis.horizon}
              onChange={(event) => {
                setThesis((v) => ({ ...v, horizon: event.target.value }))
                setPreview(null)
              }}
            >
              {['unspecified', 'short', 'medium', 'long'].map((value) => (
                <option key={value} value={value}>
                  {t('ai.horizon.' + value)}
                </option>
              ))}
            </select>
          </label>
          <label className="ai-field-label">
            {t('ai.focus')}
            <select
              value={thesis.focus}
              onChange={(event) => {
                setThesis((v) => ({ ...v, focus: event.target.value }))
                setPreview(null)
              }}
            >
              {['balanced', 'fundamentals', 'industry', 'risks'].map((value) => (
                <option key={value} value={value}>
                  {t('ai.focus.' + value)}
                </option>
              ))}
            </select>
          </label>
          <button className="ai-secondary" type="button" disabled={busy} onClick={saveThesis}>
            {t('ai.saveThesis')}
          </button>
        </div>
        <div className="ai-section">
          <strong>{t('ai.optionalData')}</strong>
          <label className="ai-stock-row">
            <input
              type="checkbox"
              checked={includeHoldings}
              onChange={(event) => {
                setIncludeHoldings(event.target.checked)
                setPreview(null)
              }}
            />
            <span>{t('ai.includeHoldings')}</span>
          </label>
          <label className="ai-stock-row">
            <input
              type="checkbox"
              checked={includeHistory}
              onChange={(event) => {
                setIncludeHistory(event.target.checked)
                setPreview(null)
              }}
            />
            <span>{t('ai.includeHistory')}</span>
          </label>
          <label className="ai-stock-row">
            <input
              type="checkbox"
              checked={includeThesis}
              onChange={(event) => {
                setIncludeThesis(event.target.checked)
                setPreview(null)
              }}
            />
            <span>{t('ai.includeThesis')}</span>
          </label>
          <p className="ai-hint">{t('ai.privacy')}</p>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t('holding.cancel')}
          </button>
          <button
            className="primary"
            type="button"
            onClick={makePreview}
            disabled={busy || selected.length === 0}
          >
            {t('ai.preview')}
          </button>
        </div>
        {status && (
          <p className="ai-hint" role="status">
            {t('ai.status.' + status)}
          </p>
        )}
        {preview && (
          <section className="ai-section" aria-label={t('ai.preview')}>
            <p className="ai-hint">{t('ai.payloadDescription')}</p>
            <pre className="ai-preview">{JSON.stringify(preview.request, null, 2)}</pre>
          </section>
        )}
      </div>
    </div>
  )
}
