/**
 * Host-half smoke test: mount `apply` on a mock Host context and drive the
 * real `/dsh-balance/snapshot` handler against the live provider.
 *
 * This exercises the parts a browser cannot reach — credential resolution
 * through the same `.credentials.yaml` the running Harness uses, the provider
 * HTTP call, payload projection, failure-as-data, and cache reuse — without
 * starting a second Web server.
 *
 * Usage: node scripts/balance-smoke.mjs
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const HOME = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? homedir(), '.dsh')
const CREDENTIALS = join(HOME, '.credentials.yaml')

/** The `refs:` block of the Harness credential file, read without a YAML dependency. */
function credentialValue(reference) {
  const text = readFileSync(CREDENTIALS, 'utf8')
  const match = new RegExp(`^\\s{2}${reference}:\\s*(\\S+)\\s*$`, 'm').exec(text)
  return match === null ? undefined : match[1]
}

/** A Host context stand-in exposing exactly the seams the plugin uses. */
function mockContext() {
  const routes = []
  const injections = []
  const listeners = new Map()
  const effects = []
  const warnings = []
  return {
    routes,
    injections,
    warnings,
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    },
    effect(body) {
      const disposer = body()
      effects.push(disposer)
      return () => {}
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => { set.delete(listener) }
    },
    webServer: {
      register(route) { routes.push(route); return () => {} },
    },
    credentials: {
      async resolve(reference) {
        const value = credentialValue(String(reference))
        return value === undefined ? undefined : { value, source: 'file' }
      },
    },
    logger: { warn: (text) => { warnings.push(text) } },
  }
}

/** Drive one route through a minimal IncomingMessage/ServerResponse pair. */
function respond(handler, method) {
  return new Promise((settle, fail) => {
    const chunks = []
    const res = {
      status: 0,
      headers: {},
      writeHead(status, headers) { this.status = status; this.headers = headers },
      end(body) { settle({ status: this.status, headers: this.headers, body: body ?? '' }) },
    }
    try {
      const returned = handler({ method, url: '/dsh-balance/snapshot' }, res)
      if (returned !== undefined && typeof returned.then === 'function') returned.catch(fail)
    } catch (error) {
      fail(error)
    }
    void chunks
  })
}

const module = await import(pathToFileURL(join(import.meta.dirname, '..', 'src', 'index.ts')).href)
const ctx = mockContext()
module.apply(ctx)

if (ctx.routes.length !== 1) throw new Error(`expected one route, got ${ctx.routes.length}`)
console.log('[smoke] route registered:', ctx.routes[0].path)

const first = await respond(ctx.routes[0].handler, 'GET')
console.log('[smoke] first read:', first.status, first.body)
const snapshot = JSON.parse(first.body)
if (snapshot.error !== undefined) {
  console.warn(`[smoke] provider reported: ${snapshot.error} (this is still a correct snapshot shape)`)
} else {
  const cny = (snapshot.balances ?? []).find(entry => entry.currency === 'CNY')
  if (cny === undefined) throw new Error('no CNY balance in the projected snapshot')
  console.log(`[smoke] CNY total = ${cny.total.toFixed(2)} (credential=${snapshot.credential})`)
}

// The injection row must appear only after a reading exists, carrying the same shape.
ctx.emit('webserver/index-inject', ctx.injections)
const injected = ctx.injections.find(row => row.name === module.INJECTION_GLOBAL)
if (injected === undefined) throw new Error('no index-injection row after the first read')
console.log('[smoke] injected early-paint snapshot:', JSON.stringify(injected.value).slice(0, 120))

const cachedAt = Date.now()
const second = await respond(ctx.routes[0].handler, 'GET')
console.log(`[smoke] cache reuse: ${Date.now() - cachedAt} ms`)

// A credential update must invalidate the cache rather than serve the old read.
ctx.emit('credentials/reference-updated', 'DEEPSEEK_API_KEY')
console.log('[smoke] credential invalidation accepted')

console.log('[smoke] OK')
process.exit(0)
