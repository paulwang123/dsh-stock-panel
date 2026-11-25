'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

test('advanced panel displays model and data scope with chart lines', () => {
  const valuation = symbol => ({ symbol, asOf: '2026-11-25', value: 13, low: 10, median: 12, high: 15, range: { start: '2021-11-25', end: '2026-11-25' }, sampleSize: 1200, source: 'FTShare', warning: '市场估值不等于指数成分股估值', points: [{ time: '2021-11-25', value: 11 }, { time: '2026-11-25', value: 13 }] })
  const chips = { asOf: '2026-11-25', computedAt: '2026-11-25T12:00:00Z', sampleDays: 250, initialWeightPercent: 15, method: '四价模型', warning: '并非真实筹码', distribution: [{ price: 10, percentage: 100 }] }
  const flow = { asOf: '2026-11-25 10:00', source: '东方财富', points: [{ time: '2026-11-25 10:00', main: -100 }] }
  const state = { symbol: 'sh600000', results: { chips: { data: chips }, flow: { data: flow }, sh: { data: valuation('sh000001') }, sz: { data: valuation('sz399001') } } }
  let plugin
  const React = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: initial => [typeof initial === 'object' ? state : initial, () => {}], useEffect() {}, useRef: value => ({ current: value }) }
  const sandbox = { window: { __ModuleLoader__: { load: item => { plugin = item } } }, Intl, Date }
  let source = fs.readFileSync(path.join(__dirname, '../client.js'), 'utf8')
  source = source.replace('    // Selection lives for the lifetime of the plugin', '    globalThis.__advanced = AdvancedAnalytics\n    // Selection lives for the lifetime of the plugin')
  vm.runInNewContext(source, sandbox)
  plugin.factory(() => React)
  const tree = sandbox.__advanced({ symbol: 'sh600000' })
  const text = JSON.stringify(tree)
  assert.match(text, /2021-11-25 至 2026-11-25/)
  assert.match(text, /首日初始化剩余权重/)
  assert.match(text, /并非真实筹码/)
  assert.match(text, /累计主力净流入估算/)
  assert.match(text, /不等同于成份股口径/)
  assert.doesNotMatch(text, /\[object Object\]|NaN/)
  const flatten = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(flatten)] : []
  const svgs = flatten(tree).filter(item => item.type === 'svg' && item.props.className === 'sp-analytics-valuation')
  assert.equal(svgs.length, 2)
  assert.equal(flatten(svgs[0]).filter(item => item.type === 'line').length, 3)
  state.results.flow.data = { mode: 'daily', asOf: '2026-11-25', source: '东方财富', points: [{ time: '2026-11-25', main: 100 }] }
  const fallback = JSON.stringify(sandbox.__advanced({ symbol: 'sh600000' }))
  assert.match(fallback, /日线汇总（非分钟数据、非实时）/)
  assert.doesNotMatch(fallback, /截至对应分钟的累计主力净流入/)
})
