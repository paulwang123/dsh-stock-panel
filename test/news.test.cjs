'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createMarket, registerRoutes } = require('../lib/market.cjs')
const ann = { success: 1, data: { list: [{ title: '公告', notice_date: '2026-11-19', art_code: 'AN202611181831832889', codes: [{ stock_code: '600000', market_code: '1' }] }] } }
const research = { data: [{ title: '研报', publishDate: '2026-08-28', orgSName: '国信证券', infoCode: 'AP202608281828618943', stockCode: '600000', market: 'SHANGHAI' }] }
const response = body => new Response(JSON.stringify(body))
test('news maps only validated records from fixed bounded upstreams', async () => {
  const requests = []
  const market = createMarket(async (url, options) => {
    requests.push(new URL(url)); if (!url.includes('push2.')) assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal)
    if (url.includes('push2.')) return response({ data: { f57: '600000', f58: '浦发银行', f43: 10 } })
    if (url.includes('search-api-web')) return new Response('stockPanelNews(' + JSON.stringify({ code: 0, result: { cmsArticleWeb: [{ title: '<em>浦发银行</em>新闻', content: '内容', date: '2026-01-01', mediaName: '媒体', url: 'http://finance.eastmoney.com/a/202611201234567890.html' }] } }) + ')')
    return response(url.includes('anotice') ? ann : research)
  })
  const result = await market.news('sh600000')
  assert.deepEqual(requests.map(u => u.origin + u.pathname), ['https://np-anotice-stock.eastmoney.com/api/security/ann', 'https://reportapi.eastmoney.com/report/list', 'https://push2.eastmoney.com/api/qt/stock/get', 'https://search-api-web.eastmoney.com/search/jsonp'])
  assert.equal(JSON.parse(requests[3].searchParams.get('param')).keyword, '浦发银行')
  assert.equal(requests[0].searchParams.get('page_size'), '20'); assert.equal(requests[1].searchParams.get('pageSize'), '20')
  assert.deepEqual(result.announcements, [{ title: '公告', date: '2026-11-19', url: 'https://data.eastmoney.com/notices/detail/600000/AN202611181831832889.html', source: '东方财富' }])
  assert.deepEqual(result.research, [{ title: '研报', date: '2026-08-28', url: 'https://pdf.dfcfw.com/pdf/H3_AP202608281828618943_1.pdf', source: '国信证券' }])
  assert.deepEqual(result.news, [{ title: '浦发银行新闻', date: '2026-01-01', url: 'https://finance.eastmoney.com/a/202611201234567890.html', source: '媒体（关键词搜索，非精确归属）' }]); assert.equal(result.errors.news, undefined); assert.equal(result.errors.research, undefined)
  await assert.rejects(market.news('sh600000&x=1')); assert.equal(requests.length, 4)
})
test('category failures, empty results, untrusted rows and bounded output', async () => {
  const market = createMarket(async url => {
    if (url.includes('anotice')) throw Error('timeout')
    return response({ data: Array.from({ length: 30 }, () => ({ ...research.data[0], title: '<b>' + 'x'.repeat(500) + '</b>', orgSName: 'a'.repeat(100) })) })
  })
  const value = await market.news('sh600000')
  assert.deepEqual(value.announcements, []); assert.ok(value.errors.announcements); assert.equal(value.research.length, 20)
  assert.equal(value.research[0].title.length, 300); assert.equal(value.research[0].source.length, 80)
  const bad = createMarket(async url => response(url.includes('anotice') ? { success: 1, data: { list: [{ ...ann.data.list[0], art_code: '../../evil' }] } } : { data: [{ ...research.data[0], market: 'SHENZHEN' }] }))
  const invalid = await bad.news('sh600000'); assert.ok(invalid.errors.announcements); assert.ok(invalid.errors.research)
  const empty = createMarket(async url => response(url.includes('anotice') ? { success: 1, data: { list: [] } } : { data: [] }))
  const e = await empty.news('sh600000'); assert.deepEqual(e.announcements, []); assert.deepEqual(e.research, []); assert.equal(e.errors.announcements, undefined)
  const malformed = createMarket(async () => response({ error: 'error' }))
  const m = await malformed.news('sh600000'); assert.ok(m.errors.announcements); assert.ok(m.errors.research)
})
test('news route rejects invalid and repeated symbols', async () => {
  const routes = new Map(); registerRoutes({ fetch: { register(r) { routes.set(r.path, r.fetch); return () => {} } } }, { news: async symbol => ({ symbol }) })
  const route = routes.get('/api/stock-panel/news')
  for (const q of ['', '?symbol=bad', '?symbol=sh600000%26x%3D1', '?symbol=sh600000&symbol=sz000001']) assert.equal((await route(new Request('http://localhost/' + q))).status, 400)
  assert.deepEqual(await (await route(new Request('http://localhost/?symbol=sh600000'))).json(), { symbol: 'sh600000' })
})
test('JSONP rejects execution, oversize, unsafe links and unrelated rows independently', async () => {
  const good = { title: '浦发银行动态', content: '', date: '2026-01-01', mediaName: '媒体', url: 'http://finance.eastmoney.com/a/202611201234567890.html' }
  const run = async payload => createMarket(async url => {
    if (url.includes('push2.')) return response({ data: { f57: '600000', f58: '浦发银行', f43: 1 } })
    if (url.includes('search-api-web')) return new Response(payload)
    return response(url.includes('anotice') ? ann : research)
  }).news('sh600000')
  const body = rows => 'stockPanelNews(' + JSON.stringify({ code: 0, result: { cmsArticleWeb: rows } }) + ')'
  const result = await run(body([good, { ...good, title: '无关' }, { ...good, url: 'https://finance.eastmoney.com.evil/a/202611201234567890.html' }, { ...good, url: 'javascript:alert(1)' }]))
  assert.equal(result.news.length, 1); assert.equal(result.announcements.length, 1)
  for (const payload of ['stockPanelNews({});globalThis.hacked=1', 'other({})', 'stockPanelNews(' + 'x'.repeat(524289) + ')']) {
    const bad = await run(payload); assert.ok(bad.errors.news); assert.equal(bad.research.length, 1)
  }
  assert.equal(globalThis.hacked, undefined)
})
test('rejects ambiguous or mismatched quote names before searching', async () => {
  for (const data of [{ f57: '600000', f58: '银行' }, { f57: '999999', f58: '浦发银行' }]) {
    let searched = false
    const market = createMarket(async url => {
      if (url.includes('push2.')) return response({ data })
      if (url.includes('search-api-web')) { searched = true; throw Error('unexpected') }
      return response(url.includes('anotice') ? ann : research)
    })
    const result = await market.news('sh600000')
    assert.ok(result.errors.news); assert.equal(searched, false); assert.equal(result.announcements.length, 1)
  }
})
