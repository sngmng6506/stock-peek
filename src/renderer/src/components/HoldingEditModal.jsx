import { useState } from 'react'

function HoldingEditModal({ stock, onClose, onSave }) {
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
        <div className="modal-title">보유 정보 편집</div>

        <div className="selected-stock">
          <span className="selected-name">{stock.name || stock.symbol}</span>
          <span className="selected-meta">
            {stock.symbol} · {stock.market === 'KR' ? '한국' : '미국'}
          </span>
        </div>

        <div className="holding-form">
          <label>
            <span className="form-label">수량</span>
            <input
              className="modal-input"
              type="number"
              step="any"
              min="0"
              placeholder="예: 10"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            <span className="form-label">
              평단가 ({stock.market === 'KR' ? '원' : '$'})
            </span>
            <input
              className="modal-input"
              type="number"
              step="any"
              min="0"
              placeholder={stock.market === 'KR' ? '예: 72400' : '예: 189.20'}
              value={avgPrice}
              onChange={(e) => setAvgPrice(e.target.value)}
            />
          </label>
        </div>

        {error && <div className="modal-err">{error}</div>}

        <div className="modal-actions">
          <button type="button" onClick={clearAll} disabled={busy}>
            지우기
          </button>
          <button type="button" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="primary"
          >
            {busy ? '...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default HoldingEditModal
