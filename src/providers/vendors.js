/**
 * The three vendors, each reduced to what differs between them.
 *
 * Every leg here is a pair of functions — `search` and/or `fetch` — plus the two
 * things the seam needs from a provider: an `id` and an `available()` that never
 * touches the network. Retry, timeout, key lookup and error coding live in
 * `http.js` so a vendor file only describes its own envelope and its own quirks.
 *
 * ## The quirks that matter, all measured
 *
 * - **AnySearch `/v1/search` caps at 10 results** regardless of a larger
 *   `max_results`; asking for 20 returns 10. The cap is enforced here so callers
 *   see the same number they would from any other leg.
 * - **AnySearch returns `snippet` (short, query-focused) and `content` (long
 *   body) separately.** The benchmark found the short field is what a `brief`
 *   caller wants and the long one is what a `deep` caller wants, so both are
 *   carried and the chain's budget decides which survives.
 * - **DeepSeek returns `summary` (600–800 chars) as well as `snippet`
 *   (100–200).** Mapping only `snippet` throws away ~86% of the text, so
 *   `summary` is preferred when present.
 * - **Tavily has no date field** on results; DeepSeek does. This is why the chain
 *   cannot synthesise recency for a free answer.
 * - **Tavily's free tier is monthly**, so it sits below AnySearch in the shipped
 *   ranking even though their measured quality is similar.
 *
 * @module dsh-web-fallback-chain/providers/vendors
 */

import { callJson, bearer, credentialSource, keyFrom, providerError } from './http.js'

const DS_BASE = 'https://api.deepseek.com/v1/tools'
const AS_BASE = 'https://api.anysearch.com/v1'
const TV_BASE = 'https://api.tavily.com'

/** An ISO-ish date, normalised to `YYYY-MM-DD` when it parses. */
function asDate(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value
}

// ─── DeepSeek ───────────────────────────────────────────────────────────────

/**
 * DeepSeek search/fetch. Billed per successful request; the only leg with index
 * dates and the only one whose search quality led every free alternative.
 *
 * @param options - `{env, timeoutMs, needContent}`.
 */
export function deepseekSearchProvider({ env, credentials, timeoutMs, needContent = false }) {
  const key = credentialSource({ credentials, env, name: 'DEEPSEEK_API_KEY' })
  return {
    id: 'deepseek-search-rich',
    available: () => key.peek() !== undefined,
    async search(request, signal) {
      const apiKey = await key.resolve()
      if (apiKey === undefined) throw providerError('deepseek-search-rich: DEEPSEEK_API_KEY is not set', 'WEB_PROVIDER_UNAUTHORIZED')
      const body = await callJson({
        url: `${DS_BASE}/search`,
        method: 'POST',
        headers: bearer(apiKey),
        body: {
          query: String(request?.query ?? ''),
          count: Math.min(Math.max(Number(request?.maxResults) || 10, 1), 50),
          need_content: needContent === true,
        },
        timeoutMs,
        signal,
        provider: 'deepseek-search-rich',
      })
      const results = Array.isArray(body?.results) ? body.results : []
      return {
        // `truncated` is required by WebSearchResult: `dsh-tool-web` writes it
        // straight into the tool output, so omitting it puts an `undefined`
        // into a value that must be lossless JSON and fails validation with
        // `value is not lossless JSON`.
        truncated: false,
        sources: results.map((r) => ({
          title: String(r?.title ?? ''),
          url: String(r?.url ?? ''),
          // `summary` carries the substance; `snippet` is a 100–200 char teaser.
          snippet: String(r?.summary || r?.snippet || r?.content || ''),
          ...(asDate(r?.date) === undefined ? {} : { publishedAt: asDate(r?.date) }),
          ...(r?.site_name === undefined ? {} : { siteName: String(r.site_name) }),
        })),
      }
    },
  }
}

/**
 * DeepSeek fetch. Returns markdown; knowingly degrades to a site footer with
 * HTTP 200 on some sites, which is why the fetch chain takes a length floor.
 */
export function deepseekFetchProvider({ env, credentials, timeoutMs }) {
  const key = credentialSource({ credentials, env, name: 'DEEPSEEK_API_KEY' })
  return {
    id: 'deepseek-fetch-rich',
    available: () => key.peek() !== undefined,
    async fetch(request, signal) {
      const apiKey = await key.resolve()
      if (apiKey === undefined) throw providerError('deepseek-fetch-rich: DEEPSEEK_API_KEY is not set', 'WEB_PROVIDER_UNAUTHORIZED')
      const body = await callJson({
        url: `${DS_BASE}/fetch`,
        method: 'POST',
        headers: bearer(apiKey),
        body: { url: String(request?.url ?? '') },
        timeoutMs,
        signal,
        provider: 'deepseek-fetch-rich',
      })
      return {
        url: String(body?.url ?? request?.url ?? ''),
        statusCode: 200,
        body: { kind: 'text', content: String(body?.content ?? '') },
        truncated: false,
      }
    },
  }
}

// ─── AnySearch ──────────────────────────────────────────────────────────────

/**
 * AnySearch search/extract, with optional vertical-domain routing.
 *
 * `tag` + `params` change the query's meaning, not just its ranking: the same
 * text under `code.doc` returns source documentation where general search
 * returns an unrelated namesake. They are therefore an explicit opt-in per
 * plugin config, never inferred from the query.
 *
 * @param options - `{env, timeoutMs, tag, params}`.
 */
export function anysearchProvider({ env, credentials, timeoutMs, tag = '', params = '' }) {
  const key = credentialSource({ credentials, env, name: 'ANYSEARCH_API_KEY' })
  const parseParams = () => {
    const out = {}
    for (const pair of String(params ?? '').split(',')) {
      const [k, ...rest] = pair.split('=')
      if (k === undefined || k.trim() === '') continue
      out[k.trim()] = rest.join('=').trim()
    }
    return out
  }
  return {
    id: 'anysearch',
    available: () => key.peek() !== undefined,
    async search(request, signal) {
      const apiKey = await key.resolve()
      if (apiKey === undefined) throw providerError('anysearch: ANYSEARCH_API_KEY is not set', 'WEB_PROVIDER_UNAUTHORIZED')
      // The API caps at 10 per call; clamping here keeps the reported count honest.
      const max = Math.min(Math.max(Number(request?.maxResults) || 10, 1), 10)
      const body = await callJson({
        url: `${AS_BASE}/search`,
        method: 'POST',
        headers: bearer(apiKey),
        body: {
          query: String(request?.query ?? ''),
          max_results: max,
          ...(String(tag ?? '').length > 0 ? { tag } : {}),
          ...(Object.keys(parseParams()).length > 0 ? { params: parseParams() } : {}),
        },
        timeoutMs,
        signal,
        provider: 'anysearch',
      })
      if (body?.code !== undefined && body.code !== 0) {
        throw providerError(`anysearch: ${body?.message ?? 'error'}`, 'WEB_PROVIDER_ERROR')
      }
      const results = Array.isArray(body?.data?.results) ? body.data.results : []
      return {
        // See the note on the DeepSeek leg: required field, must not be `undefined`.
        truncated: false,
        sources: results.slice(0, max).map((r) => {
          // `snippet` is the query-focused extract; `content` is the fetched body,
          // which usually opens with site chrome ("# Moddable Blog | # IoT Dev…").
          // Measured on 30 results: capping content-first yields a 300-char window
          // that is 40% navigation junk, snippet-first 0%. So `snippet` leads, and
          // `content` is kept only as a fallback for results that lack it.
          const snippet = String(r?.snippet ?? '')
          const content = String(r?.content ?? '')
          const primary = snippet.length > 0 ? snippet : content
          return {
            title: String(r?.title ?? ''),
            url: String(r?.url ?? ''),
            snippet: primary,
            // Keep the longer body addressable without paying for it up front.
            ...(content.length > primary.length ? { summary: content } : {}),
          }
        }),
      }
    },
    async fetch(request, signal) {
      const apiKey = await key.resolve()
      if (apiKey === undefined) throw providerError('anysearch: ANYSEARCH_API_KEY is not set', 'WEB_PROVIDER_UNAUTHORIZED')
      const body = await callJson({
        url: `${AS_BASE}/extract`,
        method: 'POST',
        headers: bearer(apiKey),
        body: { url: String(request?.url ?? '') },
        timeoutMs,
        signal,
        provider: 'anysearch',
      })
      if (body?.code !== undefined && body.code !== 0) {
        throw providerError(`anysearch: ${body?.message ?? 'extract failed'}`, 'WEB_PROVIDER_UNAVAILABLE')
      }
      const content = String(body?.data?.content ?? '')
      if (content.length === 0) {
        throw providerError('anysearch: extract returned no content', 'WEB_PROVIDER_UNAVAILABLE')
      }
      return {
        url: String(request?.url ?? ''),
        statusCode: 200,
        body: { kind: 'text', content },
        truncated: false,
      }
    },
  }
}

// ─── Tavily ─────────────────────────────────────────────────────────────────

/**
 * Tavily search/extract. The only leg here that extracts PDFs, and the only one
 * with `map`/`crawl`; its free tier is monthly (~1500), so it is ranked below
 * AnySearch despite comparable measured quality.
 *
 * @param options - `{env, timeoutMs}`.
 */
export function tavilyProvider({ env, credentials, timeoutMs }) {
  const key = credentialSource({ credentials, env, name: 'TAVILY_API_KEY' })
  return {
    id: 'tavily',
    available: () => key.peek() !== undefined,
    async search(request, signal) {
      const apiKey = await key.resolve()
      if (apiKey === undefined) throw providerError('tavily: TAVILY_API_KEY is not set', 'WEB_PROVIDER_UNAUTHORIZED')
      const body = await callJson({
        url: `${TV_BASE}/search`,
        method: 'POST',
        headers: bearer(apiKey),
        body: {
          query: String(request?.query ?? ''),
          max_results: Math.min(Math.max(Number(request?.maxResults) || 5, 1), 20),
        },
        timeoutMs,
        signal,
        provider: 'tavily',
      })
      const results = Array.isArray(body?.results) ? body.results : []
      return {
        // See the note on the DeepSeek leg: required field, must not be `undefined`.
        truncated: false,
        sources: results.map((r) => ({
          title: String(r?.title ?? ''),
          url: String(r?.url ?? ''),
          snippet: String(r?.content ?? ''),
          ...(asDate(r?.published_date) === undefined ? {} : { publishedAt: asDate(r?.published_date) }),
        })),
      }
    },
    async fetch(request, signal) {
      const apiKey = await key.resolve()
      if (apiKey === undefined) throw providerError('tavily: TAVILY_API_KEY is not set', 'WEB_PROVIDER_UNAUTHORIZED')
      const body = await callJson({
        url: `${TV_BASE}/extract`,
        method: 'POST',
        headers: bearer(apiKey),
        body: { urls: [String(request?.url ?? '')] },
        timeoutMs,
        signal,
        provider: 'tavily',
      })
      const first = Array.isArray(body?.results) ? body.results[0] : undefined
      const content = String(first?.raw_content ?? '')
      if (content.length === 0) {
        const reason = Array.isArray(body?.failed_results) && body.failed_results[0]?.error
          ? String(body.failed_results[0].error)
          : 'no content'
        throw providerError(`tavily: ${reason}`, 'WEB_PROVIDER_UNAVAILABLE')
      }
      return {
        url: String(first?.url ?? request?.url ?? ''),
        statusCode: 200,
        body: { kind: 'text', content },
        truncated: false,
      }
    },
    /**
     * Discover URLs on a site. Not part of the seam; exported for callers that
     * want it explicitly (a crawl needs a map first).
     */
    async map(request, signal) {
      const apiKey = await key.resolve()
      if (apiKey === undefined) throw providerError('tavily: TAVILY_API_KEY is not set', 'WEB_PROVIDER_UNAUTHORIZED')
      const body = await callJson({
        url: `${TV_BASE}/map`,
        method: 'POST',
        headers: bearer(apiKey),
        body: { url: String(request?.url ?? ''), limit: Number(request?.limit) || 20 },
        timeoutMs,
        signal,
        provider: 'tavily',
      })
      return { urls: Array.isArray(body?.results) ? body.results.map(String) : [] }
    },
  }
}
