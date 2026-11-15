/**
 * Register the search chain with `ctx.web`.
 *
 * Kept apart from `./search.js` so the execution logic stays testable without a
 * context: this file is the only part that knows about `ctx`.
 *
 * @module dsh-web-fallback-chain/chains/search-plugin
 */

import { CHAIN_SEARCH_PROVIDER_ID, readField } from '../config.js'

export { CHAIN_SEARCH_PROVIDER_ID, readField }
import { mergeProviders, resolveOrder, DEFAULT_MODE, MODES } from '../policy/index.js'
import { capSources, finalize, resolveLegs, runSearchChain } from './search.js'

export function applySearchChain(ctx, config) {
  /**
   * Validate the configured mode names, on first resolve rather than at mount.
   *
   * These fields are `volatile()`, and reading them during `apply()` may run
   * before injection completes, where schemastery throws. A bad mode name still
   * fails loudly — just on the first search instead of at startup.
   */
  let validated = false
  const validateModes = (searchModes) => {
    if (validated) return
    for (const mode of Object.keys(searchModes ?? {})) {
      if (!MODES.includes(mode)) {
        throw new Error(`web-search-chain: \`modeOrders.search.${mode}\` is not a mode (known: ${MODES.join(', ')})`)
      }
    }
    validated = true
  }

  const ordersFor = (request) => {
    const providers = mergeProviders(readField(config, 'providers', {}))
    const flat = readField(config, 'searchOrder', [])
    const configured = readField(config, 'modeOrders', {}) ?? {}
    const searchModes = configured.search ?? {}
    validateModes(searchModes)
    const prefs = { modeOrders: configured, defaultMode: readField(config, 'defaultMode', DEFAULT_MODE), freeOnly: false }
    const { mode } = resolveOrder({ capability: 'search', request, config: prefs, providers })
    const configuredForMode = Array.isArray(searchModes[mode]) && searchModes[mode].length > 0
    const base = configuredForMode
      ? searchModes[mode]
      : (flat.length > 0 ? flat : resolveOrder({ capability: 'search', request, config: prefs, providers }).order)
    const freeOnly = readField(config, 'freeOnly', true) === true
    const order = freeOnly ? base.filter((id) => providers[id]?.cost !== 'paid') : base
    return { mode, order, skippedForCost: base.filter((id) => !order.includes(id)) }
  }

  /** The per-source budget for the mode, read from the winning leg's metadata. */
  const capFor = (mode, order) => {
    const providers = mergeProviders(readField(config, 'providers', {}))
    const winner = order[0]
    const caps = winner === undefined ? undefined : providers[winner]?.maxChars
    const cap = caps?.[mode]
    return typeof cap === 'number' ? cap : null
  }

  const provider = {
    id: CHAIN_SEARCH_PROVIDER_ID,
    available: () => {
      try {
        const { order } = ordersFor({ query: '' })
        const { legs } = resolveLegs(ctx.web.searchProviders, order, CHAIN_SEARCH_PROVIDER_ID)
        return legs.some((leg) => {
          try {
            return leg.provider.available() === true
          } catch {
            return false
          }
        })
      } catch {
        return false
      }
    },
    search: (request, signal) => {
      const { mode, order } = ordersFor(request)
      const { legs, missing } = resolveLegs(ctx.web.searchProviders, order, CHAIN_SEARCH_PROVIDER_ID)
      return runSearchChain(legs, missing, {
        annotateFallback: readField(config, 'annotateFallback', true),
        cap: capFor(mode, order),
      }, request, signal)
    },
  }

  ctx.web.registerSearchProvider(provider)

  // Resolve the initial order defensively.
  //
  // Reading a `volatile()` field needs the plugin's injection to be complete, and
  // at `apply()` time it may not be: schemastery then throws
  // `cannot get property "X" without inject`. The order is wanted only for the
  // startup log line, so a failure here must not take the provider down — the
  // chain resolves lazily on the first real call, which runs after injection.
  try {
    const initial = ordersFor({ query: '' })
    ctx.logger?.info?.(
      `web-search-chain: registered as "${CHAIN_SEARCH_PROVIDER_ID}" (mode=${initial.mode}) order [${initial.order.join(' → ')}]`
        + (readField(config, 'freeOnly', true) === true ? ' (free only)' : ''),
    )
  } catch (error) {
    ctx.logger?.info?.(
      `web-search-chain: registered as "${CHAIN_SEARCH_PROVIDER_ID}"; order resolves on first search (${String(error?.message ?? error).slice(0, 120)})`,
    )
  }
}
