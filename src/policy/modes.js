/**
 * Modes: the answer to "what kind of material does the caller need".
 *
 * ## Why modes exist instead of one chain
 *
 * The benchmark behind this plugin found the ranking is not the same job for
 * every request: for a headline answer the cheap legs are within one point of
 * the paid one, while for a page whose whole text you must read the paid leg's
 * completeness matters and its silent failures do not. A single order has to
 * compromise; a small set of named intents does not.
 *
 * ## Why the model cannot pick one yet
 *
 * The seam's request is `{ url }` for fetch and `{ query, maxResults }` for
 * search — there is no field to carry an intent, and adding one means changing
 * the host tool layer. So modes are selected by
 * (a) an explicit per-call option when a caller can pass it (our own tools),
 * (b) a URL/query classifier as a fallback, and
 * (c) `defaultMode` otherwise. Today the host tool always lands on (b)/(c);
 * when the tool layer learns to pass a mode, nothing below has to change.
 *
 * ## The four modes
 *
 * - `brief` — a fact to quote. Smallest cap, cheapest legs first, because at 300
 *   chars per result the free and paid legs scored 5/10 and 6/10.
 * - `deep` — read a document. Biggest cap, paid legs allowed to lead: this is
 *   the only mode where their completeness pays for itself.
 * - `list` — enumerate items (news front page, search listing, comment thread).
 *   Medium cap; the failure to avoid is returning navigation instead of items.
 * - `page` — one URL the user already chose. No truncation of our own, and the
 *   only mode where the local leg's structural fidelity beats server extraction.
 *
 * @module dsh-web-chain-core/modes
 */

/** Every mode name, cheapest-first ordering intent is expressed in config, not here. */
export const MODES = ['brief', 'deep', 'list', 'page']

/** Mode used when nothing else decides. `brief` is the cheapest safe default. */
export const DEFAULT_MODE = 'brief'

/**
 * Per-capability default orders, strictly best-first by measured `quality`.
 * Free and paid legs are interleaved by score; `freeOnly` skips the paid ones at
 * call time without reordering, so the ranking is one list and the switch is
 * exactly reversible.
 *
 * These are the *shipped* defaults. A deployment that measures its own numbers
 * should override `modeOrders` in config — the plugin never re-sorts these.
 */
export const DEFAULT_MODE_ORDERS = {
  search: {
    brief: ['deepseek-search-rich', 'anysearch', 'tavily'],
    deep: ['deepseek-search-rich', 'anysearch', 'tavily'],
    list: ['deepseek-search-rich', 'anysearch', 'tavily'],
    page: ['deepseek-search-rich', 'anysearch', 'tavily'],
  },
  fetch: {
    // Strictly by measured quality, descending, for every mode.
    //
    // An earlier revision put `http` (quality 4.0, the lowest) first on the
    // reasoning that it is fastest and structurally best, and that the billed leg
    // degrades silently. That was wrong about what a fallback chain means: **first
    // means primary**, so leading with the weakest leg makes the weakest leg the one
    // that actually serves every request, with the better legs only as backups.
    // Silent degradation is what `minBodyChars` exists for, and it is already
    // accounted for in the measured score — so re-ordering around it double-counted
    // the same risk.
    brief: ['anysearch', 'tavily', 'deepseek-fetch-rich', 'http'],
    deep: ['anysearch', 'tavily', 'deepseek-fetch-rich', 'http'],
    list: ['anysearch', 'tavily', 'deepseek-fetch-rich', 'http'],
    page: ['anysearch', 'tavily', 'deepseek-fetch-rich', 'http'],
  },
}

/** URL shapes that mean "read this document", not "search for something". */
const DEEP_URL = /(\/20\d{2}\/\d{2}\/|\/docs?\/|\/wiki\/|\/blog\/|\.pdf($|\?)|\/issues?\/\d|\/pull\/\d|\/releases?\/|\/readme|\/guides?\/|\/tutorials?\/|\/reference\/|\/manual\/|\/handbook\/|\/questions?\/\d|\/question\/\d|\/answers?\/\d|\/posts?\/\d|\/articles?\/|\/notes?\/\d|\/entry\/\d)/i
/** URL shapes that are front pages, tag pages or search listings. */
const LIST_URL = /(\/$|\/news\/?$|\/tag\/|\/tags\/|\/category\/|\/archive|\/page\/\d|\/search\?|\/questions\/?$|\/comments\/?$|\/\?|index\.html?$)/i
/** Queries that ask for many items rather than one fact. */
const LIST_QUERY = /(列表|有哪些|新闻|头条|排行榜|最新消息|汇总|list|news|headlines|releases|changelog)/i
/** Queries that ask for a definition, value or one fact. */
const BRIEF_QUERY = /(是什么|多少|谁|何时|哪一?年|天气|股价|版本|what is|who|when|how (much|many)|price|version|weather)/i

/**
 * Classify a fetch request into a mode.
 *
 * `DEEP_URL` is checked first: a dated blog post (`/2025/09/18/Rust-1.90.0/`)
 * also ends in a slash, so testing the trailing-slash list rule first would
 * misfile exactly the pages that most need their full text. A specific document
 * shape therefore outranks the generic "looks like a front page" shape.
 *
 * Deliberately conservative elsewhere: an unreadable shape lands on `brief`, the
 * cheapest mode, because over-fetching is the failure this plugin exists to
 * avoid.
 *
 * @param request - the seam's fetch request (`{ url }`).
 * @returns one of {@link MODES}.
 */
export function classifyFetch(request) {
  const url = String(request?.url ?? '')
  if (DEEP_URL.test(url)) return 'deep'
  if (LIST_URL.test(url)) return 'list'
  return 'brief'
}

/**
 * Classify a search request into a mode.
 *
 * @param request - the seam's search request (`{ query, maxResults }`).
 * @returns one of {@link MODES} (never `page`: a query is not a URL).
 */
export function classifySearch(request) {
  const query = String(request?.query ?? '')
  if (LIST_QUERY.test(query) && !BRIEF_QUERY.test(query)) return 'list'
  return 'brief'
}

/** Read one config field, accepting both a resolved value and a volatile getter. */
export function readField(config, key, fallback) {
  const raw = config?.[key]
  const value = raw !== null && typeof raw === 'object' && typeof raw.get === 'function' ? raw.get() : raw
  return value === undefined ? fallback : value
}

/**
 * Resolve the order to attempt for one call.
 *
 * Precedence: an explicit mode passed by the caller, then the classifier, then
 * `defaultMode`. The chosen order is then filtered for budget when `freeOnly` is
 * on — never re-sorted, because the configured order is the user's decision.
 *
 * @param options - `{ capability, mode, request, config, providers }`.
 * @returns `{ mode, order, skippedForCost }`.
 */
export function resolveOrder({ capability, mode, request, config, providers }) {
  const freeOnly = readField(config, 'freeOnly', true) === true
  const defaultMode = readField(config, 'defaultMode', DEFAULT_MODE)
  const overrides = readField(config, 'modeOrders', {}) ?? {}
  const shipped = DEFAULT_MODE_ORDERS[capability] ?? {}

  const explicit = typeof mode === 'string' && MODES.includes(mode) ? mode : undefined
  const classified = explicit === undefined
    ? (capability === 'fetch' ? classifyFetch(request) : classifySearch(request))
    : explicit
  const chosen = explicit ?? (classified || defaultMode)

  const configured = overrides?.[capability]?.[chosen]
  const order = Array.isArray(configured) && configured.length > 0
    ? configured
    : (shipped[chosen] ?? [])

  if (!freeOnly) return { mode: chosen, order, skippedForCost: [] }

  const kept = []
  const skipped = []
  for (const id of order) {
    if (providers?.[id]?.cost === 'paid') skipped.push(id)
    else kept.push(id)
  }
  return { mode: chosen, order: kept, skippedForCost: skipped }
}

/**
 * Truncate text to a provider's per-mode budget.
 *
 * Truncation happens here rather than in the chain so every leg is capped by the
 * same rule, and a leg that returns more than its budget cannot quietly cost the
 * caller more context than the mode asked for.
 *
 * @param text - body content.
 * @param cap - character budget, or null/undefined for no cap.
 * @returns `{ text, truncated }`.
 */
export function capText(text, cap) {
  const s = typeof text === 'string' ? text : ''
  if (cap === null || cap === undefined || !Number.isFinite(cap) || s.length <= cap) return { text: s, truncated: false }
  return { text: `${s.slice(0, cap)}…`, truncated: true }
}
