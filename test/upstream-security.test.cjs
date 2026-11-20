'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createMarket } = require('../lib/market.cjs')

const json = x => new Response(JSON.stringify(x))
test('quote and both charts reject mismatched or missing security identity', async () => {
  for (const data of [{ f57: '000001', f58: '错误', f43: 1 }, { f58: '无代码', f43: 1 }]) {
    await assert.rejects(createMarket(async () => json({ data })).quote('sh600000'), /代码不匹配/)
  }
  for (const period of ['minute', 'daily']) {
    for (const data of [{ code: '000001', market: 1 }, { code: '600000', market: 0 }, { code: '600000' }]) {
      await assert.rejects(createMarket(async () => json({ data })).chart('sh600000', period), /代码不匹配/)
    }
  }
  const market = createMarket(async url => json({ data: url.includes('stock/get') ? { f57: '000001', f58: '平安银行', f43: 1 } : { code: '000001', market: 0, trends: [], klines: [] } }))
  assert.equal((await market.quote('sz000001')).symbol, 'sz000001')
  assert.deepEqual((await market.chart('sz000001', 'minute')).points, [])
})

test('all fixed upstreams use redirect error and a finite abort signal', async () => {
  const urls = []
  const market = createMarket(async (url, options) => {
    urls.push(url); assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal)
    if (url.includes('search-api-web')) return new Response('stockPanelNews({"code":0,"result":{"cmsArticleWeb":[]}})')
    if (url.includes('searchadapter')) return json({ QuotationCodeTable: { Status: 0, Data: [] } })
    if (url.includes('anotice')) return json({ success: 1, data: { list: [] } })
    if (url.includes('reportapi')) return json({ data: [] })
    if (url.includes('/details/')) return json({ data: { code: '600000', market: 1, details: [] } })
    if (url.includes('push2his')) return json({ data: { code: '600000', market: 1, trends: [], klines: [] } })
    return json({ data: { f57: '600000', f58: '浦发银行', f43: 1 } })
  })
  await market.quote('sh600000'); await market.chart('sh600000', 'minute'); await market.chart('sh600000', 'daily')
  await market.search('abc'); await market.detail('sh600000'); await market.news('sh600000')
  assert.equal(urls.length, 9)
})

test('bounded reads reject dishonest headers, oversized chunks and json-only mocks', async () => {
  for (const response of [
    () => new Response('{}', { headers: { 'content-length': '524289' } }),
    () => new Response('{}', { headers: { 'content-length': 'invalid' } }),
    () => new Response('x'.repeat(524289), { headers: { 'content-length': '1' } }),
    () => ({ ok: true, json: async () => ({ data: {} }) })
  ]) await assert.rejects(createMarket(async () => response()).quote('sh600000'), /过大|不可读取/)
  await assert.rejects(createMarket(async () => new Response('x'.repeat(131073))).search('abc'), /过大/)
  let cancelled = false
  const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(524289)) }, cancel() { cancelled = true } })
  await assert.rejects(createMarket(async () => new Response(body)).quote('sh600000'), /过大/)
  assert.equal(cancelled, true)
})
