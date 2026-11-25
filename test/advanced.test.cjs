'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createMarket, registerRoutes } = require('../lib/market.cjs')
const response = data => new Response(JSON.stringify({ data }))
const bars = ['2026-01-01,10,10,10,10,100,1000,0,0,0,5', '2026-01-02,20,20,20,20,100,2000,0,0,0,25']
const stock = klines => ({ code: '600000', market: 1, klines })
test('chips uses forward adjusted bars, decay, fixed buckets and exact percentages', async () => {
  let url
  const market = createMarket(async (u, opts) => { url = new URL(u); assert.equal(opts.redirect, 'error'); return response(stock(bars)) })
  const result = await market.chips('sh600000')
  assert.equal(url.origin + url.pathname, 'https://push2his.eastmoney.com/api/qt/stock/kline/get')
  assert.equal(url.searchParams.get('fqt'), '1'); assert.equal(url.searchParams.get('klt'), '101')
  assert.equal(result.asOf, '2026-01-02'); assert.equal(result.adjustment, 'forward')
  assert.deepEqual(result.distribution.map(x => x.percentage), [75, 25])
  assert.match(result.warning, /并非真实筹码/)
  assert.ok(Math.abs(result.distribution.reduce((s, x) => s + x.percentage, 0) - 100) < 1e-9)
})
test('chips rejects missing, inconsistent and mismatched history', async () => {
  for (const data of [stock([]), stock([bars[0].replace(',5', ',-')]), stock([bars[1], bars[0]]), stock(['2026-01-01,10,20,15,10,1,1,0,0,0,1']), { ...stock(bars), market: 0 }]) {
    await assert.rejects(createMarket(async () => response(data)).chips('sh600000'))
  }
  await assert.rejects(createMarket(async () => response(stock(bars))).chips('sh600000&x=1'))
})
test('flow prefers primary minute and maps all amounts in yuan', async () => {
  const calls = []
  const market = createMarket(async (u, opts) => { calls.push(new URL(u)); assert.equal(opts.redirect, 'error'); assert.ok(opts.signal instanceof AbortSignal); return response(stock(['2026-01-02 09:31,100,-50,-50,70,30', '2026-01-02 09:32,-20,10,10,-10,-10'])) })
  const data = await market.flow('sh600000')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].origin + calls[0].pathname, 'https://push2.eastmoney.com/api/qt/stock/fflow/kline/get')
  assert.equal(calls[0].searchParams.get('klt'), '1'); assert.equal(data.unit, '元'); assert.equal(data.mode, 'minute')
  assert.deepEqual(data.points[0], { time: '2026-01-02 09:31', main: 100, small: -50, medium: -50, large: 70, extraLarge: 30 })
  assert.equal(data.asOf, '2026-01-02 09:32')
})
test('flow tries both minute hosts before daily hosts, preserving daily values', async () => {
  const calls = []
  const market = createMarket(async u => {
    const url = new URL(u); calls.push(url.origin + url.pathname)
    if (calls.length === 1) throw Error('offline')
    if (calls.length === 2) return response(stock([]))
    if (calls.length === 3) return response(stock([]))
    return response(stock(['2026-01-01,123,-1,-2,3,4', '2026-01-02,-20,10,10,-10,-10']))
  })
  const data = await market.flow('sh600000')
  assert.deepEqual(calls, ['https://push2.eastmoney.com/api/qt/stock/fflow/kline/get', 'https://push2his.eastmoney.com/api/qt/stock/fflow/kline/get', 'https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get', 'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get'])
  assert.equal(data.mode, 'daily'); assert.equal(data.asOf, '2026-01-02'); assert.match(data.meaning, /非分钟或实时/)
  assert.deepEqual(data.points[0], { time: '2026-01-01', main: 123, small: -1, medium: -2, large: 3, extraLarge: 4 })
})
test('flow uses minute backup and differentiates empty from failure', async () => {
  let count = 0
  const minute = await createMarket(async () => ++count === 1 ? response(stock([])) : response(stock(['2026-01-02 09:31,1,2,3,4,5']))).flow('sh600000')
  assert.equal(count, 2); assert.equal(minute.mode, 'minute')
  const empty = await createMarket(async () => response(stock([]))).flow('sh600000')
  assert.deepEqual(empty.points, []); assert.equal(empty.asOf, null); assert.equal(empty.mode, 'daily')
  await assert.rejects(createMarket(async () => { throw Error('offline') }).flow('sh600000'), /上游不可用/)
  await assert.rejects(createMarket(async () => new Response('', { status: 302, headers: { location: 'https://evil.example/' } })).flow('sh600000'), /上游不可用/)
  await assert.rejects(createMarket(async () => { throw Error('timeout') }).flow('sh600000'), /上游不可用/)
  await assert.rejects(createMarket(async () => response(stock([]))).flow('sh600000&x=1'), /股票代码无效/)
})
test('flow rejects malformed, missing, mixed-day and incorrect security data', async () => {
  for (const data of [stock(['2026-01-02 09:31,1,2,   ,4,5']), stock(['2026-01-02 09:31,1,2,0x10,4,5']), stock(['2026-01-02 09:31,1,2,-,4,5']), stock(['2026-01-02 09:31,1,2,3,4,5', '2026-01-03 09:31,1,2,3,4,5']), { ...stock([]), code: '000001' }, { ...stock([]), market: 0 }, stock(null)]) {
    await assert.rejects(createMarket(async () => response(data)).flow('sh600000'), /上游不可用/)
  }
  let count = 0
  const result = await createMarket(async () => ++count < 3 ? response({ ...stock(['2026-01-02 09:31,1,2,3,4,5']), code: '000001' }) : response(stock(['2026-01-02,1,2,3,4,5']))).flow('sh600000')
  assert.equal(result.mode, 'daily'); assert.equal(result.asOf, '2026-01-02')
})
test('advanced routes validate duplicate and malformed symbols, and report failures', async () => {
  const routes = new Map()
  const dispose = registerRoutes({ fetch: { register(r) { routes.set(r.path, r.fetch); return () => {} } } }, { chips: async symbol => ({ symbol }), flow: async () => { throw Error('offline') } })
  for (const action of ['chips', 'flow']) {
    const route = routes.get(`/api/stock-panel/${action}`)
    for (const q of ['', '?symbol=bad', '?symbol=sh600000&symbol=sz000001', '?symbol=sh600000%26x%3D1']) assert.equal((await route(new Request(`http://localhost/?${q.replace(/^\?/, '')}`))).status, 400)
  }
  assert.deepEqual(await (await routes.get('/api/stock-panel/chips')(new Request('http://localhost/?symbol=sh600000'))).json(), { symbol: 'sh600000' })
  assert.equal((await routes.get('/api/stock-panel/flow')(new Request('http://localhost/?symbol=sh600000'))).status, 502)
  await dispose()
})
