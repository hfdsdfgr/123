/**
 * Theme-token guard.
 *
 * A CSS custom property that does not exist fails *silently*: the declaration
 * is dropped and the hardcoded fallback paints instead, so a typo'd token looks
 * like a deliberate design choice. That is exactly how this plugin's hover card
 * ended up reading as permanently half-transparent — four references
 * (`--dsw-alias-bg-elevated`, `--dsw-alias-text-primary`,
 * `--dsw-alias-text-secondary`, `--dsw-alias-border-subtle`) were never defined
 * by `ui-theme`, and only their fallbacks rendered.
 *
 * This check loads the real bundle to capture the stylesheet it installs, then
 * verifies every `--dsw-*` reference against the names the theme actually
 * declares. It reads the theme from the DSH checkout (`--root`, `$DSH_ROOT`, or
 * a sibling checkout); when no theme source is available it degrades to the
 * built-in known-bad list rather than passing vacuously.
 *
 * Usage: node scripts/theme-tokens.mjs [--root <dsh-checkout>]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(HERE, '..')
const CLIENT = join(PACKAGE_DIR, 'src', 'client.js')

/** Read an `--name value` pair from argv. */
function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined
}

/** Tokens that once appeared here and are NOT theme tokens; regressions to catch. */
const KNOWN_INVALID = [
  '--dsw-alias-bg-elevated',
  '--dsw-alias-text-primary',
  '--dsw-alias-text-secondary',
  '--dsw-alias-border-subtle',
]

/** Candidate DSH checkouts, most specific first. */
const ROOTS = [
  option('root'),
  process.env.DSH_ROOT,
  'E:\\DSH\\deepseek-harness-dsh-v0.1.5-rc.2',
  resolve(PACKAGE_DIR, '..'),
].filter(root => typeof root === 'string' && root.length > 0)

/** Every custom property the ui-theme sheets declare, plus browser/platform names we use. */
function themeTokens() {
  const names = new Set()
  for (const root of ROOTS) {
    const styles = join(root, 'packages', 'client', 'ui-theme', 'src', 'styles')
    if (!existsSync(styles)) continue
    for (const file of readdirSync(styles).filter(name => name.endsWith('.css'))) {
      const text = readFileSync(join(styles, file), 'utf8')
      for (const match of text.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) names.add(match[1])
    }
    if (names.size > 0) {
      console.log(`[tokens] theme source: ${styles} (${names.size} declared properties)`)
      return names
    }
  }
  return names
}

/** The stylesheet the bundle installs, captured through the module-table contract. */
async function installedStylesheet() {
  const registrations = []
  globalThis.window = { __ModuleLoader__: { load: registration => registrations.push(registration) } }
  // Captured elements, so we can read back the exact CSS text the page receives.
  const tags = []
  globalThis.document = {
    head: { appendChild: tag => { tags.push(tag); return tag } },
    createElement: () => ({ dataset: {}, textContent: '' }),
    querySelector: () => null,
  }
  await import(`${new URL(`file://${CLIENT.replaceAll('\\', '/')}`).href}?t=${Date.now()}`)
  const exports = registrations[0].factory(() => ({
    createElement: () => ({}), Fragment: 'f', useState: () => [null, () => {}], useEffect: () => {}, useCallback: fn => fn,
  }))
  exports.apply({
    effect: body => { body(); return () => {} },
    slots: { inject: () => () => {}, register: () => () => {} },
    logger: { warn: () => {}, error: () => {} },
  })
  if (tags.length !== 1) throw new Error(`expected one stylesheet, captured ${tags.length}`)
  return tags[0].textContent
}

const css = await installedStylesheet()
const referenced = [...new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map(match => match[1]))].sort()
const declared = themeTokens()

console.log(`[tokens] stylesheet references ${referenced.length} custom properties`)

const problems = []
for (const token of referenced) {
  // Names the plugin defines for itself are not the theme's business.
  const selfDeclared = new RegExp(`^\\s*${token}\\s*:`, 'm').test(css)
  if (selfDeclared) continue
  if (declared.size === 0) {
    if (KNOWN_INVALID.includes(token)) problems.push(`${token} (known-invalid theme token)`)
    continue
  }
  if (!declared.has(token)) problems.push(`${token} (not declared by ui-theme)`)
}

if (problems.length > 0) {
  console.error(`\n[tokens] ${problems.length} unresolved theme reference(s):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`[tokens] every reference resolves${declared.size === 0 ? ' (checked against the known-bad list only)' : ''}`)

// The value chip must read horizontally; a vertical writing mode was the old design.
if (/\.dsh-balance-label[^}]*writing-mode\s*:\s*vertical/.test(css)) {
  console.error('[tokens] the value chip must not use a vertical writing mode')
  process.exit(1)
}
console.log('[tokens] value chip is horizontal')
console.log('[tokens] OK')
