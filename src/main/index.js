import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
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
import { searchKoreanStocks } from './api/naver.js'
import { searchUSStocks } from './api/yahoo.js'
import { isWelcomeShown, markWelcomeShown, resetWelcome } from './preferences.js'
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

const PANEL_WIDTH = 280
const PANEL_HEIGHT_INITIAL = 180 // 로딩 중 초기 높이. renderer가 측정 후 동적으로 늘림.
const PANEL_HEIGHT_MIN = 120
const PANEL_HEIGHT_BOTTOM_MARGIN = 40 // 화면 하단에서 띄울 여백
const PANEL_Y = 100
// PANEL_PEEK 제거 — 멀티 모니터 환경에서 숨긴 패널이 보조 화면에 노출되는 버그 방지.
// 숨김 시 mainWindow.hide()를 사용하므로 peek 영역이 불필요.
const TRIGGER_WIDTH = 5
const TRIGGER_HEIGHT = 500 // hover 트리거 zone 세로 범위 (패널 실제 높이와 분리)
const HOVER_DELAY = 300
const POLL_INTERVAL = 50
const ANIM_DURATION = 200

let mainWindow = null
let tray = null
let pollTimer = null
let hoverEnterTime = null
let targetState = 'hidden' // 'hidden' | 'shown'
let cancelAnim = null
let panelLocked = false
let updateInfo = null // {version} — download available/in progress
let updateReady = null // {version} — downloaded, ready to install on restart

function getDisplayWorkArea() {
  return screen.getPrimaryDisplay().workArea
}

function getHiddenX() {
  const wa = getDisplayWorkArea()
  // 완전히 화면 밖으로 이동 (hide()와 함께 사용하므로 peek 불필요).
  return wa.x + wa.width
}

function getShownX() {
  const wa = getDisplayWorkArea()
  return wa.x + wa.width - PANEL_WIDTH
}

function getPanelY() {
  return getDisplayWorkArea().y + PANEL_Y
}

function animate(from, to, duration, onUpdate, onDone) {
  const start = Date.now()
  let canceled = false
  const tick = () => {
    if (canceled) return
    const elapsed = Date.now() - start
    const t = Math.min(elapsed / duration, 1)
    const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
    onUpdate(Math.round(from + (to - from) * eased))
    if (t < 1) setTimeout(tick, 1000 / 60)
    else onDone && onDone()
  }
  tick()
  return () => {
    canceled = true
  }
}

function setTarget(state) {
  if (!mainWindow) return
  if (targetState === state && !cancelAnim) return
  const prev = targetState
  targetState = state
  if (state === 'shown' && prev !== 'shown') startPolling()
  if (state === 'hidden' && prev !== 'hidden') stopPolling()
  if (cancelAnim) cancelAnim()
  const y = getPanelY()
  const fromX = mainWindow.getPosition()[0]
  const toX = state === 'shown' ? getShownX() : getHiddenX()

  // 보여주기 전에 윈도우를 먼저 표시 (숨김 → 표시 전환 시 필수).
  if (state === 'shown' && !mainWindow.isVisible()) {
    mainWindow.setPosition(getHiddenX(), y)
    mainWindow.show()
  }

  if (fromX === toX) {
    // 이미 목표 위치 — 숨김이면 즉시 hide 처리.
    if (state === 'hidden') mainWindow.hide()
    cancelAnim = null
    return
  }
  cancelAnim = animate(
    fromX,
    toX,
    ANIM_DURATION,
    (x) => mainWindow.setPosition(x, y),
    () => {
      cancelAnim = null
      // 슬라이드 아웃 완료 후 윈도우를 실제로 숨김 → 멀티 모니터에서 보조 화면 노출 방지.
      if (state === 'hidden') mainWindow.hide()
    }
  )
}

function getCurrentPanelHeight() {
  if (!mainWindow) return PANEL_HEIGHT_INITIAL
  return mainWindow.getSize()[1]
}

// 마우스가 주 모니터 안에 있는지 검사. 다중 모니터 환경에서 보조 모니터로
// 마우스가 넘어가면 패널을 자동으로 닫기 위해 사용.
function isOnPrimaryDisplay(cursor) {
  const wa = screen.getPrimaryDisplay().workArea
  return (
    cursor.x >= wa.x &&
    cursor.x < wa.x + wa.width &&
    cursor.y >= wa.y &&
    cursor.y < wa.y + wa.height
  )
}

function isInTriggerZone(cursor) {
  if (!isOnPrimaryDisplay(cursor)) return false
  const wa = getDisplayWorkArea()
  return (
    cursor.x >= wa.x + wa.width - TRIGGER_WIDTH &&
    cursor.x < wa.x + wa.width &&
    cursor.y >= getPanelY() &&
    cursor.y <= getPanelY() + TRIGGER_HEIGHT
  )
}

function isInPanelArea(cursor) {
  if (!mainWindow) return false
  if (targetState !== 'shown') return false
  if (!isOnPrimaryDisplay(cursor)) return false
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
    const cursor = screen.getCursorScreenPoint()

    // 마우스가 주 모니터 밖이면 lock 무시하고 무조건 hidden 처리.
    // (보조 모니터로 옮겨도 패널이 계속 떠있는 버그 방지)
    if (!isOnPrimaryDisplay(cursor)) {
      hoverEnterTime = null
      if (targetState === 'shown') setTarget('hidden')
      return
    }

    const active = isInTriggerZone(cursor) || isInPanelArea(cursor) || panelLocked

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
    movable: false,
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    startHoverPolling()
    // 첫 실행이면 패널을 강제로 슬라이드 인 + 잠금 (환영 모달이 보이게).
    // 사용자가 환영 모달 dismiss하면 lock 풀려서 자연 hover 동작 복귀.
    if (!isWelcomeShown()) {
      panelLocked = true
      setTarget('shown')
    } else {
      // 일반 실행: renderer 초기화 후 즉시 숨김 → 멀티 모니터 노출 방지.
      mainWindow.hide()
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
  refreshTrayMenu()
}

// 단일 인스턴스 — 두 번째 실행 시도하면 즉시 quit하고 첫 인스턴스가 패널 강제 표시.
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
    const maxH = wa.height - PANEL_Y - PANEL_HEIGHT_BOTTOM_MARGIN
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
    refreshAll() // immediate (don't await — UI shouldn't block)
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

  createWindow()
  createTray()

  // electron-updater: GitHub Releases 자동 체크 + 백그라운드 다운로드.
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
  // dev 모드에선 update check를 건너뜀 (signing/path 검사 실패함).
  if (!is.dev) {
    autoUpdater.checkForUpdates().catch(() => {})
    setInterval(
      () => autoUpdater.checkForUpdates().catch(() => {}),
      24 * 60 * 60 * 1000
    )
  }

  ipcMain.handle('app:get-update', () => ({
    available: updateInfo,
    ready: updateReady
  }))
  ipcMain.on('app:install-update', () => {
    if (updateReady) autoUpdater.quitAndInstall()
  })

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
  stopPolling()
})
