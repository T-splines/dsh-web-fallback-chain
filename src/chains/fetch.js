/**
 * The chain: resolve the configured provider ids against the live registry, try
 * them in order, return the first result, and make a degraded fetch legible.
 *
 * Three rules this file exists to enforce:
 *
 * 1. **No silent degradation.** A fallback that succeeds looks exactly like a
 *    first-choice success to the model, so the winner's provenance is appended
 *    to the body (configurable) and every attempt is reported on the error when
 *    nothing succeeds. A page fetched locally because DeepSeek was out of budget
 *    must not read like a page fetched by DeepSeek.
 * 2. **Resolution happens per fetch, not per mount.** Providers are mounted by
 *    other plugins in whatever order the profile lists them; resolving at call
 *    time means the chain never holds a stale view of the seam.
 * 3. **Cancellation is not a failure.** Once the caller's signal is aborted the
 *    chain rethrows instead of quietly trying the next leg — a cancelled fetch
 *    must not turn into a real request on another transport.
 *
 * @module dsh-web-fallback-chain/chains/fetch
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** How much of a provider's message is kept in the attempt record. */
const MESSAGE_LIMIT = 300

/** Shorten a message for the attempt record; the full error stays as `cause`. */
function shorten(value) {
  const text = String(value ?? '')
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT)}…` : text
}

/** The machine-routable code of a provider failure, or a neutral fallback. */
function codeOf(error) {
  const code = error?.code
  return typeof code === 'string' && code.length > 0 ? code : 'WEB_PROVIDER_ERROR'
}

/** One line describing an earlier attempt, used in the marker and the error. */
export function describeAttempt(attempt) {
  const parts = [`${attempt.leg}=${attempt.outcome}`]
  if (attempt.code !== undefined) parts.push(`(${attempt.code})`)
  if (attempt.length !== undefined) parts.push(`[${attempt.length}c]`)
  return parts.join('')
}

/**
 * The character length of a fetch result's body.
 *
 * Reads `body.content` rather than serialising the result, because the length
 * floor is about how much text the model would receive, not about metadata.
 *
 * @param result - a fetch result.
 * @returns the content length, or 0 when there is no body.
 */
export function bodyLength(result) {
  const content = result?.body?.content
  return typeof content === 'string' ? content.length : 0
}

/** Render the attempt list for humans and for the model. */
export function describeAttempts(attempts) {
  return attempts.map(describeAttempt).join(', ')
}

/**
 * Resolve the configured order against the live registry.
 *
 * @param registry - `ctx.web.fetchProviders` (`Map<id, WebFetchProvider>`).
 * @param order - configured provider ids.
 * @param selfId - the chain's own id, refused to prevent infinite recursion.
 * @returns `{legs, missing}` where a missing id is reported, never dropped.
 */
export function resolveLegs(registry, order, selfId) {
  const legs = []
  const missing = []
  for (const id of order ?? []) {
    if (id === selfId) {
      throw new WebError(`web fetch chain cannot include itself ("${selfId}") in its order`, 'WEB_PROVIDER_ERROR')
    }
    const provider = registry?.get?.(id)
    if (provider === undefined) missing.push(id)
    else legs.push({ label: id, provider })
  }
  return { legs, missing }
}

/**
 * Build the provenance marker appended to a fallback fetch's body.
 *
 * Deliberately one short line at the end: it travels with the content, so any
 * consumer that reads the body sees the degradation, and it disappears entirely
 * when the first leg serves.
 */
export function fallbackMarker(attempts, winner) {
  // `unregistered` legs are named in the attempt list because a *configured* id that
  // does not resolve is a real problem worth seeing. But a leg the deployment never
  // mounted (the local `http` fetcher belongs to another plugin) is not "an earlier leg
  // that did not serve" — it was never a candidate. Filtering it keeps the marker about
  // what actually happened, which is the only reason to print it at all.
  // Every attempt is reported, including `unregistered` ones: a configured id that
  // resolves to nothing is a real fault and dropping it is how it stays invisible.
  //
  // What changed is only that a CLEAN fetch no longer gets a marker. Printing
  // "earlier legs: http=unregistered" when the first leg served was noise — `http` is
  // normally supplied by another plugin, so it is expected to be absent here.
  const earlier = attempts.slice(0, -1)
  if (earlier.length === 0) return ''

  // Everything is reported. An `unregistered` id means a provider the order names is
  // not mounted, and dropping that from the marker would hide exactly the
  // misconfiguration worth knowing about ("I asked for deepseek-fetch-rich and nothing
  // said it was missing"). The marker is kept short instead: only blockers are listed,
  // and a clean fetch with nothing but absent legs still says so in a few characters.
  return `\n\n---\n[fetch-chain] this page was retrieved by the "${winner}" leg; earlier legs did not serve: ${describeAttempts(earlier)}`
}

/**
 * Attach provenance to a result whose leg was not the first attempt.
 *
 * @param result - the winning leg's result.
 * @param attempts - every attempt, winner last.
 * @param annotate - whether to append the marker.
 * @returns the result, annotated when a fallback happened.
 */
export function finalize(result, attempts, annotate) {
  if (!annotate || attempts.length <= 1) return result
  const winner = attempts[attempts.length - 1].leg
  const marker = fallbackMarker(attempts, winner)
  return {
    ...result,
    body: { ...result.body, content: `${result.body.content}${marker}` },
  }
}

/**
 * The error thrown when no leg served: every attempt is named, so the failure is
 * attributable rather than a generic "fetch failed".
 */
export function chainError(url, attempts, cause) {
  const error = new WebError(
    `web fetch chain failed for ${url}: ${describeAttempts(attempts)}`,
    attempts.some((attempt) => attempt.outcome === 'failed') ? 'WEB_PROVIDER_ERROR' : 'WEB_PROVIDER_UNAVAILABLE',
    cause === undefined ? undefined : { cause },
  )
  error.attempts = attempts
  return error
}

/**
 * Run the legs in order and return the first result.
 *
 * @param legs - resolved legs, in order.
 * @param missing - configured ids with no registered provider.
 * @param options - `{annotateFallback, minBodyChars}`.
 * @param request - the seam's fetch request.
 * @param signal - cancellation signal forwarded to every leg.
 * @returns the winning result, annotated when a fallback happened.
 * @throws {WebError} when no leg served, or when the caller aborted.
 */
export async function runChain(legs, missing, options, request, signal) {
  const attempts = missing.map((id) => ({ leg: id, outcome: 'unregistered', code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  const floor = Number.isFinite(options?.minBodyChars) ? options.minBodyChars : 0
  if (legs.length === 0) {
    throw chainError(
      request?.url,
      attempts.length > 0 ? attempts : [{ leg: 'none', outcome: 'unavailable', code: 'WEB_PROVIDER_UNAVAILABLE' }],
    )
  }
  let firstError
  let shortest = null
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
      const result = await leg.provider.fetch(request, signal)
      const length = bodyLength(result)
      // The floor is off by default and is a deliberate re-fetch trigger when set:
      // "my sites are all long, so a stub means extraction failed". It is NOT a quality
      // judgement — length cannot distinguish a footer from a short real page, and using
      // it that way replaced a correct 156-character answer with 958 characters of the
      // same paragraph in six languages.
      if (floor > 0 && length < floor) {
        // Successful transport, payload below the configured floor: record and continue.
        attempts.push({ leg: leg.label, outcome: 'short', statusCode: result.statusCode, length })
        if (shortest === null || length > shortest.length) shortest = { leg: leg.label, length, result }
        continue
      }
      attempts.push({ leg: leg.label, outcome: 'served', statusCode: result.statusCode, length })
      return finalize(result, attempts, options.annotateFallback !== false)
    } catch (error) {
      attempts.push({ leg: leg.label, outcome: 'failed', code: codeOf(error), message: shorten(error?.message) })
      if (firstError === undefined) firstError = error
      // A cancelled fetch is the caller's decision, not the leg's failure.
      if (signal?.aborted) throw error
    }
  }
  // Every leg came back short. Returning the longest beats returning nothing, as
  // long as the caller can see that it happened.
  if (shortest !== null) {
    // The chosen leg was already recorded as a `short` attempt. Promote that
    // record instead of appending a second one, so the marker reads
    // "a=short[100c], b=short[400c]" once each rather than repeating the winner.
    const index = attempts.findIndex((a) => a.leg === shortest.leg && a.outcome === 'short')
    const record = { leg: shortest.leg, outcome: 'short', statusCode: shortest.result.statusCode, length: shortest.length }
    if (index >= 0) attempts[index] = record
    else attempts.push(record)
    // Re-order so the winner is last: finalize treats the last entry as the leg
    // that served, and every earlier one as a leg that did not.
    const winner = attempts.splice(attempts.indexOf(record), 1)[0]
    attempts.push(winner)
    return finalize(shortest.result, attempts, options.annotateFallback !== false)
  }
  throw chainError(request?.url, attempts, firstError)
}
