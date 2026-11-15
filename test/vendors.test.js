/**
 * Offline tests for the vendor legs: envelope unwrapping, field preference,
 * error coding, and honest availability. No network — `fetch` is stubbed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildProviders } from '../src/providers/index.js'
import { codeForStatus, keyFrom, bearer, redactHeaders } from '../src/providers/http.js'
import { deepseekSearchProvider, anysearchProvider, tavilyProvider } from '../src/providers/vendors.js'

/** Replace global fetch for one test, restoring afterwards. */
function withFetch(handler, run) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => handler(String(url), init)
  return Promise.resolve(run()).finally(() => { globalThis.fetch = original })
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
})

// ─── shared ─────────────────────────────────────────────────────────────────

test('codeForStatus separates a bad key from a transient failure', () => {
  assert.equal(codeForStatus(401), 'WEB_PROVIDER_UNAUTHORIZED')
  assert.equal(codeForStatus(403), 'WEB_PROVIDER_UNAUTHORIZED')
  assert.equal(codeForStatus(429), 'WEB_PROVIDER_RATE_LIMITED')
  assert.equal(codeForStatus(503), 'WEB_PROVIDER_UNAVAILABLE')
  assert.equal(codeForStatus(400), 'WEB_PROVIDER_ERROR')
})

test('keyFrom ignores empty and non-string values', () => {
  assert.equal(keyFrom({ A: 'x' }, 'A'), 'x')
  assert.equal(keyFrom({ A: '' }, 'A'), undefined)
  assert.equal(keyFrom({ A: 42 }, 'A'), undefined)
  assert.equal(keyFrom({}, 'A'), undefined)
})

test('bearer omits the header when there is no key', () => {
  assert.deepEqual(bearer(undefined), {})
  assert.deepEqual(bearer('k'), { Authorization: 'Bearer k' })
})

test('redactHeaders never echoes a credential', () => {
  assert.deepEqual(redactHeaders({ Authorization: 'Bearer secret', Accept: 'x' }), {
    Authorization: '<redacted>', Accept: 'x',
  })
})

// ─── availability is honest ─────────────────────────────────────────────────

test('a leg without its key is registered but reports itself unavailable', () => {
  const { search } = buildProviders({}, {})
  assert.equal(search.get('deepseek-search-rich').available(), false)
  assert.equal(search.get('anysearch').available(), false)
  assert.equal(search.get('tavily').available(), false)
})

test('a leg with its key reports available', () => {
  const { search } = buildProviders({}, { ANYSEARCH_API_KEY: 'k' })
  assert.equal(search.get('anysearch').available(), true)
})

test('availability is re-checked per call, so a key rotated at runtime is seen', () => {
  const env = {}
  const { search } = buildProviders({}, env)
  assert.equal(search.get('tavily').available(), false)
  env.TAVILY_API_KEY = 'later'
  assert.equal(search.get('tavily').available(), true)
})

test('anysearch and tavily appear in both registries; deepseek split in two', () => {
  const { search, fetch } = buildProviders({}, {})
  assert.deepEqual([...search.keys()].sort(), ['anysearch', 'deepseek-search-rich', 'tavily'])
  assert.deepEqual([...fetch.keys()].sort(), ['anysearch', 'deepseek-fetch-rich', 'tavily'])
})

test('enable narrows what is built', () => {
  const { search, fetch } = buildProviders({ enable: ['anysearch'] }, {})
  assert.deepEqual([...search.keys()], ['anysearch'])
  assert.deepEqual([...fetch.keys()], ['anysearch'])
})

// ─── DeepSeek ───────────────────────────────────────────────────────────────

test('deepseek search prefers summary over snippet, and keeps the date', async () => {
  const provider = deepseekSearchProvider({ env: { DEEPSEEK_API_KEY: 'k' }, timeoutMs: 5000 })
  await withFetch(
    () => jsonResponse({ results: [{ title: 'T', url: 'https://x/', snippet: 'short', summary: 'the substance', date: '2026-10-23T03:29:36Z' }] }),
    async () => {
      const out = await provider.search({ query: 'q', maxResults: 5 })
      assert.equal(out.sources[0].snippet, 'the substance')
      assert.equal(out.sources[0].publishedAt, '2026-10-23')
    },
  )
})

test('deepseek search clamps count into the documented 1–50 range', async () => {
  const provider = deepseekSearchProvider({ env: { DEEPSEEK_API_KEY: 'k' }, timeoutMs: 5000 })
  let sent
  await withFetch(
    (url, init) => { sent = JSON.parse(init.body); return jsonResponse({ results: [] }) },
    () => provider.search({ query: 'q', maxResults: 999 }),
  )
  assert.equal(sent.count, 50)
})

test('a 401 becomes WEB_PROVIDER_UNAUTHORIZED, not a generic failure', async () => {
  const provider = deepseekSearchProvider({ env: { DEEPSEEK_API_KEY: 'k' }, timeoutMs: 5000 })
  await withFetch(
    () => jsonResponse({ error: 'bad key' }, 401),
    async () => {
      await assert.rejects(() => provider.search({ query: 'q' }), (e) => e.code === 'WEB_PROVIDER_UNAUTHORIZED')
    },
  )
})

// ─── AnySearch ──────────────────────────────────────────────────────────────

test('anysearch leads with the focused snippet, not the fetched body', async () => {
  const provider = anysearchProvider({ env: { ANYSEARCH_API_KEY: 'k' }, timeoutMs: 5000 })
  await withFetch(
    () => jsonResponse({ code: 0, data: { results: [{ title: 'T', url: 'https://x/', snippet: 'short', content: 'the body' }] } }),
    async () => {
      const out = await provider.search({ query: 'q', maxResults: 5 })
      // The body usually opens with site chrome, so the snippet must lead; the
      // longer body stays addressable as `summary` for callers that want it.
      assert.equal(out.sources[0].snippet, 'short')
      assert.equal(out.sources[0].summary, 'the body')
    },
  )
})

test('anysearch falls back to the body when the vendor omits a snippet', async () => {
  const provider = anysearchProvider({ env: { ANYSEARCH_API_KEY: 'k' }, timeoutMs: 5000 })
  await withFetch(
    () => jsonResponse({ code: 0, data: { results: [{ title: 'T', url: 'https://x/', content: 'only body' }] } }),
    async () => {
      const out = await provider.search({ query: 'q', maxResults: 5 })
      assert.equal(out.sources[0].snippet, 'only body')
      // No duplicate: the body is already the snippet, so no summary is added.
      assert.equal(out.sources[0].summary, undefined)
    },
  )
})

test('anysearch clamps max_results to its real ceiling of 10', async () => {
  const provider = anysearchProvider({ env: { ANYSEARCH_API_KEY: 'k' }, timeoutMs: 5000 })
  let sent
  await withFetch(
    (url, init) => { sent = JSON.parse(init.body); return jsonResponse({ code: 0, data: { results: [] } }) },
    () => provider.search({ query: 'q', maxResults: 50 }),
  )
  assert.equal(sent.max_results, 10)
})

test('anysearch sends a vertical tag and params only when configured', async () => {
  const bare = anysearchProvider({ env: { ANYSEARCH_API_KEY: 'k' }, timeoutMs: 5000 })
  let sentBare
  await withFetch(
    (url, init) => { sentBare = JSON.parse(init.body); return jsonResponse({ code: 0, data: { results: [] } }) },
    () => bare.search({ query: 'q' }),
  )
  assert.equal(sentBare.tag, undefined)
  assert.equal(sentBare.params, undefined)

  const vertical = anysearchProvider({
    env: { ANYSEARCH_API_KEY: 'k' }, timeoutMs: 5000,
    tag: 'code.doc', params: 'library=cordis',
  })
  let sentVertical
  await withFetch(
    (url, init) => { sentVertical = JSON.parse(init.body); return jsonResponse({ code: 0, data: { results: [] } }) },
    () => vertical.search({ query: 'q' }),
  )
  assert.equal(sentVertical.tag, 'code.doc')
  assert.deepEqual(sentVertical.params, { library: 'cordis' })
})

test('an anysearch envelope error is a coded failure, not empty results', async () => {
  const provider = anysearchProvider({ env: { ANYSEARCH_API_KEY: 'k' }, timeoutMs: 5000 })
  await withFetch(
    () => jsonResponse({ code: 40001, message: 'quota exhausted' }),
    async () => {
      await assert.rejects(() => provider.search({ query: 'q' }), (e) => e.code === 'WEB_PROVIDER_ERROR' && /quota/.test(e.message))
    },
  )
})

test('anysearch extract with no content is unavailable, so the chain falls through', async () => {
  const provider = anysearchProvider({ env: { ANYSEARCH_API_KEY: 'k' }, timeoutMs: 5000 })
  await withFetch(
    () => jsonResponse({ code: 0, data: { content: '' } }),
    async () => {
      await assert.rejects(() => provider.fetch({ url: 'https://x/' }), (e) => e.code === 'WEB_PROVIDER_UNAVAILABLE')
    },
  )
})

// ─── Tavily ─────────────────────────────────────────────────────────────────

test('tavily maps content and an optional published_date', async () => {
  const provider = tavilyProvider({ env: { TAVILY_API_KEY: 'k' }, timeoutMs: 5000 })
  await withFetch(
    () => jsonResponse({ results: [{ title: 'T', url: 'https://x/', content: 'body', published_date: '2026-11-01' }] }),
    async () => {
      const out = await provider.search({ query: 'q', maxResults: 3 })
      assert.equal(out.sources[0].snippet, 'body')
      assert.equal(out.sources[0].publishedAt, '2026-11-01')
    },
  )
})

test('tavily extract surfaces the vendor reason when it fails', async () => {
  const provider = tavilyProvider({ env: { TAVILY_API_KEY: 'k' }, timeoutMs: 5000 })
  await withFetch(
    () => jsonResponse({ results: [], failed_results: [{ url: 'https://x/', error: 'Error fetching content' }] }),
    async () => {
      await assert.rejects(
        () => provider.fetch({ url: 'https://x/' }),
        (e) => e.code === 'WEB_PROVIDER_UNAVAILABLE' && /Error fetching content/.test(e.message),
      )
    },
  )
})

test('tavily map returns the discovered urls', async () => {
  const provider = tavilyProvider({ env: { TAVILY_API_KEY: 'k' }, timeoutMs: 5000 })
  await withFetch(
    () => jsonResponse({ results: ['https://a/', 'https://b/'] }),
    async () => {
      const out = await provider.map({ url: 'https://x/' })
      assert.deepEqual(out.urls, ['https://a/', 'https://b/'])
    },
  )
})

// ─── cancellation and timeouts ──────────────────────────────────────────────

test('an aborted caller does not turn into a real request', async () => {
  const provider = anysearchProvider({ env: { ANYSEARCH_API_KEY: 'k' }, timeoutMs: 5000 })
  const controller = new AbortController()
  controller.abort()
  let called = false
  await withFetch(
    () => { called = true; return jsonResponse({}) },
    async () => {
      await assert.rejects(() => provider.search({ query: 'q' }, controller.signal), (e) => e.code === 'WEB_PROVIDER_UNAVAILABLE')
    },
  )
  assert.equal(called, false)
})

test('a network error is coded unavailable rather than thrown raw', async () => {
  const provider = anysearchProvider({ env: { ANYSEARCH_API_KEY: 'k' }, timeoutMs: 5000 })
  await withFetch(
    () => { throw new Error('ECONNRESET') },
    async () => {
      await assert.rejects(() => provider.search({ query: 'q' }), (e) => e.code === 'WEB_PROVIDER_UNAVAILABLE' && /ECONNRESET/.test(e.message))
    },
  )
})

// ─── The required-field contract ─────────────────────────────────────────────
//
// `WebSearchResult.truncated` is not optional, and `dsh-tool-web` copies it
// straight into the tool output. Omitting it put an `undefined` into a value that
// must be lossless JSON, so every search failed with
// `tool "web_search" returned invalid output: value is not lossless JSON` —
// while the provider itself looked perfectly healthy. These assertions pin the
// required fields rather than any particular vendor's payload.

/** Assert the shape every search result must satisfy for the seam to accept it. */
function assertSearchResultShape(result, label) {
  assert.equal(typeof result.truncated, 'boolean', `${label}: truncated must be a boolean`)
  assert.ok(Array.isArray(result.sources), `${label}: sources must be an array`)
  for (const [index, source] of result.sources.entries()) {
    assert.equal(typeof source.url, 'string', `${label}: sources[${index}].url must be a string`)
    for (const key of ['title', 'snippet', 'publishedAt']) {
      if (source[key] !== undefined) {
        assert.equal(typeof source[key], 'string', `${label}: sources[${index}].${key} must be a string when present`)
      }
    }
  }
}

test('every search leg satisfies the seam result contract', async () => {
  const legs = [
    ['deepseek-search-rich', { DEEPSEEK_API_KEY: 'k' }, { results: [{ title: 'T', url: 'https://x/', summary: 'S', date: '2026-01-02' }] }],
    ['anysearch', { ANYSEARCH_API_KEY: 'k' }, { code: 0, data: { results: [{ title: 'T', url: 'https://x/', snippet: 'S', content: 'C' }] } }],
    ['tavily', { TAVILY_API_KEY: 'k' }, { results: [{ title: 'T', url: 'https://x/', content: 'C' }] }],
  ]
  for (const [id, env, payload] of legs) {
    const provider = buildProviders({ enable: [id] }, env).search.get(id)
    await withFetch(
      () => jsonResponse(payload),
      async () => assertSearchResultShape(await provider.search({ query: 'q', maxResults: 5 }), id),
    )
  }
})

test('the chain result is lossless JSON in the tool output shape', async () => {
  // Mirrors what dsh-tool-web builds: { content?, sources[], truncated }.
  const provider = anysearchProvider({ env: { ANYSEARCH_API_KEY: 'k' }, timeoutMs: 5000 })
  await withFetch(
    () => jsonResponse({ code: 0, data: { results: [{ title: 'T', url: 'https://x/', snippet: 'S', content: 'C' }] } }),
    async () => {
      const out = await provider.search({ query: 'q', maxResults: 5 })
      const toolValue = { sources: out.sources, truncated: out.truncated }
      // An `undefined` anywhere is what breaks the lossless-JSON check.
      assert.equal(JSON.stringify(toolValue).includes('undefined'), false)
      assert.deepEqual(JSON.parse(JSON.stringify(toolValue)), toolValue)
    },
  )
})
