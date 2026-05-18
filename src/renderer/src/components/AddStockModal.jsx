import { useEffect, useState } from 'react'

function AddStockModal({ onClose, onAdd, existingKeys = new Set() }) {
  const [market, setMarket] = useState('KR')
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setError(null)
    const kw = keyword.trim()
    if (!kw) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const items = await window.api.searchStocks(market, kw)
        setResults(items || [])
      } catch (e) {
        setError(e?.message || '검색 실패')
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [keyword, market])

  const pick = async (item) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(item.market, item.symbol)
      onClose()
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }

  const kw = keyword.trim()

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">종목 추가</div>

        <div className="seg">
          <button
            type="button"
            className={market === 'KR' ? 'active' : ''}
            onClick={() => setMarket('KR')}
          >
            한국
          </button>
          <button
            type="button"
            className={market === 'US' ? 'active' : ''}
            onClick={() => setMarket('US')}
          >
            미국
          </button>
        </div>

        <input
          autoFocus
          className="modal-input"
          placeholder={
            market === 'KR' ? '예: 삼성전자, 005930' : '예: Apple, AAPL'
          }
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />

        <div className="search-results">
          {searching && <div className="search-hint">검색 중…</div>}
          {!searching && kw && results.length === 0 && !error && (
            <div className="search-hint">결과 없음</div>
          )}
          {results.map((r) => {
            const key = `${r.market}-${r.symbol}`
            const exists = existingKeys.has(key)
            return (
              <button
                key={key}
                type="button"
                className="search-item"
                onClick={() => !exists && pick(r)}
                disabled={busy || exists}
                title={exists ? '이미 추가된 종목' : undefined}
              >
                <span className="search-name">{r.name}</span>
                <span className="search-meta">
                  {exists
                    ? '이미 추가됨'
                    : `${r.symbol}${r.type ? ` · ${r.type}` : ''}`}
                </span>
              </button>
            )
          })}
        </div>

        {error && <div className="modal-err">{error}</div>}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddStockModal
