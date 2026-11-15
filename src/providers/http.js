/**
 * `dsh-web-providers` — the search and fetch legs this deployment actually uses.
 *
 * ## Why one package instead of one per vendor
 *
 * Every leg here is the same shape: an HTTP call with a bearer key, a response
 * envelope to unwrap, and a handful of failure codes worth translating into the
 * seam's vocabulary. Splitting that into four packages would duplicate the key
 * loading, the timeout handling and the error mapping four times, and the copies
 * would drift. The vendor-specific part of each leg is genuinely small, so it
 * lives in one file per vendor while the shared plumbing lives in `http.js`.
 *
 * ## What each leg declares
 *
 * - **AnySearch** — `/v1/search` and `/v1/extract`. The only leg that won on
 *   bot-walled sites (oschina, Reddit) in the benchmark behind these plugins.
 *   Also exposes 17 vertical domains with their own sub-domains and required
 *   params, which is a *different* capability from general web search: the same
 *   query `cordis registerService` returns the EU research database from general
 *   search and the actual source docs from `code.doc`. Vertical routing is opt-in
 *   per call, never guessed.
 * - **Tavily** — `/search` and `/extract`, plus `/crawl` and `/map`, which no
 *   other leg here offers. Its free tier is monthly (~1500 calls), not daily, so
 *   it is ranked below AnySearch for the hot path.
 * - **DeepSeek** — `/v1/tools/search` and `/v1/tools/fetch`. Best relevance and
 *   the only leg with real index dates; billed per successful request. Its fetch
 *   degrades silently (HTTP 200 + site footer), which is why the fetch chain's
 *   `minBodyChars` exists.
 *
 * ## Credentials
 *
 * Read from the environment at call time, never cached at mount, because the
 * harness snapshots `.env` into `process.env` at boot and a key rotated in the
 * file is invisible until restart — reporting `available() === false` on every
 * call keeps that visible instead of failing once and looking healthy after.
 *
 * @module dsh-web-fallback-chain/providers/http
 */

import z from '@deepseek-ai/schemastery'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-providers'

/** The web seam these providers register into. */
export const inject = ['web']

/** Provider ids this package can register. */
export const SEARCH_IDS = ['deepseek-search-rich', 'anysearch', 'tavily']
export const FETCH_IDS = ['deepseek-fetch-rich', 'anysearch', 'tavily']

export const Config = z.object({
  /** Which legs to mount. Empty means all of them; a leg without a key stays registered but unavailable. */
  enable: z.array(z.string()).default([]).volatile(),
  /** Per-request timeout in milliseconds. */
  timeoutMs: z.number().min(1000).default(30000).volatile(),
  /** Redirect hops a leg may follow (only the legs that fetch raw HTML care). */
  maxRedirects: z.number().min(0).max(10).default(5).volatile(),
  /** Send `need_content: true` to DeepSeek search (bigger payload, same price). */
  deepseekNeedContent: z.boolean().default(false).volatile(),
  /** AnySearch vertical domain routing: off by default, because it is a different query, not a refinement. */
  anysearchTag: z.string().default('').volatile(),
  /** Extra AnySearch vertical params, as `key=value,key2=value2`. */
  anysearchParams: z.string().default('').volatile(),
})

export { Config as default }

/** Options that would leak a key into a log line. */
const SECRET_HEADER = /authorization/i

/**
 * The machine-routable code for an HTTP status, in the seam's vocabulary.
 *
 * The seam distinguishes "the provider is unusable" from "this request failed";
 * a 401/403 is the former (a rotated or missing key) and must not be retried by
 * a chain, while a 5xx is the latter and should fall through.
 *
 * @param status - HTTP status.
 * @returns the code string a chain can branch on.
 */
export function codeForStatus(status) {
  if (status === 401 || status === 403) return 'WEB_PROVIDER_UNAUTHORIZED'
  if (status === 429) return 'WEB_PROVIDER_RATE_LIMITED'
  if (status >= 500) return 'WEB_PROVIDER_UNAVAILABLE'
  return 'WEB_PROVIDER_ERROR'
}

/** A WebError-shaped error: a `code` the seam and the chains understand. */
export function providerError(message, code) {
  return Object.assign(new Error(message), { code })
}

/**
 * One HTTP call, with the parts every leg needs.
 *
 * Returns the parsed JSON body; throws a coded error otherwise. Deliberately no
 * retry: a chain already retries by moving to the next leg, and a hidden retry
 * inside a leg would make the chain's per-leg timing meaningless.
 *
 * @param options - `{url, method, headers, body, timeoutMs, signal, provider}`.
 * @returns the parsed response body.
 */
export async function callJson({ url, method = 'GET', headers = {}, body, timeoutMs = 30000, signal, provider }) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) throw providerError(`${provider}: cancelled before the request`, 'WEB_PROVIDER_UNAVAILABLE')
  signal?.addEventListener?.('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  let response
  try {
    response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
  } catch (error) {
    const timedOut = error?.name === 'AbortError'
    throw providerError(
      `${provider}: ${timedOut ? `no answer within ${timeoutMs}ms` : String(error?.message ?? error)}`,
      timedOut ? 'WEB_FETCH_TIMEOUT' : 'WEB_PROVIDER_UNAVAILABLE',
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onAbort)
  }

  const text = await response.text()
  if (!response.ok) {
    throw providerError(
      `${provider}: HTTP ${response.status} ${text.slice(0, 200)}`,
      codeForStatus(response.status),
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw providerError(`${provider}: response was not JSON (${text.slice(0, 120)})`, 'WEB_PROVIDER_ERROR')
  }
}

/** Build an `Authorization` header for a bearer key, or nothing when absent. */
export function bearer(key) {
  return key ? { Authorization: `Bearer ${key}` } : {}
}

/** Read an env var at call time (see the module note about the boot snapshot). */
export function keyFrom(env, name) {
  const value = env?.[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read a credential the way the product does: the credential service first, then
 * the ambient environment.
 *
 * ## Why this exists
 *
 * A key typed into a settings page is written to the credential store, and the
 * store is consulted **before** `process.env` — that precedence is the documented
 * behaviour of `CredentialRef` ("the provider-managed store first, then ambient
 * fallbacks such as the process environment and `.env` files"). Reading only
 * `process.env` therefore made a key entered in the UI invisible to the providers:
 * the page would say "set" while every call said "401".
 *
 * The seam contract forces two shapes:
 *
 * - `available()` is synchronous, so it answers from the ambient snapshot. A key
 *   that exists only in the credential store can still report unavailable until the
 *   first call — acceptable, and the alternative (making `available` async) does not
 *   typecheck against the seam.
 * - `search()` / `fetch()` are asynchronous, so they resolve through the service and
 *   see a UI-entered key immediately.
 *
 * @param options - `{ credentials, env, name }`; `credentials` may be undefined on a
 *   deployment without the service, in which case this degrades to the env read.
 * @returns an object with a synchronous `peek()` and an async `resolve()`.
 */
export function credentialSource({ credentials, env, name }) {
  const ambient = () => keyFrom(env, name)
  return {
    /** Ambient value only — for the synchronous availability probe. */
    peek: ambient,
    /**
     * The value to authenticate with: the store first, ambient second.
     *
     * A rejected lookup must not fail the call: the whole point of a fallback chain
     * is that one leg being misconfigured produces the next leg, not an exception.
     */
    async resolve() {
      if (credentials !== undefined && typeof credentials.resolve === 'function') {
        try {
          // `credentialRef` is re-exported by the service module; the import is lazy so
          // this file stays loadable in a plain node test without the product's graph.
          const { credentialRef } = await import('@deepseek-ai/dsh-credentials')
          const resolved = await credentials.resolve(credentialRef(name))
          if (typeof resolved?.value === 'string' && resolved.value.length > 0) return resolved.value
        } catch {
          // Fall through to the ambient value.
        }
      }
      return ambient()
    },
  }
}

/** Collect the headers that are safe to log. */
export function redactHeaders(headers) {
  const out = {}
  for (const [k, v] of Object.entries(headers ?? {})) out[k] = SECRET_HEADER.test(k) ? '<redacted>' : v
  return out
}
