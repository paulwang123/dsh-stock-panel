'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validSymbol, secid, createMarket, registerRoutes } = require('../lib/market.cjs')
test('symbol validation and market mapping', () => {
  assert.equal(validSymbol('sh600000'), true); assert.equal(validSymbol('sh600000&x=1'), false)
  assert.equal(secid('sh000001'), '1.000001'); assert.equal(secid('sz000001'), '0.000001')
})
test('parse quote and both chart periods with fixed upstream URLs', async () => {
  const urls = []
  const market = createMarket(async url => {
    urls.push(url)
    const data = url.includes('trends2') ? { code: '600000', market: 1, name: '测试', trends: ['2026-01-01 09:30,10,11,12,9,100,1100,10'] } : url.includes('kline') ? { code: '600000', market: 1, name: '测试', klines: ['2026-01-01,10,12,13,9,200,2400'] } : { f57: '600000', f58: '测试', f43: 12, f169: 1, f170: 9.1, f86: 1 }
    return new Response(JSON.stringify({ data }))
  })
  assert.equal((await market.quote('sh600000')).price, 12)
  assert.deepEqual((await market.chart('sh600000', 'minute')).points[0], { time: '2026-01-01 09:30', price: 11, volume: 100 })
  assert.equal((await market.chart('sh600000', 'daily')).points[0].volume, 200)
  assert.ok(urls.every(url => new URL(url).hostname.endsWith('.eastmoney.com')))
  assert.equal(new URL(urls[2]).searchParams.get('end'), '20500101')
  await market.quote('sh600000'); assert.equal(urls.length, 3)
})
test('search uses fixed endpoint and filters non-A-shares, malformed and duplicate results', async () => {
  let called = 0
  const market = createMarket(async (url, options) => {
    called++
    const parsed = new URL(url)
    assert.equal(parsed.origin + parsed.pathname, 'https://searchadapter.eastmoney.com/api/suggest/get')
    assert.deepEqual(Object.fromEntries(parsed.searchParams), { input: 'PFYH', type: '14', count: '10' })
    assert.ok(options.signal instanceof AbortSignal)
    const sh = { Code: '600000', Name: '浦发银行', Classify: 'AStock', SecurityTypeName: '沪A', QuoteID: '1.600000' }
    return new Response(JSON.stringify({ QuotationCodeTable: { Status: 0, Data: [sh, sh, { Code: '000001', Name: '上证指数', Classify: 'Index', SecurityTypeName: '指数', QuoteID: '1.000001' }, { Code: '000001', Name: '平安银行', Classify: 'AStock', SecurityTypeName: '深A', QuoteID: '0.000001' }, { Code: '920047', Name: '诺思兰德', Classify: 'NEEQ', SecurityTypeName: '京A', QuoteID: '0.920047' }, { ...sh, QuoteID: '0.600000' }] } }))
  })
  assert.deepEqual(await market.search('pfyh'), [{ symbol: 'sh600000', code: '600000', name: '浦发银行' }, { symbol: 'sz000001', code: '000001', name: '平安银行' }, { symbol: 'bj920047', code: '920047', name: '诺思兰德' }])
  for (const invalid of ['', 'a&count=99', '中', 'a'.repeat(13), null]) await assert.rejects(market.search(invalid))
  assert.equal(called, 1)
})
test('search handles empty, malformed, excessive and failing upstream responses', async () => {
  const create = body => createMarket(async () => (new Response(JSON.stringify(body))))
  assert.deepEqual(await create({ QuotationCodeTable: { Status: 0, Data: null } }).search('x'), [])
  await assert.rejects(create({}).search('x'))
  await assert.rejects(create({ QuotationCodeTable: { Status: 1, Data: [] } }).search('x'))
  const rows = Array.from({ length: 20 }, (_, i) => ({ Code: String(600000 + i), Name: '股票', Classify: 'AStock', SecurityTypeName: '沪A', QuoteID: `1.${600000 + i}` }))
  assert.equal((await create({ QuotationCodeTable: { Status: 0, Data: rows } }).search('x')).length, 10)
  await assert.rejects(createMarket(async () => ({ ok: false, status: 503 })).search('x'), /503/)
  await assert.rejects(createMarket(async (_url, { signal }) => { assert.ok(signal); throw new Error('timeout') }).search('x'), /timeout/)
})
test('search route validates input and exposes a bounded response', async () => {
  const routes = new Map()
  registerRoutes({ fetch: { register(route) { routes.set(route.path, route.fetch); return () => {} } } }, { search: async q => { if (q === 'FAIL') throw Error('offline'); return [{ symbol: 'sh600000', code: '600000', name: '浦发银行' }] } })
  const search = routes.get('/api/stock-panel/search')
  for (const query of ['', '?q=', '?q=a%26b', '?q=abc&q=def', '?q=abcdefghijklmn', '?q=%E4%B8%AD']) assert.equal((await search(new Request(`http://localhost/api/stock-panel/search${query}`))).status, 400)
  const response = await search(new Request('http://localhost/api/stock-panel/search?q=pfyh'))
  assert.deepEqual(await response.json(), { results: [{ symbol: 'sh600000', code: '600000', name: '浦发银行' }] })
  assert.equal((await search(new Request('http://localhost/api/stock-panel/search?q=FAIL'))).status, 502)
})
test('routes validate input, report upstream failures and dispose', async () => {
  const routes = new Map(), disposed = []
  const connection = { fetch: { register(route) { routes.set(route.path, route.fetch); return () => disposed.push(route.path) } } }
  const dispose = registerRoutes(connection, { quote: async s => { if (s === 'sz000001') throw Error('no quote'); return { symbol: s } }, chart: async () => ({ points: [] }) })
  const quotes = routes.get('/api/stock-panel/quotes')
  assert.equal((await quotes(new Request('http://localhost/api/stock-panel/quotes?symbols=invalid'))).status, 400)
  const res = await quotes(new Request('http://localhost/api/stock-panel/quotes?symbols=sh600000,sz000001'))
  const body = await res.json(); assert.equal(body.quotes.length, 1); assert.equal(body.errors.length, 1)
  const chart = routes.get('/api/stock-panel/chart')
  assert.equal((await chart(new Request('http://localhost/api/stock-panel/chart?symbol=sh600000&period=other'))).status, 400)
  await dispose(); assert.equal(disposed.length, routes.size)
})

test('detail maps real-format quote and transactions with fixed URLs', async () => {
  const urls = []
  const market = createMarket(async url => {
    urls.push(new URL(url))
    const data = url.includes('/details/') ? { code: '600000', market: 1, details: ['11:29:33,10.67,56,36,2', '11:29:36,10.66,185,28,1', '11:29:39,-,-,0,4', 'bad,x,-1,0,99'] } : { f57: '600000', f58: '浦发银行', f43: 10.65, f44: 10.76, f45: 10.6, f46: 10.68, f47: 408981, f48: 436395603, f60: 10.7, f86: 1795146717, f168: 0.12, f169: -0.05, f170: -0.47 }
    return new Response(JSON.stringify({ data }))
  })
  const d = await market.detail('sh600000')
  assert.deepEqual(d, { name: '浦发银行', symbol: 'sh600000', price: 10.65, change: -0.05, percent: -0.47, time: 1795146717, open: 10.68, high: 10.76, low: 10.6, previous: 10.7, volume: 408981, amount: 436395603, turnover: 0.12, transactions: [{ time: '11:29:33', price: 10.67, volume: 56, side: 'buy' }, { time: '11:29:36', price: 10.66, volume: 185, side: 'sell' }, { time: '11:29:39', price: null, volume: null, side: 'neutral' }, { time: null, price: null, volume: null, side: null }] })
  assert.deepEqual(urls.map(u => u.origin + u.pathname), ['https://push2.eastmoney.com/api/qt/stock/get', 'https://push2.eastmoney.com/api/qt/stock/details/get'])
  assert.equal(urls[0].searchParams.get('fltt'), '2'); assert.equal(urls[1].searchParams.get('pos'), '-50')
  await assert.rejects(market.detail('sh600000&pos=1'))
})
test('detail tolerates individual upstream failures and rejects total failure', async () => {
  const make = (quoteOK, tradeOK) => createMarket(async url => {
    const isTrade = url.includes('/details/')
    if (isTrade ? !tradeOK : !quoteOK) throw Error('offline')
    return new Response(JSON.stringify({ data: isTrade ? { code: '600000', market: 1, details: [] } : { f57: '600000', f58: '浦发银行', f43: '-' } }))
  })
  const q = await make(true, false).detail('sh600000'); assert.equal(q.price, null); assert.equal(q.transactions, null)
  const t = await make(false, true).detail('sh600000'); assert.equal(t.name, null); assert.equal(t.price, null); assert.deepEqual(t.transactions, [])
  await assert.rejects(make(false, false).detail('sh600000'), /均不可用/)
  const mismatch = createMarket(async url => (new Response(JSON.stringify({ data: url.includes('/details/') ? { code: '000001', market: 0, details: [] } : { f57: '000001' } }))))
  await assert.rejects(mismatch.detail('sh600000'), /均不可用/)
})
test('detail route validates symbol and returns upstream failures', async () => {
  const routes = new Map()
  registerRoutes({ fetch: { register(r) { routes.set(r.path, r.fetch); return () => {} } } }, { detail: async s => { if (s === 'sz000001') throw Error('offline'); return { symbol: s } } })
  const route = routes.get('/api/stock-panel/detail')
  for (const query of ['', '?symbol=bad', '?symbol=sh600000%26x%3D1', '?symbol=sh600000&symbol=sz000001']) assert.equal((await route(new Request('http://localhost/api/stock-panel/detail' + query))).status, 400)
  assert.deepEqual(await (await route(new Request('http://localhost/api/stock-panel/detail?symbol=sh600000'))).json(), { symbol: 'sh600000' })
  assert.equal((await route(new Request('http://localhost/api/stock-panel/detail?symbol=sz000001'))).status, 502)
})
