/**
 * Search-chain execution: run the legs in order, take the first real answer.
 *
 * The search-side counterpart of `./fetch.js`. It differs in two ways that matter:
 * an empty `sources[]` is a **miss** rather than a success (a leg answering 200
 * with nothing would otherwise stop the chain), and the provenance marker goes on
 * the first source's snippet — a search result has no single body, and the first
 * snippet is where an answer's lead usually is.
 *
 * @module dsh-web-fallback-chain/chains/search
 */

/** Shorten a message for the attempt record. */
function shorten(value) {
  const text = String(value ?? '')
  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}

/** Machine-routable code of a failure. */
function codeOf(error) {
  return typeof error?.code === 'string' && error.code.length > 0 ? error.code : 'WEB_PROVIDER_ERROR'
}

/** One attempt, rendered for the marker and the error. */
export function describeAttempts(attempts) {
  return attempts
    .map((a) => `${a.leg}=${a.outcome}${a.code ? `(${a.code})` : ''}${a.count !== undefined ? `[${a.count}]` : ''}`)
    .join(', ')
}

import { capText } from '../policy/index.js'

/**
 * Cap every source's text to the mode's budget.
 *
 * Applied here rather than in the leg so all legs obey one rule: a leg that
 * returns more than the mode asked for must not cost the caller more context.
 *
 * @param result - a search result (`{sources[], truncated?}`).
 * @param cap - per-source character budget, or null for none.
 * @returns the result with sources capped and `truncated` widened if needed.
 */
export function capSources(result, cap) {
  if (cap === null || cap === undefined || !Array.isArray(result?.sources)) return result
  let changed = false
  const sources = result.sources.map((source) => {
    const { text, truncated } = capText(source?.snippet ?? source?.text ?? '', cap)
    if (!truncated) return source
    changed = true
    return { ...source, snippet: text, ...(source.text === undefined ? {} : { text }) }
  })
  return changed ? { ...result, sources, truncated: result.truncated === true } : result
}

/**
 * Append the provenance marker to the first source's text.
 *
 * A search result has no single body: the truthful place to record "this answer
 * came from the third-choice index" is the material the model reads, so the
 * marker goes onto the first source's snippet, which is where an answer's lead
 * usually is. Kept to one short line for the same reason the fetch chain does.
 *
 * @param result - the winning result.
 * @param attempts - every attempt, winner last.
 * @param annotate - whether to append.
 * @returns the result, annotated when a fallback happened.
 */
export function finalize(result, attempts, annotate) {
  if (!annotate || attempts.length <= 1 || !Array.isArray(result?.sources) || result.sources.length === 0) return result
  const winner = attempts[attempts.length - 1].leg
  const earlier = describeAttempts(attempts.slice(0, -1))
  const marker = `\n\n---\n[search-chain] these results came from the "${winner}" leg; earlier legs did not serve: ${earlier}`
  const [first, ...rest] = result.sources
  const key = first.snippet === undefined ? 'text' : 'snippet'
  return { ...result, sources: [{ ...first, [key]: `${first[key] ?? ''}${marker}` }, ...rest] }
}

/**
 * Run the legs in order and return the first result that has sources.
 *
 * An empty `sources[]` is a miss, not a success: a search leg answering 200 with
 * zero results would otherwise stop the chain and leave the caller with nothing.
 *
 * @param legs - resolved legs, in order.
 * @param missing - configured ids with no registered provider.
 * @param options - `{annotateFallback, cap}`.
 * @param request - the seam's search request.
 * @param signal - cancellation signal forwarded to every leg.
 * @returns the winning result.
 * @throws a `WebError`-shaped error carrying `attempts` when nothing served.
 */
export async function runSearchChain(legs, missing, options, request, signal) {
  const attempts = missing.map((id) => ({ leg: id, outcome: 'unregistered', code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  if (legs.length === 0) {
    const error = new Error(
      `web search chain has no usable leg for "${request?.query ?? ''}": ${describeAttempts(attempts) || 'none configured'}`,
    )
    error.code = 'WEB_PROVIDER_UNAVAILABLE'
    error.attempts = attempts
    throw error
  }
  let firstError
  for (const leg of legs) {
    let usable = false
    try {
      usable = leg.provider.available() === true
    } catch (error) {
      attempts.push({ leg: leg.label, outcome: 'unavailable', code: codeOf(error), message: shorten(error?.message) })
      continue
    }
    if (!usable) {
      attempts.push({ leg: leg.label, outcome: 'unavailable', code: 'WEB_PROVIDER_UNAVAILABLE' })
      continue
    }
    try {
      const raw = await leg.provider.search(request, signal)
      const count = Array.isArray(raw?.sources) ? raw.sources.length : 0
      if (count === 0) {
        attempts.push({ leg: leg.label, outcome: 'empty', code: 'WEB_PROVIDER_EMPTY' })
        continue
      }
      attempts.push({ leg: leg.label, outcome: 'served', count })
      return finalize(capSources(raw, options?.cap), attempts, options?.annotateFallback !== false)
    } catch (error) {
      attempts.push({ leg: leg.label, outcome: 'failed', code: codeOf(error), message: shorten(error?.message) })
      if (firstError === undefined) firstError = error
      if (signal?.aborted) throw error
    }
  }
  const error = new Error(
    `web search chain failed for "${request?.query ?? ''}": ${describeAttempts(attempts)}`,
  )
  error.code = attempts.some((a) => a.outcome === 'failed') ? 'WEB_PROVIDER_ERROR' : 'WEB_PROVIDER_UNAVAILABLE'
  error.attempts = attempts
  if (firstError !== undefined) error.cause = firstError
  throw error
}

/** Resolve configured ids against the live registry, reporting misses. */
export function resolveLegs(registry, order, selfId) {
  const legs = []
  const missing = []
  for (const id of order ?? []) {
    if (id === selfId) {
      throw Object.assign(new Error(`web search chain cannot include itself ("${selfId}")`), { code: 'WEB_PROVIDER_ERROR' })
    }
    const provider = registry?.get?.(id)
    if (provider === undefined) missing.push(id)
    else legs.push({ label: id, provider })
  }
  return { legs, missing }
}

/**
 * Register the chain with `ctx.web`.
 *
 * @param ctx - context whose `web` service receives the provider.
 * @param config - resolved plugin configuration (values or volatile getters).
 */
