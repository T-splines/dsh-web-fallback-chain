/**
 * Register the fetch chain — an ordered, fall-back fetch provider — with `ctx.web`.
 *
 * ## Why a provider instead of seam configuration
 *
 * The seam selects **one** provider (`fetchProvider`) and refuses to guess when
 * several are usable; its own docs reject a hidden priority chain in config,
 * because a fetch that silently changes transport is a fetch whose provenance is
 * unknowable. The requested behaviour — "DeepSeek first, something local when
 * DeepSeek cannot serve" — is therefore expressed as one explicitly pinned
 * provider: its order is deployment config, and its result says what ran.
 *
 * ## What it does not do
 *
 * It holds no credentials and imports no transport. Each leg is a provider other
 * plugins already registered, so this plugin needs nothing installed beside it
 * and cannot disagree with how those providers are configured. A fake-ip-aware
 * local fetcher (e.g. `dsh-web-fetch-fakeip`, which registers the stock `http`
 * id) is picked up automatically when it is the mounted local fetcher.
 *
 * ## Mounting
 *
 * Mount it, then pin `fetchProvider: fetch-chain` in the same `- id: web` row.
 * Left un-pinned the seam keeps reporting its ambiguity error, which is the
 * intended way to notice a half-configured seam.
 *
 * ## Modes and budget
 *
 * The order is not one list any more: `modeOrders.fetch.<mode>` ranks legs per
 * intent (`brief` / `deep` / `list` / `page`), because the benchmark behind this
 * plugin found the best leg is not the same for "quote me one fact" as for "read
 * me this document". An explicit mode is honoured when the caller passes one;
 * otherwise the URL is classified. `minBodyChars` turns a technically-successful
 * page footer into a miss so the chain actually falls through.
 *
 * @module dsh-web-fallback-chain/chains/fetch-plugin
 */

import { CHAIN_FETCH_PROVIDER_ID, readField } from '../config.js'

export { CHAIN_FETCH_PROVIDER_ID, readField }
import { resolveLegs, runChain } from './fetch.js'
import { mergeProviders, resolveOrder, DEFAULT_MODE, MODES } from '../policy/index.js'

/** Cordis plugin name used by loader diagnostics. */


/** The web seam this provider registers into. */


export { describeAttempts, fallbackMarker, finalize, chainError } from './fetch.js'

/**
 * Register the chain with `ctx.web`.
 *
 * The fields are volatile (see config.js): their values are read per call, so a
 * save on the generated settings page takes effect on the next fetch without a
 * restart. Mount-time validation still runs on the initial value — a typo caught
 * at mount is a startup error, while a typo saved later degrades to an
 * `unregistered` attempt instead of taking the service down.
 *
 * @param ctx - context whose `web` service receives the provider.
 * @param config - resolved plugin configuration (values or volatile getters).
 */
export function applyFetchChain(ctx, config) {
  /**
   * Validate the configured orders.
   *
   * Deliberately *not* called at mount: these fields are `volatile()`, and at
   * `apply()` time this plugin's injection may not be complete, in which case
   * schemastery throws `cannot get property "X" without inject`. Reading them at
   * mount to validate would mean a healthy deployment fails to start over a
   * diagnostic. Validation therefore runs on the first resolve — the point where
   * the values are known good — and a bad configuration still fails loudly, just
   * one call later, with the same message.
   */
  let validated = false
  const validateOrders = (flat, fetchModes) => {
    if (validated) return
    // An empty `order` with no `modeOrders.fetch` is NOT an error: it means "use the
    // shipped per-mode defaults", which is exactly what a fresh install has. Treating
    // it as fatal made `available()` return false (the throw was swallowed by its
    // catch), so dsh reported `web provider "fetch-chain" is registered but
    // unavailable` on a deployment with nothing wrong with it.
    // A mode name the resolver does not know would silently fall back to the
    // classifier, which looks like the setting being ignored. Refuse it instead.
    for (const mode of Object.keys(fetchModes ?? {})) {
      if (!MODES.includes(mode)) {
        throw new Error(`web-fetch-chain: \`modeOrders.fetch.${mode}\` is not a mode (known: ${MODES.join(', ')})`)
      }
    }
    // Fail loud instead of recursing at fetch time.
    const mentionsSelf = (ids) => Array.isArray(ids) && ids.includes(CHAIN_FETCH_PROVIDER_ID)
    if (mentionsSelf(flat) || Object.values(fetchModes ?? {}).some(mentionsSelf)) {
      throw new Error(`web-fetch-chain: an order cannot include "${CHAIN_FETCH_PROVIDER_ID}" (the chain itself)`)
    }
    validated = true
  }

  /**
   * Which leg ids to attempt for one call.
   *
   * Precedence, cheapest decision first:
   * 1. `modeOrders.fetch[<mode>]` when configured — the user's own ranking.
   * 2. The shipped per-mode default (`dsh-web-chain-core`), which encodes the
   *    benchmark ranking rather than a guess.
   * 3. The legacy flat `order`, which is what a pre-modes deployment has.
   *
   * `freeOnly` then removes billed legs without re-sorting the survivors, so
   * flipping the switch is exactly reversible.
   */
  const ordersFor = (request) => {
    const providers = mergeProviders(readField(config, 'providers', {}))
    const flat = readField(config, 'order', [])
    const configured = readField(config, 'modeOrders', {}) ?? {}
    const fetchModes = configured.fetch ?? {}
    validateOrders(flat, fetchModes)

    // Resolve the mode first, so we know whether the user configured *this* one.
    const prefs = { modeOrders: configured, defaultMode: readField(config, 'defaultMode', DEFAULT_MODE), freeOnly: false }
    const { mode } = resolveOrder({ capability: 'fetch', request, config: prefs, providers })

    // A mode the user configured uses their ranking. A mode they did not
    // configure falls back to the flat order — NOT to a shipped per-mode default,
    // because those name legs the deployment may never have mounted. Switching a
    // deployment onto providers it did not choose would be a surprise, so the
    // shipped defaults are only used when no flat order exists either.
    const configuredForMode = Array.isArray(fetchModes[mode]) && fetchModes[mode].length > 0
    const base = configuredForMode
      ? fetchModes[mode]
      : (flat.length > 0 ? flat : (resolveOrder({ capability: 'fetch', request, config: prefs, providers }).order))

    const freeOnly = readField(config, 'freeOnly', true) === true
    const order = freeOnly ? base.filter((id) => providers[id]?.cost !== 'paid') : base
    return {
      mode,
      order,
      skippedForCost: base.filter((id) => !order.includes(id)),
    }
  }

  // One diagnostic per distinct reason, so a per-request call does not flood the log.
  const complained = new Set()
  const complain = (what, error) => {
    const message = `${what}: ${error instanceof Error ? error.message : String(error)}`
    if (complained.has(message)) return
    complained.add(message)
    try {
      ctx.logger?.warn?.(`web-fallback: fetch chain reports unavailable — %s`, message)
    } catch {
      // A logger that throws must not turn a diagnostic into a second failure.
    }
  }

  const provider = {
    id: CHAIN_FETCH_PROVIDER_ID,
    /**
     * Usable when at least one configured provider is registered and reports
     * itself usable. Never makes a network call (the seam requires that).
     */
    available: () => {
      // `available()` must never throw — the seam calls it to choose a provider, and a
      // throw there surfaces as the opaque "registered but unavailable". But swallowing
      // the reason made a misconfigured order look like a deployment with no keys: the
      // only way to find out was to read this file. So: still return false, but say why
      // once, on the host log.
      try {
        const { legs } = resolveLegs(ctx.web.fetchProviders, ordersFor({ url: '' }).order, CHAIN_FETCH_PROVIDER_ID)
        return legs.some((leg) => {
          try {
            return leg.provider.available() === true
          } catch (error) {
            complain('a leg threw from available()', error)
            return false
          }
        })
      } catch (error) {
        complain('the chain could not resolve its order', error)
        return false
      }
    },
    fetch: (request, signal) => {
      // Resolved per fetch: another plugin may have (un)mounted a leg since mount,
      // and the settings page may have rewritten the order since the last call.
      const { order } = ordersFor(request)
      const { legs, missing } = resolveLegs(ctx.web.fetchProviders, order, CHAIN_FETCH_PROVIDER_ID)
      return runChain(legs, missing, {
        annotateFallback: readField(config, 'annotateFallback', true),
        minBodyChars: readField(config, 'minBodyChars', 0),
      }, request, signal)
    },
  }

  ctx.web.registerFetchProvider(provider)

  // Reading a volatile() field needs injection to be complete; at apply() time it
  // may not be, and schemastery then throws `cannot get property "X" without
  // inject`. The order is wanted only for this log line, so a failure must not
  // take the provider down — the chain resolves lazily on the first fetch.
  try {
    const initial = ordersFor({ url: '' })
    ctx.logger?.info?.(
      `web-fetch-chain: registered as "${CHAIN_FETCH_PROVIDER_ID}" (mode=${initial.mode}) order [${initial.order.join(' → ')}]`
        + (readField(config, 'freeOnly', true) === true ? ' (free only)' : '')
        + (readField(config, 'annotateFallback', true) === false ? ' (fallback annotation off)' : '')
        + (readField(config, 'minBodyChars', 0) > 0 ? ` (min body ${readField(config, 'minBodyChars', 0)}c)` : ''),
    )
  } catch (error) {
    ctx.logger?.info?.(
      `web-fetch-chain: registered as "${CHAIN_FETCH_PROVIDER_ID}"; order resolves on first fetch (${String(error?.message ?? error).slice(0, 120)})`,
    )
  }
}
