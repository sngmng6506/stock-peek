import { useState } from 'react'
import { useI18n } from '../i18n'

function HoldingEditModal({ stock, onClose, onSave }) {
  const { t } = useI18n()
  const [quantity, setQuantity] = useState(
    stock.quantity != null ? String(stock.quantity) : ''
  )
  const [avgPrice, setAvgPrice] = useState(
    stock.avgPrice != null ? String(stock.avgPrice) : ''
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const save = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onSave({
        quantity: Number(quantity) || undefined,
        avgPrice: Number(avgPrice) || undefined
      })
      onClose()
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }

  const clearAll = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onSave({ quantity: undefined, avgPrice: undefined })
      onClose()
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{t('holding.title')}</div>

        <div className="selected-stock">
          <span className="selected-name">{stock.name || stock.symbol}</span>
          <span className="selected-meta">
            {stock.symbol} · {stock.market === 'KR' ? t('add.korea') : t('add.us')}
          </span>
        </div>

        <div className="holding-form">
          <label>
            <span className="form-label">{t('holding.quantity')}</span>
            <input
              className="modal-input"
              type="number"
              step="any"
              min="0"
              placeholder={t('holding.qtyPlaceholder')}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            <span className="form-label">
              {t('holding.avgPrice')} ({stock.market === 'KR' ? '₩' : '$'})
            </span>
            <input
              className="modal-input"
              type="number"
              step="any"
              min="0"
              placeholder={stock.market === 'KR' ? t('holding.pricePlaceholder') : 'e.g. 189.20'}
              value={avgPrice}
              onChange={(e) => setAvgPrice(e.target.value)}
            />
          </label>
        </div>

        {error && <div className="modal-err">{error}</div>}

        <div className="modal-actions">
          <button type="button" onClick={clearAll} disabled={busy}>
            {t('holding.clear')}
          </button>
          <button type="button" onClick={onClose} disabled={busy}>
            {t('holding.cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="primary"
          >
            {busy ? '...' : t('holding.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default HoldingEditModal
