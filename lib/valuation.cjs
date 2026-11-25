'use strict'

const codes = Object.freeze({ sh000001: '000001', sz399001: '399001' })
const endpoint = 'https://market.ft.tech/gateway/api/v1/market/data/eastmoney-market-valuation'
const pageSize = 500

function dateRange(now = new Date()) {
  const end = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const [year, month, day] = end.split('-').map(Number)
  // Clamp leap day rather than rolling into March.
  const lastDay = new Date(Date.UTC(year - 5, month, 0)).getUTCDate()
  const start = `${year - 5}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
  return { start, end }
}
function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s
}
function percentile(sorted, p) {
  const pos = (sorted.length - 1) * p, i = Math.floor(pos), f = pos - i
  return sorted[i] + (sorted[Math.ceil(pos)] - sorted[i]) * f
}
function createValuation(fetchJson) {
  const cache = new Map(), pending = new Map()
  return async function valuation(symbol) {
    if (!Object.hasOwn(codes, symbol)) throw new Error('仅支持上证指数和深证成指')
    const range = dateRange(), key = `${symbol}:${range.end}`, cached = cache.get(key)
    if (cached && cached.until > Date.now()) return cached.value
    if (pending.has(key)) return pending.get(key)
    const promise = (async () => {
      const points = [], seen = new Set(), code = codes[symbol]
      const maxRecords = Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86400000) + 1
      let total, pages, previous = ''
      for (let page = 1; ; page++) {
        const query = new URLSearchParams({ market_code: code, start_date: range.start.replaceAll('-', ''), end_date: range.end.replaceAll('-', ''), page: String(page), page_size: String(pageSize) })
        const body = await fetchJson(`${endpoint}?${query}`)
        const d = body?.data
        if (body?.code !== 200 || !d || !Array.isArray(d.records) || !Number.isSafeInteger(d.total) || d.total < 1 || d.total > maxRecords || d.pageNum !== page || d.pageSize !== pageSize || d.pages !== Math.ceil(d.total / pageSize)) throw new Error('估值分页数据无效')
        if (page === 1) { total = d.total; pages = d.pages }
        if (d.total !== total || d.pages !== pages || page > pages || d.records.length !== Math.min(pageSize, total - (page - 1) * pageSize)) throw new Error('估值分页不完整或已变化')
        for (const row of d.records) {
          const date = row?.trade_date, raw = row?.pe_ttm
          if (row?.market_code !== code || !validDate(date) || date < range.start || date > range.end || seen.has(date) || (previous && date >= previous) || typeof raw !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) throw new Error('估值身份、日期或数值无效')
          seen.add(date); previous = date; points.push({ time: date, value: Number(raw) })
        }
        if (page === pages) break
      }
      points.reverse()
      const sorted = points.map(p => p.value).sort((a, b) => a - b), latest = points.at(-1)
      const value = { symbol, asOf: latest.time, value: latest.value, low: percentile(sorted, 0.2), median: percentile(sorted, 0.5), high: percentile(sorted, 0.8), points, sampleSize: points.length, range, source: 'FTShare（东方财富市场估值）', warning: 'FTShare 标记代码对应市场整体口径，非严格指数成份股估值；深市可能为深主板而非深证成指500成份股。数据截至 asOf，为日度PE TTM非实时；数值与历史分位均为PE倍数，并非指数点数，分位不构成预测。' }
      cache.set(key, { until: Date.now() + 15000, value })
      if (cache.size > 4) cache.delete(cache.keys().next().value)
      return value
    })().finally(() => pending.delete(key))
    pending.set(key, promise)
    return promise
  }
}
module.exports = { createValuation, dateRange, percentile }
