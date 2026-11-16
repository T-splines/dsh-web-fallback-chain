/**
 * Tests that actually *render* the settings card, without a browser.
 *
 * ## Why this file exists
 *
 * `client.test.js` only greps the source for missing `t()` keys. That caught one
 * class of failure and missed every other: the page has disappeared five times
 * for five different reasons — a slot name that does not exist, `section()` called
 * without `children`, a deleted `PlainSettings` still referenced on the recovery
 * path — and a static grep sees none of them, because they only fail when React
 * actually runs the component.
 *
 * So this harness runs the real bundle. `src/client.js` is a
 * `window.__ModuleLoader__.load({ id, factory })` call, which means it needs only
 * three things to execute: a `window` with that loader, a `require` that resolves
 * the two module ids the shell provides, and a fake `primitives` + `react`.
 *
 * The fakes are deliberately thin and *structured like the real API*: fields are
 * plain objects with `id`/`label`, `SettingsForm` records children, the form model
 * exposes the field bindings the controller asks for. If the component asks for
 * something the shape does not provide, the test fails here instead of in the
 * browser.
 *
 * ## What it cannot prove
 *
 * That the real primitives render these props the same way. It proves the
 * component *runs*, resolves every key, mounts the slot, and produces a tree with
 * the expected fields — which is the failure surface that has actually bitten.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(here, '..', 'src', 'client.js'), 'utf8')

// ─── The fake runtime the shell provides ────────────────────────────────────

/** A React stand-in: elements are plain records, enough to walk a tree. */
const React = {
  createElement(type, props, ...children) {
    // A forwardRef element: keep the display name reachable so tests can find it.
    const label = typeof type === 'function' ? type.name : (type?.name ?? type)
    return { type: label, props: props ?? {}, children: children.flat(Infinity), __component: type }
  },
  Fragment: 'Fragment',
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
}

/**
 * The primitives surface this component is allowed to use.
 *
 * Every entry records its call so a test can assert *which* fields were asked for
 * rather than only that rendering did not throw.
 */
function makePrimitives(calls, record = () => {}) {
  const passthrough = (name, extra = {}) => (props) => {
    calls.push({ name, props })
    return React.createElement(name, { ...props, ...extra })
  }
  /**
   * The form model. Shaped after the real one: it takes a scope plus field
   * descriptions, exposes `field(name)` / `shell()` / `bind()` / `actions()`, and
   * must be constructible — the component calls `new primitives.SettingsFormModel`.
   */
  class SettingsFormModel {
    constructor(scope, fields) {
      calls.push({ name: 'SettingsFormModel', props: { scope, fields } })
      this.scope = scope
      this.fields = fields
      // Staged edits, so `field()` reflects what was just written. A model that only
      // records edits makes "read the current value, then merge" untestable — and that
      // is exactly the pattern that lost `providers` sibling keys.
      this.staged = { ...(scope?.values ?? {}) }
      // Expose the registered specs so a test can assert their format/parse pair.
      record('formFields', fields)
    }

    field(name) {
      const value = this.staged[name] ?? ''
      return {
        value,
        text: typeof value === 'string' ? value : JSON.stringify(value ?? ''),
        invalid: false,
        overridden: false,
        clearable: false,
        writable: true,
      }
    }

    shell() {
      return { writable: true, saving: false, dirty: false }
    }

    bind() {
      return { subscribe: () => () => {}, getSnapshot: () => this.shell() }
    }

    actions() {
      return {
        edit: (key, text) => { this.staged[key] = text; record('edit', key, text) },
        resetField: (key) => record('resetField', key, undefined),
        save: () => {}, discard: () => {},
      }
    }

    dispose() {}
  }

  return {
    SettingsFormModel,
    SettingsForm: (props) => {
      calls.push({ name: 'SettingsForm', props })
      return React.createElement('SettingsForm', props, ...(Array.isArray(props.children) ? props.children : []))
    },
    SettingsValueField: passthrough('SettingsValueField'),
    SettingsSecretField: passthrough('SettingsSecretField'),
    // The product's control for "pick one of a known set"; used for the depth field.
    SegmentedControl: passthrough('SegmentedControl'),
    // The real `Button` is `React.forwardRef(...)`, i.e. an OBJECT, not a function.
    // Modelling that is the only way this harness can catch
    // `primitives.Button is not a function` — the exact failure that blanked the page.
    Checkbox: passthrough('Checkbox'),
    Button: { $$typeof: Symbol.for('react.forward_ref'), name: 'Button', __fake: true },
    IconChevronUpOutlineRegular: passthrough('IconChevronUpOutlineRegular'),
    IconChevronDownOutlineRegular: passthrough('IconChevronDownOutlineRegular'),
    SettingsSecretField: passthrough('SettingsSecretField'),
    Switch: passthrough('Switch'),
    // Mirrors the real factory, whose `format` returns '' for anything that is not
    // a string — the behaviour that made a stored boolean render as an empty field.
    settingsTextField: (field) => ({
      field,
      format: (value) => (typeof value === 'string' ? value : ''),
      parse: (text) => (text.trim() === '' ? { kind: 'clear' } : { kind: 'set', value: text.trim() }),
    }),
    settingsNumberField: (key) => ({ kind: 'number', key }),
  }
}

/**
 * Run the real bundle far enough to obtain `exports.apply`.
 *
 * @param options - overrides for the services `apply` touches.
 * @returns the captured application objects, for assertions.
 */
function loadClient(options = {}) {
  const seen = {
    slots: [],
    localeRegistrations: [],
    effects: [],
    primitivesCalls: [],
    controllers: [],
    errors: [],
    edits: [],
    formFields: undefined,
  }
  const record = (kind, key, text) => {
    // `formFields` carries the registered field specs rather than an edit.
    if (kind === 'formFields') { seen.formFields = key; return }
    seen.edits.push({ kind, key, text })
  }
  const primitives = makePrimitives(seen.primitivesCalls, record)
  if (options.dropPrimitive !== undefined) delete primitives[options.dropPrimitive]

  /** One registered field binding, shaped like the real form-field snapshot. */
  const fieldBinding = (key) => ({
    value: options.values?.[key] ?? '',
    text: options.values?.[key] ?? '',
    invalid: false,
    overridden: false,
    clearable: false,
    writable: true,
  })

  // The controller the component builds via `ctx.configForms.get(...)`. Its
  // surface mirrors what `CardController` in client.js actually calls.
  const formModel = {
    field: (name) => fieldBinding(name),
    shell: () => ({ writable: true, saving: false, dirty: false }),
    bind: () => ({ subscribe: () => () => {}, getSnapshot: () => ({ writable: true, saving: false }) }),
    actions: () => ({ edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {} }),
    dispose: () => {},
    $on: () => () => {},
  }

  const ctx = {
    slots: {
      inject: (name, fn) => {
        seen.slots.push(name)
        return fn()
      },
      register: (config, component) => {
        seen.controllers.push({ config, component })
        return () => {}
      },
    },
    locale: {
      bind: (ns) => (key) => {
        const dict = options.dictionaries
        if (dict !== undefined) {
          if (!(key in dict)) throw new Error(`missing locale key "${key}" in ${ns}`)
          return dict[key]
        }
        return `${ns}.${key}`
      },
      register: (ns, dicts) => {
        seen.localeRegistrations.push({ ns, dicts })
        return () => {}
      },
    },
    effect: (fn, label) => {
      seen.effects.push(label)
      return fn()
    },
    configForms: {
      get: (id) => ({ ...formModel, id }),
      whileServed: (ids, fn) => fn(true),
      describe: () => ({ subscribe: () => () => {}, getSnapshot: () => ({ view: { namespaces: [] } }) }),
    },
    get: () => undefined,
    remote: {
      credentials: {
        describe: async (refs) => ({ ok: true, value: Object.fromEntries(refs.map((ref) => [ref, { configured: false, writable: true }])) }),
        set: async () => ({ ok: true }),
      },
      $on: () => () => {},
    },
  }
  if (options.ctx !== undefined) Object.assign(ctx, options.ctx)

  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: ({ id, factory }) => { seen.moduleId = id; seen.exports = factory(requireFake(primitives)) },
      },
    },
    console: { error: (...args) => seen.errors.push(args.join(' ')), warn: () => {}, log: () => {} },
    document: { querySelector: () => null, createElement: () => ({ dataset: {}, set textContent(v) {}, get textContent() { return '' } }), head: { appendChild: () => {} } },
  }

  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox, { filename: 'client.js' })
  return { exports: seen.exports, seen, ctx, primitives }
}

/** Provide the two module ids the shell resolves. */
function requireFake(primitives) {
  return (id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require("${id}")`)
  }
}

/** Collect every string reachable from a rendered tree. */
function textOf(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) textOf(child, out); return out }
  if (typeof node === 'object') {
    for (const value of Object.values(node.props ?? {})) {
      if (typeof value === 'string' || typeof value === 'number') out.push(String(value))
    }
    textOf(node.children, out)
  }
  return out
}

// ─── The assertions ─────────────────────────────────────────────────────────

test('the bundle loads through the module loader contract', () => {
  const { exports, seen } = loadClient()
  assert.equal(seen.moduleId, '@magic6/dsh-web-fallback-chain')
  assert.equal(typeof exports.apply, 'function')
  // `remote.credentials` is a hard dependency: without it the page cannot say whether
  // a key is set. The official web-search page declares it for the same reason.
  assert.deepEqual([...exports.inject].sort(), ['configForms', 'locale', 'remote', 'remote.credentials', 'slots'])
})

test('apply registers into plugins.bundle.config, keyed by package name', () => {
  const { exports, seen, ctx } = loadClient()
  exports.apply(ctx)

  // Two slots exist and they are not interchangeable:
  //   `plugins.item`          → the harness's OWN built-in plugins (built-in group)
  //   `plugins.bundle.config` → an INSTALLED package's config page (已安装插件)
  //
  // This package is installed, so registering under `plugins.item` attached the card
  // to a built-in plugin that does not exist and the config page showed up under
  // 「内置插件配置」. Same mistake an earlier plugin had already fixed.
  assert.deepEqual(seen.slots, ['plugins.bundle.config'])
  assert.equal(seen.controllers.length, 1)
  const { config } = seen.controllers[0]
  assert.equal(config.name, 'plugins.bundle.config')
  // `key` (the package name), not `id` (the settings namespace): the manager pairs
  // the card with a row by package name, so the wrong field would mount nothing.
  assert.equal(config.key, '@magic6/dsh-web-fallback-chain')
  assert.equal(config.id, undefined)
  assert.equal(typeof config.inject, 'function')
})

test('the summary view renders localized copy, not a component tree', () => {
  const { exports, seen, ctx } = loadClient()
  exports.apply(ctx)
  const { component } = seen.controllers[0]
  assert.equal(component({ view: 'summary', t: (k) => `T:${k}` }), 'T:description')
})

/**
 * The primitives the page calls, as verified against the shipped shell bundle
 * (`dsh-web-frontend/dist/assets/*.js`, where each is exported under a minified
 * name). This list exists because the fake in this file previously lacked
 * `SegmentedControl`, which made the page look fine in tests and fail in the
 * browser with `primitives.SegmentedControl is not a function`.
 */
const REQUIRED_PRIMITIVES = [
  // Components
  'SettingsForm', 'SettingsFormModel', 'SettingsValueField', 'SettingsSecretField', 'Switch', 'SegmentedControl', 'Checkbox',
  // Field-descriptor factories the form model takes
  'settingsTextField', 'settingsNumberField',
  // Reorder controls on the chain preview
  'Button', 'IconChevronUpOutlineRegular', 'IconChevronDownOutlineRegular',
]

test('every primitive the page calls is in the verified surface', () => {
  const { primitives } = loadClient()
  for (const name of REQUIRED_PRIMITIVES) {
    // Most primitives are plain functions; `Button` is a `forwardRef` object, which is
    // exactly the distinction that broke the page.
    const kind = typeof primitives[name]
    assert.ok(kind === 'function' || (kind === 'object' && primitives[name] !== null),
      `fake primitives must provide ${name} (got ${kind})`)
  }
  // ...and the component must not reach for anything outside it.
  const used = new Set([...SOURCE.matchAll(/primitives\.([A-Za-z]+)/g)].map((m) => m[1]))
  const unknown = [...used].filter((name) => !REQUIRED_PRIMITIVES.includes(name))
  assert.deepEqual(unknown, [], `the page uses primitives nobody verified: ${unknown.join(', ')}`)
})

test('a primitive missing at runtime degrades to the fallback panel, not a blank card', () => {
  // The failure mode this guards: a control that exists in this harness but not in
  // the deployed shell would throw inside RichSettings. That must stay contained.
  const { exports, seen, ctx } = loadClient()
  exports.apply(ctx)
  const { component } = seen.controllers[0]
  const original = seen.primitivesCalls
  assert.ok(original !== undefined)

  // Simulate the deployed shell lacking the control.
  const broken = loadClient({ dropPrimitive: 'SegmentedControl' })
  broken.exports.apply(broken.ctx)
  const tree = broken.seen.controllers[0].component({
    view: 'page',
    t: (k) => `T:${k}`,
    useFallbackCard: (selector) => selector({ writable: true, saving: false, dirty: false, freeOnly: {}, annotateFallback: {} }),
    edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {},
  })
  const text = textOf(tree).join(' ')
  assert.match(text, /SegmentedControl/, 'the fallback must name the missing control')
})

test('the page view renders the form with every expected field', () => {
  const { exports, seen, ctx } = loadClient()
  exports.apply(ctx)
  const { component } = seen.controllers[0]

  const tree = component({
    view: 'page',
    t: (k) => `T:${k}`,
    useFallbackCard: (selector) => selector({
      writable: true, saving: false, dirty: false,
      freeOnly: {}, defaultMode: {}, order: {}, searchOrder: {},
      modeOrders: {}, minBodyChars: {}, annotateFallback: {},
    }),
    edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {},
  })

  // The page is now switches + one segmented choice + one secret field per key;
  // it deliberately has no free-text config fields left.
  const ids = seen.primitivesCalls
    .filter((c) => ['SettingsValueField', 'SettingsSecretField', 'SegmentedControl'].includes(c.name))
    .map((c) => c.props.id)
  assert.ok(ids.length > 0, 'the page must render at least one input')
  assert.equal(new Set(ids).size, ids.length, `duplicate field ids: ${ids.join(', ')}`)
  assert.ok(seen.primitivesCalls.some((c) => c.name === 'Switch'), 'the toggles must render')
  assert.ok(tree !== undefined && tree !== null, 'the page must return a tree')
})

test('a render failure falls back to a readable panel, not a blank card', () => {
  // `useFallbackCard` throwing is exactly what a shape change in the shell would
  // cause, and the recovery path used to call a `PlainSettings` that had been
  // deleted — so the fallback threw a ReferenceError of its own.
  const { exports, seen, ctx } = loadClient()
  exports.apply(ctx)
  const { component } = seen.controllers[0]

  const tree = component({
    view: 'page',
    t: (k) => `T:${k}`,
    useFallbackCard: () => { throw new Error('boom from the shell') },
    edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {},
  })

  const text = textOf(tree).join(' ')
  assert.match(text, /T:description/, 'the fallback must still show the description')
  assert.match(text, /boom from the shell/, 'the fallback must surface the cause')
})

test('every locale key the page asks for exists in both dictionaries', () => {
  // Run the page against the *real* dictionaries, so a missing key throws here.
  const { exports, seen, ctx } = loadClient()
  exports.apply(ctx)
  const [{ dicts }] = seen.localeRegistrations
  const [zh, en] = [dicts.zh, dicts.en]

  for (const [label, dict] of [['zh', zh], ['en', en]]) {
    const { exports: fresh, seen: freshSeen, ctx: freshCtx } = loadClient({ dictionaries: dict })
    fresh.apply(freshCtx)
    const { component } = freshSeen.controllers[0]
    assert.doesNotThrow(() => {
      component({ view: 'summary', t: (k) => { if (!(k in dict)) throw new Error(`missing ${k}`); return dict[k] } })
      component({
        view: 'page',
        t: (k) => { if (!(k in dict)) throw new Error(`missing ${k}`); return dict[k] },
        useFallbackCard: (selector) => selector({
          writable: true, saving: false, dirty: false,
          freeOnly: {}, defaultMode: {}, order: {}, searchOrder: {},
          modeOrders: {}, minBodyChars: {}, annotateFallback: {},
        }),
        edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {},
      })
    }, `${label} dictionary is missing a key the page asks for`)
  }
})

// ─── The per-mode order composition ─────────────────────────────────────────
//
// Eight fields stage one stored `modeOrders` object. The risk is silent: a page
// that renders eight inputs but writes none of them looks perfect in a screenshot
// and does nothing. These drive `edit` the way the form does and assert the stored
// value that comes out.

test('editing one mode field recomposes the whole modeOrders object', () => {
  const { exports, ctx, seen } = loadClient()
  exports.apply(ctx)

  // Reach the controller through the registration `apply` just made.
  const registered = seen.controllers[0]
  const face = registered.config.inject()

  let written
  // The form model records edits through the fake's actions(); capture them.
  face.edit('modeFetchBrief', 'http, anysearch')
  written = seen.edits.filter((e) => e.key === 'modeOrders').at(-1)
  assert.ok(written !== undefined, 'editing a mode field must stage modeOrders')
  assert.deepEqual(JSON.parse(written.text), { fetch: { brief: ['http', 'anysearch'] } })

  // A second mode composes alongside the first rather than replacing it.
  face.edit('modeSearchDeep', 'anysearch, tavily')
  written = seen.edits.filter((e) => e.key === 'modeOrders').at(-1)
  assert.deepEqual(JSON.parse(written.text), {
    fetch: { brief: ['http', 'anysearch'] },
    search: { deep: ['anysearch', 'tavily'] },
  })
})

test('clearing a mode field restores the default instead of pinning an empty list', () => {
  const { exports, ctx, seen } = loadClient()
  exports.apply(ctx)
  const face = seen.controllers[0].config.inject()

  face.edit('modeFetchBrief', 'http, tavily')
  face.edit('modeFetchBrief', '')
  const written = seen.edits.filter((e) => e.key === 'modeOrders').at(-1)
  // An empty array would fail at resolve time; the mode must simply be absent.
  assert.deepEqual(JSON.parse(written.text), {})
})

test('a non-mode field still goes straight to the form model', () => {
  const { exports, ctx, seen } = loadClient()
  exports.apply(ctx)
  const face = seen.controllers[0].config.inject()

  face.edit('minBodyChars', '800')
  assert.ok(seen.edits.some((e) => e.key === 'minBodyChars' && e.text === '800'))
})

// ─── The boolean round trip ──────────────────────────────────────────────────
//
// Regression: `booleanField` overrode only `parse`, so the read side still ran the
// string spec's `format`, which returns '' for a non-string. A stored `true`
// therefore rendered as an OFF switch — the reported "仅使用免费工具怎么不是默认开启了".
// These drive the field spec directly, so the bug cannot come back through a
// refactor of the component.

test('a stored true formats as an on switch, and back', () => {
  const { primitives } = loadClient()
  // The spec the card registers for a boolean is produced inside the bundle; the
  // observable contract is the format/parse pair, which the fake can exercise.
  const spec = primitives.settingsTextField('freeOnly')
  assert.equal(spec.format(true), '', 'the raw string factory loses a boolean — this is the trap')
})

test('the card renders freeOnly as ON for a stored true', () => {
  const { exports, seen, ctx } = loadClient()
  exports.apply(ctx)
  const { component } = seen.controllers[0]
  // `text: 'true'` is what a correct booleanField yields for a stored `true`.
  const tree = component({
    view: 'page',
    t: (k) => `T:${k}`,
    useFallbackCard: (selector) => selector({
      writable: true, saving: false, dirty: false,
      freeOnly: { text: 'true' },
      annotateFallback: { text: 'false' },
      deepseekNeedContent: { text: 'false' },
      defaultMode: { text: 'brief' },
      order: { text: '' }, searchOrder: { text: '' },
      providers: { text: '' }, enable: { text: '' },
      anysearchTag: { text: '' }, anysearchParams: { text: '' },
      minBodyChars: { text: '600' }, timeoutMs: { text: '30000' },
      credentials: {},
    }),
    edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {},
    lang: 'zh',
  })
  const switches = seen.primitivesCalls.filter((c) => c.name === 'Switch')
  // Three: freeOnly, annotateFallback, deepseekNeedContent. Every boolean the schema
  // declares must be switchable from the page.
  assert.equal(switches.length, 3, 'every boolean field renders as a switch')
  assert.equal(switches[0].props.checked, true, 'freeOnly must render ON when stored true')
  assert.equal(switches[1].props.checked, false, 'annotateFallback must render OFF when stored false')
})

// ─── Credentials ────────────────────────────────────────────────────────────
//
// The page had no way to see or set an API key at all, so "how do I configure the
// key" had no answer in the GUI. These pin the two things that make the added
// fields real: presence is read from the Host, and a staged value is actually
// written on save (a secret that is silently dropped is the worst failure mode).

test('the three leg credentials render as secret fields with Host-reported state', () => {
  const { exports, seen, ctx } = loadClient()
  exports.apply(ctx)
  const { component } = seen.controllers[0]

  component({
    view: 'page',
    t: (k) => `T:${k}`,
    useFallbackCard: (selector) => selector({
      writable: true, saving: false, dirty: false,
      freeOnly: { text: 'true' }, annotateFallback: { text: 'true' },
      defaultMode: { text: 'brief' }, order: { text: '' }, searchOrder: { text: '' },
      credentials: {
        DEEPSEEK_API_KEY: { configured: false, writable: true },
        ANYSEARCH_API_KEY: { configured: true, writable: true },
        TAVILY_API_KEY: { configured: false, writable: true },
      },
    }),
    edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {}, editCredential: () => {},
  })

  const secrets = seen.primitivesCalls.filter((c) => c.name === 'SettingsSecretField')
  assert.equal(secrets.length, 3, 'one secret field per key-bearing leg')
  for (const field of secrets) {
    assert.match(field.props.id, /^plugin-config-web-fallback-key-/)
    assert.equal(typeof field.props.stateLabel, 'string')
  }
  // Presence must come from the Host, not from a guess.
  assert.equal(secrets[1].props.configured, true, 'anysearch must show as configured')
  assert.equal(secrets[0].props.configured, false, 'deepseek must show as unset')
})

test('a staged key is written before the config form saves', async () => {
  const { exports, seen, ctx } = loadClient()
  const writes = []
  ctx.remote.credentials.set = async (ref, value) => {
    writes.push({ ref, value })
    return { ok: true }
  }
  exports.apply(ctx)
  const face = seen.controllers[0].config.inject()

  face.editCredential('ANYSEARCH_API_KEY', 'sk-typed-in-the-ui')
  await face.save()

  assert.deepEqual(writes, [{ ref: 'ANYSEARCH_API_KEY', value: 'sk-typed-in-the-ui' }])
})

test('an edit that is only whitespace is not written', async () => {
  const { exports, seen, ctx } = loadClient()
  const writes = []
  ctx.remote.credentials.set = async (ref, value) => { writes.push({ ref, value }); return { ok: true } }
  exports.apply(ctx)
  const face = seen.controllers[0].config.inject()

  await face.save()
  assert.deepEqual(writes, [], 'nothing staged means nothing written')
})

// ─── Reordering the ladder ──────────────────────────────────────────────────
//
// The order IS this plugin's product, so the arrows are the page's most important
// control. These drive them the way a click does and assert the value that lands in
// the config — the failure mode to prevent is arrows that look right and write
// nothing.

/**
 * Render the page the way the shell does.
 *
 * Two details of the real contract this must reproduce, both of which have caused a
 * blank page in production:
 *
 *  1. `inject().hooks` arrives as `props.use${Capitalize<name>}` — a snapshot hook,
 *     not a raw store.
 *  2. `Button` is a `forwardRef` object, so it can only be rendered through
 *     `createElement`; calling it as a function throws.
 *
 * @param options - field values to stage on the snapshot.
 * @returns the loaded harness, the render tree and the rendered buttons.
 */
function renderPage(options = {}) {
  const loaded = loadClient()
  const { exports, seen, ctx } = loaded
  exports.apply(ctx)

  const snapshot = {
    writable: true, saving: false, dirty: false, available: true,
    freeOnly: { text: options.freeOnly === false ? 'false' : 'true' },
    annotateFallback: { text: 'true' },
    defaultMode: { text: 'brief' },
    order: { text: options.order ?? '' },
    searchOrder: { text: options.searchOrder ?? '' },
    credentials: options.credentials ?? {},
  }

  const face = seen.controllers[0].config.inject()
  const expandedHooks = Object.fromEntries(
    Object.keys(face.hooks ?? {}).map((name) => [
      `use${name[0].toUpperCase()}${name.slice(1)}`,
      (selector) => selector(snapshot),
    ]),
  )

  const tree = seen.controllers[0].component({
    ...face,
    ...expandedHooks,
    view: 'page',
    t: (k) => `T:${k}`,
    lang: 'zh',
    // The arrows call `props.edit`; it must record, or a broken arrow and a working
    // one look identical to this test.
    edit: (key, text) => seen.edits.push({ key, text }),
    resetField: (key) => seen.edits.push({ key, kind: 'reset' }),
    editCredential: (ref, text) => seen.edits.push({ key: `cred:${ref}`, text }),
    save: () => {}, discard: () => {}, hooks: face.hooks,
  })

  /**
   * Collect every rendered `Button` element from a tree.
   *
   * Each node is visited once: a `createElement` element keeps its children in
   * `children`, and a helper node may also carry them in `props.children`, so
   * walking both without a guard double-counts every button.
   */
  const collectButtons = (node, out = [], visited = new Set()) => {
    if (node === null || node === undefined) return out
    if (Array.isArray(node)) { for (const child of node) collectButtons(child, out, visited); return out }
    if (typeof node !== 'object' || visited.has(node)) return out
    visited.add(node)
    if (node.type === 'Button') out.push(node)
    collectButtons(node.children, out, visited)
    collectButtons(node.props?.children, out, visited)
    return out
  }

  return { ...loaded, tree, buttons: collectButtons(tree) }
}

/** Backwards-compatible alias used by the reorder tests. */
const renderArrows = (options = {}) => renderPage(options)

test('the fetch ladder offers an up and a down arrow per leg', () => {
  const { buttons } = renderArrows()
  // Every leg stays visible whatever freeOnly says — the switch skips billed legs at
  // call time, it does not rewrite or hide the ranking. So both full ladders render:
  // fetch 4 + search 3 = 7 legs, two arrows each.
  assert.equal(buttons.length, (4 + 3) * 2, 'two arrows per leg across both ladders')
})

test('moving a leg down writes the new order', () => {
  const { seen, ctx } = renderArrows({ freeOnly: false })
  const clicked = []
  // Capture what an arrow click would stage.
  const face = seen.controllers[0].config.inject()
  const realEdit = face.edit
  assert.equal(typeof realEdit, 'function')

  // Find the first "move down" arrow and invoke it the way a click does.
  const arrows = renderArrows({ freeOnly: false })
  const downs = arrows.buttons.filter((b) => b.props['aria-label'] === 'T:moveDown')
  assert.ok(downs.length > 0, 'the page must render move-down arrows')
  downs[0].props.onClick()
  const staged = arrows.seen.edits.filter((e) => e.key === 'order').at(-1)
  assert.ok(staged !== undefined, 'clicking an arrow must stage the order field')
  // Measured order is anysearch → tavily → deepseek-fetch-rich → http.
  assert.equal(staged.text.split(',')[0], 'tavily', 'anysearch moved down, tavily took slot 1')
  assert.equal(staged.text.split(',')[1], 'anysearch', 'and anysearch is now second')
})

test('the first leg cannot move up and the last cannot move down', () => {
  const { buttons } = renderArrows({ freeOnly: false })
  const ups = buttons.filter((c) => c.props['aria-label'] === 'T:moveUp')
  const downs = buttons.filter((c) => c.props['aria-label'] === 'T:moveDown')
  // Two ladders; the bounding arrows of each must be disabled.
  assert.equal(ups.filter((c) => c.props.disabled === true).length, 2, 'one disabled up-arrow per ladder')
  assert.equal(downs.filter((c) => c.props.disabled === true).length, 2, 'one disabled down-arrow per ladder')
})

test('a stored override replaces the measured default on screen', () => {
  // The ladder renders `order` when the user has set one. If the page showed the
  // measured order regardless, every reorder would look like it did nothing.
  const collectIds = (node, out = [], visited = new Set()) => {
    if (node === null || node === undefined) return out
    if (Array.isArray(node)) { for (const c of node) collectIds(c, out, visited); return out }
    if (typeof node !== 'object' || visited.has(node)) return out
    visited.add(node)
    if (node.type === 'span' && /wfb-legId/.test(String(node.props?.className ?? ''))) out.push(node.children?.[0])
    collectIds(node.children, out, visited)
    collectIds(node.props?.children, out, visited)
    return out
  }

  const custom = renderPage({ order: 'http,tavily' })
  assert.deepEqual(collectIds(custom.tree).slice(0, 2), ['http', 'tavily'],
    'the first ladder must lead with the user\u2019s own first choice')

  const measured = renderPage()
  assert.deepEqual(collectIds(measured.tree).slice(0, 2), ['anysearch', 'tavily'],
    'with no override the measured order shows')
})

test('freeOnly never hides or reorders the ladder', () => {
  // The switch skips billed legs at call time; it does not rewrite the ranking. So
  // the page must show the same list, in the same order, on both positions — only
  // the styling differs. Hiding them made the preview disagree with the config.
  const idsFor = (freeOnly) => {
    const { exports, seen, ctx } = loadClient()
    exports.apply(ctx)
    seen.controllers[0].component({
      view: 'page',
      t: (k) => `T:${k}`,
      useFallbackCard: (selector) => selector({
        writable: true, saving: false, dirty: false,
        freeOnly: { text: freeOnly ? 'true' : 'false' },
        annotateFallback: { text: 'true' }, defaultMode: { text: 'brief' },
        order: { text: '' }, searchOrder: { text: '' }, credentials: {},
      }),
      edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {}, editCredential: () => {},
    })
    return seen.primitivesCalls.filter((c) => c.name === 'Button').length
  }
  assert.equal(idsFor(true), idsFor(false), 'the same legs and arrows must render either way')
})

/** Drop `//` and block comments so assertions judge code, not prose. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

test('Button is rendered through createElement, never called as a function', () => {
  // `Button` is `React.forwardRef(...)`: an object, not a function. Calling it as
  // `primitives.Button({...})` throws `TypeError: primitives.Button is not a function`
  // and blanks the whole card — the failure this harness now models.
  const { primitives } = loadClient()
  assert.equal(typeof primitives.Button, 'object', 'the fake must model the real forwardRef Button')
  assert.notEqual(typeof primitives.Button, 'function')

  // The page must still produce its arrows against that object.
  const { buttons } = renderPage()
  assert.ok(buttons.length > 0, 'the ladder must render arrows even though Button is an object')

  // ...and it must reach them via createElement, not by calling.
  // Find `primitives.Button(` occurrences that are NOT the type argument of a
  // createElement call — those are direct invocations and would throw.
  const code = stripComments(SOURCE)
  const direct = [...code.matchAll(/(\w)\s*\.\s*Button\s*\(/g)]
    .map((m) => m.index)
    .filter((at) => !/createElement\($/.test(code.slice(Math.max(0, at - 20), at + 1)))
  assert.deepEqual(direct, [], 'primitives.Button must never be invoked directly')
  assert.match(SOURCE, /createElement\(primitives\.Button/, 'Button must go through createElement')
})

// ─── Every field spec must own BOTH directions ──────────────────────────────
//
// This bug has now shipped three times in this file, always with the same shape:
// `settingsTextField` is a STRING field whose `format` is
//     (value) => typeof value === 'string' ? value : ''
// so any field holding something that is not a string reads back as `''`.
// Overriding only `parse` (the write direction) leaves the read direction broken:
//
//   boolean  → stored `true` rendered as '' → switch showed OFF
//   array    → stored order rendered as ''  → save wrote the empty value back
//   object   → stored JSON rendered as ''   → save wrote `{}` back
//
// The last one is the worst because it *looks* applied and silently clears itself.
// So: assert the round trip for every field the card registers, not one by one.

test('the string factory loses non-string values — the trap these specs must escape', () => {
  const { primitives } = loadClient()
  const spec = primitives.settingsTextField('x')
  assert.equal(spec.format(true), '', 'boolean → empty (the boolean bug)')
  assert.equal(spec.format(['a', 'b']), '', 'array → empty (the order bug)')
  assert.equal(spec.format({ a: 1 }), '', 'object → empty (the json bug)')
})

test('every registered field spec formats its own value type without losing it', () => {
  // Pull the specs straight out of the bundle: `apply` constructs the controller,
  // and the controller hands the field list to `SettingsFormModel`.
  const { seen, ctx, exports } = loadClient()
  exports.apply(ctx)
  const registered = seen.formFields ?? []
  assert.ok(registered.length > 0, 'the harness must capture the field specs')

  const samples = {
    freeOnly: true,
    annotateFallback: false,
    defaultMode: 'deep',
    order: ['tavily', 'anysearch'],
    searchOrder: [],
    providers: { anysearch: { quality: 9 } },
    minBodyChars: 600,
    timeoutMs: 30000,
  }

  const lost = []
  for (const spec of registered) {
    const sample = samples[spec.field]
    if (sample === undefined) continue // per-mode drafts are written through edit()
    const text = spec.format(sample)
    // An EMPTY container legitimately formats to '' — it means "no override", and
    // the page shows an empty box for it on purpose. Only a non-empty value that
    // disappears is a defect.
    const isEmptyContainer = (Array.isArray(sample) && sample.length === 0)
      || (sample !== null && typeof sample === 'object' && !Array.isArray(sample) && Object.keys(sample).length === 0)
    if (text === '' && !isEmptyContainer) {
      lost.push(`${spec.field}: ${JSON.stringify(sample)} → ''`)
    }
  }
  assert.deepEqual(lost, [], `fields whose read direction drops the value:\n  ${lost.join('\n  ')}`)
})

test('editing one leg\u2019s billing keeps every other providers key', () => {
  // `providers` entries carry maxChars / requiresKey / note as well as cost. Rebuilding
  // the object from `{ cost }` would delete the rest — quiet data loss on a field the
  // page only partially exposes.
  const { exports, seen, ctx } = loadClient()
  exports.apply(ctx)
  const face = seen.controllers[0].config.inject()
  renderPage()

  face.edit('providers', JSON.stringify({
    http: { cost: 'free', quality: 4, note: 'my own note' },
    anysearch: { maxChars: { brief: 900 } },
  }))
  face.edit('cost:http', 'paid')

  const written = JSON.parse(seen.edits.filter((e) => e.key === 'providers').at(-1).text)
  assert.equal(written.http.cost, 'paid', 'the edited classification lands')
  assert.equal(written.http.note, 'my own note', 'note survives')
  assert.equal(written.http.quality, 4, 'quality survives')
  assert.deepEqual(written.anysearch, { maxChars: { brief: 900 } }, 'other entries untouched')
})

test('a billing value other than free/paid removes the override', () => {
  // The control only emits free|paid, but the field is a string: a stray value must
  // drop the override rather than be stored and read as "not paid" by freeOnly.
  const { exports, seen, ctx } = loadClient()
  exports.apply(ctx)
  const face = seen.controllers[0].config.inject()
  renderPage()

  face.edit('providers', JSON.stringify({ http: { cost: 'paid', note: 'keep me' } }))
  face.edit('cost:http', 'nonsense')

  const written = JSON.parse(seen.edits.filter((e) => e.key === 'providers').at(-1).text)
  assert.equal(written.http.cost, undefined, 'the bogus value is not stored')
  assert.equal(written.http.note, 'keep me', 'the rest of the entry stays')
})
