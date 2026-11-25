import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { errorText } from '../lib/errors'
import { getLanguageInfo } from '../../../shared/languages.js'
import ProAccount from './ProAccount'

const MAX_STOCKS = 5
const MAX_LISTED_REPORTS = 5

export default function AiAnalysisModal({ onClose }) {
  const { t, lang } = useI18n()
  const closeRef = useRef(null)
  const [stocks, setStocks] = useState([])
  const [selected, setSelected] = useState([])
  const [thesis, setThesis] = useState({ text: '', horizon: 'unspecified', focus: 'balanced' })
  const [includeHoldings, setIncludeHoldings] = useState(false)
  const [includeHistory, setIncludeHistory] = useState(false)
  const [includeThesis, setIncludeThesis] = useState(false)
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [pro, setPro] = useState({ available: false })
  const [reports, setReports] = useState([])

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
    window.api
      .listAiReports()
      .then((items) => active && setReports(items))
      .catch(() => {})
    window.api
      .getProStatus()
      .then((value) => active && setPro(value || { available: false }))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  function changeSelected(key) {
    setPreview(null)
    setStatus('')
    setSelected((current) => {
      const valid = current.filter((k) => supported(k.split(':')[0]))
      if (valid.includes(key)) return valid.filter((x) => x !== key)
      return valid.length < MAX_STOCKS ? [...valid, key] : valid
    })
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
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  async function makePreview() {
    if (busy || !activeSelected.length) return
    setBusy(true)
    setStatus('')
    setPreview(null)
    try {
      const result = await window.api.buildAiPreview({
        selectedKeys: activeSelected,
        includeHoldings,
        includeHistory,
        includeThesis,
        lookbackDays: 90,
        ...(includeThesis ? { thesisDraft: thesis } : {})
      })
      setPreview(result)
      setStatus('preview')
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  function showError(error) {
    setErrorMessage(error ? errorText(error, t) : '')
    setStatus('error')
  }

  async function run(task) {
    if (busy) return
    setBusy(true)
    setErrorMessage('')
    try {
      await task()
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  function generate() {
    if (!preview) return
    setStatus('generating')
    return run(async () => {
      const result = await window.api.createAiReport({
        selectedKeys: activeSelected,
        includeHoldings,
        includeHistory,
        includeThesis,
        lookbackDays: 90,
        ...(includeThesis ? { thesisDraft: thesis } : {})
      })
      setReports(result.reports)
      setPreview(null)
      setStatus('generated')
      setPro(await window.api.getProStatus())
    })
  }

  function savePdf(id) {
    setStatus('')
    return run(async () => {
      const result = await window.api.saveAiReportPdf(id)
      if (result?.status === 'saved') setStatus('pdfSaved')
    })
  }

  function openReport(id) {
    setStatus('')
    return run(() => window.api.openAiReport(id))
  }

  function deleteReport(id) {
    setStatus('')
    return run(async () => {
      setReports(await window.api.deleteAiReport(id))
      setStatus('deleted')
    })
  }

  const dateFormat = new Intl.DateTimeFormat(getLanguageInfo(lang).locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
  const supported = (market) => !pro.available || pro.markets.includes(market)
  const credits = pro.account?.credits?.available ?? 0
  // Reports cover a subset of markets; unsupported stocks are never sent.
  const activeSelected = selected.filter((key) => supported(key.split(':')[0]))
  const canGenerate = pro.available && pro.reports && !!pro.account && credits > 0

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
        <p className="ai-hint">{t(pro.available ? 'ai.proHint' : 'ai.previewOnly')}</p>
        {pro.available && <ProAccount pro={pro} onChange={setPro} busy={busy} setBusy={setBusy} />}
        <div className="ai-section">
          <strong>{t('ai.stocks')}</strong>
          <p className="ai-hint">{t('ai.stockLimit')}</p>
          {stocks.map((stock) => {
            const key = stock.market + ':' + stock.symbol
            const allowed = supported(stock.market)
            return (
              <label className="ai-stock-row" key={key}>
                <input
                  type="checkbox"
                  checked={activeSelected.includes(key)}
                  onChange={() => changeSelected(key)}
                  disabled={
                    !allowed ||
                    (!activeSelected.includes(key) && activeSelected.length >= MAX_STOCKS)
                  }
                />
                <span>{key}</span>
                {!allowed && <small className="ai-muted">{t('ai.unsupportedMarket')}</small>}
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
          <p className="ai-hint">{t(pro.available ? 'ai.privacyPro' : 'ai.privacy')}</p>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t('holding.cancel')}
          </button>
          <button
            className="primary"
            type="button"
            onClick={makePreview}
            disabled={busy || activeSelected.length === 0}
          >
            {t('ai.preview')}
          </button>
        </div>
        {status && (
          <p className="ai-hint" role="status">
            {status === 'error' && errorMessage ? errorMessage : t('ai.status.' + status)}
          </p>
        )}
        {preview && (
          <section className="ai-section" aria-label={t('ai.preview')}>
            <p className="ai-hint">{t('ai.payloadDescription')}</p>
            <pre className="ai-preview">{JSON.stringify(preview.request, null, 2)}</pre>
            {pro.available && (
              <div className="modal-actions">
                <button
                  className="primary"
                  type="button"
                  onClick={generate}
                  disabled={busy || !canGenerate}
                >
                  {t('ai.generate')}
                </button>
              </div>
            )}
            {pro.available && !canGenerate && (
              <p className="ai-hint">{t(pro.reports ? 'ai.noCredits' : 'ai.reportsPaused')}</p>
            )}
          </section>
        )}
        {reports.length > 0 && (
          <section className="ai-section" aria-label={t('ai.reports')}>
            <strong>{t('ai.reports')}</strong>
            <ul className="ai-report-list">
              {reports.slice(0, MAX_LISTED_REPORTS).map((item) => (
                <li key={item.id}>
                  <span className="ai-report-meta">
                    {dateFormat.format(new Date(item.createdAt))}
                    {item.noNewEvents && <small className="ai-muted">{t('ai.noNewEvents')}</small>}
                  </span>
                  <span className="ai-report-stocks">{item.stocks.join(' · ')}</span>
                  <span className="ai-report-actions">
                    <button
                      className="ai-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => openReport(item.id)}
                    >
                      {t('ai.openReport')}
                    </button>
                    <button
                      className="ai-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => savePdf(item.id)}
                    >
                      {t('ai.savePdf')}
                    </button>
                    <button
                      className="ai-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => deleteReport(item.id)}
                    >
                      {t('ai.deleteReport')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
