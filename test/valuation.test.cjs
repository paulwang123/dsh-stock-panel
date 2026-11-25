'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createValuation, dateRange, percentile } = require('../lib/valuation.cjs')
const { registerRoutes } = require('../lib/market.cjs')

function fixture(count = 501) {
  const end = new Date(`${dateRange().end}T00:00:00Z`)
  return Array.from({ length: count }, (_, i) => ({ market_code: '000001', trade_date: new Date(end - i * 86400000).toISOString().slice(0, 10), pe_ttm: String(i + 1) }))
}
function upstream(rows, modify = x => x) {
  return async url => {
    const q = new URL(url).searchParams, page = Number(q.get('page'))
    assert.equal(q.get('market_code'), '000001'); assert.equal(q.get('page_size'), '500')
    return modify({ code: 200, data: { pageNum: page, pageSize: 500, total: rows.length, pages: Math.ceil(rows.length / 500), records: rows.slice((page - 1) * 500, page * 500) } }, page)
  }
}
test('linear percentiles and leap date range', () => {
  assert.equal(percentile([1, 2, 3, 4], .2), 1.6)
  assert.deepEqual(dateRange(new Date('2024-02-29T04:00:00Z')), { start: '2019-02-28', end: '2024-02-29' })
})
test('reads all pages, maps PE not index, sorts dates and caches', async () => {
  let calls = 0; const fetch = upstream(fixture())
  const valuation = createValuation(async u => { calls++; return fetch(u) })
  const [r, same] = await Promise.all([valuation('sh000001'), valuation('sh000001')])
  assert.equal(calls, 2); assert.deepEqual(r, same); assert.equal(r.sampleSize, 501)
  assert.equal(r.value, 1); assert.equal(r.low, 101); assert.equal(r.median, 251); assert.equal(r.high, 401)
  assert.equal(r.points[0].value, 501); assert.match(r.warning, /非实时/)
  await valuation('sh000001'); assert.equal(calls, 2)
})
test('caches both supported markets independently', async () => {
  let calls = 0
  const valuation = createValuation(async url => {
    calls++
    const code = new URL(url).searchParams.get('market_code')
    return { code: 200, data: { pageNum: 1, pageSize: 500, total: 1, pages: 1, records: [{ market_code: code, trade_date: dateRange().end, pe_ttm: '12' }] } }
  })
  await valuation('sh000001'); await valuation('sz399001')
  await valuation('sh000001'); await valuation('sz399001')
  assert.equal(calls, 2)
})
test('rejects incomplete, changing, duplicate or invalid data', async () => {
  const rows = fixture()
  for (const change of [
    (b, p) => { if (p === 2) b.data.records = []; return b },
    (b, p) => { if (p === 2) b.data.total++; return b },
    (b, p) => { if (p === 2) b.data.records[0] = rows[0]; return b },
    b => { b.data.records[0] = { ...b.data.records[0], market_code: '399001' }; return b },
    b => { b.data.records[0] = { ...b.data.records[0], trade_date: '2025-02-30' }; return b },
    b => { b.data.records[0] = { ...b.data.records[0], pe_ttm: '' }; return b },
    b => { b.code = 500; return b }
  ]) await assert.rejects(createValuation(upstream(rows, change))('sh000001'))
})
test('route only accepts supported index symbols', async () => {
  const routes = new Map()
  registerRoutes({ fetch: { register(r) { routes.set(r.path, r.fetch); return () => {} } } }, { valuation: async symbol => ({ symbol }) })
  const route = routes.get('/api/stock-panel/valuation')
  for (const query of ['symbol=sh600000', 'symbol=sh000001&symbol=sz399001', '']) assert.equal((await route(new Request(`http://localhost/?${query}`))).status, 400)
  assert.deepEqual(await (await route(new Request('http://localhost/?symbol=sz399001'))).json(), { symbol: 'sz399001' })
})
