'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

test('header search registers without replacing host navigation and shares valid selections', () => {
  let module, initial, setter
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: value => { initial = value; setter = v => { initial = v }; return [value, setter] },
    useEffect: fn => fn(), useRef: value => ({ current: value }),
  }
  const sandbox = { window: { __ModuleLoader__: { load: m => { module = m } } } }
  const source = fs.readFileSync(path.join(__dirname, '../client.js'), 'utf8').replace('    function StockPanel() {', '    globalThis.__selectSymbol = selectSymbol; globalThis.__useSelectedSymbol = useSelectedSymbol\n    function StockPanel() {')
  vm.runInNewContext(source, sandbox)
  const plugin = module.factory(() => react)
  const registrations = []
  plugin.apply({ layout: { selectPanel() {} }, effect() {}, slots: { inject(_name, fn) { fn() }, register(meta) { registrations.push(meta) } } })
  assert.ok(registrations.some(r => r.name === 'conversation.session.header.utilities' && r.id === 'stock-panel.search'))
  assert.ok(registrations.some(r => r.name === 'main' && r.key === 'stock-panel'))
  assert.ok(!registrations.some(r => r.name === 'conversation.header.leading'))
  sandbox.__useSelectedSymbol()
  sandbox.__selectSymbol('SH600000')
  assert.equal(initial, 'sh600000')
  sandbox.__selectSymbol('bad')
  assert.equal(initial, 'sh600000')
})
