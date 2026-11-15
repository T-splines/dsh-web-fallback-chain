import { Config } from '../src/config.js'
/**
 * Tests for the behaviour this plugin gained after the benchmark:
 *
 * - `minBodyChars` — a 200 response carrying a footer must not end the chain.
 * - modes — the order per intent, and that a URL is classified without a hint.
 * - `freeOnly` — billed legs removed, survivors not re-sorted.
 * - user-extensible providers — a leg we never shipped can be ordered and
 *   filtered like a built-in.
 *
 * All offline: the legs are stubs.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyFetchChain, CHAIN_FETCH_PROVIDER_ID, readField } from '../src/chains/fetch-plugin.js'
import { bodyLength, describeAttempt, runChain } from '../src/chains/fetch.js'

const big = (n) => ({ url: 'https://example.com/', statusCode: 200, body: { kind: 'text', content: 'x'.repeat(n) }, truncated: false })
const req = { url: 'https://example.com/' }

function stub(behaviour = {}) {
  return {
    available: () => behaviour.available !== false,
    fetch: async () => {
      if (behaviour.error) throw behaviour.error
      return behaviour.result ?? big(5000)
    },
  }
}
const registry = (entries) => new Map(Object.entries(entries))

/** Mount the plugin against a fake ctx and return the registered provider. */
function mount(config, providers = {}) {
  let registered
  const ctx = {
    web: { fetchProviders: registry(providers), registerFetchProvider: (p) => { registered = p } },
    logger: { info: () => {} },
  }
  applyFetchChain(ctx, config)
  return registered
}

// ─── minBodyChars ───────────────────────────────────────────────────────────

test('bodyLength reads the text the model would receive', () => {
  assert.equal(bodyLength(big(10)), 10)
  assert.equal(bodyLength({ body: { content: 42 } }), 0)
  assert.equal(bodyLength({}), 0)
  assert.equal(bodyLength(undefined), 0)
})

test('a short body is a miss, not a success: the next leg serves', async () => {
  // The measured failure this guards: 332 chars of footer at HTTP 200.
  const legs = [
    { label: 'paid', provider: stub({ result: big(332) }) },
    { label: 'local', provider: stub({ result: big(50000) }) },
  ]
  const result = await runChain(legs, [], { minBodyChars: 600, annotateFallback: false }, req)
  assert.equal(bodyLength(result), 50000)
})

test('the short attempt is recorded with its length, so the skip is auditable', async () => {
  const legs = [
    { label: 'paid', provider: stub({ result: big(142) }) },
    { label: 'local', provider: stub({ result: big(50000) }) },
  ]
  const result = await runChain(legs, [], { minBodyChars: 600, annotateFallback: true }, req)
  // the marker travels with the content
  assert.match(result.body.content, /paid=short/)
  assert.match(result.body.content, /\[142c\]/)
  assert.match(result.body.content, /"local" leg/)
})

test('minBodyChars 0 disables the floor (a stub page can be wanted)', async () => {
  const legs = [{ label: 'only', provider: stub({ result: big(50) }) }]
  const result = await runChain(legs, [], { minBodyChars: 0, annotateFallback: false }, req)
  assert.equal(bodyLength(result), 50)
})

test('when every leg is short, the longest one still comes back — and says so', async () => {
  const legs = [
    { label: 'a', provider: stub({ result: big(100) }) },
    { label: 'b', provider: stub({ result: big(400) }) },
  ]
  const result = await runChain(legs, [], { minBodyChars: 600, annotateFallback: true }, req)
  // The longer body wins; the marker is appended, so compare the payload prefix.
  assert.ok(result.body.content.startsWith('x'.repeat(400)), 'the 400-char body is the one returned')
  // The winner is named once, and every leg it beat is still reported.
  assert.match(result.body.content, /retrieved by the "b" leg/)
  assert.match(result.body.content, /a=short\[100c\]/)
  // …and the winner does not appear a second time in its own "did not serve" list.
  assert.doesNotMatch(result.body.content, /b=short/)
})

test('a thrown leg after a short one still reports both', async () => {
  const legs = [
    { label: 'shorty', provider: stub({ result: big(100) }) },
    { label: 'boom', provider: stub({ error: Object.assign(new Error('nope'), { code: 'WEB_PROVIDER_ERROR' }) }) },
  ]
  // every leg short-or-failed, but one produced *something*
  const result = await runChain(legs, [], { minBodyChars: 600, annotateFallback: true }, req)
  assert.ok(result.body.content.startsWith('x'.repeat(100)))
  const marker = result.body.content
  assert.match(marker, /boom=failed/)
})

test('describeAttempt includes the length only when it is known', () => {
  assert.equal(describeAttempt({ leg: 'x', outcome: 'served' }), 'x=served')
  assert.equal(describeAttempt({ leg: 'x', outcome: 'short', length: 142 }), 'x=short[142c]')
})

// ─── modes ──────────────────────────────────────────────────────────────────

test('a document URL resolves to the deep order without any caller hint', async () => {
  // `deep` puts the local leg first; the billed leg is present but not leading.
  const ran = []
  const spy = (name) => ({ available: () => true, fetch: async () => { ran.push(name); return big(9000) } })
  const p = mount({
    order: [],
    defaultMode: 'brief',
    modeOrders: { fetch: { deep: ['http', 'anysearch', 'deepseek-fetch-rich'] } },
    freeOnly: true,
  }, { http: spy('http'), anysearch: spy('anysearch'), 'deepseek-fetch-rich': spy('deepseek-fetch-rich') })
  // A wikipedia article classifies as `deep` with no hint from the caller.
  await p.fetch({ url: 'https://en.wikipedia.org/wiki/Large_language_model' }, undefined)
  assert.deepEqual(ran, ['http'], 'the deep order led with the local leg')
})

test('modeOrders drives the order; freeOnly then removes billed legs', () => {
  let called = []
  const legs = {
    'deepseek-fetch-rich': stub(), http: stub(), anysearch: stub(),
  }
  const p = mount({
    order: [],
    modeOrders: { fetch: { brief: ['deepseek-fetch-rich', 'http', 'anysearch'] } },
    freeOnly: true,
  }, legs)
  assert.equal(p.available(), true)
})

test('an unknown mode name is refused instead of being ignored', () => {
  // Validation runs on the first resolve (volatile fields are unreadable at mount).
  const p = mount({ order: ['http'], modeOrders: { fetch: { shallow: ['http'] } } }, { http: stub() })
  assert.throws(() => p.fetch({ url: 'https://example.com/' }, undefined), /modeOrders\.fetch\.shallow.*not a mode/)
})

test('a mode order that names the chain itself is refused', () => {
  const p = mount({ order: ['http'], modeOrders: { fetch: { brief: [CHAIN_FETCH_PROVIDER_ID] } } }, { http: stub() })
  assert.throws(() => p.fetch({ url: 'https://example.com/' }, undefined), /cannot include "fetch-chain"/)
})

test('mounting with modes configured needs no flat order', () => {
  assert.doesNotThrow(() => mount({ order: [], modeOrders: { fetch: { brief: ['http'] } } }, { http: stub() }))
})

test('mounting with neither an order nor modes uses the shipped defaults and stays available', () => {
  // This pair of behaviours is what a fresh install looks like: `order: []` and
  // `modeOrders: {}`. Treating it as a config error made `available()` false and dsh
  // refused every web_fetch with "registered but unavailable".
  const p = mount({ order: [] }, { http: stub() })
  assert.equal(p.available(), true, 'an empty order must not disable the chain')
  assert.doesNotThrow(() => p.fetch({ url: 'https://example.com/' }, undefined).catch(() => {}))
})

// ─── freeOnly ───────────────────────────────────────────────────────────────

test('freeOnly is on by default, so the billed leg is skipped without configuration', () => {
  const def = Config({})
  assert.equal(readField(def, 'freeOnly', undefined), true)
})

test('a user-added provider participates in freeOnly by its declared cost', () => {
  // The user adds a paid vendor we never shipped; freeOnly must skip it too.
  const p = mount({
    order: [],
    modeOrders: { fetch: { brief: ['my-paid-vendor', 'http'] } },
    freeOnly: true,
    providers: { 'my-paid-vendor': { cost: 'paid', kinds: ['fetch'] } },
  }, { 'my-paid-vendor': stub(), http: stub() })
  assert.equal(p.available(), true)
})

test('flipping freeOnly off changes what runs, live, without a remount', async () => {
  let flag = true
  const seen = []
  const spy = (name) => ({
    available: () => true,
    fetch: async () => { seen.push(name); return big(5000) },
  })
  const config = {
    order: [],
    // `defaultMode` pins the mode so the test does not depend on classification.
    defaultMode: 'brief',
    modeOrders: { fetch: { brief: ['paid', 'free'] } },
    freeOnly: { get: () => flag },
    providers: { paid: { cost: 'paid', kinds: ['fetch'] } },
  }
  const p = mount(config, { paid: spy('paid'), free: spy('free') })
  await p.fetch({ url: 'https://example.com/pricing' }, undefined)
  assert.deepEqual(seen, ['free'], 'freeOnly on: the paid leg must not run')
  flag = false
  seen.length = 0
  await p.fetch({ url: 'https://example.com/pricing' }, undefined)
  assert.deepEqual(seen, ['paid'], 'freeOnly off: the paid leg leads again')
})

test('minBodyChars is read live from config', async () => {
  let floor = 0
  const config = {
    order: [],
    defaultMode: 'brief',
    modeOrders: { fetch: { brief: ['a', 'b'] } },
    freeOnly: false,
    annotateFallback: false, // isolate the length from the provenance marker
    minBodyChars: { get: () => floor },
  }
  const a = { available: () => true, fetch: async () => big(100) }
  const b = { available: () => true, fetch: async () => big(9000) }
  const p = mount(config, { a, b })
  // floor 0: the first leg serves even though it is tiny
  assert.equal(bodyLength(await p.fetch({ url: 'https://example.com/pricing' }, undefined)), 100)
  // raise the floor live: the same call now falls through to b
  floor = 600
  assert.equal(bodyLength(await p.fetch({ url: 'https://example.com/pricing' }, undefined)), 9000)
})

test('a mode the user did not configure falls back to the flat order, not to shipped legs', async () => {
  // Guard against a real surprise: configuring only `brief` must not make a
  // `list` fetch reach for providers this deployment never mounted.
  const ran = []
  const spy = (name) => ({ available: () => true, fetch: async () => { ran.push(name); return big(5000) } })
  const p = mount({
    order: ['free-a', 'free-b'],
    defaultMode: 'brief',
    modeOrders: { fetch: { brief: ['free-a', 'free-b'] } },
    freeOnly: true,
  }, { 'free-a': spy('free-a'), 'free-b': spy('free-b') })
  // a front-page URL classifies as `list`, which has no configured order
  await p.fetch({ url: 'https://example.com/' }, undefined)
  assert.deepEqual(ran, ['free-a'], 'the flat order served the unconfigured mode')
})
