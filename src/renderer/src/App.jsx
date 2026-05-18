import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import StockCard from './components/StockCard'
import AddStockModal from './components/AddStockModal'
import SettingsModal from './components/SettingsModal'

const idOf = (s) => `${s.market}-${s.symbol}`

function SortableCard({ stock, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: idOf(stock) })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 'auto'
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <StockCard stock={stock} onRemove={onRemove} />
    </div>
  )
}

function App() {
  const [stocks, setStocks] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const panelRef = useRef(null)
  const cardsRef = useRef(null)
  const cardsInnerRef = useRef(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    window.api.getStocks().then((data) => {
      if (Array.isArray(data) && data.length) setStocks(data)
    })
    const unsub = window.api.onStocksUpdate((data) => setStocks(data))
    return () => unsub()
  }, [])

  useEffect(() => {
    if (showAdd || showSettings) window.api.panelLock()
    else window.api.panelUnlock()
  }, [showAdd, showSettings])

  // 카드 영역 + 모달 자연 높이를 측정해서 main에 전달. 화면 한도 내에서 clamp.
  // 모달이 열려있으면 모달 컨텐츠가 다 보이는 높이를 보장 (작은 패널에 모달 갇히는 문제 해결).
  useLayoutEffect(() => {
    const panel = panelRef.current
    const inner = cardsInnerRef.current
    if (!panel || !inner) return

    const cardsPadding = 20 // .cards padding 10+10
    const borderCompensation = 2 // .panel border
    const modalBackdropPadding = 32 // .modal-backdrop padding 16*2

    const measure = () => {
      const header = panel.querySelector('.panel-header')
      const headerH = header ? header.offsetHeight : 0
      const innerH = inner.offsetHeight
      let total = headerH + innerH + cardsPadding + borderCompensation

      const modal = panel.querySelector('.modal')
      if (modal) {
        const modalRequired = modal.offsetHeight + modalBackdropPadding
        if (modalRequired > total) total = modalRequired
      }

      window.api.setPanelHeight(total)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(inner)
    const modal = panel.querySelector('.modal')
    if (modal) ro.observe(modal)
    return () => ro.disconnect()
  }, [showAdd, showSettings])

  const handleAdd = async (market, symbol) => {
    await window.api.addStock(market, symbol)
  }

  const handleRemove = async (stock) => {
    await window.api.removeStock(stock.market, stock.symbol)
  }

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await window.api.refreshStocks()
    } finally {
      setTimeout(() => setRefreshing(false), 400)
    }
  }

  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const [marketA] = String(active.id).split('-')
    const [marketB] = String(over.id).split('-')
    if (marketA !== marketB) return // 시장 간 이동 불가

    const same = stocks.filter((s) => s.market === marketA)
    const others = stocks.filter((s) => s.market !== marketA)
    const oldIndex = same.findIndex((s) => idOf(s) === active.id)
    const newIndex = same.findIndex((s) => idOf(s) === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(same, oldIndex, newIndex)

    // KR이 항상 앞, US가 뒤로 오는 순서 유지
    const next =
      marketA === 'KR'
        ? [...reordered, ...others]
        : [...others, ...reordered]
    setStocks(next) // optimistic
    window.api.reorderStocks(
      next.map((s) => ({ market: s.market, symbol: s.symbol }))
    )
  }

  const kr = stocks.filter((s) => s.market === 'KR')
  const us = stocks.filter((s) => s.market === 'US')
  const krIds = kr.map(idOf)
  const usIds = us.map(idOf)
  const existingKeys = new Set(stocks.map(idOf))

  return (
    <div className="panel" ref={panelRef}>
      <header className="panel-header">
        <span className="title">Watchlist</span>
        <div className="actions">
          <button
            className={`icon-btn ${refreshing ? 'spinning' : ''}`}
            onClick={handleRefresh}
            title="새로고침"
          >
            ↻
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowAdd(true)}
            title="추가"
          >
            +
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowSettings(true)}
            title="설정"
          >
            ⚙
          </button>
        </div>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className="cards" ref={cardsRef}>
          <div className="cards-inner" ref={cardsInnerRef}>
          {stocks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-text">종목이 비어있어요</div>
              <button
                type="button"
                className="empty-btn"
                onClick={() => setShowAdd(true)}
              >
                + 종목 추가
              </button>
            </div>
          ) : (
            <>
              <SortableContext
                items={krIds}
                strategy={verticalListSortingStrategy}
              >
                {kr.map((s) => (
                  <SortableCard
                    key={idOf(s)}
                    stock={s}
                    onRemove={handleRemove}
                  />
                ))}
              </SortableContext>
              {kr.length > 0 && us.length > 0 && <div className="divider" />}
              <SortableContext
                items={usIds}
                strategy={verticalListSortingStrategy}
              >
                {us.map((s) => (
                  <SortableCard
                    key={idOf(s)}
                    stock={s}
                    onRemove={handleRemove}
                  />
                ))}
              </SortableContext>
            </>
          )}
          </div>
        </div>
      </DndContext>

      {showAdd && (
        <AddStockModal
          onClose={() => setShowAdd(false)}
          onAdd={handleAdd}
          existingKeys={existingKeys}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}

export default App
