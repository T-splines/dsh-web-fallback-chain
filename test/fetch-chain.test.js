import { Config } from '../src/config.js'
/**
 * Offline tests for the chain: resolution against the live registry, ordering,
 * fallback, provenance, cancellation and attribution. No network, no harness
 * process — the legs are stubs, because what is under test is the chain's
 * policy, not the transport.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyFetchChain, CHAIN_FETCH_PROVIDER_ID, readField } from '../src/chains/fetch-plugin.js'
import { chainError, describeAttempts, fallbackMarker, finalize, resolveLegs, runChain } from '../src/chains/fetch.js'

const OK_RESULT = { url: 'https://example.com/', statusCode: 200, body: { kind: 'text', content: 'hello' }, truncated: false }
const request = { url: 'https://example.com/' }

/** A stub provider, programmable through `behaviour`. */
function stub(behaviour = {}) {
  return {
    available: () => (typeof behaviour.available === 'function' ? behaviour.available() : behaviour.available !== false),
    fetch: async (req, signal) => {
      if (behaviour.error !== undefined) throw behaviour.error
      if (behaviour.deferred !== undefined) return behaviour.deferred(signal)
      return behaviour.result ?? OK_RESULT
    },
  }
}

/** A registry (`Map`-like) built from id → provider pairs. */
function registry(entries) {
  return new Map(Object.entries(entries))
}


/** Run one fetch with a config object, the way the plugin resolves it. */
function runWithConfig(config, providers) {
  const registered = []
  const ctx = {
    web: { fetchProviders: registry(providers), registerFetchProvider: (p) => registered.push(p) },
    logger: { info: () => {} },
  }
  applyFetchChain(ctx, config)
  return registered[0].fetch(request)
}

/** Resolve legs the way the plugin does, then run them. */
function run(order, providers, options = {}, signal) {
  const { legs, missing } = resolveLegs(registry(providers), order, CHAIN_FETCH_PROVIDER_ID)
  return runChain(legs, missing, { annotateFallback: true, ...options }, request, signal)
}

test('the first usable leg serves and the body is untouched', async () => {
  const result = await run(['deepseek-fetch-rich', 'http'], {
    'deepseek-fetch-rich': stub({ result: { ...OK_RESULT, body: { kind: 'text', content: 'from ds' } } }),
    http: stub({ result: { ...OK_RESULT, body: { kind: 'text', content: 'from local' } } }),
  })
  assert.equal(result.body.content, 'from ds')
})

test('a failing first leg falls back and the body says so', async () => {
  const error = Object.assign(new Error('bad key'), { code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  const result = await run(['deepseek-fetch-rich', 'http'], {
    'deepseek-fetch-rich': stub({ error }),
    http: stub({ result: { ...OK_RESULT, body: { kind: 'text', content: 'from local' } } }),
  })
  assert.match(result.body.content, /from local/)
  assert.match(result.body.content, /\[fetch-chain\] this page was retrieved by the "http" leg/)
  assert.match(result.body.content, /deepseek-fetch-rich=failed\(WEB_PROVIDER_CREDENTIAL_MISSING\)/)
})

test('a credential-less first leg is unavailable, not an error', async () => {
  const result = await run(['deepseek-fetch-rich', 'http'], {
    'deepseek-fetch-rich': stub({ available: false }),
    http: stub(),
  })
  assert.match(result.body.content, /deepseek-fetch-rich=unavailable\(WEB_PROVIDER_UNAVAILABLE\)/)
})

test('a configured id with no provider is reported, never dropped', async () => {
  const result = await run(['deepseek-fetch-rich', 'http'], { http: stub() })
  assert.match(result.body.content, /deepseek-fetch-rich=unregistered\(WEB_PROVIDER_CONFIGURED_MISSING\)/)
})

test('a throwing availability check is an unavailable leg, not a crash', async () => {
  const result = await run(['a', 'b'], {
    a: stub({ available: () => { throw new Error('boom') } }),
    b: stub(),
  })
  assert.match(result.body.content, /a=unavailable\(WEB_PROVIDER_ERROR\)/)
})

test('annotation can be turned off without changing the winner', async () => {
  const result = await run(['a', 'b'], { a: stub({ error: new Error('nope') }), b: stub() }, { annotateFallback: false })
  assert.equal(result.body.content, 'hello')
})

test('no leg serving throws an error naming every attempt', async () => {
  await assert.rejects(
    () => run(['deepseek-fetch-rich', 'http'], {
      'deepseek-fetch-rich': stub({ error: Object.assign(new Error('bad key'), { code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }) }),
      http: stub({ error: Object.assign(new Error('blocked'), { code: 'WEB_BLOCKED_URL' }) }),
    }),
    (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR')
      assert.match(error.message, /deepseek-fetch-rich=failed\(WEB_PROVIDER_CREDENTIAL_MISSING\), http=failed\(WEB_BLOCKED_URL\)/)
      assert.equal(error.attempts.length, 2)
      assert.equal(error.cause.message, 'bad key')
      return true
    },
  )
})

test('nothing registered at all fails attributably', async () => {
  await assert.rejects(() => run(['deepseek-fetch-rich', 'http'], {}), (error) => {
    assert.equal(error.code, 'WEB_PROVIDER_UNAVAILABLE')
    assert.match(error.message, /deepseek-fetch-rich=unregistered/)
    assert.match(error.message, /http=unregistered/)
    return true
  })
})

test('an empty order fails attributably instead of fetching nowhere', async () => {
  await assert.rejects(() => run([], {}), (error) => {
    assert.equal(error.code, 'WEB_PROVIDER_UNAVAILABLE')
    assert.match(error.message, /none=unavailable/)
    return true
  })
})

test('an aborted call is rethrown, never retried on the next leg', async () => {
  const controller = new AbortController()
  const abortError = Object.assign(new Error('web fetch aborted'), { code: 'WEB_ABORTED' })
  let secondCalls = 0
  const promise = run(['a', 'b'], {
    a: stub({
      deferred: (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(abortError), { once: true })
      }),
    }),
    b: stub({ deferred: async () => { secondCalls += 1; return OK_RESULT } }),
  }, {}, controller.signal)
  controller.abort()
  await assert.rejects(() => promise, (error) => {
    assert.equal(error.code, 'WEB_ABORTED')
    return true
  })
  assert.equal(secondCalls, 0)
})

test('including the chain itself is refused at resolution, and by resolveLegs', async () => {
  // Validation runs on the first resolve, not at mount: these fields are
  // volatile() and reading them before injection completes throws. Mounting must
  // stay safe; a real bad config still fails loudly.
  let registered
  const ctx = { web: { fetchProviders: registry({ http: stub() }), registerFetchProvider: (p) => { registered = p } }, logger: { info: () => {} } }
  applyFetchChain(ctx, { order: ['http', CHAIN_FETCH_PROVIDER_ID] })
  assert.throws(() => registered.fetch({ url: 'https://example.com/' }, undefined), /cannot include "fetch-chain"/)
  assert.throws(
    () => resolveLegs(registry({}), ['http', CHAIN_FETCH_PROVIDER_ID], CHAIN_FETCH_PROVIDER_ID),
    /cannot include itself/,
  )
})

test('apply registers exactly one provider under the pinned id and reports its order', () => {
  const registered = []
  const logs = []
  const ctx = {
    web: { fetchProviders: registry({ http: stub() }), registerFetchProvider: (p) => registered.push(p) },
    logger: { info: (line) => logs.push(line) },
  }
  applyFetchChain(ctx, { order: ['deepseek-fetch-rich', 'http'], freeOnly: false, annotateFallback: true })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, CHAIN_FETCH_PROVIDER_ID)
  assert.equal(registered[0].available(), true)
  assert.match(logs[0], /order \[deepseek-fetch-rich → http\]/)
})

test('an empty order with no modes means "use the shipped defaults", not an error', async () => {
  // This used to throw, and `available()` swallowed the throw and returned false, so a
  // fresh deployment reported `web provider "fetch-chain" is registered but
  // unavailable` while nothing was wrong. An empty order is the DEFAULT state.
  let registered
  const ctx = { web: { fetchProviders: registry({ http: stub() }), registerFetchProvider: (p) => { registered = p } }, logger: { info: () => {} } }
  assert.doesNotThrow(() => applyFetchChain(ctx, { order: [] }))
  // No throw is the point: `fetch` resolves the order without rejecting the config.
  // (Whether a leg then serves depends on the registry, which is a separate test.)
  await assert.doesNotReject(registered.fetch({ url: 'https://example.com/' }, undefined))
})

test('the chain is unavailable when no configured leg is registered', () => {
  const registered = []
  const ctx = {
    web: { fetchProviders: registry({}), registerFetchProvider: (p) => registered.push(p) },
    logger: { info: () => {} },
  }
  applyFetchChain(ctx, { order: ['deepseek-fetch-rich', 'http'] })
  assert.equal(registered[0].available(), false)
})

test('readField accepts a plain value, a volatile getter, and a missing field', () => {
  assert.deepEqual(readField({ order: ['http'] }, 'order', []), ['http'])
  assert.deepEqual(readField({ order: { get: () => ['http'] } }, 'order', []), ['http'])
  assert.deepEqual(readField({}, 'order', []), [])
  assert.equal(readField({ annotateFallback: { get: () => false } }, 'annotateFallback', true), false)
  assert.equal(readField({}, 'annotateFallback', true), true)
})

test('volatile fields are re-read per call, so a settings edit needs no restart', async () => {
  // Stands in for what the generated settings page does: a live write swaps the
  // value behind the same volatile getter — the config object identity does not
  // change, so a plugin that cached the value at mount would miss it.
  const live = { order: ['a'] }
  const config = { order: { get: () => live.order }, annotateFallback: { get: () => true } }
  const registered = []
  const ctx = {
    web: {
      fetchProviders: registry({
        a: stub({ result: { ...OK_RESULT, body: { kind: 'text', content: 'from a' } } }),
        b: stub({ result: { ...OK_RESULT, body: { kind: 'text', content: 'from b' } } }),
      }),
      registerFetchProvider: (p) => registered.push(p),
    },
    logger: { info: () => {} },
  }
  applyFetchChain(ctx, config)

  const first = await registered[0].fetch(request)
  assert.equal(first.body.content, 'from a')

  live.order = ['b', 'missing-leg']
  const second = await registered[0].fetch(request)
  assert.equal(second.body.content.startsWith('from b'), true)
  // 'a' is no longer in the order at all — proof the new value was read.
  assert.equal(second.body.content.includes('a='), false)
  // ...and the new order's own trailing entry is reported as never attempted.
  assert.match(second.body.content, /\[fetch-chain\]/)
})






test('a typo saved after mount degrades to an unregistered attempt instead of throwing at mount', async () => {
  const registered = []
  const ctx = {
    web: { fetchProviders: registry({ http: stub() }), registerFetchProvider: (p) => registered.push(p) },
    logger: { info: () => {} },
  }
  applyFetchChain(ctx, { order: { get: () => ['deepssek', 'http'] }, annotateFallback: { get: () => true } })
  const result = await registered[0].fetch(request)
  assert.match(result.body.content, /deepssek=unregistered\(WEB_PROVIDER_CONFIGURED_MISSING\)/)
})

test('a bad INITIAL order still fails loudly, on the first call (errors stay loud)', async () => {
  const mount = (order) => {
    let registered
    const ctx = { web: { fetchProviders: registry({ http: stub() }), registerFetchProvider: (p) => { registered = p } }, logger: { info: () => {} } }
    applyFetchChain(ctx, { order })
    return registered
  }
  // An empty order is the "shipped defaults" state, so it must NOT throw...
  await assert.doesNotReject(mount({ get: () => [] }).fetch({ url: 'https://example.com/' }, undefined))
  // ...but a genuinely impossible order still fails loudly.
  assert.throws(
    () => mount({ get: () => [CHAIN_FETCH_PROVIDER_ID] }).fetch({ url: 'https://example.com/' }, undefined),
    /cannot include "fetch-chain"/,
  )
})

test('the exported Config marks both fields volatile (that is what generates the settings page)', () => {
  // `toJSON()` returns a ref table, not a nested tree: the root object's `dict`
  // holds indices into `refs`. Resolve one field either way so the assertion
  // survives a schemastery version that inlines instead of refs.
  const shape = Config.toJSON()
  const refs = shape.refs ?? {}
  const root = refs[shape.uid] ?? shape
  const field = (name) => {
    const slot = root.dict?.[name]
    return typeof slot === 'number' ? refs[slot] : slot
  }
  assert.equal(field('order')?.meta?.volatile, true)
  assert.equal(field('annotateFallback')?.meta?.volatile, true)
  // The merged plugin ships per-mode orders as the real ranking, so the flat
  // `order` starts empty and means "use the per-mode default". It still needs a
  // default because a volatile field without one cannot be resolved at all.
  assert.deepEqual(field('order')?.meta?.default, [])
  assert.equal(field('annotateFallback')?.meta?.default, true)
})

test('marker and attempt descriptions stay one line each', () => {
  assert.equal(describeAttempts([{ leg: 'a', outcome: 'failed', code: 'WEB_PROVIDER_ERROR' }]), 'a=failed(WEB_PROVIDER_ERROR)')
  assert.equal(describeAttempts([{ leg: 'b', outcome: 'unavailable' }]), 'b=unavailable')

  // A marker appears only when something actually came before the winner. With a single
  // attempt there is no earlier leg, and printing "earlier legs: (nothing)" is noise.
  assert.equal(fallbackMarker([{ leg: 'b', outcome: 'served', statusCode: 200 }], 'b'), '')

  const marker = fallbackMarker([
    { leg: 'a', outcome: 'failed', code: 'X' },
    { leg: 'b', outcome: 'served', statusCode: 200 },
  ], 'b')
  // Two leading newlines (a blank line before the rule), the rule, and one line of text.
  assert.equal(marker.split('\n').length, 4, 'blank line, ---, one description line')
  assert.match(marker, /earlier legs did not serve: a=failed\(X\)/)
})

test('finalize leaves a first-attempt success byte-identical', () => {
  assert.equal(finalize(OK_RESULT, [{ leg: 'a', outcome: 'served', statusCode: 200 }], true), OK_RESULT)
})

test('chainError carries the attempts for callers that want detail', () => {
  const error = chainError('https://x.test/', [{ leg: 'http', outcome: 'failed', code: 'WEB_FETCH_TIMEOUT' }])
  assert.match(error.message, /https:\/\/x\.test\//)
  assert.equal(error.attempts[0].code, 'WEB_FETCH_TIMEOUT')
})

test('a fresh install (empty order, empty modes) is available and logs no complaint', () => {
  // The exact shape a new deployment has. `available()` returning false here made dsh
  // answer every web_fetch with "registered but unavailable" before this was fixed.
  const warnings = []
  let registered
  const ctx = {
    web: { fetchProviders: registry({ http: stub() }), registerFetchProvider: (p) => { registered = p } },
    logger: { info: () => {}, warn: (message) => warnings.push(String(message)) },
  }
  applyFetchChain(ctx, { order: [], modeOrders: {}, freeOnly: true })
  assert.equal(registered.available(), true, 'an empty order is the default state, not a fault')
  assert.deepEqual(warnings, [], 'and it must not log a complaint about it')
})

test('available() never throws, even when a leg does', () => {
  // The seam calls available() to pick a provider; a throw there becomes the opaque
  // "registered but unavailable", so a leg blowing up must be contained.
  let registered
  const explosion = () => ({
    id: 'http',
    available: () => { throw new Error('boom') },
    fetch: async () => ({ content: '', truncated: false }),
  })
  const ctx = {
    web: { fetchProviders: registry({ http: explosion() }), registerFetchProvider: (p) => { registered = p } },
    logger: { info: () => {}, warn: () => {} },
  }
  applyFetchChain(ctx, { order: ['http'] })
  assert.doesNotThrow(() => registered.available())
  assert.equal(registered.available(), false, 'an exploding leg is unavailable, not fatal')
})
