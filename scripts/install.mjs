/**
 * Install the balance bar into the DSH Web profile's own patch layer.
 *
 * The Web profile's `cordis.patch.yml` is the user patch layer the running
 * launcher watches (`patchReload: live`), so appending the row here is what
 * makes the plugin load on the next index render — no restart, only a page
 * reload.
 *
 * Idempotent: an existing `balance-bar` row is reported and left alone.
 * Re-runnable with a different checkout path via `--host <file-url>`.
 *
 * Usage: node scripts/install.mjs [--home <DSH_HOME>] [--profile web] [--host <file-url>] [--dry-run]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(HERE, '..')

/** Read an `--name value` pair from argv. */
function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined
}

const flag = name => process.argv.includes(`--${name}`)

const home = option('home') ?? process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? homedir(), '.dsh')
const profile = option('profile') ?? 'web'
const profileDir = join(home, 'profiles', profile)
const patchPath = join(profileDir, 'cordis.patch.yml')
const hostEntry = option('host') ?? pathToFileURLOf(join(PACKAGE_DIR, 'src', 'index.ts'))

/** Absolute path as the loader's own resolver wants it. */
function pathToFileURLOf(absolute) {
  const posix = absolute.replaceAll('\\', '/')
  return `file:///${posix.replace(/^\/+/, '')}`
}

if (!existsSync(profileDir)) {
  console.error(`[install] no profile at ${profileDir}`)
  console.error('[install] pass --home <DSH_HOME> or start `dsh web` once to create the profile')
  process.exit(1)
}

const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '# Your patch layer for this dsh profile.\n[]\n'

if (/^\s*-?\s*id:\s*balance-bar\s*$/m.test(existing) || existing.includes('balance-bar/src/index.ts')) {
  console.log(`[install] balance-bar is already present in ${patchPath}`)
  process.exit(0)
}

/**
 * Replace the empty document (`[]`) with one insert block, or append a new
 * insert block after existing rows. Both are valid patch lists; keeping the
 * file's own comments intact is the point of not re-serializing it.
 */
function merged(text) {
  const block = [
    '',
    '# dsh-balance-bar: live account balance as a vertical bar on the right edge.',
    '- insert:',
    '    - id: balance-bar',
    `      name: '${hostEntry}'`,
    '      config:',
    '        credentialRef: DEEPSEEK_API_KEY',
    '        endpoint: https://api.deepseek.com/user/balance',
    '        cacheTtlMs: 60000',
    '        pollIntervalMs: 300000',
    '        timeoutMs: 10000',
    '',
  ].join('\n')
  const stripped = text.replace(/^\s*\[\s*\]\s*$/m, '')
  return `${stripped.replace(/\s*$/, '')}\n${block}`
}

const next = merged(existing)

if (flag('dry-run')) {
  console.log(`[install] would write ${patchPath}:\n`)
  console.log(next)
  process.exit(0)
}

writeFileSync(patchPath, next)
console.log(`[install] wrote ${patchPath}`)
console.log(`[install] host half: ${hostEntry}`)
console.log('[install] the Web profile reloads this file live — reload the page to see the bar.')
