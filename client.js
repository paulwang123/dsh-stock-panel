/* Stock panel: DSH module-loader browser entry. */
window.__ModuleLoader__.load({
  id: 'dsh-stock-panel',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useRef } = React
    const h = React.createElement
    const KEY = 'dsh-stock-panel-watchlist-v1'
    const INDEXES = ['sh000001', 'sz399001', 'sz399006']
    const DEFAULTS = ['sh600000', 'sz000001']
    const valid = value => /^(sh|sz|bj)\d{6}$/.test(value)
    function initialWatchlist() {
      try {
        const stored = localStorage.getItem(KEY)
        if (stored === null) return DEFAULTS
        const parsed = JSON.parse(stored)
        return Array.isArray(parsed) ? [...new Set(parsed.filter(x => typeof x === 'string' && valid(x)))] : DEFAULTS
      } catch { return DEFAULTS }
    }
    async function request(path, params, signal) {
      const url = new URL(`api/stock-panel/${path}`, document.baseURI)
      Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
      const response = await fetch(url, { signal })
      let data
      try { data = await response.json() } catch { throw new Error(`服务器返回无效数据（${response.status}）`) }
      if (!response.ok) throw new Error(data?.message || data?.error?.message || (typeof data?.error === 'string' && data.error) || `请求失败（${response.status}）`)
      return data
    }
    const num = x => x !== null && x !== '' && Number.isFinite(Number(x)) ? Number(x) : null
    const format = (x, digits = 2) => num(x) === null ? '--' : Number(x).toFixed(digits)
    const signed = x => num(x) === null ? '--' : `${Number(x) > 0 ? '+' : ''}${Number(x).toFixed(2)}`
    const direction = x => num(x) > 0 ? 'sp-up' : num(x) < 0 ? 'sp-down' : 'sp-flat'
    function Chart({ points }) {
      const [selection, setSelection] = useState(null)
      const touchStart = useRef(null)
      const data = points.map(p => ({ time: p.time, price: num(p.price), volume: num(p.volume) })).filter(p => p.price !== null)
      useEffect(() => { setSelection(null) }, [points])
      const selectedIndex = selection?.points === points && selection.index < data.length ? selection.index : null
      if (!data.length) return h('div', { className: 'sp-empty' }, '暂无走势图数据')
      const w = 800, top = 20, bottom = 205, volumeTop = 230, volumeBottom = 300
      const prices = data.map(p => p.price), low = Math.min(...prices), high = Math.max(...prices)
      const pad = (high - low) * 0.08 || Math.abs(high) * 0.01 || 1
      const min = low - pad, max = high + pad, vmax = Math.max(0, ...data.map(p => p.volume || 0)) || 1
      const x = i => data.length === 1 ? w / 2 : 8 + i * (w - 16) / (data.length - 1)
      const y = p => bottom - (p - min) / (max - min) * (bottom - top)
      const line = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ')
      const area = `${line} L${x(data.length - 1).toFixed(1)},${bottom} L${x(0).toFixed(1)},${bottom} Z`
      const barWidth = Math.max(1, Math.min(10, (w - 16) / data.length * 0.6))
      function selectPointer(event) {
        const rect = event.currentTarget.getBoundingClientRect()
        if (!rect.width) return
        const plotX = Math.max(0, Math.min(w, (event.clientX - rect.left) / rect.width * w))
        const index = data.length === 1 ? 0 : Math.max(0, Math.min(data.length - 1, Math.round((plotX - 8) / (w - 16) * (data.length - 1))))
        setSelection({ points, index })
      }
      function selectKey(event) {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1
        const index = selectedIndex === null ? (delta > 0 ? 0 : data.length - 1) : Math.max(0, Math.min(data.length - 1, selectedIndex + delta))
        setSelection({ points, index })
      }
      const selectedPoint = selectedIndex === null ? null : data[selectedIndex]
      return h('div', { className: 'sp-chart-wrap' },
        h('div', { className: 'sp-chart-labels' }, h('span', null, format(high)), h('span', null, format(low))),
        h('svg', { viewBox: `0 0 ${w} 310`, preserveAspectRatio: 'none', role: 'group', tabIndex: 0, 'aria-label': '价格走势与成交量，使用方向键选择数据点', onKeyDown: selectKey, onPointerDown: event => { if (event.pointerType === 'touch') { touchStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; return } selectPointer(event); event.currentTarget.focus(); if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId) }, onPointerMove: event => { if (event.pointerType === 'touch') { const start = touchStart.current; if (start && (Math.abs(event.clientX - start.x) > 10 || Math.abs(event.clientY - start.y) > 10)) touchStart.current = null } else if (event.buttons) selectPointer(event) }, onPointerUp: event => { const start = touchStart.current; if (event.pointerType === 'touch' && start && start.id === event.pointerId) selectPointer(event); touchStart.current = null }, onPointerCancel: () => { touchStart.current = null } },
          h('defs', null, h('linearGradient', { id: 'sp-fill', x1: '0', x2: '0', y1: '0', y2: '1' }, h('stop', { offset: '0%', stopColor: '#568bff', stopOpacity: '.32' }), h('stop', { offset: '100%', stopColor: '#568bff', stopOpacity: '0' }))),
          [top, (top + bottom) / 2, bottom, volumeBottom].map((v, i) => h('line', { key: i, x1: 0, y1: v, x2: w, y2: v, stroke: '#263447', strokeWidth: 1 })),
          h('path', { d: area, fill: 'url(#sp-fill)' }), h('path', { d: line, fill: 'none', stroke: '#6b9cff', strokeWidth: 2, vectorEffect: 'non-scaling-stroke' }),
          data.map((p, i) => h('rect', { key: i, x: x(i) - barWidth / 2, y: volumeBottom - Math.max(0, p.volume || 0) / vmax * (volumeBottom - volumeTop), width: barWidth, height: Math.max(0, p.volume || 0) / vmax * (volumeBottom - volumeTop), fill: i && p.price < data[i - 1].price ? '#32bd99' : '#ee6b70', opacity: '.7' })),
          selectedPoint && h('g', { className: 'sp-chart-cross', pointerEvents: 'none' },
            h('line', { x1: x(selectedIndex), x2: x(selectedIndex), y1: top, y2: volumeBottom }),
            h('line', { x1: 0, x2: w, y1: y(selectedPoint.price), y2: y(selectedPoint.price) }),
            h('circle', { cx: x(selectedIndex), cy: y(selectedPoint.price), r: 4 }))),
        h('div', { className: 'sp-chart-times' }, h('span', null, String(data[0].time ?? '')), h('span', null, '成交量'), h('span', null, String(data[data.length - 1].time ?? ''))),
        selectedPoint && h('div', { className: 'sp-chart-selection', role: 'status', 'aria-live': 'polite' },
          h('span', null, `时间 ${String(selectedPoint.time ?? '--')}`), h('span', null, `价格 ${format(selectedPoint.price)}`), h('span', null, `成交量 ${selectedPoint.volume === null ? '--' : selectedPoint.volume.toLocaleString('zh-CN')}（来源单位待确认）`)))
    }
    const displayText = value => value === null || value === undefined || value === '' ? '--' : String(value)
    const quantity = value => num(value) === null ? '--' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
    function tradeSide(value) {
      const side = String(value ?? '').trim().toLowerCase()
      if (['buy', '买', '买入', 'b'].includes(side)) return ['买', 'sp-up']
      if (['sell', '卖', '卖出', 's'].includes(side)) return ['卖', 'sp-down']
      if (['neutral', '中性', '中', '平'].includes(side)) return ['中性', 'sp-flat']
      return ['--', 'sp-flat']
    }
    function MarketDetail({ data, loading, error, symbol, watched, watchlistFull, onAddWatch }) {
      const fields = [['今开', format(data?.open)], ['最高', format(data?.high)], ['最低', format(data?.low)], ['昨收', format(data?.previous)], ['成交量(手)', quantity(data?.volume)], ['成交额(元)', quantity(data?.amount)], ['换手率', num(data?.turnover) === null ? '--' : `${format(data.turnover)}%`], ['更新时间', num(data?.time) === null ? '--' : new Date(data.time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })]]
      return h('section', { className: 'sp-market-detail', 'aria-label': '行情详情' },
        h('div', { className: 'sp-market-heading' }, h('div', null, h('div', { className: 'sp-market-name' }, displayText(data?.name)), h('div', { className: 'sp-code' }, data?.symbol || symbol)),
          !INDEXES.includes(symbol) && h('button', { type: 'button', className: 'sp-watch-add', disabled: watched || watchlistFull, onClick: onAddWatch, title: watchlistFull && !watched ? '自选数量已达上限' : undefined }, watched ? '✓ 已加入自选' : '+ 添加自选'),
          h('div', { className: `sp-market-price ${direction(data?.change ?? data?.percent)}` }, h('strong', null, format(data?.price)), h('small', null, `${signed(data?.change)}  ${signed(data?.percent)}${num(data?.percent) === null ? '' : '%'}`))),
        loading && h('div', { className: 'sp-market-status', role: 'status' }, '正在加载行情详情…'),
        error && h('div', { className: 'sp-market-status sp-error', role: 'alert' }, `行情详情加载失败：${error}`),
        data && h(React.Fragment, null,
          h('dl', { className: 'sp-market-fields' }, fields.map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value)))),
          h('div', { className: 'sp-trades-title' }, '最近分笔交易'),
          Array.isArray(data?.transactions) && data.transactions.length ? h('div', { className: 'sp-trades-scroll' }, h('table', { className: 'sp-trades' }, h('thead', null, h('tr', null, ['时间', '价格', '成交量(手)', '方向'].map(label => h('th', { key: label, scope: 'col' }, label)))), h('tbody', null, [...data.transactions].reverse().map((trade, i) => { const [label, color] = tradeSide(trade?.side); return h('tr', { key: i }, h('td', null, displayText(trade?.time)), h('td', null, format(trade?.price)), h('td', null, quantity(trade?.volume)), h('td', { className: color }, label)) })))) : h('div', { className: 'sp-market-status' }, data?.transactions === null ? '分笔数据暂不可用' : '暂无分笔交易数据')))
    }
    function StockNews({ symbol, version }) {
      const [tab, setTab] = useState('news')
      const [refresh, setRefresh] = useState(0)
      const [state, setState] = useState({ symbol: '', loading: true, data: null, error: '' })
      const tabs = [['news', '新闻'], ['announcements', '公告'], ['research', '研报']]
      useEffect(() => {
        const controller = new AbortController()
        setState({ symbol, loading: true, data: null, error: '' })
        request('news', { symbol }, controller.signal).then(data => {
          if (controller.signal.aborted) return
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('资讯响应格式无效')
          setState({ symbol, loading: false, data, error: '' })
        }).catch(error => {
          if (!controller.signal.aborted) setState({ symbol, loading: false, data: null, error: String(error?.message || error) })
        })
        return () => controller.abort()
      }, [symbol, version, refresh])
      const loading = state.symbol !== symbol || state.loading
      const data = state.symbol === symbol ? state.data : null
      const error = state.symbol === symbol ? state.error : ''
      const sectionError = data?.errors?.[tab]
      const items = Array.isArray(data?.[tab]) ? data[tab] : []
      function safeUrl(value) {
        if (typeof value !== 'string') return null
        try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null } catch { return null }
      }
      return h('section', { className: 'sp-news', 'aria-label': '当前股票资讯' },
        h('div', { className: 'sp-news-head' }, h('strong', null, '股票资讯'), h('button', { type: 'button', className: 'sp-news-refresh', disabled: loading, onClick: () => setRefresh(value => value + 1) }, loading ? '加载中…' : '↻ 刷新资讯')),
        h('div', { className: 'sp-news-tabs', role: 'group', 'aria-label': '资讯分类' }, tabs.map(([key, label]) => h('button', { key, type: 'button', className: tab === key ? 'active' : '', 'aria-pressed': tab === key, onClick: () => setTab(key) }, label))),
        loading ? h('div', { className: 'sp-news-status', role: 'status' }, '正在加载资讯…') : error ? h('div', { className: 'sp-news-status sp-error', role: 'alert' }, `资讯加载失败：${error}`) : h(React.Fragment, null,
          tab === 'news' && h('div', { className: 'sp-news-status' }, '按股票简称关键词搜索，可能包含其他证券的相关新闻，请核对内容。'),
          sectionError && h('div', { className: 'sp-news-status sp-error', role: 'alert' }, `${tabs.find(([key]) => key === tab)[1]}加载失败：${typeof sectionError === 'string' ? sectionError : '请稍后重试'}`),
          items.length ? h('ul', { className: 'sp-news-list' }, items.map((item, index) => {
            const url = safeUrl(item?.url)
            const title = displayText(item?.title)
            return h('li', { key: index }, h('div', { className: 'sp-news-meta' }, h('time', null, displayText(item?.date)), h('span', null, displayText(item?.source))), url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, title) : h('span', { className: 'sp-news-title' }, title))
          })) : !sectionError && h('div', { className: 'sp-news-status' }, `暂无${tabs.find(([key]) => key === tab)[1]}数据`)))
    }
    // Selection lives for the lifetime of the plugin, independently of watchlist storage.
    let selectedSymbol = 'sh000001'
    const selectionListeners = new Set()
    let layout
    function selectSymbol(symbol) {
      symbol = symbol.toLowerCase()
      if (!valid(symbol)) return
      selectedSymbol = symbol
      selectionListeners.forEach(listener => listener(symbol))
    }
    function useSelectedSymbol() {
      const [selected, setSelected] = useState(selectedSymbol)
      useEffect(() => {
        selectionListeners.add(setSelected)
        setSelected(selectedSymbol)
        return () => selectionListeners.delete(setSelected)
      }, [])
      return [selected, selectSymbol]
    }
    function StockPanel() {
      const [watchlist, setWatchlist] = useState(initialWatchlist)
      const [input, setInput] = useState('')
      const [inputError, setInputError] = useState('')
      const [results, setResults] = useState([])
      const [searchState, setSearchState] = useState('idle')
      const [searchError, setSearchError] = useState('')
      const [activeResult, setActiveResult] = useState(-1)
      const [searchOpen, setSearchOpen] = useState(false)
      const searchId = useRef(`sp-search-${Math.random().toString(36).slice(2)}`)
      const [selected, setSelected] = useSelectedSymbol()
      const [period, setPeriod] = useState('minute')
      const [version, setVersion] = useState(0)
      const [quotes, setQuotes] = useState([])
      const [quoteLoading, setQuoteLoading] = useState(true)
      const [quoteError, setQuoteError] = useState('')
      const [chart, setChart] = useState(null)
      const [chartLoading, setChartLoading] = useState(true)
      const [chartError, setChartError] = useState('')
      const [detail, setDetail] = useState(null)
      const [detailLoading, setDetailLoading] = useState(true)
      const [detailError, setDetailError] = useState('')
      const [storageError, setStorageError] = useState('')
      const firstSave = useRef(true)
      useEffect(() => {
        try { localStorage.setItem(KEY, JSON.stringify(watchlist)); setStorageError('') }
        catch { setStorageError('自选股无法保存到本地，刷新后可能丢失。') }
        firstSave.current = false
      }, [watchlist])
      const symbols = [...new Set([...INDEXES, ...watchlist])].join(',')
      useEffect(() => {
        const controller = new AbortController()
        setQuoteLoading(true); setQuoteError('')
        request('quotes', { symbols }, controller.signal).then(data => {
          if (!Array.isArray(data?.quotes)) throw new Error('行情响应格式无效')
          setQuotes(data.quotes); setQuoteError(Array.isArray(data.errors) && data.errors.length ? data.errors.join('；') : ''); setQuoteLoading(false)
        }).catch(error => { if (!controller.signal.aborted) { setQuoteError(String(error?.message || error)); setQuoteLoading(false) } })
        return () => controller.abort()
      }, [symbols, version])
      useEffect(() => {
        const controller = new AbortController()
        setChartLoading(true); setChartError(''); setChart(null)
        request('chart', { symbol: selected, period }, controller.signal).then(data => {
          if (!Array.isArray(data?.points)) throw new Error('走势图响应格式无效')
          setChart(data); setChartLoading(false)
        }).catch(error => { if (!controller.signal.aborted) { setChartError(String(error?.message || error)); setChartLoading(false) } })
        return () => controller.abort()
      }, [selected, period, version])
      useEffect(() => {
        let controller = null
        let stopped = false
        function load() {
          if (controller) controller.abort()
          controller = new AbortController()
          const currentController = controller
          setDetailLoading(true); setDetailError('')
          request('detail', { symbol: selected }, currentController.signal).then(data => {
            if (currentController.signal.aborted || stopped) return
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('行情详情响应格式无效')
            setDetail({ symbol: selected, data }); setDetailLoading(false)
          }).catch(error => { if (!currentController.signal.aborted && !stopped) { setDetailError(String(error?.message || error)); setDetailLoading(false) } })
        }
        load()
        const timer = setInterval(load, 30000)
        return () => { stopped = true; clearInterval(timer); if (controller) controller.abort() }
      }, [selected, version])
      useEffect(() => {
        const query = input.trim()
        if (!query || valid(query.toLowerCase())) { setResults([]); setSearchState('idle'); return }
        const controller = new AbortController()
        setResults([]); setActiveResult(-1); setSearchState('loading'); setSearchError('')
        const timer = setTimeout(() => {
          request('search', { q: query }, controller.signal).then(data => {
            if (controller.signal.aborted) return
            if (!Array.isArray(data?.results)) throw new Error('搜索响应格式无效')
            setResults(data.results.filter(item => item && typeof item.symbol === 'string' && valid(item.symbol.toLowerCase()) && typeof item.name === 'string'))
            setSearchState('done')
          }).catch(error => {
            if (!controller.signal.aborted) { setSearchError(String(error?.message || error)); setSearchState('error') }
          })
        }, 250)
        return () => { clearTimeout(timer); controller.abort() }
      }, [input])
      function addSymbol(value) {
        const symbol = value.trim().toLowerCase()
        if (!valid(symbol)) { setInputError('请选择搜索结果，或输入带市场前缀的代码，如 sh600000。'); return }
        if (watchlist.includes(symbol)) { setInputError('该股票已在自选列表中。'); return }
        if (new Set([...INDEXES, ...watchlist, symbol]).size > 30) { setInputError('最多支持 30 个指数及自选代码。'); return }
        setWatchlist(list => [...list, symbol]); setInput(''); setInputError(''); setSearchOpen(false); setSelected(symbol)
      }
      function add(event) {
        event.preventDefault()
        if (searchOpen && activeResult >= 0 && results[activeResult]) addSymbol(results[activeResult].symbol)
        else addSymbol(input)
      }
      function remove(symbol) {
        setWatchlist(list => list.filter(x => x !== symbol))
        if (selected === symbol && !INDEXES.includes(symbol)) setSelected('sh000001')
      }
      const bySymbol = new Map(quotes.filter(q => q && typeof q.symbol === 'string').map(q => [q.symbol.toLowerCase(), q]))
      const current = bySymbol.get(selected)
      function row(symbol, isWatch) {
        const q = bySymbol.get(symbol)
        return h('div', { className: `sp-row ${selected === symbol ? 'sp-selected' : ''}`, key: symbol },
          h('button', { type: 'button', className: 'sp-row-main', onClick: () => setSelected(symbol), 'aria-pressed': selected === symbol },
            h('span', { className: 'sp-name' }, h('strong', null, q?.name || symbol), h('small', null, symbol)),
            h('span', { className: `sp-values ${direction(q?.percent)}` }, h('strong', null, format(q?.price)), h('small', null, `${signed(q?.percent)}${num(q?.percent) === null ? '' : '%'}`))),
          isWatch && h('button', { type: 'button', className: 'sp-remove', onClick: () => remove(symbol), 'aria-label': `删除 ${q?.name || symbol}` }, '×'))
      }
      return h('section', { className: 'sp-panel' },
        h('header', { className: 'sp-header' }, h('div', null, h('div', { className: 'sp-eyebrow' }, 'MARKET OVERVIEW'), h('h2', null, '股票面板'), h('p', null, '关注市场，掌握自选动态')), h('div', { className: 'sp-header-actions' }, h(HeaderSearch), h('button', { type: 'button', className: 'sp-refresh', onClick: () => setVersion(v => v + 1), disabled: quoteLoading || chartLoading }, quoteLoading || chartLoading ? '刷新中…' : '↻ 刷新'))),
        storageError && h('p', { role: 'alert', className: 'sp-error' }, storageError),
        h('div', { className: 'sp-grid' },
          h('aside', { className: 'sp-sidebar' }, h('div', { className: 'sp-group-title' }, '市场指数'),
            quoteError && h('div', { className: 'sp-error', role: 'alert' }, `行情加载失败：${quoteError}`),
            quoteLoading && h('div', { className: 'sp-muted', role: 'status' }, '正在加载行情…'),
            INDEXES.map(symbol => row(symbol, false)),
            h('div', { className: 'sp-group-title sp-watch-title' }, '我的自选', h('span', null, watchlist.length)),
            h('form', { className: 'sp-form', onSubmit: add }, h('input', { value: input, onChange: e => { setInput(e.target.value); setInputError(''); setSearchOpen(true); setActiveResult(-1) }, onFocus: () => setSearchOpen(true), onKeyDown: e => { if (e.key === 'Escape') { setSearchOpen(false); setActiveResult(-1) } else if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); setSearchOpen(true); setActiveResult(i => Math.min(i + 1, results.length - 1)) } else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); setSearchOpen(true); setActiveResult(i => i <= 0 ? 0 : i - 1) } }, placeholder: '拼音缩写或代码，如 PFYH', 'aria-label': '搜索股票拼音缩写或代码', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': searchOpen && results.length > 0, 'aria-controls': searchId.current, 'aria-activedescendant': searchOpen && activeResult >= 0 && results[activeResult] ? `${searchId.current}-${activeResult}` : undefined }), h('button', { type: 'submit' }, '添加')),
            searchOpen && input.trim() && searchState === 'loading' && h('div', { className: 'sp-search-status', role: 'status' }, '正在搜索…'),
            searchOpen && searchState === 'error' && h('div', { className: 'sp-error', role: 'alert' }, `搜索失败：${searchError}`),
            searchOpen && searchState === 'done' && !results.length && h('div', { className: 'sp-search-status', role: 'status' }, '没有找到匹配的股票。'),
            h('div', { id: searchId.current, role: 'listbox', className: 'sp-search-results', hidden: !searchOpen || !results.length }, results.map((item, i) => h('div', { id: `${searchId.current}-${i}`, key: `${item.symbol}-${i}`, role: 'option', 'aria-selected': i === activeResult, className: `sp-search-option ${i === activeResult ? 'active' : ''}`, onMouseDown: e => e.preventDefault(), onClick: () => addSymbol(item.symbol) }, h('span', null, item.name), h('small', null, item.symbol.toLowerCase())))),
            inputError && h('div', { className: 'sp-error', role: 'alert' }, inputError),
            watchlist.length ? watchlist.map(symbol => row(symbol, true)) : h('div', { className: 'sp-muted' }, '暂无自选股，输入代码添加。')),
          h('main', { className: 'sp-detail sp-detail-layout' }, h('div', { className: 'sp-chart-column' }, h('div', { className: 'sp-detail-head' }, h('div', null, h('div', { className: 'sp-detail-name' }, chart?.name || current?.name || selected), h('div', { className: 'sp-code' }, selected, current?.time ? ` · ${new Date(current.time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : '')), h('div', { className: `sp-detail-price ${direction(current?.percent)}` }, h('strong', null, format(current?.price)), h('small', null, `${signed(current?.change)}  ${signed(current?.percent)}${num(current?.percent) === null ? '' : '%'}`))),
            h('div', { className: 'sp-toolbar' }, h('div', { className: 'sp-tabs', role: 'group', 'aria-label': '走势图周期' }, [['minute', '分时'], ['daily', '日线']].map(([value, label]) => h('button', { key: value, type: 'button', className: period === value ? 'active' : '', 'aria-pressed': period === value, onClick: () => setPeriod(value) }, label))), h('span', { className: 'sp-muted' }, '价格 / 成交量')),
            chartLoading ? h('div', { className: 'sp-empty', role: 'status' }, '正在加载走势图…') : chartError ? h('div', { className: 'sp-empty sp-error', role: 'alert' }, `走势图加载失败：${chartError}`) : h(Chart, { points: chart?.points || [] }),
            h('p', { className: 'sp-footnote' }, '行情数据仅供参考，不构成投资建议。'), h(StockNews, { symbol: selected, version })), h(MarketDetail, { data: detail?.symbol === selected ? detail.data : null, loading: detailLoading || (detail && detail.symbol !== selected), error: detailError, symbol: selected, watched: watchlist.includes(selected), watchlistFull: new Set([...INDEXES, ...watchlist, selected]).size > 30, onAddWatch: () => addSymbol(selected) }))))
    }
    const css = `.sp-panel{box-sizing:border-box;background:#101722;color:#e8eef8;border:1px solid #283547;border-radius:16px;padding:24px;max-width:1200px;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif}.sp-panel *{box-sizing:border-box}.sp-panel button,.sp-panel input{font:inherit}.sp-panel button{cursor:pointer}.sp-header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}.sp-header h2{margin:4px 0;font-size:24px;color:#f3f6ff}.sp-header p,.sp-footnote{margin:4px 0;color:#8290a6;font-size:12px}.sp-eyebrow{font-size:10px;letter-spacing:.15em;color:#6e9aff;font-weight:700}.sp-refresh,.sp-form button{border:1px solid #365487;background:#233c67;color:#d9e7ff;border-radius:8px;padding:8px 13px}.sp-refresh:disabled{opacity:.55;cursor:wait}.sp-grid{display:grid;grid-template-columns:minmax(220px,290px) minmax(0,1fr);gap:18px}.sp-sidebar,.sp-detail{background:#151f2d;border:1px solid #283649;border-radius:12px;padding:16px;min-width:0}.sp-group-title{font-weight:700;font-size:13px;color:#dbe5f5;margin:2px 0 10px;display:flex;justify-content:space-between}.sp-group-title span,.sp-muted,.sp-code{color:#8493a8;font-size:12px}.sp-watch-title{margin-top:22px}.sp-row{display:flex;align-items:center;border-radius:8px}.sp-row:hover,.sp-selected{background:#202e41}.sp-row-main{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:1;min-width:0;border:0;background:transparent;color:inherit;padding:9px;text-align:left}.sp-name,.sp-values{display:flex;flex-direction:column;gap:4px;min-width:0}.sp-name strong{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sp-name small,.sp-values small{font-size:11px;color:#8493a8}.sp-values{text-align:right;white-space:nowrap}.sp-values strong{font-size:13px}.sp-values.sp-up small,.sp-up{color:#f4777d}.sp-values.sp-down small,.sp-down{color:#40cba8}.sp-flat{color:#d4dfed}.sp-remove{border:0;background:transparent;color:#8090a5;font-size:20px;padding:4px 8px}.sp-remove:hover{color:#f4777d}.sp-form{display:flex;gap:6px;margin-bottom:8px}.sp-form input{width:100%;min-width:0;background:#101824;color:#eef4ff;border:1px solid #34445a;border-radius:8px;padding:8px;font-size:12px}.sp-form button{font-size:12px;white-space:nowrap}.sp-error{color:#ff858a;font-size:12px;overflow-wrap:anywhere;margin:8px 0}.sp-detail-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.sp-detail-name{font-size:20px;font-weight:700}.sp-code{margin-top:5px}.sp-detail-price{display:flex;flex-direction:column;text-align:right;gap:5px}.sp-detail-price strong{font-size:25px}.sp-detail-price small{font-size:12px}.sp-toolbar{display:flex;align-items:center;justify-content:space-between;margin:26px 0 12px}.sp-tabs{display:flex;gap:5px;background:#101824;border-radius:8px;padding:3px}.sp-tabs button{border:0;background:transparent;color:#93a2b7;border-radius:6px;padding:6px 14px;font-size:12px}.sp-tabs button.active{background:#30496d;color:#eef4ff}.sp-chart-wrap{position:relative;padding-left:44px}.sp-chart-wrap svg{display:block;width:100%;height:260px;overflow:visible}.sp-chart-labels{position:absolute;left:0;top:10px;height:150px;display:flex;flex-direction:column;justify-content:space-between;color:#8290a6;font-size:10px}.sp-chart-times{display:flex;justify-content:space-between;color:#8290a6;font-size:10px;margin-top:6px}.sp-empty{display:flex;align-items:center;justify-content:center;min-height:260px;color:#8493a8;font-size:13px;text-align:center;overflow-wrap:anywhere}.sp-empty.sp-error{color:#ff858a}.sp-footnote{margin-top:20px}.sp-panel button:focus-visible,.sp-panel input:focus-visible{outline:2px solid #8baeff;outline-offset:2px}@media(max-width:700px){.sp-panel{padding:14px}.sp-grid{grid-template-columns:1fr}.sp-chart-wrap svg{height:200px}}`
    // Terminal skin stays scoped to the panel so it can live inside the host settings view.
    const terminalCss = `
.sp-panel{container-type:inline-size;max-width:none;width:100%;padding:16px;background:#0a101a;color:#dce4ef;border:1px solid #202c3c;border-radius:4px;font-size:13px;font-variant-numeric:tabular-nums}
.sp-header{margin:-16px -16px 14px;padding:16px;background:#b51f2e;border-bottom:1px solid #8f1724;gap:12px}.sp-header p{color:#ffe0e2}.sp-header .sp-eyebrow{color:#ffd2d5}.sp-header .sp-refresh{background:#991b28;border-color:#f19ba2;color:#fff}.sp-header .sp-refresh:hover:not(:disabled){background:#821521}
.sp-header h2{margin:2px 0;font-size:19px;line-height:1.3;color:#f2f4f8}
.sp-header p,.sp-footnote{color:#79879a;font-size:11px}
.sp-eyebrow{color:#e05259;font-size:10px;letter-spacing:.12em}
.sp-refresh,.sp-form button{border:1px solid #a73741;border-radius:3px;background:#a82e3a;color:#fff;padding:6px 11px}
.sp-refresh:hover:not(:disabled),.sp-form button:hover{background:#c03945}
.sp-grid{grid-template-columns:minmax(210px,260px) minmax(0,1fr);gap:10px;align-items:stretch}
.sp-sidebar,.sp-detail{min-width:0;background:#0e1723;border:1px solid #263242;border-radius:3px;padding:12px}
.sp-group-title{margin:0 0 8px;padding:0 0 8px;border-bottom:1px solid #263242;color:#d9e1ec;font-size:12px;letter-spacing:.03em}
.sp-group-title span,.sp-muted,.sp-code{color:#7f8da1;font-size:11px}
.sp-watch-title{margin-top:16px}
.sp-row{border-radius:0;border-bottom:1px solid #1d2938;border-left:2px solid transparent}
.sp-row:hover{background:#162333}.sp-row.sp-selected{background:#202734;border-left-color:#e04b55}
.sp-row-main{padding:8px 6px;gap:6px}.sp-name,.sp-values{gap:3px}.sp-name strong,.sp-values strong{font-size:12px}.sp-name small,.sp-values small{font-size:10px}
.sp-values.sp-up small,.sp-up{color:#f05a63}.sp-values.sp-down small,.sp-down{color:#32bd94}.sp-flat{color:#c6d0de}
.sp-remove{color:#8592a3;border-radius:2px}.sp-remove:hover{color:#ff6870;background:#34212a}
.sp-form{gap:5px;margin-bottom:8px}.sp-form input{min-width:0;background:#0a121d;border:1px solid #344253;border-radius:3px;color:#e5ebf3;padding:7px}.sp-form input::placeholder{color:#677689}
.sp-search-results{margin:-3px 0 8px;border:1px solid #344253;background:#101b29}.sp-search-results[hidden]{display:none}.sp-search-option{display:flex;justify-content:space-between;gap:8px;padding:8px;cursor:pointer;color:#e5ebf3}.sp-search-option small{color:#a9b6c7}.sp-search-option:hover,.sp-search-option.active{background:#25364a}.sp-search-status{color:#a9b6c7;font-size:12px;margin:0 0 8px}.sp-detail-head{padding-bottom:12px;border-bottom:1px solid #263242}.sp-detail-name{font-size:18px;color:#eef2f7}.sp-detail-price strong{font-size:25px}.sp-detail-price small{font-size:12px}
.sp-toolbar{margin:10px 0 8px;border-bottom:1px solid #263242}.sp-tabs{gap:3px}.sp-tabs button{border-radius:2px 2px 0 0}.sp-tabs button.active{background:#a82e3a;color:#fff}
.sp-chart-wrap{background:#0a121d;border:1px solid #263242;border-radius:2px;padding:10px}.sp-chart-wrap svg{display:block;width:100%;min-height:220px}.sp-chart-labels,.sp-chart-times{color:#8291a3;font-size:10px}.sp-footnote{margin-top:10px}
.sp-chart-wrap svg{touch-action:pan-y;cursor:crosshair}.sp-chart-wrap svg:focus-visible{outline:2px solid #f0666e;outline-offset:2px}.sp-chart-cross line{stroke:#aabbd0;stroke-width:1;stroke-dasharray:4 4;vector-effect:non-scaling-stroke}.sp-chart-cross circle{fill:#6b9cff;stroke:#fff;stroke-width:2;vector-effect:non-scaling-stroke}.sp-chart-selection{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px;color:#dce4ef;font-size:11px;overflow-wrap:anywhere}
.sp-panel button:focus-visible,.sp-panel input:focus-visible{outline:2px solid #f0666e;outline-offset:2px}
.sp-detail-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(230px,280px);gap:12px;align-items:start}.sp-chart-column{min-width:0}.sp-market-detail{min-width:0;background:#0b1b30;border:1px solid #243b57;padding:12px;color:#dce7f5}.sp-watch-add{margin-left:auto;padding:4px 8px;border:1px solid #ad434e;border-radius:3px;background:#912a37;color:#fff;font-size:11px;white-space:nowrap}.sp-watch-add:disabled{color:#9ba9b9;border-color:#34475b;background:#192738;cursor:default}.sp-market-heading{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px;padding-bottom:10px;border-bottom:1px solid #263d59}.sp-market-name{font-size:16px;font-weight:700;color:#edf4ff}.sp-market-price{display:flex;flex-direction:column;text-align:right}.sp-market-price strong{font-size:22px}.sp-market-price small{font-size:11px;white-space:nowrap}.sp-market-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px;margin:8px 0}.sp-market-fields div{display:flex;justify-content:space-between;gap:6px;padding:6px 0;border-bottom:1px solid #1c3048;min-width:0}.sp-market-fields dt{color:#8fa3bc;white-space:nowrap}.sp-market-fields dd{margin:0;text-align:right;overflow-wrap:anywhere}.sp-trades-title{font-weight:700;margin:14px 0 8px}.sp-trades-scroll{overflow-x:auto}.sp-trades{width:100%;border-collapse:collapse;font-size:11px;white-space:nowrap}.sp-trades th,.sp-trades td{padding:6px 3px;text-align:right;border-bottom:1px solid #1c3048}.sp-trades th{font-weight:400;color:#8fa3bc}.sp-trades th:first-child,.sp-trades td:first-child{text-align:left}.sp-market-status{padding:10px 0;color:#91a5be;font-size:12px}.sp-market-status.sp-error{color:#f4777d}.sp-dock .sp-detail-layout{grid-template-columns:minmax(0,1fr) minmax(200px,250px)}.sp-dock .sp-market-detail{padding:8px}
.sp-news{margin-top:16px;border:1px solid #263b53;background:#0b1726;min-width:0}.sp-news-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;color:#e2ebf7}.sp-news-refresh{border:1px solid #435670;background:#17283b;color:#cbd9eb;padding:4px 8px;border-radius:3px;font-size:11px}.sp-news-refresh:disabled{opacity:.6;cursor:wait}.sp-news-tabs{display:flex;gap:4px;padding:0 12px;border-bottom:1px solid #263b53}.sp-news-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;color:#9aabc0;padding:7px 12px}.sp-news-tabs button.active{color:#f5f7fb;border-bottom-color:#e05259}.sp-news-list{list-style:none;margin:0;padding:0 12px}.sp-news-list li{padding:10px 0;border-bottom:1px solid #1c3048;min-width:0}.sp-news-list li:last-child{border-bottom:0}.sp-news-meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:4px;color:#8fa3bc;font-size:11px;overflow-wrap:anywhere}.sp-news-list a,.sp-news-title{color:#dce7f5;line-height:1.5;overflow-wrap:anywhere}.sp-news-list a:hover{color:#ff858b}.sp-news-list a:focus-visible{outline:2px solid #f0666e;outline-offset:2px}.sp-news-status{padding:12px;color:#91a5be;font-size:12px;overflow-wrap:anywhere}.sp-news-status.sp-error{color:#f4777d}
@container (max-width: 900px){.sp-detail-layout,.sp-dock .sp-detail-layout{grid-template-columns:minmax(0,1fr)}}
@container (max-width: 620px){.sp-grid{grid-template-columns:minmax(0,1fr)}.sp-sidebar,.sp-detail{padding:10px}.sp-header{align-items:flex-start}.sp-chart-wrap svg{min-height:170px}}
`;
    function StockIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true }, h('path', { d: 'M3 19h18M5 16l4-5 4 2 6-8M16 5h3v3' }))
    }
    function StockDock() {
      const [open, setOpen] = useState(false)
      return h('div', { className: 'sp-dock' },
        h('button', { type: 'button', className: 'sp-dock-toggle', onClick: () => setOpen(x => !x), 'aria-expanded': open }, h(StockIcon), ' 股票行情 ', open ? '▾' : '▴'),
        open && h('div', { className: 'sp-dock-body' }, h(StockPanel)))
    }
    const integrationCss = `.sp-main{height:100%;min-height:0;overflow:auto;background:#0a101a}.sp-main .sp-panel{min-height:100%;border:0;border-radius:0}.sp-main .sp-grid{min-height:calc(100vh - 110px)}.sp-dock{background:#101927;border-top:1px solid #283547;color:#b3bfd0}.sp-dock-toggle{display:flex;align-items:center;gap:5px;background:transparent;border:0;color:inherit;padding:6px 12px;font-size:12px;cursor:pointer}.sp-dock-toggle:hover{color:#fff;background:#1a2636}.sp-dock-body{max-height:min(45vh,480px);overflow:auto}.sp-dock .sp-panel{border:0;border-radius:0;padding:10px}.sp-dock .sp-header{margin:-10px -10px 8px;padding:10px}.sp-dock .sp-header p,.sp-dock .sp-eyebrow{display:none}`
    // Host conversation chrome has no public header-color slot in DSH 0.2.2.
    // The attribute identifies its resident header without targeting other pages.
    const hostHeaderCss = `header:has(> [data-conversation-header-leading]){background:#b51f2e!important;color:#fff;--dsw-alias-label-primary:#fff;--dsw-alias-label-secondary:#ffe0e2;--dsw-alias-label-tertiary:#ffd2d5}.sp-dock .sp-header{margin:-10px -10px 8px;padding:10px}`
    function HeaderSearch() {
      const [input, setInput] = useState('')
      const [results, setResults] = useState([])
      const [status, setStatus] = useState('idle')
      const [error, setError] = useState('')
      const [open, setOpen] = useState(false)
      const [active, setActive] = useState(-1)
      const [position, setPosition] = useState(null)
      const [mobileOpen, setMobileOpen] = useState(false)
      const root = useRef(null)
      const popup = useRef(null)
      const id = useRef(`sp-header-search-${Math.random().toString(36).slice(2)}`)
      useEffect(() => {
        const query = input.trim()
        if (!query) { setResults([]); setStatus('idle'); return }
        const controller = new AbortController()
        setResults([]); setActive(-1); setStatus('loading'); setError('')
        const timer = setTimeout(() => {
          request('search', { q: query }, controller.signal).then(data => {
            if (controller.signal.aborted) return
            if (!Array.isArray(data?.results)) throw new Error('搜索响应格式无效')
            setResults(data.results.filter(item => item && typeof item.symbol === 'string' && valid(item.symbol.toLowerCase()) && typeof item.name === 'string'))
            setStatus('done')
          }).catch(e => { if (!controller.signal.aborted) { setError(String(e?.message || e)); setStatus('error') } })
        }, 250)
        return () => { clearTimeout(timer); controller.abort() }
      }, [input])
      useEffect(() => {
        if (!open) return
        function updatePosition() {
          if (!root.current) return
          const rect = (root.current.querySelector('input') || root.current).getBoundingClientRect()
          const width = Math.min(320, window.innerWidth - 16)
          setPosition({ top: Math.min(rect.bottom + 4, window.innerHeight - 48), left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width })
        }
        function outside(e) { if (!root.current?.contains(e.target) && !popup.current?.contains(e.target)) setOpen(false) }
        updatePosition()
        window.addEventListener('resize', updatePosition)
        window.addEventListener('scroll', updatePosition, true)
        document.addEventListener('pointerdown', outside)
        return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true); document.removeEventListener('pointerdown', outside) }
      }, [open, mobileOpen])
      function choose(symbol) {
        selectSymbol(symbol)
        setOpen(false); setInput(''); setActive(-1)
        try { layout.selectPanel('stock-panel') } catch (e) { setError(String(e?.message || e)); setStatus('error'); setOpen(true) }
      }
      const visible = open && !!input.trim() && !!position
      const content = visible && h('div', { ref: popup, className: 'sp-header-popup', style: position },
        status === 'loading' && h('div', { className: 'sp-header-status', role: 'status' }, '正在搜索…'),
        status === 'error' && h('div', { className: 'sp-header-status', role: 'alert' }, `搜索失败：${error}`),
        status === 'done' && !results.length && h('div', { className: 'sp-header-status', role: 'status' }, '没有找到匹配的股票。'),
        h('div', { id: id.current, role: 'listbox', 'aria-label': '股票搜索结果' }, results.map((item, i) => h('div', { key: `${item.symbol}-${i}`, id: `${id.current}-${i}`, role: 'option', 'aria-selected': i === active, className: `sp-header-option ${i === active ? 'active' : ''}`, onMouseDown: e => e.preventDefault(), onClick: () => choose(item.symbol) }, h('span', null, item.name), h('small', null, item.symbol.toLowerCase())))))
      return h('div', { ref: root, className: `sp-header-search ${mobileOpen ? 'sp-mobile-open' : ''}` },
        h('button', { type: 'button', className: 'sp-mobile-toggle', 'aria-label': '打开股票搜索', 'aria-expanded': mobileOpen, onClick: () => setMobileOpen(value => !value) }, '⌕'),
        h('input', { value: input, placeholder: '股票代码 / 拼音', 'aria-label': '搜索股票代码或拼音', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': visible && results.length > 0, 'aria-controls': visible ? id.current : undefined, 'aria-activedescendant': visible && active >= 0 && results[active] ? `${id.current}-${active}` : undefined,
          onChange: e => { setInput(e.target.value); setOpen(true); setActive(-1) }, onFocus: () => setOpen(true), onKeyDown: e => {
            if (e.nativeEvent?.isComposing) return
            if (e.key === 'Escape') { setOpen(false); setActive(-1) }
            else if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, results.length - 1)) }
            else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); setOpen(true); setActive(i => Math.max(0, i - 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); if (open && active >= 0 && results[active]) choose(results[active].symbol); else if (valid(input.trim().toLowerCase())) choose(input.trim()) }
          } }),
        content && require('react-dom').createPortal(content, document.body))
    }
    const headerSearchCss = `.sp-header-search{display:flex;min-width:0;width:clamp(110px,16vw,200px);flex:none}.sp-header-search input{box-sizing:border-box;width:100%;min-width:0;padding:5px 8px;border:1px solid #bc747b;border-radius:4px;background:#851a25;color:#fff;font:inherit;font-size:12px}.sp-header-search input::placeholder{color:#ffd7da}.sp-header-search input:focus-visible{outline:2px solid #fff;outline-offset:1px}.sp-header-popup{position:fixed;z-index:2147483000;max-height:min(50vh,320px);overflow:auto;background:#101b29;color:#e5ebf3;border:1px solid #596a80;box-shadow:0 6px 20px #0008;font:13px system-ui,sans-serif}.sp-header-option{display:flex;justify-content:space-between;gap:12px;padding:9px;cursor:pointer}.sp-header-option small{color:#a9b6c7}.sp-header-option:hover,.sp-header-option.active{background:#25364a}.sp-header-status{padding:9px;color:#cbd7e7}.sp-main-search{padding:8px 16px;background:#101927}.sp-main-search .sp-header-search{width:min(320px,100%)}@media(max-width:500px){.sp-header-search{width:100px}.sp-header-search input{font-size:12px}}`
    const mobileSearchCss = `.sp-header-actions{display:flex;align-items:center;justify-content:flex-end;gap:16px;min-width:0}.sp-header-actions .sp-header-search{width:clamp(150px,17vw,320px)}@container (max-width: 480px){.sp-header-actions{gap:6px}.sp-header-actions .sp-header-search{width:auto}}.sp-mobile-toggle{display:none}@media(max-width:500px){.sp-header-search{width:auto;position:relative}.sp-mobile-toggle{display:block;border:0;background:transparent;color:inherit;cursor:pointer;font-size:20px;padding:4px}.sp-header-search input{display:none}.sp-header-search.sp-mobile-open input{display:block;position:fixed;z-index:2147483001;top:52px;left:8px;width:calc(100vw - 16px);background:#851a25}.sp-header-search.sp-mobile-open .sp-header-popup{top:90px}.sp-main-search .sp-header-search{width:100%}.sp-main-search .sp-mobile-toggle{display:none}.sp-main-search .sp-header-search input{display:block;position:static;width:100%}}`
    function MainPanel() { return h('div', { className: 'sp-main' }, h(StockPanel)) }
    function apply(ctx) {
      layout = ctx.layout
      ctx.effect(() => { const style = document.createElement('style'); style.textContent = css + terminalCss + integrationCss + hostHeaderCss + headerSearchCss + mobileSearchCss; document.head.appendChild(style); return () => style.remove() }, 'stock-panel styles')
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'stock-panel' }, MainPanel))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'stock-panel', order: 20, label: () => '股票行情' }, StockIcon))
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'stock-panel.dock', order: 50 }, StockDock))
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'stock-panel.search', order: 50 }, HeaderSearch))
    }
    return { inject: ['slots', 'layout'], apply }
  },
})
