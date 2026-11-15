import { Config } from '../src/config.js'
/**
 * Offline tests for the search chain.
 *
 * What is under test is the policy — ordering, free filtering, the empty-result
 * rule, the budget, and legible degradation. No network: the legs are stubs.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applySearchChain, CHAIN_SEARCH_PROVIDER_ID, readField } from '../src/chains/search-plugin.js'
import { capSources, describeAttempts, finalize, resolveLegs, runSearchChain } from '../src/chains/search.js'

const result = (n = 3, len = 800) => ({
  sources: Array.from({ length: n }, (_, i) => ({
    title: `t${i}`, url: `https://example.com/${i}`, snippet: 'x'.repeat(len),
  })),
})
const req = { query: 'rust 1.90 release notes' }

function stub(behaviour = {}) {
  return {
    available: () => behaviour.available !== false,
    search: async () => {
      if (behaviour.error) throw behaviour.error
      if (behaviour.call) return behaviour.call()
      return behaviour.result ?? result()
    },
  }
}
const registry = (entries) => new Map(Object.entries(entries))

function mount(config, providers = {}) {
  let registered
  const ctx = {
    web: { searchProviders: registry(providers), registerSearchProvider: (p) => { registered = p } },
    logger: { info: () => {} },
  }
  applySearchChain(ctx, config)
  return registered
}

// ─── the chain ──────────────────────────────────────────────────────────────

test('the first leg with sources serves', async () => {
  const legs = [
    { label: 'a', provider: stub({ result: result(2) }) },
    { label: 'b', provider: stub({ result: result(5) }) },
  ]
  const out = await runSearchChain(legs, [], {}, req)
  assert.equal(out.sources.length, 2)
})

test('an empty result is a miss, not a success', async () => {
  // A leg answering 200 with zero sources must not end the chain.
  const legs = [
    { label: 'empty', provider: stub({ result: { sources: [] } }) },
    { label: 'real', provider: stub({ result: result(4) }) },
  ]
  const out = await runSearchChain(legs, [], {}, req)
  assert.equal(out.sources.length, 4)
})

test('a throw falls through and the failure is attributed', async () => {
  const legs = [
    { label: 'boom', provider: stub({ error: Object.assign(new Error('nope'), { code: 'WEB_PROVIDER_ERROR' }) }) },
    { label: 'ok', provider: stub({ result: result(3) }) },
  ]
  const out = await runSearchChain(legs, [], { annotateFallback: true }, req)
  assert.equal(out.sources.length, 3)
  assert.match(out.sources[0].snippet, /boom=failed\(WEB_PROVIDER_ERROR\)/)
})

test('an unavailable leg is skipped without a call', async () => {
  let called = false
  const legs = [
    { label: 'off', provider: { available: () => false, search: async () => { called = true } } },
    { label: 'on', provider: stub({ result: result(2) }) },
  ]
  const out = await runSearchChain(legs, [], {}, req)
  assert.equal(called, false)
  assert.equal(out.sources.length, 2)
})

test('an unregistered configured id is reported, never silently dropped', async () => {
  const legs = [{ label: 'ok', provider: stub({ result: result(2) }) }]
  const out = await runSearchChain(legs, ['never-mounted'], { annotateFallback: true }, req)
  assert.match(out.sources[0].snippet, /never-mounted=unregistered/)
})

test('when nothing serves the error carries every attempt', async () => {
  const legs = [
    { label: 'a', provider: stub({ result: { sources: [] } }) },
    { label: 'b', provider: stub({ error: Object.assign(new Error('x'), { code: 'WEB_PROVIDER_ERROR' }) }) },
  ]
  await assert.rejects(
    () => runSearchChain(legs, ['ghost'], {}, req),
    (error) => {
      assert.equal(error.attempts.length, 3)
      assert.match(error.message, /a=empty/)
      assert.match(error.message, /b=failed/)
      assert.match(error.message, /ghost=unregistered/)
      return true
    },
  )
})

test('a first-attempt success is left byte-identical', () => {
  const r = result(2)
  assert.equal(finalize(r, [{ leg: 'a', outcome: 'served' }], true), r)
})

test('describeAttempts renders count when known', () => {
  assert.equal(describeAttempts([{ leg: 'a', outcome: 'served', count: 5 }]), 'a=served[5]')
})

test('resolveLegs refuses the chain including itself', () => {
  assert.throws(
    () => resolveLegs(registry({}), [CHAIN_SEARCH_PROVIDER_ID], CHAIN_SEARCH_PROVIDER_ID),
    /cannot include itself/,
  )
})

// ─── budget ─────────────────────────────────────────────────────────────────

test('capSources truncates each source to the budget', () => {
  const out = capSources(result(2, 1000), 300)
  for (const s of out.sources) assert.equal(s.snippet.length, 301) // 300 + the ellipsis
})

test('capSources leaves a result under budget untouched', () => {
  const r = result(2, 100)
  assert.equal(capSources(r, 300), r)
})

test('a null cap means no truncation', () => {
  const r = result(2, 5000)
  assert.equal(capSources(r, null), r)
})

// ─── config ─────────────────────────────────────────────────────────────────

test('freeOnly is on by default', () => {
  assert.equal(readField(Config({}), 'freeOnly', undefined), true)
})

test('freeOnly skips a billed leg and keeps the rest in order', async () => {
  const ran = []
  const spy = (name) => ({ available: () => true, search: async () => { ran.push(name); return result(2) } })
  const p = mount({
    searchOrder: ['paid-a', 'free-b'],
    defaultMode: 'brief',
    freeOnly: true,
    providers: { 'paid-a': { cost: 'paid', kinds: ['search'] } },
  }, { 'paid-a': spy('paid-a'), 'free-b': spy('free-b') })
  await p.search(req, undefined)
  assert.deepEqual(ran, ['free-b'])
})

test('flipping freeOnly off restores the billed leg first, live', async () => {
  let flag = true
  const ran = []
  const spy = (name) => ({ available: () => true, search: async () => { ran.push(name); return result(2) } })
  const p = mount({
    searchOrder: ['paid-a', 'free-b'],
    defaultMode: 'brief',
    freeOnly: { get: () => flag },
    providers: { 'paid-a': { cost: 'paid', kinds: ['search'] } },
  }, { 'paid-a': spy('paid-a'), 'free-b': spy('free-b') })
  await p.search(req, undefined)
  assert.deepEqual(ran, ['free-b'])
  flag = false
  ran.length = 0
  await p.search(req, undefined)
  assert.deepEqual(ran, ['paid-a'])
})

test('a user-added provider can lead the chain', async () => {
  const ran = []
  const spy = (name) => ({ available: () => true, search: async () => { ran.push(name); return result(2) } })
  const p = mount({
    searchOrder: ['my-searxng', 'anysearch'],
    defaultMode: 'brief',
    freeOnly: true,
    providers: { 'my-searxng': { cost: 'free', quality: 8, kinds: ['search'] } },
  }, { 'my-searxng': spy('my-searxng'), anysearch: spy('anysearch') })
  await p.search(req, undefined)
  assert.deepEqual(ran, ['my-searxng'])
})

test('an unknown mode name is refused instead of being ignored', () => {
  // Validation runs on the first resolve: volatile fields are unreadable at mount.
  const p = mount({ searchOrder: ['a'], modeOrders: { search: { shallow: ['a'] } } }, { a: stub() })
  assert.throws(() => p.search(req, undefined), /modeOrders\.search\.shallow.*not a mode/)
})

test('the per-mode cap comes from the winning leg metadata', async () => {
  let seenCap = null
  const p = mount({
    searchOrder: ['a'],
    defaultMode: 'brief',
    freeOnly: true,
    providers: { a: { cost: 'free', maxChars: { brief: 50, deep: 400 } } },
  }, { a: stub({ result: result(2, 1000) }) })
  const out = await p.search(req, undefined)
  seenCap = out.sources[0].snippet.length
  assert.equal(seenCap, 51, 'brief budget of 50 characters plus the ellipsis')
})

// ─── the volatile/default constraint ────────────────────────────────────────

test('every volatile field carries a default, or the plugin cannot mount', () => {
  // Hard-won: a `volatile()` field with no `.default()` is resolved while the
  // schema is built, before injection completes, and schemastery raises
  // `cannot get property "X" without inject`. That happens at config-parse time,
  // so no try/catch in apply() can rescue it — the provider silently never
  // registers and the seam reports `"search-chain" is not registered`.
  const shape = Config.toJSON()
  const refs = shape.refs ?? {}
  const root = refs[shape.uid] ?? shape
  const dict = root.dict ?? {}
  const missing = []
  for (const [name, slot] of Object.entries(dict)) {
    const field = typeof slot === 'number' ? refs[slot] : slot
    const meta = field?.meta ?? {}
    if (meta.volatile === true && meta.default === undefined) missing.push(name)
  }
  assert.deepEqual(missing, [], `volatile fields without a default: ${missing.join(', ')}`)
})

test('the config can be constructed with no fields at all', () => {
  // This is what the host does at mount. If it throws, the plugin never loads.
  assert.doesNotThrow(() => Config({}))
})
