/**
 * Offline tests for the shared chain policy. No network, no harness process.
 *
 * What is under test is the *decision*, not any transport: which order a mode
 * resolves to, what free mode removes, and how a per-result budget is applied.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULTS, MODES, DEFAULT_MODE, DEFAULT_MODE_ORDERS,
  mergeProviders, partitionByCost, missingKey,
  classifyFetch, classifySearch, resolveOrder, readField, capText,
} from '../src/policy/index.js'

// ─── provider metadata ──────────────────────────────────────────────────────

test('built-in metadata declares cost for every shipped leg', () => {
  for (const [id, meta] of Object.entries(DEFAULTS)) {
    assert.ok(meta.cost === 'free' || meta.cost === 'paid', `${id} must declare cost`)
    assert.ok(meta.quality >= 0 && meta.quality <= 10, `${id} quality in range`)
    assert.ok(Array.isArray(meta.kinds) && meta.kinds.length > 0, `${id} declares kinds`)
  }
})

test('a user can add a leg we never tested', () => {
  const merged = mergeProviders({ 'my-searxng': { cost: 'free', quality: 6, kinds: ['search'] } })
  assert.equal(merged['my-searxng'].id, 'my-searxng')
  assert.equal(merged['my-searxng'].cost, 'free')
  assert.equal(merged['my-searxng'].quality, 6)
  // and the built-ins survive alongside it
  assert.equal(merged['deepseek-search-rich'].cost, 'paid')
})

test('an override patches field-by-field instead of replacing the entry', () => {
  const merged = mergeProviders({ anysearch: { cost: 'paid' } })
  assert.equal(merged.anysearch.cost, 'paid')
  // untouched fields are still the shipped ones
  assert.equal(merged.anysearch.quality, DEFAULTS.anysearch.quality)
  assert.deepEqual(merged.anysearch.maxChars, DEFAULTS.anysearch.maxChars)
})

test('a partial maxChars override merges onto the built-in caps', () => {
  const merged = mergeProviders({ http: { maxChars: { deep: 5000 } } })
  assert.equal(merged.http.maxChars.deep, 5000)
  assert.equal(merged.http.maxChars.brief, DEFAULTS.http.maxChars.brief)
})

test('metadata typos are refused, naming the id and the field', () => {
  assert.throws(() => mergeProviders({ x: { cost: 'cheap' } }), /x: .*cost/)
  assert.throws(() => mergeProviders({ x: { quality: 11 } }), /x: .*quality/)
  assert.throws(() => mergeProviders({ x: { kinds: ['telepathy'] } }), /x: .*kind/)
  assert.throws(() => mergeProviders({ x: { maxChars: { deep: -1 } } }), /x: .*maxChars/)
  assert.throws(() => mergeProviders({ x: { qualty: 5 } }), /x\.qualty is not a known field/)
})

test('partitionByCost keeps order and treats unknown legs as free', () => {
  const providers = { a: { cost: 'paid' }, b: { cost: 'free' } }
  const { free, paid } = partitionByCost(['a', 'b', 'never-heard-of-it'], providers)
  assert.deepEqual(free, ['b', 'never-heard-of-it'])
  assert.deepEqual(paid, ['a'])
})

test('missingKey reports the env var a leg needs', () => {
  const providers = { deepseek: { requiresKey: 'DS_KEY' }, http: { requiresKey: null } }
  assert.equal(missingKey('deepseek', providers, {}), 'DS_KEY')
  assert.equal(missingKey('deepseek', providers, { DS_KEY: 'x' }), null)
  assert.equal(missingKey('http', providers, {}), null)
})

// ─── modes ──────────────────────────────────────────────────────────────────

test('every capability ships an order for every mode', () => {
  for (const capability of ['search', 'fetch']) {
    for (const mode of MODES) {
      const order = DEFAULT_MODE_ORDERS[capability][mode]
      assert.ok(Array.isArray(order) && order.length > 0, `${capability}.${mode} has an order`)
    }
  }
})

test('fetch classification: a document URL is deep, a front page is list', () => {
  assert.equal(classifyFetch({ url: 'https://en.wikipedia.org/wiki/Large_language_model' }), 'deep')
  assert.equal(classifyFetch({ url: 'https://blog.rust-lang.org/2025/09/18/Rust-1.90.0/' }), 'deep')
  // Measured: the /abs/ page is 8879 characters, most of it nav and sidebar;
  // the abstract itself finishes inside the first 600. brief is the honest mode.
  assert.equal(classifyFetch({ url: 'https://arxiv.org/abs/1706.03762' }), 'brief')
  assert.equal(classifyFetch({ url: 'https://example.com/' }), 'list')
  assert.equal(classifyFetch({ url: 'https://www.ithome.com/' }), 'list')
  assert.equal(classifyFetch({ url: 'https://news.ycombinator.com/news' }), 'list')
  assert.equal(classifyFetch({ url: 'https://example.com/pricing' }), 'brief')
})

test('search classification: an enumeration query is list, a fact is brief', () => {
  assert.equal(classifySearch({ query: 'github deepseek-ai/dsh releases' }), 'list')
  assert.equal(classifySearch({ query: '有哪些 dsh 插件' }), 'list')
  assert.equal(classifySearch({ query: '2026年诺贝尔物理学奖 获奖者' }), 'brief')
})

test('freeOnly removes billed legs and never re-sorts what remains', () => {
  const providers = DEFAULTS
  const order = DEFAULT_MODE_ORDERS.fetch.brief
  const { order: kept, skippedForCost } = resolveOrder({
    capability: 'fetch', mode: 'brief', request: { url: 'https://example.com/' },
    config: { freeOnly: true }, providers,
  })
  assert.deepEqual(skippedForCost, ['deepseek-fetch-rich'])
  assert.deepEqual(kept, order.filter((id) => id !== 'deepseek-fetch-rich'))
})

test('freeOnly defaults to on when the field is absent', () => {
  const { order } = resolveOrder({
    capability: 'fetch', mode: 'brief', request: { url: 'https://x/' }, config: {}, providers: DEFAULTS,
  })
  assert.ok(!order.includes('deepseek-fetch-rich'))
})

test('turning freeOnly off restores the paid leg in its configured position', () => {
  const { order } = resolveOrder({
    capability: 'fetch', mode: 'deep', request: { url: 'https://x/' },
    config: { freeOnly: false }, providers: DEFAULTS,
  })
  assert.deepEqual(order, DEFAULT_MODE_ORDERS.fetch.deep)
  assert.ok(order.includes('deepseek-fetch-rich'))
})

test('an explicit mode beats the classifier', () => {
  const { mode } = resolveOrder({
    capability: 'fetch', mode: 'page', request: { url: 'https://example.com/' },
    config: {}, providers: DEFAULTS,
  })
  assert.equal(mode, 'page')
})

test('a configured modeOrders override wins over the shipped default', () => {
  const { order } = resolveOrder({
    capability: 'search', mode: 'brief', request: { query: 'x' },
    config: { modeOrders: { search: { brief: ['tavily', 'anysearch'] } } }, providers: DEFAULTS,
  })
  assert.deepEqual(order, ['tavily', 'anysearch'])
})

test('a user-added leg participates in ordering like a built-in', () => {
  const providers = mergeProviders({ 'my-searxng': { cost: 'free', quality: 6, kinds: ['search'] } })
  const { order } = resolveOrder({
    capability: 'search', mode: 'brief', request: { query: 'x' },
    config: { modeOrders: { search: { brief: ['my-searxng', 'deepseek-search-rich'] } } }, providers,
  })
  assert.deepEqual(order, ['my-searxng'])
})

test('volatile getters are read per call', () => {
  let flag = true
  const config = { freeOnly: { get: () => flag } }
  const first = resolveOrder({ capability: 'fetch', mode: 'brief', request: { url: 'https://x/' }, config, providers: DEFAULTS })
  flag = false
  const second = resolveOrder({ capability: 'fetch', mode: 'brief', request: { url: 'https://x/' }, config, providers: DEFAULTS })
  assert.ok(!first.order.includes('deepseek-fetch-rich'))
  assert.ok(second.order.includes('deepseek-fetch-rich'))
  assert.equal(readField(config, 'freeOnly', true), false)
})

// ─── budget ─────────────────────────────────────────────────────────────────

test('capText truncates and says so', () => {
  assert.deepEqual(capText('abcdef', 3), { text: 'abc…', truncated: true })
  assert.deepEqual(capText('abc', 3), { text: 'abc', truncated: false })
  assert.deepEqual(capText('abc', null), { text: 'abc', truncated: false })
  assert.deepEqual(capText(undefined, 3), { text: '', truncated: false })
})

test('shipped maxChars gives brief a smaller budget than deep', () => {
  const meta = DEFAULTS['deepseek-search-rich']
  assert.ok(meta.maxChars.brief < meta.maxChars.deep, 'brief must be cheaper than deep')
})
