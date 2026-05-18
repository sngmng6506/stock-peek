import Sparkline from './Sparkline'

function formatPrice(stock) {
  if (!Number.isFinite(stock.price)) return '—'
  if (stock.market === 'KR') return `${Math.round(stock.price).toLocaleString('ko-KR')}원`
  return `$${stock.price.toFixed(2)}`
}

function formatRatio(r) {
  if (!Number.isFinite(r)) return ''
  const sign = r > 0 ? '+' : ''
  return `${sign}${r.toFixed(2)}%`
}

function RemoveBtn({ onClick }) {
  return (
    <button
      className="card-remove"
      onClick={onClick}
      title="삭제"
      aria-label="삭제"
    >
      ×
    </button>
  )
}

function StockCard({ stock, onRemove }) {
  if (stock.error) {
    return (
      <div className="card card-err">
        {onRemove && <RemoveBtn onClick={() => onRemove(stock)} />}
        <div className="row">
          <span className="name">{stock.symbol}</span>
          <span className="change down">err</span>
        </div>
        <div className="row">
          <span className="err-msg" title={stock.error}>
            {stock.error}
          </span>
        </div>
      </div>
    )
  }

  const cls = stock.isUp ? 'up' : 'down'
  return (
    <div className="card">
      {onRemove && <RemoveBtn onClick={() => onRemove(stock)} />}
      <div className="row">
        <span className="name" title={stock.symbol}>
          {stock.name || stock.symbol}
        </span>
        <span className={`change ${cls}`}>{formatRatio(stock.changeRatio)}</span>
      </div>
      <div className="row">
        <span className="price">{formatPrice(stock)}</span>
        <Sparkline prices={stock.prices} isUp={stock.isUp} />
      </div>
    </div>
  )
}

export default StockCard
