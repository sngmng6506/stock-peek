import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import fs from 'node:fs'
import { finiteNumber, positivePrice } from '../src/main/markets/numbers.js'
import { previousClose } from '../src/main/markets/previousClose.js'

function provider(file, dependencies, expression) {
  const source = fs
    .readFileSync(new URL(`../src/main/markets/${file}.js`, import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({
    USER_AGENT: 'test',
    finiteNumber,
    positivePrice,
    previousClose,
    ...dependencies
  })
  return vm.runInContext(`${source}\n${expression}`, context)
}

test('a stalled Naver chart does not block the quote; missing raw fields use formatted prices', async () => {
  const naver = provider(
    'naver',
    {
      fetchJson: (url) =>
        url.includes('polling.finance')
          ? Promise.resolve({
              ok: true,
              data: {
                datas: [
                  {
                    stockName: 'test',
                    closePriceRaw: null,
                    closePrice: '70,000',
                    compareToPreviousClosePrice: '100',
                    fluctuationsRatio: '0.14'
                  }
                ]
              }
            })
          : new Promise(() => {})
    },
    'naverProvider'
  )
  const result = await Promise.race([
    naver.fetch('005930'),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Chart blocked quote')), 1000)
      timer.unref()
    })
  ])
  assert.equal(result.price, 70000)
})

test('Yahoo null price falls back to valid last close and stays invalid without bars', async () => {
  let closes = [100, 110]
  const yahoo = provider(
    'yahoo',
    {
      fetchJson: async () => ({
        ok: true,
        data: {
          chart: {
            result: [
              {
                meta: { regularMarketPrice: null },
                timestamp: [1, 2],
                indicators: { quote: [{ close: closes }] }
              }
            ]
          }
        }
      })
    },
    "createYahooProvider({market:'US'})"
  )
  assert.equal((await yahoo.fetch('AAPL')).price, 110)
  closes = []
  assert.ok(Number.isNaN((await yahoo.fetch('AAPL')).price))
})
