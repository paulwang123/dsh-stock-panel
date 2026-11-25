'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

test('insight tabs switch the mounted panel and expose tab semantics', () => {
  let plugin, selected = 'news'
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: () => [selected, v => { selected = v }], useEffect() {}, useRef: () => ({ current: 'test-tabs' }) }
  const sandbox = { window: { __ModuleLoader__: { load: item => { plugin = item } } }, document: { getElementById: () => ({ focus() {} }) } }
  const source = fs.readFileSync(path.join(__dirname, '../client.js'), 'utf8').replace('    // Selection lives for the lifetime of the plugin', '    globalThis.__tabs = InsightTabs\n    // Selection lives for the lifetime of the plugin')
  vm.runInNewContext(source, sandbox); plugin.factory(() => React)
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const render = () => sandbox.__tabs({ symbol: 'sh600000', version: 1 })
  let tree = render(), nodes = walk(tree)
  const tabs = nodes.filter(n => n.props.role === 'tab')
  assert.equal(tabs.length, 2); assert.equal(tabs[0].props['aria-selected'], true); assert.equal(tabs[1].props['aria-selected'], false)
  assert.equal(nodes.find(n => n.props.role === 'tabpanel').children[0].type.name, 'StockNews')
  tabs[1].props.onClick(); tree = render(); nodes = walk(tree)
  assert.equal(nodes.find(n => n.props.role === 'tabpanel').children[0].type.name, 'AdvancedAnalytics')
  assert.equal(nodes.filter(n => n.props.role === 'tab')[1].props['aria-selected'], true)
})
