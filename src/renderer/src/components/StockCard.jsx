import Sparkline from './Sparkline'
import { useI18n } from '../i18n'
import { formatMoney, formatNumber, formatRatio } from '../lib/format'

function profitOf(stock) {
  if (!Number.isFinite(stock.price) || !stock.quantity || !stock.avgPrice) return null
  const profit = (stock.price - stock.avgPrice) * stock.quantity
  const ratio = ((stock.price - stock.avgPrice) / stock.avgPrice) * 100
  return { profit, ratio, isUp: profit >= 0 }
}

function CardBtn({ onClick, title, label, className }) {
  return (
    <button
      className={`card-btn ${className || ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {label}
    </button>
  )
}

function StockCard({ stock, onRemove, onEditHolding }) {
  const { t, lang } = useI18n()
  if (stock.error) {
    return (
      <div className="card card-err">
        {onRemove && (
          <CardBtn
            onClick={() => onRemove(stock)}
            title={t('card.remove')}
            label="×"
            className="card-remove"
          />
        )}
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
  const profit = profitOf(stock)

  return (
    <div className="card">
      <div className="card-actions">
        {onEditHolding && (
          <CardBtn
            onClick={() => onEditHolding(stock)}
            title={t('card.editHolding')}
            label="✎"
            className="card-edit"
          />
        )}
        {onRemove && (
          <CardBtn
            onClick={() => onRemove(stock)}
            title={t('card.remove')}
            label="×"
            className="card-remove"
          />
        )}
      </div>
      <div className="row">
        <span className="name" title={stock.symbol}>
          {stock.name || stock.symbol}
        </span>
        <span className={`change ${cls}`}>{formatRatio(stock.changeRatio)}</span>
      </div>
      <div className="row">
        <span className="price">
          {stock.stale && <span className="stale-dot" title="연결 끊김 — 마지막 가격" />}
          {formatMoney(stock.price, stock.market, lang)}
        </span>
        <Sparkline prices={stock.prices} isUp={stock.isUp} />
      </div>
      {profit && (
        <div className="row holding">
          <span className="holding-qty">
            {t('unit.shares', { n: formatNumber(stock.quantity, lang) })}
          </span>
          <span className={`holding-profit ${profit.isUp ? 'up' : 'down'}`}>
            {formatMoney(profit.profit, stock.market, lang, { signed: true })} (
            {formatRatio(profit.ratio)})
          </span>
        </div>
      )}
    </div>
  )
}

export default StockCard
