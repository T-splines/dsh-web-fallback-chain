/**
 * `dsh-web-fallback-chain` — one plugin that gives the web seam a ranked, cost-aware
 * fallback chain for both search and fetch.
 *
 * ## The problem it solves
 *
 * `ctx.web` selects exactly **one** provider per capability. Its own docs say the
 * configured id "is NOT a hidden priority chain", and it throws
 * `WEB_PROVIDER_AMBIGUOUS` when more than one provider is usable. So a deployment
 * that wants "best first, something free when the best is unavailable" cannot
 * express that in seam config at all — it has to be one pinned provider whose
 * internal order is explicit. That is what this plugin registers.
 *
 * ## What it registers
 *
 * | id | capability | what it is |
 * |:--|:--|:--|
 * | `fetch-chain` | fetch | ordered fallback across the managed legs |
 * | `search-chain` | search | the same for search |
 * | `deepseek-search-rich` | search | DeepSeek, mapping `summary` not just `snippet` |
 * | `deepseek-fetch-rich` | fetch | DeepSeek fetch |
 * | `anysearch` | both | AnySearch, the leg that won on bot-walled sites |
 * | `tavily` | both | Tavily, the only leg here that extracts PDFs |
 *
 * Pin `searchProvider: search-chain` and `fetchProvider: fetch-chain`, and the
 * chain decides which underlying leg runs.
 *
 * ## Why one package and not four
 *
 * This started as four packages (shared policy / vendors / fetch chain / search
 * chain) on a single-responsibility argument. That argument was wrong in practice:
 * it produced four settings pages, a package that could not be configured at all
 * (the shared policy has no `apply()`), and a lockstep-upgrade problem where the
 * two chains had to be bumped together by hand. Modules are the right unit for
 * internal separation; a package is the right unit for installing and configuring,
 * and there should be exactly one of those.
 *
 * ## Shape
 *
 * ```
 * config.js          one schema  -> one settings page
 * policy/            who is free, which mode wants which order, how much text
 * providers/         the vendor HTTP legs
 * chains/            the ordering and fallback logic
 * client.js          the settings page itself
 * ```
 *
 * `policy` is imported by both chains on purpose: search and fetch must agree on
 * what "free" means and on how a mode maps to an order, and two copies of that
 * rule would drift the moment one learned about a new leg.
 *
 * ## The one rule that is easy to break
 *
 * A `volatile()` config field **must** have a `.default()` **and** must be present
 * in the profile patch. schemastery reads every declared field while resolving the
 * schema, before this plugin's injection completes; a missing field is read through
 * the context proxy and throws `cannot get property "X" without inject`. That
 * happens inside config resolution, so no try/catch in `apply()` can catch it, and
 * the provider silently never registers — the seam then reports
 * `configured web provider "search-chain" is not registered` with nothing in the
 * log to explain it. `cordis.patch.yml` in this package lists every field.
 *
 * @module dsh-web-fallback-chain
 */

import { CHAIN_FETCH_PROVIDER_ID, CHAIN_SEARCH_PROVIDER_ID, Config, readField } from './config.js'
import { buildProviders } from './providers/index.js'
import { applyFetchChain } from './chains/fetch-plugin.js'
import { applySearchChain } from './chains/search-plugin.js'
import { applyPromptSection } from './prompt.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-fallback'

/**
 * The web seam this plugin registers into.
 *
 * `systemPrompt` and `tools` are collaborators of the prompt section, probed at
 * call time rather than listed here: making them hard dependencies would stop
 * the providers from registering on a deployment that composes without them,
 * which is a much worse failure than losing one prompt section.
 */
export const inject = ['web']

export { Config }
export { CHAIN_FETCH_PROVIDER_ID, CHAIN_SEARCH_PROVIDER_ID, readField, paidLast } from './config.js'
export { buildProviders } from './providers/index.js'
export { runChain, resolveLegs, finalize, describeAttempts, chainError, fallbackMarker, bodyLength } from './chains/fetch.js'
export { runSearchChain, capSources } from './chains/search.js'
export {
  DEFAULTS, KINDS, mergeProviders, partitionByCost, missingKey,
  MODES, DEFAULT_MODE, DEFAULT_MODE_ORDERS, classifyFetch, classifySearch, resolveOrder, capText,
} from './policy/index.js'

/**
 * Register every provider and both chains.
 *
 * Order matters only in that the chains must be able to find the vendor legs by
 * the time a fetch or search happens — which registration guarantees, since
 * resolution happens per call rather than at mount.
 *
 * @param ctx - context whose `web` service receives the providers.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx, config) {
  // A key entered in the settings page lands in the credential store, which takes
  // precedence over `process.env`. Reading only the environment made those keys
  // invisible to the providers, so the page said "set" while every call said 401.
  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
  const { search, fetch: fetchers } = buildProviders(config, process.env, credentials)

  const registered = { search: [], fetch: [] }
  for (const [id, provider] of search) {
    ctx.web.registerSearchProvider(provider)
    registered.search.push(id)
  }
  for (const [id, provider] of fetchers) {
    ctx.web.registerFetchProvider(provider)
    registered.fetch.push(id)
  }

  applyFetchChain(ctx, config)
  applySearchChain(ctx, config)
  applyPromptSection(ctx)

  // The only mount-time config read, and it reads fields the schema already
  // resolved. Nothing else here touches config until the first real call.
  ctx.logger?.info?.(
    `web-fallback: registered search [${registered.search.join(', ')}] + ${CHAIN_SEARCH_PROVIDER_ID}, `
      + `fetch [${registered.fetch.join(', ')}] + ${CHAIN_FETCH_PROVIDER_ID}`
      + (readField(config, 'freeOnly', true) === true ? ' (free only)' : ''),
  )
}

export { PROMPT_SECTION, PROMPT_TEXT, applyPromptSection } from './prompt.js'

export default { name, inject, Config, apply }
