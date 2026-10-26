// Windows/macOS runner에서 실제 Electron main + preload + renderer를 실행해
// (SMOKE_APP을 주면 빌드 대신 배포된 앱 실행 파일로)
// 일본·사우디 현지어 검색과 시세 공급처 응답을 확인한다.
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { setTimeout: delay } = require('node:timers/promises')

const PORT = 19339
const MAIN_PORT = 19340
// SMOKE_APP: 배포된 앱 실행 파일 (예: Stock Peek.app/Contents/MacOS/Stock Peek). 없으면 out/ 빌드를 Electron으로 실행
const packagedApp = process.env.SMOKE_APP
const smokeData = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-peek-smoke-'))
const bootstrap = packagedApp ? null : path.resolve('out/main/smoke-bootstrap.cjs')
if (bootstrap) {
  fs.writeFileSync(
    bootstrap,
    `globalThis.__smokeElectron = require('electron');
globalThis.__smokeElectron.app.setPath('userData', ${JSON.stringify(smokeData)});
require('./index.js');`
  )
}
const child = spawn(
  packagedApp || require('electron'),
  [
    `--remote-debugging-port=${PORT}`,
    `--inspect=${MAIN_PORT}`,
    '--remote-allow-origins=*',
    ...(packagedApp ? [`--user-data-dir=${smokeData}`] : [bootstrap])
  ],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } }
)
let log = ''
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    log = (log + chunk.toString()).slice(-12_000)
  })
}

// 호출마다 60초 (전체 실행 기준이면 느린 Intel 러너에서 두 번째 호출이 바로 실패)
async function rendererTarget() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await response.json()
      const page = targets.find(
        (target) => target.type === 'page' && target.url.includes('renderer/index.html')
      )
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Electron is still starting.
    }
    await delay(250)
  }
  throw new Error(`Electron renderer did not start (exit ${child.exitCode}).\n${log}`)
}

function evaluate(url, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('Renderer smoke timed out'))
    }, 120_000)
    const finish = (error, value) => {
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else resolve(value)
    }
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        })
      )
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== 1) return
      if (message.error || message.result?.exceptionDetails) {
        finish(new Error(JSON.stringify(message.error || message.result.exceptionDetails)))
      } else {
        finish(null, message.result?.result?.value)
      }
    })
    socket.addEventListener('error', (error) => finish(error))
  })
}

const probe = `(async () => {
  const until = Date.now() + 20000;
  while ((!window.api || !document.querySelector('.panel')) && Date.now() < until)
    await new Promise(resolve => setTimeout(resolve, 100));
  if (!window.api) throw new Error('Preload API unavailable');
  const jp = await window.api.searchStocks('JP', 'トヨタ');
  const sa = await window.api.searchStocks('SA', 'أرامكو');
  if (!jp.some(item => item.symbol === '7203')) throw new Error('Japanese search failed');
  if (!sa.some(item => item.symbol === '2222')) throw new Error('Arabic search failed');
  await window.api.addStock('JP', '7203', { quantity: 10, avgPrice: 2000 });
  await window.api.addStock('SA', '2222');
  let quotes = await window.api.refreshStocks();
  const reordered = await window.api.reorderStocks(quotes.map(q => ({market:q.market,symbol:q.symbol})).reverse());
  if (reordered.find(q => q.symbol === '7203')?.quantity !== 10) throw new Error('Reorder erased holding');
  let rejected = false;
  try { await window.api.updateHolding('JP', '7203', {quantity:-1, avgPrice:2000}); }
  catch { rejected = true; }
  if (!rejected) throw new Error('Invalid holding accepted');
  quotes = await window.api.refreshStocks();
  if (quotes.find(q => q.symbol === '7203')?.quantity !== 10) throw new Error('Invalid edit erased holding');
  // Dismiss welcome in both React and main before exercising settings.
  document.querySelector('.welcome-modal .modal-actions button')?.click();
  await window.api.dismissWelcome();
  document.querySelector('.actions button:nth-child(3)').click();
  await new Promise(resolve => setTimeout(resolve, 200));
  for (const lang of ['ko', 'en', 'ja', 'ar']) {
    const select = document.querySelector('.lang-select');
    if (!select) throw new Error('Settings language selector missing');
    select.value = lang;
    select.dispatchEvent(new Event('change', {bubbles:true}));
    await new Promise(resolve => setTimeout(resolve, 100));
    if (document.documentElement.lang !== lang || document.documentElement.dir !== (lang === 'ar' ? 'rtl' : 'ltr'))
      throw new Error('Language/RTL switch failed: ' + lang);
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  return {
    platform: navigator.platform,
    language: document.documentElement.lang,
    markets: ['JP', 'SA'].map(market => {
      const item = quotes.find(q => q.market === market);
      const card = document.querySelector('.card .name[title="' + item?.symbol + '"]')?.closest('.card');
      return { market, symbol: item?.symbol, price: item?.price,
        error: item?.error, cardVisible: Boolean(card) };
    })
  };
})()`

;(async () => {
  try {
    const result = await evaluate(await rendererTarget(), probe)
    const targets = await (await fetch(`http://127.0.0.1:${MAIN_PORT}/json/list`)).json()
    const mainUrl = targets[0].webSocketDebuggerUrl
    const native = await evaluate(
      mainUrl,
      `(async () => {
      const {BrowserWindow, screen} = globalThis.__smokeElectron || process.mainModule.require('electron');
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html'));
      const originalCursor = screen.getCursorScreenPoint;
      const area = screen.getPrimaryDisplay().workArea;
      screen.getCursorScreenPoint = () => ({x:area.x + area.width/2, y:area.y + area.height/2});
      await new Promise(r => setTimeout(r, 600));
      const hidden = !win.isVisible();
      screen.getCursorScreenPoint = originalCursor;
      if (!hidden) throw new Error('Unpinned settings panel did not auto-hide');
      return {settingsAutoHide:true};
    })()`
    )
    await evaluate(await rendererTarget(), `window.api.pinPanel()`)
    const pinned = await evaluate(
      mainUrl,
      `(async () => {
      const {BrowserWindow, screen} = globalThis.__smokeElectron || process.mainModule.require('electron');
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html'));
      const cursor = screen.getCursorScreenPoint;
      screen.getCursorScreenPoint = () => ({x:-100000, y:-100000});
      await new Promise(r => setTimeout(r, 600));
      const visible = win.isVisible();
      screen.getCursorScreenPoint = cursor;
      if (!visible) throw new Error('Pinned panel was hidden');
      const all = screen.getAllDisplays;
      const primary = screen.getPrimaryDisplay;
      const d = primary();
      const replacement = {...d, id:d.id+10000, workArea:{x:0,y:0,width:800,height:600}};
      try {
        screen.getAllDisplays = () => [replacement];
        screen.getPrimaryDisplay = () => replacement;
        screen.emit('display-removed', {}, d);
        await new Promise(r => setTimeout(r, 350));
        const b = win.getBounds();
        if (b.x < 0 || b.y < 0 || b.x+b.width > 800 || b.y+b.height > 600)
          throw new Error('Display fallback bounds invalid: '+JSON.stringify(b));
      } finally {
        screen.getAllDisplays = all;
        screen.getPrimaryDisplay = primary;
        screen.emit('display-metrics-changed', {}, d, ['workArea']);
      }
      return {pinKeepsVisible:true, simulatedDisplayRemoval:true};
    })()`
    )
    result.native = { ...native, ...pinned }
    for (const market of result.markets) {
      if (!Number.isFinite(market.price) || !market.cardVisible) {
        throw new Error(`Native quote check failed: ${JSON.stringify(result)}\n${log}`)
      }
    }
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    child.kill()
    if (bootstrap) fs.rmSync(bootstrap, { force: true })
    // The OS runner also clears the isolated profile if Electron still holds files.
    child.once('exit', () => {
      try {
        fs.rmSync(smokeData, { recursive: true, force: true })
      } catch {
        /* still locked */
      }
    })
  }
})()
