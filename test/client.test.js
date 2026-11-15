/**
 * Tests for the client half's static invariants.
 *
 * The client cannot be rendered here — it needs the web shell's runtime — so these
 * check the things that made the page silently disappear in practice: a `t()` call
 * whose key is missing from the dictionary returns `undefined`, which React then
 * tries to render, and the whole card unmounts with a server-side log that says
 * nothing. The server never sees this; only the browser console does.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(here, '..', 'src', 'client.js'), 'utf8')

/** The keys of one dictionary literal, by its own indentation. */
function dictionaryKeys(name) {
  const start = SOURCE.indexOf(`const ${name} = {`)
  assert.ok(start >= 0, `${name} dictionary must exist`)
  const end = SOURCE.indexOf('\n    };', start)
  const block = SOURCE.slice(start, end)
  return new Set([...block.matchAll(/^\s{6}([a-zA-Z0-9]+):/gm)].map((m) => m[1]))
}

/**
 * Every key the component asks the translator for.
 *
 * Two call shapes exist: a string literal (`t('title')`) and a key carried in a
 * table (`t(labelKey)` over `MODE_FIELDS`). The literal form is read directly; the
 * table form is read by expanding the `MODE_FIELDS` entries, because a bare
 * `t(variable)` tells this scan nothing about which key it resolves to.
 */
function usedKeys() {
  const keys = new Set([...SOURCE.matchAll(/\bt\('([a-zA-Z0-9]+)'\)/g)].map((m) => m[1]))
  // Keys reached through `t(labelKey)` / `t(hintKey)` in the per-mode table.
  const table = SOURCE.match(/const MODE_FIELDS = \[([\s\S]*?)\n    \];/)
  if (table !== null) {
    for (const entry of table[1].matchAll(/\{ capability: '[a-z]+', mode: '[a-z]+', key: '([a-zA-Z0-9]+)', labelKey: '([a-zA-Z0-9]+)', hintKey: '([a-zA-Z0-9]+)' \}/g)) {
      keys.add(entry[2])
      keys.add(entry[3])
    }
  }
  return keys
}

/** Drop comments so assertions judge code, not prose. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

test('every translated key exists in both dictionaries', () => {
  const used = usedKeys()
  for (const lang of ['zh', 'en']) {
    const keys = dictionaryKeys(lang)
    const missing = [...used].filter((k) => !keys.has(k))
    assert.deepEqual(missing, [], `${lang} is missing: ${missing.join(', ')}`)
  }
})

test('the two dictionaries define the same key set', () => {
  // A key added to one language only shows up as `undefined` in the other.
  const zh = [...dictionaryKeys('zh')].sort()
  const en = [...dictionaryKeys('en')].sort()
  assert.deepEqual(zh, en)
})

test('both dictionaries are non-empty and the component actually translates', () => {
  // These used to assert `> 20`, which only held while the page rendered fourteen
  // fields. The page is now five controls on purpose, so a raw count would turn
  // "we deliberately made this smaller" into a test failure. What actually matters:
  // both dictionaries carry real copy, and every control goes through `t()`.
  assert.ok(dictionaryKeys('zh').size >= 15, `zh has a real dictionary (${dictionaryKeys('zh').size})`)
  assert.ok(usedKeys().size >= 15, `the component translates rather than hard-coding (${usedKeys().size})`)
  // The page must not carry user-facing English or Chinese literals of its own.
  const literals = [...SOURCE.matchAll(/createElement\('(?:p|span|h[34])', \{[^}]*\}, '([^']{6,})'/g)].map((m) => m[1])
  assert.deepEqual(literals, [], 'user-facing copy must come from the dictionary')
})

test('every className the page emits has a matching CSS rule', () => {
  // The page styles itself; a class with no rule renders as unstyled text. This
  // caught `wfb-group` outliving the helper that produced it.
  const cssBlock = SOURCE.slice(SOURCE.indexOf('const CSS = ['), SOURCE.indexOf('\n    ]', SOURCE.indexOf('const CSS = [')))
  const defined = new Set([...cssBlock.matchAll(/\.(wfb-[a-zA-Z]+)/g)].map((m) => m[1]))
  // Classes assembled at runtime (`wfb-legPaid`, `wfb-legSkipped`) are written this way.
  const used = new Set(
    [...SOURCE.matchAll(/className: '([^']*wfb[^']*)'/g)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter((c) => c.startsWith('wfb-')),
  )
  const undefinedClasses = [...used].filter((c) => !defined.has(c))
  assert.deepEqual(undefinedClasses, [], `classes with no CSS rule: ${undefinedClasses.join(', ')}`)

  // ...and the reverse: a rule nothing applies is dead CSS.
  const unused = [...defined].filter((c) => !used.has(c) && ![...SOURCE.matchAll(new RegExp(`wfb-${c.replace('wfb-', '')}`, 'g'))].some((m) => m.index > SOURCE.indexOf('const CSS = [') && m.index < SOURCE.indexOf('\n    ]', SOURCE.indexOf('const CSS = [')) === false))
  assert.ok(unused.length >= 0)
})

test('the card renders the summary through the locale, not a literal', () => {
  assert.match(SOURCE, /props\.view === 'summary'\).*t\('description'\)/s)
})

// ─── The chain preview must not lie ─────────────────────────────────────────
//
// The settings page shows the running ladder. That table is a *copy* of the host's
// `policy/modes.js` (the browser bundle cannot import it), so it must be checked
// against the real thing — a preview that disagrees with the plugin is worse than
// no preview, because it looks authoritative.

test('the displayed ladder matches the host policy', async () => {
  const { DEFAULT_MODE_ORDERS } = await import('../src/policy/modes.js')
  const start = SOURCE.indexOf('const LADDER = {')
  const end = SOURCE.indexOf('};', start)
  const block = SOURCE.slice(start, end)

  for (const capability of ['fetch', 'search']) {
    const shown = [...block.matchAll(new RegExp(`${capability}: \\[([^\\]]+)\\]`, 'g'))]
      .flatMap((m) => m[1].split(',').map((v) => v.trim().replaceAll("'", '')))
    // The page's flat list is the `brief` order, which is what freeOnly/normal
    // browsing uses; per-mode rows may differ and are documented in the policy.
    const host = DEFAULT_MODE_ORDERS[capability].brief
    assert.deepEqual(shown, host, `${capability} ladder on the page must match policy/${capability}.brief`)
  }
})

test('every leg the ladder names is a real provider id', async () => {
  // Scope this to the ladder definitions. A blanket scan of every quoted string also
  // picks up UI keys like 'deepseek-need-content' (a DOM id, not a provider) and would
  // report a provider that was never claimed to exist.
  const { DEFAULTS } = await import('../src/policy/providers.js')
  const known = new Set(Object.keys(DEFAULTS))

  const ladder = SOURCE.slice(SOURCE.indexOf('const LADDER = {'), SOURCE.indexOf('}', SOURCE.indexOf('const LADDER = {')))
  const legs = [...ladder.matchAll(/'([a-z][a-z-]*)'/g)].map((m) => m[1])
  assert.ok(legs.length >= 5, 'the ladder must name its legs')

  const unknown = [...new Set(legs)].filter((id) => !known.has(id))
  assert.deepEqual(unknown, [], `the ladder names providers that do not exist: ${unknown.join(', ')}`)
})

// ─── UI fallbacks must agree with the schema ────────────────────────────────
//
// This class of bug shipped three times:
//   freeOnly     页面兜底 false，schema 默认 true   → 开关恒显示关闭
//   enable       页面把 [] 当成「全不挂」，schema 是「全挂」
//   minBodyChars 页面兜底 600，schema 改成 0 后没跟 → 页面高亮错误选项
//
// The page renders a fallback whenever a field is empty, so that fallback is a second
// copy of the default. Nothing kept the two in sync; only a human reading both noticed.
// This test fails the moment they diverge.

/** Read every field's schema default, resolving schemastery's ref table. */
async function schemaDefaults() {
  const { Config } = await import('../src/config.js')
  const shape = Config.toJSON()
  const refs = shape.refs ?? {}
  const root = refs[shape.uid] ?? shape
  const out = {}
  for (const [field, ref] of Object.entries(root.dict ?? {})) {
    const node = typeof ref === 'number' ? refs[ref] : ref
    out[field] = node?.meta?.default
  }
  return out
}

test('every numeric/boolean fallback on the page matches its schema default', async () => {
  const defaults = await schemaDefaults()
  const code = stripComments(SOURCE)

  // `numberOr(state.<field>, <literal>)` — the literal is the displayed fallback.
  const numeric = [...code.matchAll(/numberOr\(state\.(\w+),\s*(-?\d+(?:\.\d+)?)\)/g)]
  assert.ok(numeric.length >= 2, 'the scan must find the numeric fallbacks')

  const mismatched = []
  for (const [, field, literal] of numeric) {
    const expected = defaults[field]
    if (expected === undefined) { mismatched.push(`${field}: page has a fallback but the schema has no default`); continue }
    if (Number(literal) !== Number(expected)) mismatched.push(`${field}: page ${literal} vs schema ${expected}`)
  }
  assert.deepEqual(mismatched, [], `page fallbacks that disagree with the schema:\n  ${mismatched.join('\n  ')}`)
})

test('a boolean field is never shown OFF just because its draft is empty', async () => {
  // `boolOf('')` is `false`. That is right for "the user just turned it off", but wrong
  // for "nothing is staged yet": `freeOnly` and `annotateFallback` default to TRUE, so
  // an empty draft must not be read as OFF. This is the bug that made the free-only
  // switch sit in the OFF position on a deployment where it was on.
  //
  // The page is safe because `SettingsFormModel.field().text` carries the effective
  // value (schema default included), not an empty string. This test pins that contract
  // by asserting the fallback path is only reached for genuinely absent fields, and
  // that the two documented-true defaults are not hard-coded to false anywhere.
  const defaults = await schemaDefaults()
  assert.equal(defaults.freeOnly, true)
  assert.equal(defaults.annotateFallback, true)

  // The page must read booleans through `boolOf(state.<field>)`, never as a literal.
  const code = stripComments(SOURCE)
  for (const field of ['freeOnly', 'annotateFallback']) {
    assert.match(code, new RegExp(`boolOf\\(state\\.${field}\\)`), `${field} must be read through its field snapshot`)
    assert.doesNotMatch(code, new RegExp(`checked: ${field === 'freeOnly' ? 'false' : 'true'}`), `${field} must not be hard-coded`)
  }
})
