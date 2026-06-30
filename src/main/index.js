import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, screen, shell, Tray } from 'electron'
import { join } from 'path'
import fs from 'node:fs/promises'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

function resourcePath(name) {
  if (is.dev) return join(process.cwd(), 'resources', name)
  return join(process.resourcesPath, 'app.asar.unpacked', 'resources', name)
}
import {
  startPolling,
  stopPolling,
  getCache,
  subscribe,
  refreshAll,
  reorderCache
} from './stockService.js'
import {
  getItems,
  addItem,
  removeItem,
  setItems,
  updateHolding
} from './watchlist.js'
import { searchKoreanStocks, fetchKoreanDailyCloses } from './api/naver.js'
import { searchUSStocks, fetchUSDailyCloses } from './api/yahoo.js'
import { computeStatsWithDailyData } from './portfolioStats.js'
import { WORKER_URL } from './api/proxy.js'
import {
  isWelcomeShown,
  markWelcomeShown,
  resetWelcome,
  getDockPosition,
  setDockPosition,
  getLanguage,
  setLanguage,
  getDeviceId
} from './preferences.js'
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

const PANEL_WIDTH = 280
const PANEL_HEIGHT_INITIAL = 180
const PANEL_HEIGHT_MIN = 120
const PANEL_HEIGHT_BOTTOM_MARGIN = 40
const TRIGGER_WIDTH = 8
const TRIGGER_HEIGHT = 500
const HOVER_DELAY = 300
const POLL_INTERVAL = 50
const ANIM_DURATION = 200
const INDICATOR_WIDTH = 6
const INDICATOR_HEIGHT = 50

let mainWindow = null
let indicatorWindow = null
let tray = null
let pollTimer = null
let hoverEnterTime = null
let targetState = 'hidden' // 'hidden' | 'shown'
let cancelAnim = null
let panelLocked = false
let panelPinned = false
let isDragging = false
let dragDebounce = null
let updateInfo = null
let updateReady = null

function getDockedDisplay() {
  const dock = getDock()
  const displays = screen.getAllDisplays()
  // 저장된 displayId의 모니터를 찾되, 없으면(연결 해제 등) primary로 폴백
  if (dock.displayId != null) {
    const found = displays.find((d) => d.id === dock.displayId)
    if (found) return found
  }
  return screen.getPrimaryDisplay()
}

function getDisplayWorkArea() {
  return getDockedDisplay().workArea
}

function getDock() {
  return getDockPosition()
}

function getHiddenX() {
  const wa = getDisplayWorkArea()
  const dock = getDock()
  if (dock.edge === 'left') return wa.x - PANEL_WIDTH
  return wa.x + wa.width
}

function getShownX() {
  const wa = getDisplayWorkArea()
  const dock = getDock()
  if (dock.edge === 'left') return wa.x
  return wa.x + wa.width - PANEL_WIDTH
}

function getPanelY() {
  const wa = getDisplayWorkArea()
  const dock = getDock()
  const maxY = wa.height - PANEL_HEIGHT_MIN - PANEL_HEIGHT_BOTTOM_MARGIN
  return wa.y + Math.max(0, Math.min(dock.y, maxY))
}

function getIndicatorX() {
  const wa = getDisplayWorkArea()
  const dock = getDock()
  if (dock.edge === 'left') return wa.x
  return wa.x + wa.width - INDICATOR_WIDTH
}

function getIndicatorY() {
  return getPanelY() + 30
}

function animate(from, to, duration, onUpdate, onDone) {
  // NaN 방지: from/to가 유효하지 않으면 즉시 완료
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    onDone && onDone()
    return () => {}
  }
  const start = Date.now()
  let canceled = false
  const tick = () => {
    if (canceled) return
    if (mainWindow && mainWindow.isDestroyed()) return
    const elapsed = Date.now() - start
    const t = Math.min(elapsed / duration, 1)
    const eased = 1 - Math.pow(1 - t, 3)
    onUpdate(Math.round(from + (to - from) * eased))
    if (t < 1) setTimeout(tick, 1000 / 60)
    else onDone && onDone()
  }
  tick()
  return () => {
    canceled = true
  }
}

function safeGetX() {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      const x = mainWindow.getPosition()[0]
      if (Number.isFinite(x)) return x
    }
  } catch {}
  return getHiddenX()
}

function safeSetPosition(win, x, y) {
  try {
    if (win && !win.isDestroyed()) {
      win.setPosition(Math.round(x) || 0, Math.round(y) || 0)
    }
  } catch {}
}

function showIndicator() {
  if (!indicatorWindow || indicatorWindow.isDestroyed()) return
  safeSetPosition(indicatorWindow, getIndicatorX(), getIndicatorY())
  if (!indicatorWindow.isVisible()) indicatorWindow.show()
}

function hideIndicator() {
  if (!indicatorWindow || indicatorWindow.isDestroyed()) return
  if (indicatorWindow.isVisible()) indicatorWindow.hide()
}

function setTarget(state) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (targetState === state && !cancelAnim) return
  const prev = targetState
  targetState = state
  if (state === 'shown' && prev !== 'shown') startPolling()
  if (state === 'hidden' && prev !== 'hidden') stopPolling()
  if (cancelAnim) cancelAnim()
  const y = getPanelY()

  if (state === 'shown') {
    hideIndicator()
    if (!mainWindow.isVisible()) {
      safeSetPosition(mainWindow, getHiddenX(), y)
      mainWindow.show()
    }
    const fromX = safeGetX()
    const toX = getShownX()
    if (fromX === toX) {
      cancelAnim = null
      return
    }
    cancelAnim = animate(fromX, toX, ANIM_DURATION, (x) => safeSetPosition(mainWindow, x, y), () => {
      cancelAnim = null
    })
  } else {
    const fromX = safeGetX()
    const toX = getHiddenX()
    if (fromX === toX || !mainWindow.isVisible()) {
      mainWindow.hide()
      showIndicator()
      cancelAnim = null
      return
    }
    cancelAnim = animate(fromX, toX, ANIM_DURATION, (x) => safeSetPosition(mainWindow, x, y), () => {
      cancelAnim = null
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
      showIndicator()
    })
  }
}

function getCurrentPanelHeight() {
  if (!mainWindow) return PANEL_HEIGHT_INITIAL
  return mainWindow.getSize()[1]
}

function isOnDockedDisplay(cursor) {
  const wa = getDisplayWorkArea()
  return (
    cursor.x >= wa.x &&
    cursor.x < wa.x + wa.width &&
    cursor.y >= wa.y &&
    cursor.y < wa.y + wa.height
  )
}

function isInTriggerZone(cursor) {
  if (!isOnDockedDisplay(cursor)) return false
  const wa = getDisplayWorkArea()
  const dock = getDock()
  const y = getPanelY()
  if (dock.edge === 'left') {
    return (
      cursor.x >= wa.x &&
      cursor.x < wa.x + TRIGGER_WIDTH &&
      cursor.y >= y &&
      cursor.y <= y + TRIGGER_HEIGHT
    )
  }
  return (
    cursor.x >= wa.x + wa.width - TRIGGER_WIDTH &&
    cursor.x < wa.x + wa.width &&
    cursor.y >= y &&
    cursor.y <= y + TRIGGER_HEIGHT
  )
}

function isInPanelArea(cursor) {
  if (!mainWindow) return false
  if (targetState !== 'shown') return false
  if (!isOnDockedDisplay(cursor)) return false
  const shownX = getShownX()
  return (
    cursor.x >= shownX &&
    cursor.x < shownX + PANEL_WIDTH &&
    cursor.y >= getPanelY() &&
    cursor.y <= getPanelY() + getCurrentPanelHeight()
  )
}

function startHoverPolling() {
  pollTimer = setInterval(() => {
    if (!mainWindow) return
    if (isDragging) return

    const cursor = screen.getCursorScreenPoint()

    if (!isOnDockedDisplay(cursor)) {
      hoverEnterTime = null
      if (targetState === 'shown') setTarget('hidden')
      return
    }

    const active = isInTriggerZone(cursor) || isInPanelArea(cursor) || panelLocked || panelPinned

    if (active) {
      if (targetState === 'shown') {
        hoverEnterTime = null
      } else {
        if (hoverEnterTime === null) hoverEnterTime = Date.now()
        if (Date.now() - hoverEnterTime >= HOVER_DELAY) {
          hoverEnterTime = null
          setTarget('shown')
        }
      }
    } else {
      hoverEnterTime = null
      if (targetState === 'shown') setTarget('hidden')
    }
  }, POLL_INTERVAL)
}

// 드래그 종료 시 커서가 위치한 모니터의 가장 가까운 좌/우 edge로 스냅
function snapToEdge() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const pos = mainWindow.getPosition()
  const wx = pos[0] || 0
  const wy = pos[1] || 0

  // 패널 중심점이 속한 모니터를 찾음 (멀티모니터 지원)
  const centerPoint = {
    x: wx + Math.round(PANEL_WIDTH / 2),
    y: wy + 40
  }
  const display = screen.getDisplayNearestPoint(centerPoint)
  const wa = display.workArea

  const centerX = wx + PANEL_WIDTH / 2
  const edge = centerX < wa.x + wa.width / 2 ? 'left' : 'right'
  const newY = Math.max(0, Math.min(wy - wa.y, wa.height - PANEL_HEIGHT_MIN - PANEL_HEIGHT_BOTTOM_MARGIN))

  // displayId까지 저장 → 다음 실행 및 위치 계산에 사용
  setDockPosition({ edge, y: newY, displayId: display.id })

  // 스냅 위치로 이동
  const toX = getShownX()
  const toY = getPanelY()
  safeSetPosition(mainWindow, toX, toY)

  // renderer에 edge 변경 알림
  if (mainWindow.webContents) {
    mainWindow.webContents.send('dock:edge-changed', edge)
  }
}

const INDICATOR_HTML = `<!DOCTYPE html>
<html><head><style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: transparent; }
  .bar {
    width: ${INDICATOR_WIDTH}px;
    height: ${INDICATOR_HEIGHT}px;
    border-radius: 3px;
    background: rgba(120, 160, 220, 0.35);
    box-shadow: 0 0 8px rgba(120, 160, 220, 0.2);
    transition: background 150ms;
  }
  .bar:hover {
    background: rgba(120, 160, 220, 0.6);
  }
</style></head><body><div class="bar"></div></body></html>`

function createIndicatorWindow() {
  indicatorWindow = new BrowserWindow({
    width: INDICATOR_WIDTH,
    height: INDICATOR_HEIGHT,
    x: getIndicatorX(),
    y: getIndicatorY(),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: { sandbox: true }
  })
  indicatorWindow.setAlwaysOnTop(true, 'screen-saver')
  indicatorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  indicatorWindow.setIgnoreMouseEvents(false)
  indicatorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(INDICATOR_HTML)}`)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT_INITIAL,
    x: getHiddenX(),
    y: getPanelY(),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })

  // 드래그 감지: will-move → 드래그 시작, 이동 멈추면 스냅
  mainWindow.on('will-move', () => {
    if (!isDragging) {
      isDragging = true
      panelLocked = true
      hideIndicator()
    }
  })

  mainWindow.on('move', () => {
    if (!isDragging) return
    if (dragDebounce) clearTimeout(dragDebounce)
    dragDebounce = setTimeout(() => {
      isDragging = false
      panelLocked = false
      snapToEdge()
    }, 200)
  })

  mainWindow.on('ready-to-show', () => {
    startHoverPolling()
    if (!isWelcomeShown()) {
      panelLocked = true
      safeSetPosition(mainWindow, getHiddenX(), getPanelY())
      mainWindow.show()
      setTarget('shown')
    } else {
      // 일반 실행: show 없이 polling만 시작 → 에러 방지.
      // indicator만 표시하고 hover 시 패널 노출.
      showIndicator()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function applyAutoStart(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: []
  })
}

function refreshTrayMenu() {
  if (!tray) return
  const isAuto = app.getLoginItemSettings().openAtLogin
  const template = []
  if (updateReady) {
    template.push({
      label: `↻ v${updateReady.version} 적용 (재시작)`,
      click: () => autoUpdater.quitAndInstall()
    })
    template.push({ type: 'separator' })
  } else if (updateInfo) {
    template.push({
      label: `↓ v${updateInfo.version} 다운로드 중...`,
      enabled: false
    })
    template.push({ type: 'separator' })
  }
  template.push({
    label: '자동 시작',
    type: 'checkbox',
    checked: isAuto,
    click: (item) => {
      applyAutoStart(item.checked)
      refreshTrayMenu()
    }
  })
  template.push({ type: 'separator' })
  template.push({ label: '종료', click: () => app.quit() })
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function createTray() {
  const img = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  tray = new Tray(img)
  tray.setToolTip('몰래주식')
  tray.on('click', () => {
    panelPinned = true
    setTarget('shown')
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('panel:pinned-changed', true)
    }
  })
  refreshTrayMenu()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    setTarget('shown')
  }
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.stockpeek')

  ipcMain.handle('stocks:get-cache', () => getCache())
  ipcMain.handle('stocks:refresh', () => refreshAll())

  ipcMain.on('panel:lock', () => {
    panelLocked = true
  })
  ipcMain.on('panel:unlock', () => {
    panelLocked = false
  })

  ipcMain.on('panel:set-height', (_e, requested) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const wa = getDisplayWorkArea()
    const dock = getDock()
    const maxH = wa.height - dock.y - PANEL_HEIGHT_BOTTOM_MARGIN
    const h = Math.max(PANEL_HEIGHT_MIN, Math.min(Math.round(requested) || 0, maxH))
    const [w, current] = mainWindow.getSize()
    if (current === h) return
    mainWindow.setSize(w, h)
  })

  ipcMain.handle('settings:get', () => ({
    autoStart: app.getLoginItemSettings().openAtLogin,
    version: app.getVersion()
  }))
  ipcMain.handle('settings:set-autostart', (_e, enabled) => {
    applyAutoStart(!!enabled)
    refreshTrayMenu()
    return app.getLoginItemSettings().openAtLogin
  })
  ipcMain.handle('settings:get-donate-qr', async () => {
    try {
      const data = await fs.readFile(resourcePath('icon_qr.jpg'))
      return `data:image/jpeg;base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })
  ipcMain.on('shell:open-external', (_e, url) => {
    if (typeof url === 'string' && /^(https?:\/\/|mailto:)/.test(url)) {
      shell.openExternal(url)
    }
  })

  ipcMain.handle('watchlist:get', () => getItems())
  ipcMain.handle('watchlist:add', async (_e, { market, symbol, quantity, avgPrice }) => {
    const list = addItem(market, symbol, { quantity, avgPrice })
    refreshAll()
    return list
  })
  ipcMain.handle(
    'watchlist:update-holding',
    async (_e, { market, symbol, quantity, avgPrice }) => {
      const list = updateHolding(market, symbol, { quantity, avgPrice })
      refreshAll()
      return list
    }
  )
  ipcMain.handle('watchlist:remove', async (_e, { market, symbol }) => {
    const list = removeItem(market, symbol)
    refreshAll()
    return list
  })

  ipcMain.handle('watchlist:reorder', (_e, items) => {
    const next = setItems(items)
    reorderCache(next)
    return next
  })

  ipcMain.handle('welcome:check', () => !isWelcomeShown())
  ipcMain.handle('welcome:dismiss', () => {
    markWelcomeShown()
    panelLocked = false
    return true
  })
  ipcMain.handle('welcome:show-again', () => {
    resetWelcome()
    return true
  })

  ipcMain.handle('search:stocks', async (_e, { market, keyword }) => {
    const kw = String(keyword || '').trim()
    if (!kw) return []
    if (market === 'KR') return await searchKoreanStocks(kw)
    if (market === 'US') return await searchUSStocks(kw)
    return []
  })

  ipcMain.handle('dock:get-edge', () => getDock().edge)

  ipcMain.handle('lang:get', () => {
    const saved = getLanguage()
    if (saved) return saved
    // OS 언어 감지: 한국어면 ko, 그 외 en
    const locale = (app.getLocale() || 'en').toLowerCase()
    return locale.startsWith('ko') ? 'ko' : 'en'
  })
  ipcMain.handle('lang:set', (_e, lang) => {
    setLanguage(lang)
    return getLanguage()
  })

  // 포트폴리오 한 줄 평: 일봉 받아 통계 계산 → Worker(LLM) 호출.
  ipcMain.handle('review:generate', async (_e, lang) => {
    try {
      const cache = getCache()
      if (!Array.isArray(cache) || cache.length === 0) {
        return { ok: false, reason: 'empty' }
      }
      // 보유 종목 일봉(3개월)으로 통계 계산
      const stats = await computeStatsWithDailyData(cache, {
        KR: fetchKoreanDailyCloses,
        US: fetchUSDailyCloses
      })
      if (stats.empty) return { ok: false, reason: 'empty' }

      const deviceId = getDeviceId()
      const res = await net.fetch(`${WORKER_URL}/api/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, stats, lang: lang === 'en' ? 'en' : 'ko' })
      })

      if (res.status === 429) {
        return { ok: false, reason: 'used_today' }
      }
      if (res.status === 503) {
        return { ok: false, reason: 'unavailable' }
      }
      if (!res.ok) {
        return { ok: false, reason: 'error' }
      }
      const json = await res.json()
      return { ok: true, review: json.review, date: json.date }
    } catch (e) {
      console.error('review:generate error:', e?.message || e)
      return { ok: false, reason: 'error' }
    }
  })

  ipcMain.on('app:quit', () => {
    app.quit()
  })

  ipcMain.on('panel:pin', () => {
    panelPinned = true
    setTarget('shown')
  })
  ipcMain.on('panel:unpin', () => {
    panelPinned = false
  })
  ipcMain.handle('panel:get-pinned', () => panelPinned)

  ipcMain.handle('app:get-update', () => ({
    available: updateInfo,
    ready: updateReady
  }))
  ipcMain.on('app:install-update', () => {
    if (updateReady) autoUpdater.quitAndInstall()
  })

  createWindow()
  createIndicatorWindow()
  createTray()

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (info) => {
    updateInfo = { version: info.version, releaseDate: info.releaseDate }
    refreshTrayMenu()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:update-available', updateInfo)
    }
  })
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = { version: info.version }
    refreshTrayMenu()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:update-ready', updateReady)
    }
  })
  autoUpdater.on('error', (err) => {
    console.error('autoUpdater error:', err?.message || err)
  })
  if (!is.dev) {
    autoUpdater.checkForUpdates().catch(() => {})
    setInterval(
      () => autoUpdater.checkForUpdates().catch(() => {}),
      24 * 60 * 60 * 1000
    )
  }

  subscribe((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stocks:update', data)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  if (pollTimer) clearInterval(pollTimer)
  if (cancelAnim) cancelAnim()
  if (dragDebounce) clearTimeout(dragDebounce)
  stopPolling()
})
