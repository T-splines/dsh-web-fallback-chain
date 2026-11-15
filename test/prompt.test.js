/**
 * Tests for the routing prompt section.
 *
 * The section is the only part of this plugin that tries to change agent
 * *behaviour* rather than tool output, and it does so by writing into every
 * request's system prompt — a place where a bug is expensive and silent. So the
 * assertions here are about the things that can go wrong quietly:
 *
 * - the section must be **absent** when there is no `web_search` to route to,
 * - it must not throw when the prompt service or tool registry is missing,
 * - its placement must follow the deployment's own section table,
 * - and the text must keep the 用法/调试 discriminator that justifies it existing.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { PROMPT_SECTION, PROMPT_TEXT, applyPromptSection } from '../src/prompt.js'

/** A minimal stand-in for the system-prompt service. */
function fakePrompt({ order = 2100 } = {}) {
  const sections = []
  return {
    sections,
    section(entry) {
      sections.push(entry)
      return () => {}
    },
    getSectionOrder(name) {
      return name === 'TOOL_WEB_FETCH' ? order : undefined
    },
  }
}

/** A tool registry holding the given ids. */
function fakeTools(ids) {
  return { get: (id) => (ids.includes(id) ? { name: id } : undefined) }
}

/**
 * A context that behaves like cordis's proxy for the one property that matters:
 * reading an undeclared service is a **throw**, not `undefined`. Modelling that is
 * what makes the regression test below meaningful.
 */
function fakeCtx({ prompt, tools } = {}) {
  const services = {}
  if (prompt !== undefined) services.systemPrompt = prompt
  if (tools !== undefined) services.tools = tools
  return {
    get(name) {
      return services[name]
    },
    get systemPrompt() {
      if (!('systemPrompt' in services)) {
        throw new Error('cannot get property "systemPrompt" without inject')
      }
      return services.systemPrompt
    },
  }
}

test('registers one section, right after the fetch section', () => {
  const prompt = fakePrompt({ order: 2100 })
  applyPromptSection(fakeCtx({ prompt, tools: fakeTools(['web_search', 'web_fetch']) }))

  assert.equal(prompt.sections.length, 1)
  assert.equal(prompt.sections[0].name, PROMPT_SECTION)
  assert.equal(prompt.sections[0].order, 2101)
})

test('the text is empty when web_search is not registered in this scope', () => {
  const prompt = fakePrompt()
  applyPromptSection(fakeCtx({ prompt, tools: fakeTools(['web_fetch']) }))
  assert.equal(prompt.sections[0].text({ scope: 's' }), '')
})

test('the text renders when web_search is available', () => {
  const prompt = fakePrompt()
  applyPromptSection(fakeCtx({ prompt, tools: fakeTools(['web_search']) }))
  assert.equal(prompt.sections[0].text({ scope: 's' }), PROMPT_TEXT)
})

/**
 * Regression: reading `ctx.systemPrompt` directly made cordis throw
 * `cannot get property "systemPrompt" without inject` *inside* `apply()`, which
 * took both chains down. The observed symptom was
 * `configured web provider "fetch-chain" is not registered`.
 *
 * The fake context throws on direct property access for exactly this reason, so a
 * revert to `ctx.systemPrompt` fails here instead of in production.
 */
test('an absent systemPrompt service is read via ctx.get and never throws', () => {
  const ctx = fakeCtx({ tools: fakeTools(['web_search']) })
  assert.throws(() => ctx.systemPrompt, /without inject/)
  assert.doesNotThrow(() => applyPromptSection(ctx))
})

test('a missing context or missing get() is not fatal', () => {
  assert.doesNotThrow(() => applyPromptSection({}))
  assert.doesNotThrow(() => applyPromptSection(undefined))
})

test('a missing tool registry still yields the text rather than crashing', () => {
  const prompt = fakePrompt()
  applyPromptSection(fakeCtx({ prompt }))
  assert.equal(prompt.sections[0].text({ scope: 's' }), PROMPT_TEXT)
})

test('falls back to a fixed order when the deployment names no section table', () => {
  const prompt = { section(entry) { this.entry = entry }, sections: [] }
  applyPromptSection(fakeCtx({ prompt, tools: fakeTools(['web_search']) }))
  assert.equal(prompt.entry.order, 2100)
})

test('the text keeps the usage/debug discriminator and the two-attempt limit', () => {
  // These three ideas are the whole reason the section exists; a rewrite that
  // drops one silently turns it back into an unactionable "search more" note.
  assert.match(PROMPT_TEXT, /Usage questions/)
  assert.match(PROMPT_TEXT, /Debugging questions/)
  assert.match(PROMPT_TEXT, /two failed attempts/)
  assert.match(PROMPT_TEXT, /web_search/)
})
