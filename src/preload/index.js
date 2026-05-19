import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  getStocks: () => ipcRenderer.invoke('stocks:get-cache'),
  refreshStocks: () => ipcRenderer.invoke('stocks:refresh'),
  onStocksUpdate: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('stocks:update', handler)
    return () => ipcRenderer.off('stocks:update', handler)
  },
  checkWelcome: () => ipcRenderer.invoke('welcome:check'),
  dismissWelcome: () => ipcRenderer.invoke('welcome:dismiss'),
  showWelcomeAgain: () => ipcRenderer.invoke('welcome:show-again'),
  panelLock: () => ipcRenderer.send('panel:lock'),
  panelUnlock: () => ipcRenderer.send('panel:unlock'),
  setPanelHeight: (h) => ipcRenderer.send('panel:set-height', h),
  getWatchlist: () => ipcRenderer.invoke('watchlist:get'),
  addStock: (market, symbol) => ipcRenderer.invoke('watchlist:add', { market, symbol }),
  searchStocks: (market, keyword) =>
    ipcRenderer.invoke('search:stocks', { market, keyword }),
  removeStock: (market, symbol) =>
    ipcRenderer.invoke('watchlist:remove', { market, symbol }),
  reorderStocks: (items) => ipcRenderer.invoke('watchlist:reorder', items),
  getUpdate: () => ipcRenderer.invoke('app:get-update'),
  installUpdate: () => ipcRenderer.send('app:install-update'),
  onUpdateAvailable: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('app:update-available', handler)
    return () => ipcRenderer.off('app:update-available', handler)
  },
  onUpdateReady: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('app:update-ready', handler)
    return () => ipcRenderer.off('app:update-ready', handler)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setAutoStart: (enabled) => ipcRenderer.invoke('settings:set-autostart', enabled),
  getDonateQr: () => ipcRenderer.invoke('settings:get-donate-qr'),
  openExternal: (url) => ipcRenderer.send('shell:open-external', url)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
