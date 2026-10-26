// Windows/macOS runner에서 실제 Electron main + preload + renderer를 실행해
// 일본·사우디 현지어 검색과 시세 공급처 응답을 확인한다.
const { spawn } = require('node:child_process')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

const PORT = 19339
const deadline = Date.now() + 60_000
const electron = require('electron')
const child = spawn(
  electron,
  [
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    path.resolve('out/main/index.js')
  ],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } }
)
let log = ''
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    log = (log + chunk.toString()).slice(-12_000)
  })
}

async function rendererTarget() {
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
    }, 75_000)
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
  await window.api.addStock('JP', '7203');
  await window.api.addStock('SA', '2222');
  const quotes = await window.api.refreshStocks();
  await new Promise(resolve => setTimeout(resolve, 300));
  return {
    platform: navigator.platform,
    language: document.documentElement.lang,
    markets: ['JP', 'SA'].map(market => {
      const item = quotes.find(q => q.market === market);
      const card = document.querySelector('.card .name[title="' + item?.symbol + '"]')?.closest('.card');
      return { market, symbol: item?.symbol, price: item?.price,
        quoteTime: item?.quoteTime, fetchedAt: item?.fetchedAt,
        error: item?.error, cardVisible: Boolean(card), timeVisible: Boolean(card?.querySelector('.quote-status')) };
    })
  };
})()`

;(async () => {
  try {
    const result = await evaluate(await rendererTarget(), probe)
    for (const market of result.markets) {
      if (
        !Number.isFinite(market.price) ||
        !market.quoteTime ||
        !market.cardVisible ||
        !market.timeVisible
      ) {
        throw new Error(`Native quote check failed: ${JSON.stringify(result)}\n${log}`)
      }
    }
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    child.kill()
  }
})()
