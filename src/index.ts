/**
 * Account-balance bar, Host half.
 *
 * The browser cannot talk to the model provider by itself (the API key must
 * never reach a page), so this half owns the two things only the Host can do:
 * resolve the provider credential through `ctx.credentials` and call the
 * DeepSeek balance endpoint. It then publishes the result on two surfaces the
 * all-plain-JavaScript Client half consumes:
 *
 * 1. `GET /dsh-balance/snapshot` — a small same-origin JSON route the browser
 *    poller reads. It is intentionally NOT under `/api`: that carrier belongs
 *    to the Connection plugin (which authenticates and would 401 every route it
 *    does not own), while this is an ordinary named route on `ctx.webServer`.
 *    The reading is a display-only snapshot, and the shipped Web composition
 *    binds loopback only.
 * 2. A `globalThis.__DSH_BALANCE__` index-injection row, so the bar can paint
 *    the last known value on the very first frame instead of waiting a round
 *    trip.
 *
 * Every fetch failure is carried in the snapshot as data (`error`) rather than
 * thrown, so the poller never has to distinguish "no balance" from "the route
 * itself is broken".
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name (the Loader row name). */
export const name = 'dsh-balance-bar'

/**
 * Services this half needs before `apply` runs. `webServer` and `credentials`
 * are mounted by the shipped Web composition; when one is absent the fiber
 * waits instead of failing loudly.
 */
export const inject = ['webServer', 'credentials']

/** Route prefix owned by this plugin. */
const ROUTE_PREFIX = '/dsh-balance'

/** One balance figure as the provider reports it. */
export interface BalanceInfo {
  /** ISO currency code, e.g. `CNY`. */
  readonly currency: string
  /** Total remaining amount, as the provider prints it. */
  readonly total: number
  /** Provider-reported granted (promotional) part, when present. */
  readonly granted?: number
  /** Provider-reported topped-up part, when present. */
  readonly toppedUp?: number
}

/** The display snapshot crossing to the browser. */
export interface BalanceSnapshot {
  /** Provider account accepts requests. */
  readonly available: boolean
  /** One entry per currency; the bar uses the first CNY entry, else the first. */
  readonly balances: readonly BalanceInfo[]
  /** Unix milliseconds of the successful reading. */
  readonly fetchedAt: number
  /** Failure text of the latest attempt; the last good reading stays in `balances`. */
  readonly error?: string
  /** Unix milliseconds of the failed attempt. */
  readonly errorAt?: number
  /** Whether a provider credential currently resolves. */
  readonly credential: boolean
}

/** Host-half configuration (optional; the row may omit `config` entirely). */
export interface Config {
  /** Credential reference holding the provider API key. @default 'DEEPSEEK_API_KEY' */
  readonly credentialRef?: string
  /** Balance endpoint. @default 'https://api.deepseek.com/user/balance' */
  readonly endpoint?: string
  /** Milliseconds a successful reading is served before a refresh. @default 60000 */
  readonly cacheTtlMs?: number
  /** Milliseconds between background refreshes while the page polls. @default 300000 */
  readonly pollIntervalMs?: number
  /** Per-request timeout in milliseconds. @default 10000 */
  readonly timeoutMs?: number
}

const DEFAULTS = {
  credentialRef: 'DEEPSEEK_API_KEY',
  endpoint: 'https://api.deepseek.com/user/balance',
  cacheTtlMs: 60_000,
  pollIntervalMs: 300_000,
  timeoutMs: 10_000,
} as const

/** The injection property the Client half reads before its first fetch. */
export const INJECTION_GLOBAL = '__DSH_BALANCE__'

/** Parse a provider money string without letting a malformed value become NaN. */
function parseAmount(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Project the provider payload onto the display snapshot. */
function readPayload(payload: unknown, fetchedAt: number, credential: boolean): BalanceSnapshot {
  const body = (payload ?? {}) as Record<string, unknown>
  const raw = Array.isArray(body.balance_infos) ? body.balance_infos : []
  const balances: BalanceInfo[] = []
  for (const entry of raw) {
    const info = (entry ?? {}) as Record<string, unknown>
    const total = parseAmount(info.total_balance)
    if (total === undefined) continue
    const granted = parseAmount(info.granted_balance)
    const toppedUp = parseAmount(info.topped_up_balance)
    balances.push({
      currency: String(info.currency ?? 'CNY'),
      total,
      ...granted === undefined ? {} : { granted },
      ...toppedUp === undefined ? {} : { toppedUp },
    })
  }
  return {
    available: body.is_available !== false,
    balances,
    fetchedAt,
    credential,
  }
}

/** Resolve the configured credential reference, tolerating either provider shape. */
async function resolveKey(ctx: Context, ref: string): Promise<string | undefined> {
  const credentials = (ctx as unknown as {
    credentials?: { resolve?: (reference: unknown) => Promise<{ value?: unknown } | undefined> }
  }).credentials
  if (credentials?.resolve === undefined) return undefined
  // The reference is a branded string at the type level and an ordinary string
  // on the wire, so the string itself is the correct runtime value.
  const resolved = await credentials.resolve(ref)
  const value = resolved?.value
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** One balance reading, with every failure converted into snapshot data. */
async function readBalance(ctx: Context, config: Required<Config>): Promise<BalanceSnapshot> {
  const attemptedAt = Date.now()
  let key: string | undefined
  try {
    key = await resolveKey(ctx, config.credentialRef)
  } catch (error) {
    return {
      available: false,
      balances: [],
      fetchedAt: attemptedAt,
      error: `credential lookup failed: ${message(error)}`,
      errorAt: attemptedAt,
      credential: false,
    }
  }
  if (key === undefined) {
    return {
      available: false,
      balances: [],
      fetchedAt: attemptedAt,
      error: `no credential: ${config.credentialRef} is not configured`,
      errorAt: attemptedAt,
      credential: false,
    }
  }

  const abort = new AbortController()
  const timer = setTimeout(() => { abort.abort() }, config.timeoutMs)
  try {
    const response = await fetch(config.endpoint, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: abort.signal,
    })
    if (!response.ok) {
      return {
        available: false,
        balances: [],
        fetchedAt: attemptedAt,
        error: `HTTP ${response.status} from ${config.endpoint}`,
        errorAt: attemptedAt,
        credential: true,
      }
    }
    return readPayload(await response.json(), Date.now(), true)
  } catch (error) {
    return {
      available: false,
      balances: [],
      fetchedAt: attemptedAt,
      error: message(error),
      errorAt: attemptedAt,
      credential: true,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Error text without assuming the thrown value is an `Error`. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Normalize partial row config against the defaults. */
function normalize(config: Config | undefined): Required<Config> {
  return {
    credentialRef: config?.credentialRef ?? DEFAULTS.credentialRef,
    endpoint: config?.endpoint ?? DEFAULTS.endpoint,
    cacheTtlMs: positive(config?.cacheTtlMs ?? DEFAULTS.cacheTtlMs),
    pollIntervalMs: positive(config?.pollIntervalMs ?? DEFAULTS.pollIntervalMs),
    timeoutMs: positive(config?.timeoutMs ?? DEFAULTS.timeoutMs),
  }
}

/** Coerce a configured duration to a usable positive number. */
function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

/**
 * Mount the balance reader: the JSON route, the early-paint injection row, and
 * a light refresh cadence.
 * @param ctx - Host plugin context.
 * @param config - optional row configuration.
 */
export function apply(ctx: Context, config?: Config): void {
  const settings = normalize(config)
  let snapshot: BalanceSnapshot | undefined
  let inFlight: Promise<BalanceSnapshot> | undefined
  let disposed = false

  /** Refresh once, sharing any in-flight read with concurrent callers. */
  const refresh = (): Promise<BalanceSnapshot> => {
    inFlight ??= readBalance(ctx, settings).then((next) => {
      inFlight = undefined
      if (disposed) return next
      // A failed attempt keeps the last good figures so the bar degrades to a
      // stale reading instead of an empty one.
      const previous = snapshot
      snapshot = next.error !== undefined && previous !== undefined && previous.balances.length > 0
        ? { ...previous, error: next.error, errorAt: next.errorAt, credential: next.credential }
        : next
      if (next.error !== undefined) {
        ctx.logger?.warn?.(`[${name}] balance refresh failed: ${next.error}`)
      }
      return snapshot
    })
    return inFlight
  }

  /** Current snapshot, refreshing when the cached reading has aged out. */
  const current = async (): Promise<BalanceSnapshot> => {
    if (snapshot !== undefined && Date.now() - snapshot.fetchedAt < settings.cacheTtlMs) return snapshot
    return await refresh()
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/snapshot`,
    handler: (req, res) => {
      void (async () => {
        const body = JSON.stringify(req.method === 'GET' || req.method === 'HEAD' ? await current() : {})
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(req.method === 'HEAD' ? undefined : body)
      })().catch((error: unknown) => {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: message(error) }))
      })
    },
  }), `${name}: balance route`)

  // Early paint: the same snapshot the route would return, embedded at index
  // render time. Absent until the first reading lands, so the Client half still
  // knows how to start from nothing.
  ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
    if (snapshot === undefined) return
    table.push({ kind: 'global', name: INJECTION_GLOBAL, value: snapshot })
  }), `${name}: earliest snapshot injection`)

  // A changed credential invalidates the cache so the next poll re-reads it.
  ctx.effect(() => ctx.on('credentials/reference-updated', (ref) => {
    if (String(ref) !== settings.credentialRef) return
    snapshot = undefined
    void refresh()
  }), `${name}: credential invalidation`)

  // A quiet background cadence keeps the reading warm between page polls.
  ctx.effect(() => {
    const timer = setInterval(() => {
      if (disposed) return
      void current().catch(() => undefined)
    }, settings.pollIntervalMs)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, `${name}: refresh cadence`)

  void refresh().catch(() => undefined)
}
