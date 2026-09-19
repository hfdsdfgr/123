/**
 * Client-half smoke test: load `src/client.js` exactly the way the browser
 * module table does — through a stubbed `window.__ModuleLoader__` — and assert
 * the registration it performs.
 *
 * This catches what only a real load can: syntax errors, a wrong artifact shape
 * (the factory must return the plugin exports), a missing `shell.overlay`
 * registration, and a module-table request the shell cannot answer. It does not
 * render React; it proves the bundle materializes and wires up.
 *
 * Usage: node scripts/client-smoke.mjs
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CLIENT = join(import.meta.dirname, '..', 'src', 'client.js')

/** Platform modules the shell seeds; anything else is a load-time failure. */
const PLATFORM = {
  react: {
    createElement: () => ({}),
    Fragment: Symbol('Fragment'),
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useCallback: fn => fn,
    memo: value => value,
  },
}

const registrations = []
globalThis.window = {
  __ModuleLoader__: {
    load(registration) { registrations.push(registration) },
  },
}
// Ask the factory for its pure logic so the threshold and wave math is testable.
globalThis.__DSH_BALANCE_TEST__ = true

// Two DOM touch points exist outside React: the stylesheet installer. Stub just
// those so the same file can be exercised without a page.
const styleTags = []
globalThis.document = {
  head: { appendChild: tag => { styleTags.push(tag); return tag } },
  createElement: () => ({ dataset: {}, textContent: '' }),
  querySelector: () => null,
}

// The artifact is a classic script: evaluating it in this realm is exactly the
// browser's load step (`<script src>`), and the module-table require below is
// the shell's own resolver contract.
await import(`${new URL(`file://${CLIENT.replaceAll('\\', '/')}`).href}`)

if (registrations.length !== 1) throw new Error(`expected one registration, got ${registrations.length}`)
const registration = registrations[0]
if (registration.id !== 'dsh-balance-bar') throw new Error(`registration id is ${registration.id}`)
console.log('[smoke] registered bundle id:', registration.id)

const requested = []
const exports = registration.factory((specifier) => {
  requested.push(specifier)
  const found = PLATFORM[specifier]
  if (found === undefined) throw new Error(`module table has no answer for "${specifier}"`)
  return found
})

console.log('[smoke] requested modules:', requested.join(', ') || '(none)')
if (typeof exports.apply !== 'function') throw new Error('the factory returned no apply function')
if (exports.name !== 'dsh-balance-bar') throw new Error(`plugin name is ${exports.name}`)
if (!Array.isArray(exports.inject) || !exports.inject.includes('slots')) {
  throw new Error(`inject is ${JSON.stringify(exports.inject)}`)
}

/** Minimal Client context recording the Cordis calls the plugin makes. */
const calls = { effects: [], injections: [], registrations: [] }
const ctx = {
  effect(body, label) { calls.effects.push(label); return body() },
  slots: {
    inject(key, callback) {
      calls.injections.push(key)
      const effect = callback()
      calls.registrations.push(effect)
      return () => {}
    },
    register(options, component) {
      calls.registrations.push({ options, component })
      // The real registry returns the entry disposer.
      return () => {}
    },
  },
  logger: { warn: () => {}, error: () => {} },
}

exports.apply(ctx)

console.log('[smoke] effects:', calls.effects.join(' | '))
console.log('[smoke] injected into slot:', calls.injections.join(','))
const registrationCall = calls.registrations.find(entry => entry !== null && typeof entry === 'object' && entry.options)
if (registrationCall === undefined) throw new Error('no slots.register call reached the registry')
if (registrationCall.options.name !== 'shell.overlay') {
  throw new Error(`registered into ${registrationCall.options.name}, expected shell.overlay`)
}
if (registrationCall.options.id !== 'balance-bar') {
  throw new Error(`list entry id is ${String(registrationCall.options.id)}`)
}
if (typeof registrationCall.component !== 'function') throw new Error('registered component is not a function')
console.log('[smoke] register ->', JSON.stringify(registrationCall.options))
if (styleTags.length !== 1) throw new Error(`expected one injected stylesheet, got ${styleTags.length}`)
if (!styleTags[0].textContent.includes('dshbb-scroll')) throw new Error('injected stylesheet lacks the wave animation')
console.log('[smoke] stylesheet:', styleTags[0].dataset.dshPluginCss, `${styleTags[0].textContent.length} bytes`)

// The stylesheet must be the one thing the bundle owns without React.
const source = readFileSync(CLIENT, 'utf8')
for (const marker of ['dshbb-scroll', 'dsh-balance-surface', "id: 'dsh-balance-bar'"]) {
  if (!source.includes(marker)) throw new Error(`client artifact is missing ${marker}`)
}

console.log('[smoke] OK')
