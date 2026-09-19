/**
 * Account-balance bar, browser half.
 *
 * This file IS the client artifact. The DSH client module table is a lazy
 * CommonJS table whose transport contract is the two-line wrapper below: a
 * bundle registers a closure factory through `window.__ModuleLoader__.load`
 * and resolves shared modules through the injected `require` — never through
 * its own copy of them. Everything inside the factory is therefore ordinary
 * CommonJS JavaScript, and this plugin needs no bundler: `react` arrives from
 * the shell's platform seed and nothing else is imported.
 *
 * What it renders: one fixed vertical progress bar against the right edge of
 * the GUI, registered into the layout package's `shell.overlay` root list. The
 * reading comes from the Host half's same-origin JSON route; the Host also
 * embeds the last snapshot as `globalThis.__DSH_BALANCE__` at index render
 * time, so the bar can paint a real value on the first frame and only polls
 * afterwards.
 *
 * Colour thresholds (CNY yuan, per the product spec):
 *   total < 10          -> red
 *   10 <= total < 30    -> yellow
 *   30 <= total <= 50   -> green
 *   total > 50          -> green still filled to 50, and every yuan above the
 *                          scale is drawn as a持续波纹状浅蓝紫色 animated wave
 *
 * The bar scale is `SCALE_LIMIT`; the wave is a separate top layer whose height
 * grows with the overflow, so the two facts never fight for the same pixels.
 */

window.__ModuleLoader__.load({
  id: 'dsh-balance-bar',
  factory: (require) => {
    'use strict'

    const React = require('react')

    /** Route the Host half serves the current reading on. */
    const SNAPSHOT_ROUTE = '/dsh-balance/snapshot'

    /** Bar scale in yuan: the filled portion tops out here. */
    const SCALE_LIMIT = 50

    /** Upper bound of the red band (exclusive). */
    const RED_LIMIT = 10

    /** Upper bound of the yellow band (exclusive). */
    const YELLOW_LIMIT = 30

    /** How long a reading is reused before the browser asks the Host again. */
    const REFRESH_MS = 60_000

    /** Style element carrying every rule this plugin owns. */
    const STYLE_ID = 'dsh-balance-bar/styles'

    /**
     * Gradient stops for the filled portion. The fill is a gradient so its base
     * reads darker than the surface beside the label, keeping the value legible
     * on both light and dark shells.
     */
    const PALETTE = {
      red: ['#ff5a5a', '#c81f3c'],
      yellow: ['#ffd24a', '#e0951a'],
      green: ['#4ce08a', '#12915c'],
    }

    /** Wave ink: the light blue-violet pair the crest and body are drawn with. */
    const WAVE_CREST = '#cddcff'
    const WAVE_BODY = '#8fb0ff'

    /** The stylesheet. Plain CSS on purpose: no build step, no class hashing. */
    const STYLES = `
.dsh-balance-root {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 0;
  pointer-events: none;
  z-index: 30;
}
.dsh-balance-bar {
  position: absolute;
  top: 84px;
  right: 12px;
  bottom: 26px;
  width: 16px;
  overflow: hidden;
  border-radius: 999px;
  pointer-events: auto;
  cursor: pointer;
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #ffffff) 45%, transparent);
  box-shadow: 0 1px 2px rgb(0 0 0 / 18%), inset 0 0 0 0.5px rgb(127 127 127 / 22%);
  transition: width 180ms ease, right 180ms ease;
}
.dsh-balance-root[data-open='true'] .dsh-balance-bar,
.dsh-balance-bar:hover {
  width: 22px;
  right: 9px;
}
.dsh-balance-bar:focus-visible {
  outline: 2px solid var(--dsw-alias-link, #6b8cff);
  outline-offset: 2px;
}
.dsh-balance-fill {
  position: absolute;
  inset: auto 0 0 0;
  transition: height 600ms cubic-bezier(.22, .61, .36, 1), background 400ms linear;
}
.dsh-balance-fill[data-tone='red'] { background: linear-gradient(to top, ${PALETTE.red[1]}, ${PALETTE.red[0]}); }
.dsh-balance-fill[data-tone='yellow'] { background: linear-gradient(to top, ${PALETTE.yellow[1]}, ${PALETTE.yellow[0]}); }
.dsh-balance-fill[data-tone='green'] { background: linear-gradient(to top, ${PALETTE.green[1]}, ${PALETTE.green[0]}); }
.dsh-balance-fill[data-tone='unknown'] { background: linear-gradient(to top, #8b8b8b, #c9c9c9); }
.dsh-balance-surface {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  overflow: hidden;
  pointer-events: none;
}
.dsh-balance-glow {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 90px;
  background: linear-gradient(to top, ${WAVE_BODY}, transparent);
  opacity: .38;
}
.dsh-balance-wave {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 200%;
  height: 100%;
  animation: dshbb-scroll 5.5s linear infinite;
}
.dsh-balance-wave--back {
  width: 300%;
  animation-duration: 8.5s;
  opacity: .55;
}
.dsh-balance-wave path { fill: ${WAVE_BODY}; }
.dsh-balance-wave--crest path {
  fill: none;
  stroke: ${WAVE_CREST};
  stroke-width: 2;
  opacity: .95;
}
@keyframes dshbb-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
.dsh-balance-label {
  position: absolute;
  top: 50%;
  right: 34px;
  transform: translateY(-50%);
  pointer-events: auto;
  cursor: pointer;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: .02em;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary, #1b1b1b);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border-radius: 999px;
  padding: 4px 9px;
  box-shadow: var(--dsw-elevation-panel, 0 2px 8px rgb(0 0 0 / 18%));
  transition: right 180ms ease;
}
.dsh-balance-root[data-open='true'] .dsh-balance-label {
  right: 31px;
}
.dsh-balance-root[data-tone='red'] .dsh-balance-label { color: #d92b2b; }
.dsh-balance-root[data-tone='yellow'] .dsh-balance-label { color: #b06f00; }
.dsh-balance-root[data-tone='green'] .dsh-balance-label { color: #0f7a4a; }
.dsh-balance-root[data-tone='unknown'] .dsh-balance-label { color: var(--dsw-alias-label-secondary, #4a4a4a); }
.dsh-balance-card {
  position: fixed;
  right: 76px;
  top: 50%;
  transform: translateY(-50%);
  min-width: 150px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 0;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  box-shadow: var(--dsw-elevation-prominent, 0 8px 28px rgb(0 0 0 / 22%));
  color: var(--dsw-alias-label-primary, #1b1b1b);
  font-size: 12px;
  line-height: 18px;
  pointer-events: none;
}
.dsh-balance-card-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .04em;
  color: var(--dsw-alias-label-secondary, #4a4a4a);
  margin-bottom: 4px;
}
.dsh-balance-card-value {
  font-size: 19px;
  line-height: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary, #1b1b1b);
}
.dsh-balance-card-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--dsw-alias-label-secondary, #4a4a4a);
  font-variant-numeric: tabular-nums;
}
.dsh-balance-card-note {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgb(127 127 127 / 30%));
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #5c5c5c);
}
.dsh-balance-card-note[data-error='true'] { color: var(--dsw-alias-state-error-primary, #d92b2b); }
@media (max-width: 860px) {
  .dsh-balance-bar { right: 6px; width: 12px; }
  .dsh-balance-bar:hover { width: 16px; right: 4px; }
  .dsh-balance-label { right: 26px; }
  .dsh-balance-card { right: 64px; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-balance-bar,
  .dsh-balance-label,
  .dsh-balance-fill { transition: none; }
  .dsh-balance-wave { animation: none; }
}
`

    /**
     * Install the stylesheet once per page.
     * @returns a disposer removing the element.
     */
    function installStyles() {
      if (document.querySelector('style[data-dsh-plugin-css="' + STYLE_ID + '"]') !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.dshPlugin = 'dsh-balance-bar'
      tag.dataset.dshPluginCss = STYLE_ID
      tag.textContent = STYLES
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    /** The CNY balance row, else the first one the Host reported. */
    function pickBalance(snapshot) {
      const balances = snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.balances)
        ? snapshot.balances
        : []
      return balances.find(entry => entry !== null && entry !== undefined && entry.currency === 'CNY') ?? balances[0]
    }

    /** The display tone for one amount. */
    function toneOf(total) {
      if (typeof total !== 'number' || !Number.isFinite(total)) return 'unknown'
      if (total < RED_LIMIT) return 'red'
      if (total < YELLOW_LIMIT) return 'yellow'
      return 'green'
    }

    /** Format an amount for display. */
    function formatAmount(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—'
    }

    /** Milliseconds in a compact relative form. */
    function relativeTime(from, now) {
      if (typeof from !== 'number' || from <= 0) return '尚未获取'
      const seconds = Math.max(0, Math.round((now - from) / 1000))
      if (seconds < 10) return '刚刚'
      if (seconds < 60) return seconds + ' 秒前'
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return minutes + ' 分钟前'
      return Math.round(minutes / 60) + ' 小时前'
    }

    /**
     * A sine surface spanning exactly two wavelengths, so a layer translated by
     * half its own width (`translateX(-50%)`) lands on the identical phase and
     * the loop is seamless.
     * @param period - wavelength in viewBox units (the bar width in pixels).
     * @param height - viewBox height.
     * @param amplitude - crest height above the midline.
     * @param crestOnly - emit the open top line instead of a filled band.
     */
    function wavePath(period, height, amplitude, crestOnly) {
      const mid = height * 0.5
      const perCycle = 12
      const points = []
      for (let cycle = 0; cycle < 2; cycle += 1) {
        for (let index = 0; index <= perCycle; index += 1) {
          if (cycle > 0 && index === 0) continue
          const x = (cycle + index / perCycle) * period
          points.push('L ' + x.toFixed(2) + ' ' + (mid - amplitude * Math.sin((2 * Math.PI * index) / perCycle)).toFixed(2))
        }
      }
      const top = 'M ' + points[0].slice(2) + ' ' + points.slice(1).join(' ')
      return crestOnly ? top : top + ' L ' + (period * 2).toFixed(2) + ' ' + height + ' L 0 ' + height + ' Z'
    }

    /** Height in pixels the wave band occupies for one overflow amount. */
    function waveBandHeight(over) {
      return Math.round(Math.min(74, 22 + Math.sqrt(over) * 10))
    }

    /** One animated sine layer, stretched to the bar's width. */
    function Wave(props) {
      const height = 40
      const period = props.period
      return React.createElement('svg', {
        className: props.className,
        viewBox: '0 0 ' + (period * 2).toFixed(2) + ' ' + height,
        preserveAspectRatio: 'none',
        'aria-hidden': 'true',
      }, React.createElement('path', {
        d: wavePath(period, height, props.amplitude, props.crestOnly === true),
      }))
    }

    /** The bar, its hover card, and the Host polling loop. */
    function BalanceBar() {
      const [snapshot, setSnapshot] = React.useState(() => globalThis.__DSH_BALANCE__ ?? null)
      const [open, setOpen] = React.useState(false)
      const [now, setNow] = React.useState(() => Date.now())

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(SNAPSHOT_ROUTE, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const next = await response.json()
          if (next !== null && typeof next === 'object') {
            globalThis.__DSH_BALANCE__ = next
            setSnapshot(next)
          }
        } catch (error) {
          // Keep the last good reading and report the failure in the card.
          const text = String(error !== null && error !== undefined && error.message ? error.message : error)
          setSnapshot(previous => previous === null || previous === undefined
            ? { available: false, balances: [], fetchedAt: 0, error: text, credential: false }
            : Object.assign({}, previous, { error: text, errorAt: Date.now() }))
        }
      }, [])

      React.useEffect(() => { void load() }, [load])

      React.useEffect(() => {
        const timer = setInterval(() => { void load() }, REFRESH_MS)
        return () => { clearInterval(timer) }
      }, [load])

      // The card shows relative times, so it needs its own slow clock.
      React.useEffect(() => {
        if (!open) return undefined
        const timer = setInterval(() => { setNow(Date.now()) }, 15_000)
        return () => { clearInterval(timer) }
      }, [open])

      const balance = pickBalance(snapshot)
      const total = balance === undefined || balance === null ? undefined : balance.total
      const tone = toneOf(total)
      const known = tone !== 'unknown'
      const ratio = known ? Math.max(0, Math.min(1, total / SCALE_LIMIT)) : 0
      const over = known ? Math.max(0, total - SCALE_LIMIT) : 0
      const waving = over > 0
      const stale = snapshot !== null && snapshot !== undefined && snapshot.error !== undefined
      const fetchedAt = snapshot === null || snapshot === undefined ? 0 : snapshot.fetchedAt
      const errorAt = snapshot === null || snapshot === undefined ? 0 : (snapshot.errorAt ?? 0)

      const activate = () => { void load() }

      const rows = []
      if (known) {
        rows.push(React.createElement('div', { className: 'dsh-balance-card-row', key: 'scale' },
          React.createElement('span', undefined, '刻度'),
          React.createElement('span', undefined, (ratio * 100).toFixed(0) + '% / ¥' + SCALE_LIMIT)))
        if (waving) {
          rows.push(React.createElement('div', { className: 'dsh-balance-card-row', key: 'over' },
            React.createElement('span', undefined, '超出部分'),
            React.createElement('span', undefined, '¥' + formatAmount(over))))
        }
        if (typeof balance.toppedUp === 'number') {
          rows.push(React.createElement('div', { className: 'dsh-balance-card-row', key: 'toppedUp' },
            React.createElement('span', undefined, '充值余额'),
            React.createElement('span', undefined, '¥' + formatAmount(balance.toppedUp))))
        }
        if (typeof balance.granted === 'number' && balance.granted > 0) {
          rows.push(React.createElement('div', { className: 'dsh-balance-card-row', key: 'granted' },
            React.createElement('span', undefined, '赠送余额'),
            React.createElement('span', undefined, '¥' + formatAmount(balance.granted))))
        }
      }
      rows.push(React.createElement('div', { className: 'dsh-balance-card-note', key: 'note' },
        stale ? '⚠ ' + snapshot.error : '更新于 ' + relativeTime(fetchedAt, now)))
      if (stale && fetchedAt > 0) {
        rows.push(React.createElement('div', {
          className: 'dsh-balance-card-note', 'data-error': 'true', key: 'stale',
        }, '数据可能已过期（失败于 ' + relativeTime(errorAt, now) + '）'))
      }
      rows.push(React.createElement('div', { className: 'dsh-balance-card-note', key: 'hint' },
        '点击竖条可立即刷新'))

      const wave = waving
        ? React.createElement('div', {
          className: 'dsh-balance-surface',
          style: { height: waveBandHeight(over) + 'px' },
        },
        React.createElement('div', { className: 'dsh-balance-glow' }),
        React.createElement(Wave, { className: 'dsh-balance-wave dsh-balance-wave--back', amplitude: 5, period: 30 }),
        React.createElement(Wave, { className: 'dsh-balance-wave', amplitude: 7, period: 20 }),
        React.createElement(Wave, {
          className: 'dsh-balance-wave dsh-balance-wave--crest', amplitude: 7, period: 20, crestOnly: true,
        }))
        : null

      // Hover/focus belongs to the whole overlay cell, so the bar and the
      // horizontal value chip light up together and the card survives the
      // pointer travelling from the bar to the chip.
      const hover = {
        onMouseEnter: () => { setOpen(true); setNow(Date.now()) },
        onMouseLeave: () => { setOpen(false) },
        onFocus: () => { setOpen(true); setNow(Date.now()) },
        onBlur: () => { setOpen(false) },
      }
      const keys = {
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            activate()
          }
        },
      }

      const bar = React.createElement('div', {
        className: 'dsh-balance-root',
        'data-tone': tone,
        'data-open': open ? 'true' : undefined,
        ...hover,
      },
      React.createElement('div', {
        className: 'dsh-balance-bar',
        role: 'progressbar',
        tabIndex: 0,
        'aria-label': known ? '账户余额 ¥' + formatAmount(total) : '账户余额读取中',
        'aria-valuemin': 0,
        'aria-valuemax': SCALE_LIMIT,
        'aria-valuenow': known ? Math.min(total, SCALE_LIMIT) : undefined,
        onClick: activate,
        ...keys,
      },
      React.createElement('div', {
        className: 'dsh-balance-fill',
        'data-tone': tone,
        style: { height: (ratio * 100).toFixed(2) + '%' },
      }),
      wave),
      React.createElement('div', {
        className: 'dsh-balance-label',
        onClick: activate,
        ...keys,
      }, known ? '¥' + formatAmount(total) : stale ? '余额读取失败' : '读取中…'))

      const card = open
        ? React.createElement('div', { className: 'dsh-balance-card', role: 'status' },
          React.createElement('div', { className: 'dsh-balance-card-title' }, '账户余额'),
          React.createElement('div', { className: 'dsh-balance-card-value' },
            known ? '¥' + formatAmount(total) : '读取中…'),
          rows)
        : null

      return React.createElement(React.Fragment, undefined, bar, card)
    }

    /**
     * Register the bar into the layout package's overlay list.
     *
     * `ctx.slots.inject` already waits for the declaration, reruns after a
     * redeclaration, and leaves with this plugin's fiber, so the only local work
     * is the owning id and order.
     */
    function apply(ctx) {
      ctx.effect(() => installStyles(), 'dsh-balance-bar: styles')
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'balance-bar',
        order: 50,
      }, BalanceBar)), 'dsh-balance-bar: overlay registration')
    }

    return {
      name: 'dsh-balance-bar',
      inject: ['slots'],
      apply,
      // Test seam: the threshold and wave math is the part a load-only smoke test
      // cannot see, so it is exposed only when a harness asks for it. Production
      // loads never read the flag.
      ...globalThis.__DSH_BALANCE_TEST__ === true
        ? { __internals: { toneOf, wavePath, waveBandHeight, pickBalance, relativeTime, SCALE_LIMIT, RED_LIMIT, YELLOW_LIMIT } }
        : {},
    }
  },
})
