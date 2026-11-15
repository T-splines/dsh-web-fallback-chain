/**
 * Shared policy for the search and fetch fallback chains.
 *
 * This package holds no provider and makes no network call. It is the piece the
 * two chain plugins have in common:
 *
 * - {@link module:dsh-web-fallback-chain/policy/providers} — what each leg costs, how good
 *   it is, how much text to keep, and how a user adds a leg we never tested.
 * - {@link module:dsh-web-fallback-chain/policy/modes} — what kind of material the caller
 *   needs (`brief` / `deep` / `list` / `page`), how that picks an order, and how
 *   `freeOnly` removes the billed legs without re-sorting anything.
 *
 * Splitting it out is deliberate: search and fetch must agree on what "free"
 * means and on how a mode maps to an order, and two copies of that rule would
 * drift the moment one of them learned about a new leg.
 *
 * @module dsh-web-fallback-chain/policy
 */

export {
  DEFAULTS,
  KINDS,
  mergeProviders,
  partitionByCost,
  missingKey,
} from './providers.js'

export {
  MODES,
  DEFAULT_MODE,
  DEFAULT_MODE_ORDERS,
  classifyFetch,
  classifySearch,
  resolveOrder,
  readField,
  capText,
} from './modes.js'
