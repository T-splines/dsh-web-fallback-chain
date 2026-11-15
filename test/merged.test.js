/**
 * Tests for the merged plugin.
 *
 * The four source packages had 106 tests between them; this file does not repeat
 * them. It checks the things that only exist because of the merge — one schema
 * that resolves, one registry pass that wires everything, and the invariant that
 * cost the most to learn.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply, Config, name, inject, buildProviders, DEFAULT_MODE_ORDERS, MODES, mergeProviders, classifyFetch, classifySearch } from '../src/index.js'

/** A context that records what was registered. */
function recordingCtx() {
  const search = new Map()
  const fetch = new Map()
  return {
    web: {
      searchProviders: search,
      fetchProviders: fetch,
      registerSearchProvider: (p) => {
        if (search.has(p.id)) throw Object.assign(new Error(`duplicate ${p.id}`), { code: 'WEB_DUPLICATE_PROVIDER' })
        search.set(p.id, p)
      },
      registerFetchProvider: (p) => {
        if (fetch.has(p.id)) throw Object.assign(new Error(`duplicate ${p.id}`), { code: 'WEB_DUPLICATE_PROVIDER' })
        fetch.set(p.id, p)
      },
    },
    logger: { info: () => {} },
  }
}

test('the plugin declares the seam it needs', () => {
  assert.equal(name, 'web-fallback')
  assert.deepEqual(inject, ['web'])
})

test('apply registers both chains and every vendor leg exactly once', () => {
  const ctx = recordingCtx()
  apply(ctx, {})
  const searchIds = [...ctx.web.searchProviders.keys()]
  const fetchIds = [...ctx.web.fetchProviders.keys()]
  assert.ok(searchIds.includes('search-chain'), 'search chain registered')
  assert.ok(fetchIds.includes('fetch-chain'), 'fetch chain registered')
  // The vendor legs that serve both capabilities appear in both registries.
  for (const id of ['anysearch', 'tavily']) {
    assert.ok(searchIds.includes(id), `${id} search leg`)
    assert.ok(fetchIds.includes(id), `${id} fetch leg`)
  }
  assert.ok(searchIds.includes('deepseek-search-rich'))
  assert.ok(fetchIds.includes('deepseek-fetch-rich'))
})

test('apply is idempotent per context, and a second mount would be a duplicate', () => {
  const ctx = recordingCtx()
  apply(ctx, {})
  // Registering the same ids again on the same registry is the seam's error to
  // raise, and it must still raise it: a silent overwrite would hide a double mount.
  assert.throws(() => apply(ctx, {}), (e) => e.code === 'WEB_DUPLICATE_PROVIDER')
})

// ─── the invariant that cost the most ───────────────────────────────────────

test('every volatile field has a default', () => {
  // schemastery resolves every declared field while building the schema, before
  // injection completes. A volatile field with no default is read through the
  // context proxy and throws `cannot get property "X" without inject` — inside
  // config resolution, where no apply()-level try/catch can help. The provider
  // then never registers and the seam says `"search-chain" is not registered`.
  const shape = Config.toJSON()
  const refs = shape.refs ?? {}
  const root = refs[shape.uid] ?? shape
  const missing = []
  for (const [fieldName, slot] of Object.entries(root.dict ?? {})) {
    const field = typeof slot === 'number' ? refs[slot] : slot
    const meta = field?.meta ?? {}
    if (meta.volatile === true && meta.default === undefined) missing.push(fieldName)
  }
  assert.deepEqual(missing, [], `volatile without a default: ${missing.join(', ')}`)
})

test('the config constructs with no fields at all (that is what the host does)', () => {
  assert.doesNotThrow(() => Config({}))
})

// ─── the merged policy is one copy ─────────────────────────────────────────

test('both capabilities resolve their order from the same policy module', () => {
  // The reason policy is a module and not a package: one copy, so search and
  // fetch cannot disagree about what "free" means.
  assert.ok(DEFAULT_MODE_ORDERS.fetch, 'fetch orders shipped')
  assert.ok(DEFAULT_MODE_ORDERS.search, 'search orders shipped')
  for (const mode of MODES) {
    assert.ok(Array.isArray(DEFAULT_MODE_ORDERS.fetch[mode]), `fetch.${mode}`)
    assert.ok(Array.isArray(DEFAULT_MODE_ORDERS.search[mode]), `search.${mode}`)
  }
})

test('every shipped default names a provider the policy knows the cost of', () => {
  // A default that names an unknown id would make freeOnly silently keep a leg it
  // should have dropped (cost undefined !== 'paid').
  const providers = mergeProviders({})
  for (const capability of ['fetch', 'search']) {
    for (const mode of MODES) {
      for (const id of DEFAULT_MODE_ORDERS[capability][mode]) {
        assert.ok(providers[id], `default order names unknown provider "${id}" in ${capability}.${mode}`)
      }
    }
  }
})

test('no shipped default names a provider nothing can register', () => {
  // `http` is intentionally external: whichever local fetcher the deployment
  // mounts (stock, or dsh-web-fetch-fakeip) owns that id, so this plugin must not
  // require it. Anything else in a default has to be a leg this package supplies,
  // or every call carries a noise `unregistered` attempt — which is what
  // trafilatura did until it was removed for needing a python sidecar.
  const EXTERNAL = new Set(['http'])
  const ctx = recordingCtx()
  apply(ctx, {})
  const own = new Set([...ctx.web.searchProviders.keys(), ...ctx.web.fetchProviders.keys()])
  for (const capability of ['fetch', 'search']) {
    for (const mode of MODES) {
      const unknown = DEFAULT_MODE_ORDERS[capability][mode].filter((id) => !own.has(id) && !EXTERNAL.has(id))
      assert.deepEqual(unknown, [], `${capability}.${mode} names unregistered: ${unknown.join(', ')}`)
    }
  }
})

// ─── one schema, one page ──────────────────────────────────────────────────

test('the fields the settings page edits are real config keys', () => {
  // A synthetic field name would be written into the profile patch as a key the
  // host schema does not know, and silently ignored.
  const shape = Config.toJSON()
  const refs = shape.refs ?? {}
  const root = refs[shape.uid] ?? shape
  const declared = new Set(Object.keys(root.dict ?? {}))
  for (const key of ['freeOnly', 'annotateFallback', 'defaultMode', 'order', 'modeOrders', 'providers', 'minBodyChars', 'timeoutMs']) {
    assert.ok(declared.has(key), `settings page edits "${key}" but config does not declare it`)
  }
})

// ─── the classifier is the reason the tool layer is optional ───────────────

test('classifyFetch separates the shapes that need different legs', () => {
  // This function is what makes an explicit mode parameter unnecessary: a URL's
  // shape decides, and the cases below are the ones measured to matter.
  const cases = [
    // A dated blog post also ends in "/", so an article shape must outrank the
    // generic front-page shape or exactly the pages that need full text get 300c.
    ['https://blog.rust-lang.org/2025/09/18/Rust-1.90.0/', 'deep'],
    ['https://en.wikipedia.org/wiki/Large_language_model', 'deep'],
    // Docs live under paths whose last segment looks like nothing at all.
    ['https://api-docs.deepseek.com/zh-cn/guides/search', 'deep'],
    ['https://www.zhihu.com/question/1', 'deep'],
    // A listing wants many rows, not one page of prose.
    ['https://news.ycombinator.com/news', 'list'],
    ['https://www.ithome.com/', 'list'],
    ['https://stackoverflow.com/questions', 'list'],
    // Everything unreadable lands on the cheapest mode: over-fetching is the
    // failure this plugin exists to avoid.
    ['https://github.com/deepseek-ai/deepseek-harness', 'brief'],
    ['https://arxiv.org/abs/1706.03762', 'brief'],
  ]
  for (const [url, want] of cases) {
    assert.equal(classifyFetch({ url }), want, url)
  }
})

test('classifySearch separates many-items queries from one-fact queries', () => {
  assert.equal(classifySearch({ query: 'github cordis releases' }), 'list')
  assert.equal(classifySearch({ query: 'rust 1.90 是什么' }), 'brief')
  assert.equal(classifySearch({ query: '2026年诺贝尔奖 有哪些' }), 'list')
})

test('the two chains rank independently (searchOrder is not `order`)', () => {
  // Before this was split, both chains read the same `order` key, so editing the
  // fetch ranking silently rewrote the search ranking. They are different
  // questions and must have different answers.
  const shape = Config.toJSON()
  const refs = shape.refs ?? {}
  const root = refs[shape.uid] ?? shape
  const declared = new Set(Object.keys(root.dict ?? {}))
  assert.ok(declared.has('order'), 'fetch order key')
  assert.ok(declared.has('searchOrder'), 'search order key')
  assert.notEqual('order', 'searchOrder')
})

test('both order keys are volatile and carry a default', () => {
  // Same constraint as every other volatile field: no default means the plugin
  // cannot resolve its schema at all.
  const shape = Config.toJSON()
  const refs = shape.refs ?? {}
  const root = refs[shape.uid] ?? shape
  for (const name of ['order', 'searchOrder']) {
    const slot = root.dict?.[name]
    const field = typeof slot === 'number' ? refs[slot] : slot
    assert.equal(field?.meta?.volatile, true, `${name} volatile`)
    assert.ok(Array.isArray(field?.meta?.default), `${name} has an array default`)
  }
})
