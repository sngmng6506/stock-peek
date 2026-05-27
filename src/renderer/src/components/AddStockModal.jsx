import { useEffect, useState } from 'react'

function AddStockModal({ onClose, onAdd, existingKeys = new Set() }) {
  const [market, setMarket] = useState('KR')
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // step 2: 선택한 종목 + 매수가/수량 입력
  const [selected, setSelected] = useState(null)
  const [quantity, setQuantity] = useState('')
  const [avgPrice, setAvgPrice] = useState('')

  useEffect(() => {
    if (selected) return // 검색 step 멈춤
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
  }, [keyword, market, selected])

  const handlePick = (item) => {
    setSelected(item)
    setError(null)
  }

  const submitAdd = async (withHolding) => {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      const holding = withHolding
        ? {
            quantity: Number(quantity) || undefined,
            avgPrice: Number(avgPrice) || undefined
          }
        : undefined
      await onAdd(selected.market, selected.symbol, holding)
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
        {!selected ? (
          <>
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
                    onClick={() => !exists && handlePick(r)}
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
          </>
        ) : (
          <>
            <div className="modal-title">매수 정보 (선택)</div>

            <div className="selected-stock">
              <span className="selected-name">{selected.name}</span>
              <span className="selected-meta">
                {selected.symbol} · {selected.market === 'KR' ? '한국' : '미국'}
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
                  평단가 ({selected.market === 'KR' ? '원' : '$'})
                </span>
                <input
                  className="modal-input"
                  type="number"
                  step="any"
                  min="0"
                  placeholder={selected.market === 'KR' ? '예: 72400' : '예: 189.20'}
                  value={avgPrice}
                  onChange={(e) => setAvgPrice(e.target.value)}
                />
              </label>
            </div>

            <div className="form-hint">
              평단가는 나중에 편집 가능 · 입력 안 해도 OK
            </div>

            {error && <div className="modal-err">{error}</div>}

            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setSelected(null)}
                disabled={busy}
              >
                ← 뒤로
              </button>
              <button
                type="button"
                onClick={() => submitAdd(false)}
                disabled={busy}
              >
                건너뛰기
              </button>
              <button
                type="button"
                onClick={() => submitAdd(true)}
                disabled={busy || (!quantity && !avgPrice)}
                className="primary"
              >
                {busy ? '...' : '추가'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default AddStockModal
