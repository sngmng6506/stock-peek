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
import { getItems, addItem, removeItem, setItems } from './watchlist.js'
import { searchKoreanStocks } from './api/naver.js'
import { searchUSStocks } from './api/yahoo.js'
import { startUpdateChecker, getLatestUpdate } from './updater.js'

const PANEL_WIDTH = 280
const PANEL_HEIGHT_INITIAL = 180 // 로딩 중 초기 높이. renderer가 측정 후 동적으로 늘림.
const PANEL_HEIGHT_MIN = 120
const PANEL_HEIGHT_BOTTOM_MARGIN = 40 // 화면 하단에서 띄울 여백
const PANEL_Y = 100
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

function getDisplayWorkArea() {
  return screen.getPrimaryDisplay().workArea
}

function getHiddenX() {
  const wa = getDisplayWorkArea()
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
  if (fromX === toX) {
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
    }
  )
}

function getCurrentPanelHeight() {
  if (!mainWindow) return PANEL_HEIGHT_INITIAL
  return mainWindow.getSize()[1]
}

function isInTriggerZone(cursor) {
  const wa = getDisplayWorkArea()
  return (
    cursor.x >= wa.x + wa.width - TRIGGER_WIDTH &&
    cursor.x <= wa.x + wa.width &&
    cursor.y >= getPanelY() &&
    cursor.y <= getPanelY() + TRIGGER_HEIGHT
  )
}

function isInPanelArea(cursor) {
  if (!mainWindow) return false
  // 패널이 실제로 보일 때만 검사 (슬라이드 아웃 중엔 false)
  if (targetState !== 'shown') return false
  const shownX = getShownX()
  return (
    cursor.x >= shownX &&
    cursor.x <= shownX + PANEL_WIDTH &&
    cursor.y >= getPanelY() &&
    cursor.y <= getPanelY() + getCurrentPanelHeight()
  )
}

function startHoverPolling() {
  pollTimer = setInterval(() => {
    if (!mainWindow) return
    const cursor = screen.getCursorScreenPoint()
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
  const update = getLatestUpdate()
  const template = []
  if (update) {
    template.push({
      label: `↓ 새 버전 ${update.version} 다운로드`,
      click: () => shell.openExternal(update.url)
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
  ipcMain.handle('watchlist:add', async (_e, { market, symbol }) => {
    const list = addItem(market, symbol)
    refreshAll() // immediate (don't await — UI shouldn't block)
    return list
  })
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

  ipcMain.handle('search:stocks', async (_e, { market, keyword }) => {
    const kw = String(keyword || '').trim()
    if (!kw) return []
    if (market === 'KR') return await searchKoreanStocks(kw)
    if (market === 'US') return await searchUSStocks(kw)
    return []
  })

  createWindow()
  createTray()

  startUpdateChecker(app.getVersion(), (update) => {
    refreshTrayMenu()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:update-available', update)
    }
  })

  ipcMain.handle('app:get-update', () => getLatestUpdate())

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
