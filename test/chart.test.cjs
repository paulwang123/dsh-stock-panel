'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

test('chart pointer and keyboard select nearest price and volume', () => {
  let state = null, component
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: () => [state, value => { state = value }],
    useEffect: () => {}, useRef: value => ({ current: value }),
  }
  const sandbox = { window: { __ModuleLoader__: { load: item => { component = item } } } }
  const file = fs.readFileSync(path.join(__dirname, '../client.js'), 'utf8')
  vm.runInNewContext(file.replace('    function StockPanel() {', '    globalThis.__chart = Chart\n    function StockPanel() {'), sandbox)
  component.factory(() => react)
  const points = [{ time: '09:30', price: 10, volume: 100 }, { time: '09:31', price: 12, volume: 200 }, { time: '09:32', price: 11, volume: 300 }]
  const flatten = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(flatten)] : []
  const svg = tree => flatten(tree).find(item => item.type === 'svg')
  let tree = sandbox.__chart({ points })
  const target = { getBoundingClientRect: () => ({ left: 100, width: 400 }), focus() {}, setPointerCapture() {} }
  svg(tree).props.onPointerDown({ currentTarget: target, clientX: 300, pointerId: 1, pointerType: 'mouse', button: 0 })
  assert.equal(state.index, 1)
  tree = sandbox.__chart({ points })
  const text = JSON.stringify(tree)
  assert.match(text, /09:31/); assert.match(text, /12\.00/); assert.match(text, /200/)
  svg(tree).props.onKeyDown({ key: 'ArrowRight', preventDefault() {} })
  assert.equal(state.index, 2)
  tree = sandbox.__chart({ points: [{ time: 'new', price: 8, volume: 3 }] })
  assert.doesNotMatch(JSON.stringify(tree), /09:31/)
})
