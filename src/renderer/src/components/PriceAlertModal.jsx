import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { getMarket } from '../../../shared/markets.js'

export default function PriceAlertModal({ stock, onClose }) {
  const { t } = useI18n()
  const first = useRef(null)
  const [direction, setDirection] = useState('above')
  const [target, setTarget] = useState('')
  const [alerts, setAlerts] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const currency = getMarket(stock.market)?.currency || stock.market
  useEffect(() => {
    first.current?.focus()
    window.api
      .getAlerts()
      .then((list) => {
        setAlerts(list.filter((a) => a.market === stock.market && a.symbol === stock.symbol))
      })
      .catch(() => setError(t('settings.actionFailed')))
  }, [stock.market, stock.symbol, t])
  const create = async () => {
    if (busy) return
    const price = Number(target)
    if (!Number.isFinite(price) || price <= 0) {
      setError(t('alert.invalidPrice'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await window.api.createAlert({
        market: stock.market,
        symbol: stock.symbol,
        direction,
        target: price
      })
      setAlerts(
        (await window.api.getAlerts()).filter(
          (a) => a.market === stock.market && a.symbol === stock.symbol
        )
      )
      setTarget('')
    } catch {
      setError(t('alert.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setAlerts(
        await window.api
          .removeAlert(id)
          .then((list) =>
            list.filter((a) => a.market === stock.market && a.symbol === stock.symbol)
          )
      )
    } catch {
      setError(t('settings.actionFailed'))
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
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="alert-title">
        <div className="modal-title" id="alert-title">
          {t('alert.title')} · {stock.symbol}
        </div>
        <p className="alert-hint">{t('alert.hint')}</p>
        <label className="alert-label" htmlFor="alert-direction">
          {t('alert.direction')}
        </label>
        <select
          id="alert-direction"
          className="alert-input"
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
        >
          <option value="above">{t('alert.above')}</option>
          <option value="below">{t('alert.below')}</option>
        </select>
        <label className="alert-label" htmlFor="alert-target">
          {t('alert.target')} ({currency})
        </label>
        <input
          ref={first}
          id="alert-target"
          className="alert-input"
          type="number"
          step="any"
          min="0"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder={t('alert.placeholder')}
        />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t('holding.cancel')}
          </button>
          <button type="button" className="primary" disabled={busy || !target} onClick={create}>
            {t('alert.add')}
          </button>
        </div>
        <div className="alert-list">
          {alerts.map((a) => (
            <div className="alert-entry" key={a.id}>
              <span>
                {a.direction === 'above' ? '≥' : '≤'} {a.target} {currency} ·{' '}
                {t('alert.' + a.status)}
              </span>
              <button type="button" disabled={busy} onClick={() => remove(a.id)}>
                {t('alert.remove')}
              </button>
            </div>
          ))}
        </div>
        {error && (
          <p className="modal-err" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
