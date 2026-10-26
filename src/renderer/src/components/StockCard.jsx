import Sparkline from './Sparkline'
import { useI18n } from '../i18n'
import { displayName, formatMoney, formatNumber, formatQuoteTime, formatRatio } from '../lib/format'
import { getMarket } from '../../../shared/markets.js'

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
            {stock.errorCode ? t(`error.${stock.errorCode}`) : stock.error}
          </span>
        </div>
      </div>
    )
  }

  const cls = stock.isUp ? 'up' : 'down'
  const delay = getMarket(stock.market)?.delayMinutes
  const profit = profitOf(stock)
  const quoteTime = formatQuoteTime(stock.quoteTime, lang)
  const checkedTime = formatQuoteTime(stock.fetchedAt, lang)
  const status = [
    stock.stale ? t('card.stale') : null,
    quoteTime
      ? t('card.quoteTime', { v: quoteTime })
      : checkedTime
        ? t('card.checkedTime', { v: checkedTime })
        : null
  ]
    .filter(Boolean)
    .join(' · ')

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
          {displayName(stock, lang)}
        </span>
        <span className={`change ${cls}`}>{formatRatio(stock.changeRatio)}</span>
      </div>
      <div className="row">
        <span className="price">
          {stock.stale && <span className="stale-dot" aria-hidden="true" />}
          <span className="num">{formatMoney(stock.price, stock.market, lang)}</span>
          {delay ? <span className="delay">{t('card.delayed', { n: delay })}</span> : null}
        </span>
        <Sparkline prices={stock.prices} isUp={stock.isUp} />
      </div>
      {status && (
        <div className={`quote-status${stock.stale ? ' stale' : ''}`} title={status}>
          {status}
        </div>
      )}
      {profit && (
        <div className="row holding">
          <span className="holding-qty">
            {t('unit.shares', { n: formatNumber(stock.quantity, lang) })}
          </span>
          <span className={`holding-profit ${profit.isUp ? 'up' : 'down'}`}>
            <span className="num">
              {formatMoney(profit.profit, stock.market, lang, { signed: true })}
            </span>{' '}
            (<span className="num">{formatRatio(profit.ratio)}</span>)
          </span>
        </div>
      )}
    </div>
  )
}

export default StockCard
