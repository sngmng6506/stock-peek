import { BrowserWindow, shell } from 'electron'

// Report documents are static HTML: no JavaScript, no preload, no navigation inside the window.
const WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  javascript: false,
  webSecurity: true,
  spellcheck: false
}

function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

function harden(win) {
  const contents = win.webContents
  // Source links open in the default browser; the report window never navigates away.
  contents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (isHttps(url)) shell.openExternal(url)
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttps(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

const toDataUrl = (html) => 'data:text/html;charset=utf-8,' + encodeURIComponent(html)

// destroy() tears down the shared renderer process before Chromium is done with it, and the
// next data: URL load in a new window then fails with ERR_FAILED. Close gracefully instead.
function closeWindow(win) {
  if (win.isDestroyed()) return Promise.resolve()
  return new Promise((resolve) => {
    win.once('closed', resolve)
    win.close()
  })
}

let viewer = null

export async function openReportViewer(html, title) {
  if (!viewer || viewer.isDestroyed()) {
    viewer = new BrowserWindow({
      width: 820,
      height: 1000,
      show: false,
      autoHideMenuBar: true,
      title,
      backgroundColor: '#ffffff',
      webPreferences: WEB_PREFERENCES
    })
    harden(viewer)
    viewer.on('page-title-updated', (event) => event.preventDefault())
    viewer.on('closed', () => {
      viewer = null
    })
  }
  viewer.setTitle(title)
  await viewer.loadURL(toDataUrl(html))
  viewer.show()
  viewer.focus()
}

// Renders the document off-screen as A4 PDF (as many pages as the content needs).
export async function printReportPdf(html) {
  const win = new BrowserWindow({ show: false, webPreferences: WEB_PREFERENCES })
  harden(win)
  try {
    await win.loadURL(toDataUrl(html))
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      generateDocumentOutline: false
    })
  } finally {
    await closeWindow(win)
  }
}
