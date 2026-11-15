/**
 * Provider metadata: the one place a leg's cost, quality and shape are declared.
 *
 * ## Why metadata lives here and not in the provider
 *
 * The web seam exposes a provider's `id` and nothing else — no price, no quality
 * score, no output shape. A chain that orders legs by anything richer than "the
 * order you typed" therefore needs that knowledge to come from somewhere. It
 * lives in this registry so the assumption is visible, diffable and overridable
 * instead of being buried in a sort function.
 *
 * ## User-extensible by design
 *
 * `defaults` covers the legs this deployment measured. A user adding a leg we
 * never tested (a paid vendor, a self-hosted SearXNG, a corporate gateway) must
 * not have to fork the plugin: they add one entry to `providers` in the profile
 * patch and it participates in ordering, free-mode filtering and budget caps
 * exactly like a built-in one. An entry that redeclares a built-in id overrides
 * it field-by-field rather than replacing it.
 *
 * ## Fields
 *
 * - `cost` — `'free'` or `'paid'`. The only field free mode reads. `'paid'` does
 *   NOT mean "requires a key": AnySearch needs a key and is still free.
 * - `quality` — 0–10, higher is better. Ordering only; never a promise. The
 *   defaults come from this repository's benchmark (see `research/`), rounded,
 *   and are meant to be replaced when a deployment measures its own.
 * - `maxChars` — the per-result budget this leg should be truncated to. Search
 *   legs and list-shaped pages want a small number; a page fetched on request
 *   wants the whole thing. `null` means "no cap of our own".
 * - `requiresKey` — env var name that must be present for the leg to be usable.
 *   Advisory: providers already report `available()`; this is for preflight
 *   messages and documentation.
 * - `kinds` — which capabilities this leg can serve (`'search'`, `'fetch'`).
 *   A leg may serve both (AnySearch does) and then appears in both chains.
 * - `note` — one line for humans, shown by the preflight command.
 *
 * @module dsh-web-chain-core/providers
 */

/** Capability names the chain understands. */
export const KINDS = ['search', 'fetch']

/**
 * Built-in metadata, ordered by measured quality per thousand tokens.
 *
 * Sources (this repository, `research/web-provider-bench-2026-11-02/`):
 * - search: blind relevance@5 40/50 paid vs 28–29/50 free; strict answer-hit at
 *   300 chars/result 6/10 paid vs 5/10 free.
 * - fetch: blind extraction 15 pages; AnySearch won 9/15, DeepSeek 4/8 (only 8
 *   of 15 pages returned anything), local 2/14.
 * - `maxChars.searched` = 300 is the measured knee: 300 → 1200 chars per result
 *   is 3.8× the tokens for no change in strict answer-hit.
 */
export const DEFAULTS = {
  'deepseek-search-rich': {
    cost: 'paid', quality: 9.6, requiresKey: 'DEEPSEEK_API_KEY', kinds: ['search'],
    maxChars: { brief: 300, deep: 1200, list: 300, page: null },
    note: 'DeepSeek /v1/tools/search via dsh-web-providers: maps summary (600-800c), not just snippet, and keeps site_name',
  },
  'deepseek-search-api': {
    cost: 'paid', quality: 9.0, requiresKey: 'DEEPSEEK_API_KEY', kinds: ['search'],
    maxChars: { brief: 300, deep: 1200, list: 300, page: null },
    note: 'DeepSeek /v1/tools/search via the official plugin: maps snippet only (100-200c) — measured to drop ~86% of the text the API returns',
  },
  'deepseek-fetch-rich': {
    cost: 'paid', quality: 5.4, requiresKey: 'DEEPSEEK_API_KEY', kinds: ['fetch'],
    maxChars: { brief: 300, deep: 1200, list: 300, page: null },
    note: 'DeepSeek /v1/tools/fetch via dsh-web-providers',
  },
  'deepseek-fetch-api': {
    cost: 'paid', quality: 5.4, requiresKey: 'DEEPSEEK_API_KEY', kinds: ['fetch'],
    maxChars: { brief: 300, deep: 1200, list: 300, page: null },
    note: 'DeepSeek /v1/tools/fetch via the official plugin — returned nothing on 7/15 pages and degrades silently (HTTP 200 + footer)',
  },
  'anysearch': {
    cost: 'free', quality: 7.3, requiresKey: 'ANYSEARCH_API_KEY', kinds: ['search', 'fetch'],
    maxChars: { brief: 300, deep: 1200, list: 300, page: null },
    note: 'AnySearch /v1/search + /v1/extract — only leg that won on bot-walled sites (oschina, Reddit); 1000 calls/day, max 10 results',
  },
  'tavily': {
    cost: 'free', quality: 7.3, requiresKey: 'TAVILY_API_KEY', kinds: ['search', 'fetch'],
    maxChars: { brief: 300, deep: 1200, list: 300, page: null },
    note: 'Tavily — good content length, only free leg that extracts PDFs; ~1500 calls/month so keep it off the hot path',
  },
  'http': {
    cost: 'free', quality: 4.0, requiresKey: null, kinds: ['fetch'],
    maxChars: { brief: 300, deep: 1200, list: 1500, page: null },
    note: 'local HTTP fetch — best structural fidelity, but mojibake on some GBK pages and needs maxBodyChars raised for big pages',
  },
  'trafilatura': {
    cost: 'free', quality: 5.6, requiresKey: null, kinds: ['fetch'],
    maxChars: { brief: 300, deep: 1200, list: 1500, page: null },
    note: 'NOT IMPLEMENTED — local trafilatura extraction scored highest on the pages it appeared in the benchmark, but it needs a python sidecar and this deployment cannot install one (PEP 668). Kept in the metadata table so a future leg can claim the id; deliberately absent from the shipped orders so no fetch reports it as an unregistered attempt.',
  },
}

/** Fields a metadata entry may carry, with the coercion each one gets. */
const SCHEMA = {
  cost: (v) => {
    if (v !== 'free' && v !== 'paid') throw new Error(`provider metadata: cost must be "free" or "paid", got ${JSON.stringify(v)}`)
    return v
  },
  quality: (v) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0 || n > 10) throw new Error(`provider metadata: quality must be 0–10, got ${JSON.stringify(v)}`)
    return n
  },
  maxChars: (v) => {
    if (v === null) return { brief: null, deep: null, list: null, page: null }
    if (typeof v !== 'object') throw new Error(`provider metadata: maxChars must be an object or null, got ${JSON.stringify(v)}`)
    const out = {}
    for (const [mode, cap] of Object.entries(v)) {
      if (cap !== null && (!Number.isInteger(cap) || cap <= 0)) {
        throw new Error(`provider metadata: maxChars.${mode} must be a positive integer or null, got ${JSON.stringify(cap)}`)
      }
      out[mode] = cap
    }
    return out
  },
  requiresKey: (v) => (v === null || v === undefined ? null : String(v)),
  kinds: (v) => {
    const list = Array.isArray(v) ? v : [v]
    for (const k of list) {
      if (!KINDS.includes(k)) throw new Error(`provider metadata: unknown kind ${JSON.stringify(k)}; expected one of ${KINDS.join(', ')}`)
    }
    return [...new Set(list)]
  },
  note: (v) => String(v ?? ''),
}

/**
 * Merge user-supplied entries over the built-ins.
 *
 * Overriding is field-by-field so a user who only wants to correct a price can
 * write `{ anysearch: { cost: 'paid' } }` without restating quality or caps.
 *
 * @param overrides - `{ [id]: partialMetadata }` from plugin config.
 * @returns a new metadata map; the built-in object is never mutated.
 * @throws when an override field is malformed, naming the id and field.
 */
export function mergeProviders(overrides = {}) {
  const merged = {}
  for (const [id, meta] of Object.entries(DEFAULTS)) merged[id] = { ...meta, id }

  for (const [id, patch] of Object.entries(overrides ?? {})) {
    if (!patch || typeof patch !== 'object') throw new Error(`provider metadata: entry "${id}" must be an object`)
    const base = merged[id] ?? {
      id, cost: 'free', quality: 5, requiresKey: null, kinds: [...KINDS], note: 'user-defined provider',
    }
    const next = { ...base, id }
    for (const [field, value] of Object.entries(patch)) {
      if (field === 'id') continue
      const coerce = SCHEMA[field]
      if (coerce === undefined) {
        throw new Error(`provider metadata: ${id}.${field} is not a known field (known: ${Object.keys(SCHEMA).join(', ')})`)
      }
      try {
        next[field] = coerce(value)
      } catch (error) {
        throw new Error(`${id}: ${error.message}`)
      }
    }
    // A partial maxChars override merges onto the built-in caps.
    if (patch.maxChars !== undefined && base.maxChars && patch.maxChars !== null) {
      next.maxChars = { ...base.maxChars, ...SCHEMA.maxChars(patch.maxChars) }
    }
    merged[id] = next
  }
  return merged
}

/** Split ids into those that bill and those that do not, preserving order. */
export function partitionByCost(ids, providers) {
  const free = []
  const paid = []
  for (const id of ids) {
    // An unknown id is treated as free: an unlisted leg is more likely a local
    // or user-added free source than a silent charge.
    const meta = providers?.[id]
    ;(meta?.cost === 'paid' ? paid : free).push(id)
  }
  return { free, paid }
}

/** True when the id's `requiresKey` env var is absent, given an env lookup. */
export function missingKey(id, providers, env = process.env) {
  const key = providers?.[id]?.requiresKey
  if (!key) return null
  return env?.[key] ? null : key
}
