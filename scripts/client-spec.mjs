/**
 * Spec test for the client's pure logic: the colour bands, the yuan→pixel
 * scale, and the wave geometry.
 *
 * It loads the real artifact through the stubbed module table (asking for the
 * test seam), then asserts the exact behavior the product spec states:
 *
 *   total < 10          red
 *   10 <= total < 30    yellow
 *   30 <= total <= 50   green
 *   total > 50          green, scale pinned at 100%, wave layer present
 *
 * Usage: node scripts/client-spec.mjs
 */

import { join } from 'node:path'

const CLIENT = join(import.meta.dirname, '..', 'src', 'client.js')

globalThis.__DSH_BALANCE_TEST__ = true
const registrations = []
globalThis.window = { __ModuleLoader__: { load: registration => registrations.push(registration) } }
globalThis.document = {
  head: { appendChild: () => {} },
  createElement: () => ({ dataset: {}, textContent: '' }),
  querySelector: () => null,
}

await import(new URL(`file://${CLIENT.replaceAll('\\', '/')}`).href)
const exports = registrations[0].factory(() => ({ createElement: () => ({}), Fragment: 'f', useState: () => [null, () => {}], useEffect: () => {}, useCallback: fn => fn }))

const internals = exports.__internals
if (internals === undefined) throw new Error('the test seam is missing; set globalThis.__DSH_BALANCE_TEST__ before loading')

let failures = 0
/** Assert one equality with a readable failure line. */
function is(actual, expected, what) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (!same) {
    failures += 1
    console.error(`  FAIL ${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  } else {
    console.log(`  ok   ${what} = ${JSON.stringify(actual)}`)
  }
}

console.log('[spec] colour bands')
is(internals.toneOf(0), 'red', 'tone(0)')
is(internals.toneOf(9.99), 'red', 'tone(9.99)')
is(internals.toneOf(10), 'yellow', 'tone(10) — red upper bound is exclusive')
is(internals.toneOf(29.99), 'yellow', 'tone(29.99)')
is(internals.toneOf(30), 'green', 'tone(30) — yellow upper bound is exclusive')
is(internals.toneOf(50), 'green', 'tone(50) — the scale limit is still green')
is(internals.toneOf(50.01), 'green', 'tone(50.01)')
is(internals.toneOf(undefined), 'unknown', 'tone(undefined)')
is(internals.toneOf(Number.NaN), 'unknown', 'tone(NaN)')

console.log('[spec] scale limit and layout constants')
is(internals.SCALE_LIMIT, 50, 'SCALE_LIMIT')
is(internals.RED_LIMIT, 10, 'RED_LIMIT')
is(internals.YELLOW_LIMIT, 30, 'YELLOW_LIMIT')

console.log('[spec] wave band grows with the overflow and never covers the bar')
const bands = [0.5, 1, 10, 50, 500].map(over => internals.waveBandHeight(over))
console.log('  ok   waveBandHeight:', bands.join(' -> '))
for (let index = 1; index < bands.length; index += 1) {
  if (bands[index] < bands[index - 1]) { failures += 1; console.error('  FAIL waveBandHeight is not monotonic') }
}
if (bands.at(-1) > 74) { failures += 1; console.error(`  FAIL waveBandHeight exceeds the 74px cap: ${bands.at(-1)}`) }

console.log('[spec] wave geometry')
const filled = internals.wavePath(20, 40, 7, false)
const crest = internals.wavePath(20, 40, 7, true)
if (!filled.startsWith('M 0.00 20.00')) { failures += 1; console.error(`  FAIL filled path does not start on the midline: ${filled.slice(0, 24)}`) }
if (!filled.endsWith('L 40.00 40 L 0 40 Z')) { failures += 1; console.error('  FAIL filled path does not close across the bottom') }
if (crest.includes('Z')) { failures += 1; console.error('  FAIL crest must stay an open line') }
// A seamless loop needs the path to end at the phase it started at.
const crestPoints = crest.split(' L ')
const parse = point => point.replace('M ', '').split(' ').map(Number)
const first = parse(crestPoints[0])
const last = parse(crestPoints.at(-1))
if (Math.abs(first[1] - last[1]) > 0.01) { failures += 1; console.error(`  FAIL crest does not close its phase: ${first[1]} vs ${last[1]}`) }
if (Math.abs(last[0] - 40) > 0.01) { failures += 1; console.error(`  FAIL crest spans exactly two wavelengths: ends at x=${last[0]}`) }
console.log(`  ok   crest phase closes (${first[1]} -> ${last[1]}) across ${crestPoints.length} points, span x=${last[0]}`)

console.log('[spec] provider payload projection')
is(internals.pickBalance({ balances: [{ currency: 'USD', total: 1 }, { currency: 'CNY', total: 2 }] })?.currency, 'CNY', 'prefers CNY')
is(internals.pickBalance({ balances: [{ currency: 'USD', total: 1 }] })?.currency, 'USD', 'falls back to the first entry')
is(internals.pickBalance({ balances: [] }), undefined, 'empty payload')
is(internals.pickBalance(null), undefined, 'missing payload')

console.log('[spec] reading age')
is(internals.relativeTime(0, 0), '尚未获取', 'never fetched')
is(internals.relativeTime(1000, 1000 + 2000), '刚刚', 'just now')
is(internals.relativeTime(0, 0), '尚未获取', 'epoch is treated as absent')

if (failures > 0) {
  console.error(`\n[spec] ${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\n[spec] OK')
