/**
 * `dsh-web-providers` — mount the search and fetch legs this deployment uses.
 *
 * Registers each enabled leg into `ctx.web` under the ids the chains expect
 * (`deepseek-search`, `deepseek-fetch`, `anysearch`, `tavily`). A leg whose key
 * is missing is still registered but reports itself unavailable, so a chain can
 * name it and the degradation stays visible instead of looking like the leg was
 * never configured.
 *
 * ## Why the ids are shared between search and fetch
 *
 * AnySearch and Tavily serve both capabilities under one vendor name. Registering
 * them as the same id in both registries keeps the provider metadata (cost,
 * quality, budget) in one place — a leg that is `free` for search is also free
 * for fetch, and the chains read one entry.
 *
 * @module dsh-web-fallback-chain/providers
 */

import { readField } from '../config.js'
import { deepseekSearchProvider, deepseekFetchProvider, anysearchProvider, tavilyProvider } from './vendors.js'

export { codeForStatus, providerError, callJson, bearer, keyFrom, redactHeaders } from './http.js'
export { deepseekSearchProvider, deepseekFetchProvider, anysearchProvider, tavilyProvider } from './vendors.js'

/**
 * Build every enabled leg.
 *
 * Exported so a test (or a preflight command) can inspect the legs without
 * mounting the plugin.
 *
 * @param config - plugin config, plain or volatile.
 * @param env - environment to read keys from; defaults to `process.env`.
 * @param credentials - the product's credential service, when the deployment has
 *   one. Passed through so a key entered in the settings page is used; without it
 *   the providers read only the ambient environment.
 * @returns `{search: Map<id, provider>, fetch: Map<id, provider>}`.
 */
export function buildProviders(config, env = process.env, credentials = undefined) {
  const timeoutMs = readField(config, 'timeoutMs', 30000)
  const needContent = readField(config, 'deepseekNeedContent', false)
  const tag = readField(config, 'anysearchTag', '')
  const params = readField(config, 'anysearchParams', '')
  const enabled = readField(config, 'enable', [])
  const wanted = (id) => !Array.isArray(enabled) || enabled.length === 0 || enabled.includes(id)

  const search = new Map()
  const fetch = new Map()

  if (wanted('deepseek-search-rich')) search.set('deepseek-search-rich', deepseekSearchProvider({ env, credentials, timeoutMs, needContent }))
  if (wanted('deepseek-fetch-rich')) fetch.set('deepseek-fetch-rich', deepseekFetchProvider({ env, credentials, timeoutMs }))
  if (wanted('anysearch')) {
    const leg = anysearchProvider({ env, credentials, timeoutMs, tag, params })
    search.set('anysearch', leg)
    fetch.set('anysearch', leg)
  }
  if (wanted('tavily')) {
    const leg = tavilyProvider({ env, credentials, timeoutMs })
    search.set('tavily', leg)
    fetch.set('tavily', leg)
  }
  return { search, fetch }
}


