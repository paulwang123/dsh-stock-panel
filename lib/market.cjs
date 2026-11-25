'use strict'
// All upstream URLs and parameters are fixed here: this is not a general proxy.
const { createValuation } = require('./valuation.cjs')
const validSymbol = s => /^(?:sh|sz|bj)\d{6}$/.test(s)
const secid = s => `${s.startsWith('sh') ? 1 : 0}.${s.slice(2)}`
const number = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
function createMarket(fetcher = fetch) {
  const cache = new Map(), pending = new Map()
  // Bound decoded response bytes, not just the optional (possibly compressed) Content-Length.
  async function fetchText(url, maxBytes, accept = 'application/json') {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { accept, 'user-agent': 'Mozilla/5.0' } })
    if (!response.ok) throw new Error(`行情源返回 HTTP ${response.status}`)
    const length = response.headers?.get('content-length')
    if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error('上游响应过大')
    if (!response.body || typeof response.body.getReader !== 'function') throw new Error('上游响应不可读取')
    const reader = response.body.getReader(), chunks = []; let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) { void reader.cancel().catch(() => {}); throw new Error('上游响应过大') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(total); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  async function fetchJson(url, maxBytes = 512 * 1024) {
    return JSON.parse(await fetchText(url, maxBytes))
  }
  async function get(key, url) {
    const item = cache.get(key)
    if (item && item.until > Date.now()) return item.value
    if (pending.has(key)) return pending.get(key)
    const promise = (async () => {
      const value = await fetchJson(url)
      if (!value || !value.data) throw new Error('行情源无数据，代码可能不存在或暂不可用')
      cache.set(key, { until: Date.now() + 15000, value: value.data })
      if (cache.size > 300) cache.delete(cache.keys().next().value)
      return value.data
    })().finally(() => pending.delete(key))
    pending.set(key, promise)
    return promise
  }
  async function quote(symbol) {
    const query = new URLSearchParams({ secid: secid(symbol), fltt: '2', fields: 'f43,f57,f58,f60,f86,f169,f170' })
    const d = await get(`q:${symbol}`, `https://push2.eastmoney.com/api/qt/stock/get?${query}`)
    if (d.f57 !== symbol.slice(2)) throw new Error('行情代码不匹配')
    if (!d.f58 || number(d.f43) === null) throw new Error(`代码 ${symbol} 暂无报价`)
    return { symbol, name: d.f58, price: number(d.f43), change: number(d.f169), percent: number(d.f170), time: number(d.f86) }
  }
  async function detail(symbol) {
    if (typeof symbol !== 'string' || !validSymbol(symbol)) throw new Error('股票代码无效')
    const fields = 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f86,f168,f169,f170'
    const quoteQuery = new URLSearchParams({ secid: secid(symbol), fltt: '2', fields })
    const tradeQuery = new URLSearchParams({ secid: secid(symbol), pos: '-50', fields1: 'f1,f2,f3,f4,f5', fields2: 'f51,f52,f53,f54,f55' })
    const [quoteResult, tradeResult] = await Promise.allSettled([
      get(`detail:q:${symbol}`, `https://push2.eastmoney.com/api/qt/stock/get?${quoteQuery}`).then(d => {
        if (d.f57 !== symbol.slice(2)) throw new Error('行情代码不匹配')
        return d
      }),
      get(`detail:t:${symbol}`, `https://push2.eastmoney.com/api/qt/stock/details/get?${tradeQuery}`).then(d => {
        if (d.code !== symbol.slice(2) || d.market !== (symbol.startsWith('sh') ? 1 : 0) || !Array.isArray(d.details)) throw new Error('分笔数据无效')
        return d
      })
    ])
    if (quoteResult.status === 'rejected' && tradeResult.status === 'rejected') throw new Error('行情和分笔均不可用')
    const d = quoteResult.status === 'fulfilled' ? quoteResult.value : {}
    // f47 and f53 are lots (手), f48 is yuan; fltt=2 prices are yuan.
    const transactions = tradeResult.status === 'fulfilled' ? tradeResult.value.details.slice(-50).filter(line => typeof line === 'string').map(line => {
      const p = line.split(',')
      const time = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(p[0]) ? p[0] : null
      const price = number(p[1]), volume = number(p[2])
      return { time, price: price !== null && price >= 0 ? price : null, volume: volume !== null && volume >= 0 ? volume : null, side: p[4] === '1' ? 'sell' : p[4] === '2' ? 'buy' : p[4] === '4' ? 'neutral' : null }
    }) : null
    return { name: typeof d.f58 === 'string' && d.f58.trim() ? d.f58 : null, symbol, price: number(d.f43), change: number(d.f169), percent: number(d.f170), time: number(d.f86), open: number(d.f46), high: number(d.f44), low: number(d.f45), previous: number(d.f60), volume: number(d.f47), amount: number(d.f48), turnover: number(d.f168), transactions }
  }
  async function chart(symbol, period) {
    const daily = period === 'daily'
    const query = new URLSearchParams(daily ? { secid: secid(symbol), klt: '101', fqt: '0', end: '20500101', lmt: '100', fields1: 'f1,f2,f3,f4,f5,f6', fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' } : { secid: secid(symbol), ndays: '1', iscr: '0', fields1: 'f1,f2,f3,f4,f5,f6,f7,f8', fields2: 'f51,f52,f53,f54,f55,f56,f57,f58' })
    const endpoint = daily ? 'kline/get' : 'trends2/get'
    const d = await get(`c:${period}:${symbol}`, `https://push2his.eastmoney.com/api/qt/stock/${endpoint}?${query}`)
    if (d.code !== symbol.slice(2) || d.market !== (symbol.startsWith('sh') ? 1 : 0)) throw new Error('走势代码不匹配')
    const lines = daily ? d.klines : d.trends
    if (!Array.isArray(lines)) throw new Error('行情源未返回走势数据')
    const points = lines.map(line => {
      const p = String(line).split(',')
      return { time: p[0], price: number(daily ? p[2] : p[2]), volume: number(daily ? p[5] : p[5]) }
    }).filter(p => p.time && p.price !== null && p.volume !== null && p.volume >= 0)
    return { name: d.name || symbol, points }
  }
  // Estimated cost distribution, not actual shareholder positions. All OHLC values
  // are from the same Eastmoney forward-adjusted daily series (fqt=1).
  async function chips(symbol) {
    if (typeof symbol !== 'string' || !validSymbol(symbol)) throw new Error('股票代码无效')
    const query = new URLSearchParams({ secid: secid(symbol), klt: '101', fqt: '1', end: '20500101', lmt: '250', fields1: 'f1,f2,f3,f4,f5,f6', fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' })
    const d = await get(`chips:${symbol}`, `https://push2his.eastmoney.com/api/qt/stock/kline/get?${query}`)
    if (d.code !== symbol.slice(2) || d.market !== (symbol.startsWith('sh') ? 1 : 0)) throw new Error('筹码历史代码不匹配')
    if (!Array.isArray(d.klines) || !d.klines.length || d.klines.length > 250) throw new Error('缺少有效历史行情')
    let previous = ''
    const bars = d.klines.map(line => {
      if (typeof line !== 'string') throw new Error('历史行情格式无效')
      const p = line.split(','), date = p[0], values = [p[1], p[2], p[3], p[4]].map(number), turnover = number(p[10])
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= previous || values.some(v => v === null || v <= 0) || turnover === null || turnover < 0 || turnover > 100) throw new Error('历史价格或换手率缺失或无效')
      const [open, close, high, low] = values
      if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) throw new Error('历史价格范围无效')
      previous = date
      return { date, values, turnover }
    })
    const prices = bars.flatMap(b => b.values), min = Math.min(...prices), max = Math.max(...prices)
    // 50 equal-width buckets; use the same boundaries for the entire adjusted series.
    const count = 50, width = max === min ? 0 : (max - min) / count
    const weights = Array(count).fill(0)
    let initialWeight = 1
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i], replacement = i === 0 ? 1 : bar.turnover / 100
      if (i > 0) initialWeight *= 1 - replacement
      for (let j = 0; j < count; j++) weights[j] *= 1 - replacement
      for (const price of bar.values) {
        const index = width ? Math.min(count - 1, Math.floor((price - min) / width)) : 0
        weights[index] += replacement / 4
      }
    }
    // Largest-remainder rounding guarantees exactly 10,000 hundredths of a percent.
    const total = weights.reduce((a, b) => a + b, 0)
    const rounded = weights.map((weight, index) => { const exact = weight / total * 10000; return { index, units: Math.floor(exact), fraction: exact - Math.floor(exact) } })
    let remaining = 10000 - rounded.reduce((sum, row) => sum + row.units, 0)
    for (const row of [...rounded].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) { if (remaining-- <= 0) break; row.units++ }
    return { symbol, asOf: bars.at(-1).date, method: '前复权日OHLC四点等权、50等宽价格桶、按日换手衰减；首日初始化为100%', adjustment: 'forward', sampleDays: bars.length, initialWeightPercent: initialWeight * 100, computedAt: new Date().toISOString(), priceBucketWidth: width, warning: '仅为有限历史的估算，并非真实筹码；价格大幅变化、复权调整或样本不足时可能不可靠。', distribution: rounded.filter(row => row.units > 0).map(row => ({ price: width ? min + (row.index + 0.5) * width : min, percentage: row.units / 100 })) }
  }
  // Eastmoney f52..f56 are cumulative net amounts (yuan): main, small,
  // medium, large and extra-large orders. Do not infer them from trades.
  async function flow(symbol) {
    if (typeof symbol !== 'string' || !validSymbol(symbol)) throw new Error('股票代码无效')
    const query = new URLSearchParams({ secid: secid(symbol), klt: '1', lmt: '0', fields1: 'f1,f2,f3,f7', fields2: 'f51,f52,f53,f54,f55,f56' })
    let failures = 0
    for (const mode of ['minute', 'daily']) {
      const endpoint = mode === 'minute' ? 'kline' : 'daykline'
      for (const host of ['push2.eastmoney.com', 'push2his.eastmoney.com']) {
        try {
          const body = await fetchJson(`https://${host}/api/qt/stock/fflow/${endpoint}/get?${query}`)
          if (!body || (body.rc !== undefined && body.rc !== 0)) throw new Error('资金流上游返回错误')
          if (body.data === null) continue
          const d = body.data
          if (!d || d.code !== symbol.slice(2) || d.market !== (symbol.startsWith('sh') ? 1 : 0)) throw new Error('资金流代码不匹配')
          if (!Array.isArray(d.klines) || d.klines.length > 500) throw new Error('资金流数据格式无效')
          let last = '', date = ''
          const points = d.klines.map(line => {
            if (typeof line !== 'string') throw new Error('资金流数据格式无效')
            const p = line.split(','), time = p[0], values = p.slice(1, 6).map(number)
            const pattern = mode === 'minute' ? /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d$/ : /^\d{4}-\d{2}-\d{2}$/
            if (!pattern.test(time) || time <= last || values.length !== 5 || values.some(v => v === null)) throw new Error('资金流数据缺失或无效')
            if (mode === 'minute' && date && date !== time.slice(0, 10)) throw new Error('资金流包含多日数据')
            date = time.slice(0, 10); last = time
            return { time, main: values[0], small: values[1], medium: values[2], large: values[3], extraLarge: values[4] }
          })
          if (!points.length) continue
          return { symbol, mode, asOf: points.at(-1).time, source: '东方财富', unit: '元', meaning: mode === 'minute' ? '当日截至该时刻各单级别累计净流入；主力为大单与超大单' : '各交易日各单级别净流入汇总；主力为大单与超大单，非分钟或实时数据', points }
        } catch { failures++ }
      }
    }
    if (failures) throw new Error('资金流上游不可用或数据无效')
    return { symbol, mode: 'daily', asOf: null, source: '东方财富', unit: '元', meaning: '各交易日各单级别净流入汇总；主力为大单与超大单，非分钟或实时数据', points: [] }
  }
  async function search(input) {
    if (typeof input !== 'string' || !/^[a-zA-Z0-9]{1,12}$/.test(input)) throw new Error('搜索关键词无效')
    const query = new URLSearchParams({ input: input.toUpperCase(), type: '14', count: '10' })
    const body = await fetchJson(`https://searchadapter.eastmoney.com/api/suggest/get?${query}`, 128 * 1024)
    const table = body?.QuotationCodeTable
    if (!table || table.Status !== 0 || (table.Data !== null && !Array.isArray(table.Data))) throw new Error('搜索源返回数据无效')
    const results = [], seen = new Set()
    for (const row of (table.Data || []).slice(0, 10)) {
      if (!row || typeof row.Code !== 'string' || !/^\d{6}$/.test(row.Code) || typeof row.Name !== 'string' || !row.Name.trim() || row.Name.length > 80) continue
      const prefix = row.Classify === 'AStock' && row.SecurityTypeName === '沪A' && row.QuoteID === `1.${row.Code}` ? 'sh'
        : row.Classify === 'AStock' && row.SecurityTypeName === '深A' && row.QuoteID === `0.${row.Code}` ? 'sz'
          : row.Classify === 'NEEQ' && row.SecurityTypeName === '京A' && row.QuoteID === `0.${row.Code}` ? 'bj' : null
      if (!prefix) continue
      const symbol = prefix + row.Code
      if (seen.has(symbol)) continue
      seen.add(symbol)
      results.push({ symbol, code: row.Code, name: row.Name })
    }
    return results
  }
  async function news(symbol) {
    if (typeof symbol !== 'string' || !validSymbol(symbol)) throw new Error('股票代码无效')
    const code = symbol.slice(2), marketCode = symbol.startsWith('sh') ? '1' : '0'
    const annQuery = new URLSearchParams({ sr: '-1', page_size: '20', page_index: '1', ann_type: 'A', client_source: 'web', stock_list: code })
    const reportQuery = new URLSearchParams({ industryCode: '*', pageSize: '20', industry: '*', rating: '*', ratingChange: '*', beginTime: '2000-01-01', endTime: '2099-12-31', pageNo: '1', qType: '0', code })
    const text = (value, limit) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : ''
    function mapRows(rows, convert) {
      if (!Array.isArray(rows)) throw new Error('上游数据格式无效')
      const result = rows.slice(0, 20).map(convert).filter(Boolean)
      if (rows.length && !result.length) throw new Error('上游无可用的匹配记录')
      return result
    }
    // Keyword search is not a security-identity search; reject very short or generic names.
    async function keywordNews() {
      let name
      try {
        const q = new URLSearchParams({ secid: secid(symbol), fltt: '2', fields: 'f43,f57,f58,f60,f86,f169,f170' })
        const d = await get(`q:${symbol}`, `https://push2.eastmoney.com/api/qt/stock/get?${q}`)
        if (d.f57 !== code || typeof d.f58 !== 'string') throw new Error('行情代码不匹配')
        name = d.f58.trim()
      } catch { throw new Error('无法获取匹配证券的股票简称') }
      if (name.length < 3 || name.length > 40 || !/^[\p{Script=Han}A-Za-z0-9*·.-]+$/u.test(name) || /^(?:ST|\*ST)?(?:银行|证券|集团|股份|科技|实业|能源|控股|中国|中华)$/i.test(name)) throw new Error('股票简称过短或过于泛化，已停止关键词搜索')
      const param = { uid: '', keyword: name, type: ['cmsArticleWeb'], client: 'web', clientType: 'web', clientVersion: 'curr', param: { cmsArticleWeb: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: 20, preTag: '<em>', postTag: '</em>' } } }
      const query = new URLSearchParams({ cb: 'stockPanelNews', param: JSON.stringify(param) })
      const raw = await fetchText(`https://search-api-web.eastmoney.com/search/jsonp?${query}`, 512 * 1024, '*/*')
      const match = /^stockPanelNews\(([\s\S]*)\);?\s*$/.exec(raw)
      if (!match) throw new Error('新闻搜索 JSONP 格式无效')
      const body = JSON.parse(match[1])
      if (body?.code !== 0 || !Array.isArray(body?.result?.cmsArticleWeb)) throw new Error('新闻搜索数据无效')
      const rows = []
      for (const row of body.result.cmsArticleWeb.slice(0, 20)) {
        if (!row || typeof row.title !== 'string' || typeof row.content !== 'string' || row.title.length > 10000 || row.content.length > 30000) continue
        const title = text(row.title, 300), content = text(row.content, 30000)
        if (!title || (!title.includes(name) && !content.includes(name))) continue
        let url
        try {
          const parsed = new URL(row.url)
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname !== 'finance.eastmoney.com' || parsed.port || parsed.username || parsed.password || !/^(?:\/a\/\d{10,30}\.html|\/news\/\d{1,8},\d{10,30}\.html)$/.test(parsed.pathname) || parsed.search || parsed.hash) continue
          parsed.protocol = 'https:'; url = parsed.href
        } catch { continue }
        const date = text(row.date, 32), source = text(row.mediaName, 80)
        if (!date || !source) continue
        rows.push({ title, date, url, source: `${source}（关键词搜索，非精确归属）` })
      }
      return rows.sort((a, b) => b.date.localeCompare(a.date))
    }
    const [ann, reports, newsResult] = await Promise.allSettled([
      fetchJson(`https://np-anotice-stock.eastmoney.com/api/security/ann?${annQuery}`).then(body => {
        if (body?.success !== 1) throw new Error('公告源返回错误')
        return mapRows(body?.data?.list, row => {
          if (!row || !Array.isArray(row.codes) || !row.codes.some(c => c?.stock_code === code && String(c.market_code) === marketCode) || !/^AN\d{10,30}$/.test(row.art_code || '')) return null
          const title = text(row.title, 300), date = text(row.notice_date, 32)
          return title && date ? { title, date, url: `https://data.eastmoney.com/notices/detail/${code}/${row.art_code}.html`, source: '东方财富' } : null
        })
      }),
      fetchJson(`https://reportapi.eastmoney.com/report/list?${reportQuery}`).then(body => mapRows(body?.data, row => {
        const expectedMarket = symbol.startsWith('sh') ? 'SHANGHAI' : symbol.startsWith('sz') ? 'SHENZHEN' : 'BEIJING'
        if (!row || row.stockCode !== code || row.market !== expectedMarket || !/^AP\d{10,30}$/.test(row.infoCode || '')) return null
        const title = text(row.title, 300), date = text(row.publishDate, 32), source = text(row.orgSName, 80)
        return title && date && source ? { title, date, url: `https://pdf.dfcfw.com/pdf/H3_${row.infoCode}_1.pdf`, source } : null
      })),
      keywordNews()
    ])
    const result = { news: [], announcements: [], research: [], errors: {} }
    for (const [key, settled] of [['announcements', ann], ['research', reports], ['news', newsResult]]) {
      if (settled.status === 'fulfilled') result[key] = settled.value
      else result.errors[key] = key === 'news' && /^股票简称过短或过于泛化/.test(settled.reason?.message || '') ? settled.reason.message : '上游不可用或数据无效'
    }
    return result
  }
  const valuation = createValuation(fetchJson)
  return { quote, chart, search, detail, news, chips, flow, valuation }
}
function registerRoutes(connection, market = createMarket()) {
  const disposers = []
  const send = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  try {
    for (const action of ['quotes', 'chart', 'search', 'detail', 'news', 'chips', 'flow', 'valuation']) disposers.push(connection.fetch.register({ path: `/api/stock-panel/${action}`, methods: ['GET'], requestBody: 'buffered', fetch: async request => {
      try {
        const q = new URL(request.url).searchParams
        if (action === 'quotes') {
          const symbols = (q.get('symbols') || '').split(',')
          if (!symbols.length || symbols.length > 30 || symbols.some(s => !validSymbol(s))) return send(400, { error: '股票代码格式错误或数量超过30' })
          const results = await Promise.allSettled([...new Set(symbols)].map(s => market.quote(s)))
          return send(200, { quotes: results.filter(r => r.status === 'fulfilled').map(r => r.value), errors: results.filter(r => r.status === 'rejected').map(r => String(r.reason?.message || r.reason)) })
        }
        if (action === 'search') {
          const input = q.get('q')
          if (q.getAll('q').length !== 1 || !input || !/^[a-zA-Z0-9]{1,12}$/.test(input)) return send(400, { error: '搜索关键词须为1至12位字母或数字' })
          return send(200, { results: await market.search(input) })
        }
        if (action === 'valuation') {
          const symbol = q.get('symbol')
          if (q.getAll('symbol').length !== 1 || !['sh000001', 'sz399001'].includes(symbol)) return send(400, { error: '仅支持上证指数和深证成指' })
          return send(200, await market.valuation(symbol))
        }
        if (action === 'detail' || action === 'news' || action === 'chips' || action === 'flow') {
          const symbol = q.get('symbol')
          if (q.getAll('symbol').length !== 1 || !validSymbol(symbol || '')) return send(400, { error: '股票代码无效' })
          return send(200, await market[action](symbol))
        }
        const symbol = q.get('symbol'), period = q.get('period')
        if (!validSymbol(symbol || '') || !['minute', 'daily'].includes(period)) return send(400, { error: '股票代码或周期无效' })
        return send(200, await market.chart(symbol, period))
      } catch (e) { return send(502, { error: `行情获取失败：${e.message}` }) }
    } }))
  } catch (e) { for (const dispose of disposers.reverse()) void dispose(); throw e }
  return async () => { for (const dispose of disposers.reverse()) await dispose() }
}
module.exports = { validSymbol, secid, createMarket, registerRoutes }
