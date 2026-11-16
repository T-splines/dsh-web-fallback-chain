# dsh-web-fallback-chain

**English** | [简体中文](https://github.com/T-splines/dsh-web-fallback-chain/blob/main/README.zh-CN.md)

**One ranked, cost-aware chain for web search and fetch in DeepSeek Harness — measured quality, free-only mode, and a single settings page.**

DSH's `ctx.web` selects exactly **one** provider per capability, and its config is a pinned
provider id rather than a priority list. "Best first, something free when the best fails"
cannot be expressed in a profile. This plugin registers one provider per capability whose
internal order *is* that list — and ships the individual legs so you can pin any of them
directly.

- [Why this exists](#why-this-exists)
- [What makes it different](#what-makes-it-different)
- [What it registers](#what-it-registers)
- [Install](#install)
- [Ranking](#ranking)
- [The free-only switch](#the-free-only-switch)
- [Settings page](#settings-page)
- [Configuration](#configuration)
- [Why one package and not four](#why-one-package-and-not-four)
- [Tests](#tests)
- [Compatibility](#compatibility)

## Why this exists

A DSH profile can say *which* web provider to use, but not *in what order to try several*.
When the primary search or fetch fails, the request fails; there is no "try the free leg
next" seam. Rebuilding that seam in every deployment means four packages, four settings
pages, and a lockstep upgrade problem.

This plugin puts the ordered chain back into the provider slot:

```
web_search ──▶ search-chain ──▶ deepseek-search-rich ──▶ anysearch ──▶ tavily
web_fetch  ──▶ fetch-chain  ──▶ anysearch ──▶ tavily ──▶ deepseek-fetch-rich ──▶ http*
```

`http*` is an optional plain-HTTP leg supplied by the deployment (for example a separate
web-fetch plugin); this package does not register it. The first **available** leg serves
each request; the rest are attempted only when it fails or returns too little. The order is
a quality ranking, not a cost ranking. With the default `freeOnly: true`, paid legs are
skipped at call time, so the first available leg is the first *free* one.

## What makes it different

- **Measured, not guessed.** Defaults come from this plugin's own benchmark: blind-scored
  fetches on 15 pages, blind-scored search relevance on 10 queries, and 20-site availability
  runs. The numbers are a starting point you can reorder, not a promise about any page.
- **Free-only actually skips paid legs.** `freeOnly` is checked at call time. Turning it off
  restores the *same* order instead of maintaining a second list.
- **One package, one settings page.** Reorder legs with ▲▼, toggle free-only, annotate which
  leg served a fallback, and switch read mode. No second config to keep in sync.
- **Honest fallback.** The chain returns lossless JSON, can write the serving leg into the
  output, and does not treat a short page as a failure unless you opt in
  (`minBodyChars` defaults to 0).
- **Provider-specific value.** DeepSeek search maps the `summary` field (600–800 chars), not
  just a snippet; AnySearch is the leg that got through bot walls in testing; Tavily is the
  free leg that extracts PDFs.
- **Tested where it matters.** 162 `node --test` cases, including the real settings client
  rendered through `vm` with a fake module loader, and round-trip tests for every
  registered settings field.

## What it registers

| id | capability | what it is |
|:--|:--|:--|
| `search-chain` | search | the ordered search chain (pin `searchProvider` to this) |
| `fetch-chain` | fetch | the ordered fetch chain (pin `fetchProvider` to this) |
| `deepseek-search-rich` | search | DeepSeek search, mapping `summary` (600–800 chars) not just `snippet` |
| `deepseek-fetch-rich` | fetch | DeepSeek fetch |
| `anysearch` | search + fetch | AnySearch; the only leg that got through bot walls in testing |
| `tavily` | search + fetch | Tavily; the only free leg here that extracts PDFs |

`http` is intentionally **not** in this table: it is a deployment-supplied leg, not part of
this package. The chains can name it, and a fetch that falls through to it will use it when
another plugin registers that id.

## Install

Requirements: DSH `0.2.2-rc.x`, Node.js 20+, and **at least one** of
`DEEPSEEK_API_KEY`, `ANYSEARCH_API_KEY`, `TAVILY_API_KEY`. A leg without its key is still
registered but reports itself unavailable, so a chain with no keys has nothing to call.
An optional plain-HTTP leg (`http`) can be supplied by a separate web-fetch plugin.

### From npm

```bash
dsh plugin --profile web add dsh-web-fallback-chain
```

### From source

```bash
git clone https://github.com/T-splines/dsh-web-fallback-chain.git
cd dsh-web-fallback-chain
dsh plugin --profile web add "$PWD"
```

The package is a bundle (`dsh.bundle.patch`), so its default entry is mounted by the
bundle. Pin the chain providers in your profile patch
(`$DSH_HOME/profiles/<profile>/cordis.patch.yml`):

```yaml
- id: web
  config:
    searchProvider: search-chain
    fetchProvider: fetch-chain
```

Reload the profile (or restart the web app), then open **Plugins → Installed →
dsh-web-fallback-chain**. The settings card is rendered on the plugin's detail page.
If your profile already pins another provider, replace those pins with the two ids above.

The profile entry id stays `web-fallback`. If you are upgrading from the old package name
`dsh-web-fallback`, remove the old package first; installing both would mount the same entry
twice. Existing settings keep working because the entry id did not change.

To verify the composition without starting an agent:

```bash
dsh --profile web --dump-config | grep -A6 'id: web-fallback'
```

## Ranking

Defaults are **strictly by measured quality, descending**, identical for every read mode:

| leg | quality | cost | key |
|:--|:--|:--|:--|
| `deepseek-search-rich` | 9.6 | paid | `DEEPSEEK_API_KEY` |
| `anysearch` | 7.3 | free | `ANYSEARCH_API_KEY` |
| `tavily` | 7.3 | free | `TAVILY_API_KEY` |
| `deepseek-fetch-rich` | 5.4 | paid | `DEEPSEEK_API_KEY` |
| `http` | 4.0 | free | — (external leg, not shipped) |

Search order: `deepseek-search-rich → anysearch → tavily`.
Fetch order: `anysearch → tavily → deepseek-fetch-rich → http` (the last one only when an
external web-fetch plugin registers it).

`quality` is for ordering only — it is not a promise about a particular page. The numbers
come from the plugin's own benchmark; your corpus may rank differently. Reorder the ladders
on the settings page and the plugin writes the flat `order` / `searchOrder` list.

**First available means primary.** The first leg whose key is present and that is not
skipped by `freeOnly` serves the request; the rest are tried only when it fails or returns
too little. The list is ordered by "how good is what comes back", not by "how cheap is the
attempt".

## The free-only switch

`freeOnly` (default **on**) skips every leg marked `paid` **at call time**. It does not
reorder anything: the ranking is one list, and turning the switch off restores the same
sequence. The settings page shows billed legs greyed out rather than hiding them, so the
displayed list always matches the stored one.

Reading only `process.env` and skipping paid legs is the whole of it — there is no second
configuration to keep in sync.

## Settings page

It lives on the plugin's detail page — **Plugins → Installed → dsh-web-fallback-chain** —
not under Settings. The card has five primary controls, because every setting already has a
measured default and none of them is something you must fill in:

- two switches — `freeOnly`, `annotateFallback`
- one choice — `defaultMode` (`brief` / `deep` / `list` / `page`)
- two ladders with ▲▼ to reorder a leg

There is also an **Advanced** section for the settings you are more likely to touch:
`minBodyChars`, `timeoutMs`, the `enable` allow-list (as mount checkboxes), per-leg
`cost`, `deepseekNeedContent`, `anysearchTag`, and the three API keys.

## Configuration

The table below is the full field reference, including the few fields that remain
patch-only:

| field | where | meaning |
|:--|:--|:--|
| `minBodyChars` | Advanced | **Default 0 (off): HTTP status alone decides.** When set, a shorter body counts as a miss and the chain continues. A length floor cannot separate a site footer (142–332 chars) from a legitimately short page: `example.com` has 171 characters of real content. |
| `timeoutMs` | Advanced | per-leg timeout. Default 30000. |
| `order` / `searchOrder` | ▲▼ arrows | the flat ladder per capability. Covers every mode at once and takes precedence over the shipped per-mode defaults. |
| `modeOrders` | patch only | per-capability, per-mode override: `{ fetch: { deep: [...] } }`. Only set this to make one mode behave differently; an uncovered mode falls back to `order`. If `order` is empty too, the shipped per-mode defaults apply — that is how the no-config default works. |
| `enable` | Advanced | an **allow-list** of legs this plugin registers. **Empty means all.** Use it to keep a provider from ever being called — e.g. leaving a billed leg out so it is unreachable even with free-only off. |
| `providers` | Advanced (cost) / patch (rest) | per-leg metadata overrides: `cost` (what `freeOnly` reads), `maxChars` (per-mode budget), `requiresKey`, `kinds`, `note`. `quality` is documentation only; runtime ordering comes from `order` / `modeOrders`. |
| `deepseekNeedContent` | Advanced | DeepSeek search full-text. Billed per call either way; the response grows from ~5 KB to ~45 KB. |
| `anysearchTag` | Advanced | vertical routing, e.g. `code.doc`. It changes query semantics, not ranking. |
| `anysearchParams` | patch only | extra AnySearch query parameters, passed through as-is. |

> **Save rewrites the config block.** The settings page writes the whole `config` mapping
> through the host's `configForms` writer, which replaces the block wholesale — comments
> placed inside a config block do not survive a save. That is why this table exists instead
> of comment blocks in `cordis.patch.yml`. Comments elsewhere in the file are unaffected.

API keys are entered on the page and stored in the host credential store, which the legs
consult **before** the environment. A key typed into the page works without a restart.

## Why one package and not four

This started as four packages (policy / vendors / fetch chain / search chain) on a
single-responsibility argument. In practice that produced four settings pages, one package
that could not be configured at all (the shared policy has no `apply()`), and a lockstep
upgrade problem. Modules are the right unit for internal separation; a package is the right
unit for installing and configuring, and there should be exactly one.

```
config.js         one schema -> one settings page
policy/           who is free, which mode wants which order, how much text
providers/        the vendor HTTP legs
chains/           ordering and fallback logic
prompt.js         the one system-prompt section (when to reach for web_search)
client.js         the settings page
cordis.patch.yml  the default config, every field listed
```

## Tests

```bash
npm install --no-audit --no-fund   # peer dependencies provide the test imports
npm test
```

There is no build step. `npm install` is still required in a fresh checkout because the
tests import `@deepseek-ai/schemastery` and `@deepseek-ai/dsh-web`; they are declared as
peer dependencies, not bundled.
`test/client-render.test.js` runs the real `client.js` through `vm` with a fake
`__ModuleLoader__`, a fake `primitives` shaped like the shipped one, and a fake context that
expands `inject().hooks` the way the shell does. It exists because static checks missed five
different ways this page disappeared — including `Button` being a `forwardRef` object rather
than a callable function, which blanked the entire card.

One class of bug appeared three times and is now covered systematically: `settingsTextField`
is a *string* field, so a spec that overrides only `parse` leaves the read direction broken
and any non-string value (boolean, array, object) reads back as `''`. A test asserts the round
trip for every registered field spec.

## Compatibility

- DSH `0.2.2-rc.x` (the `engines.dsh` range is `>=0.2.2-0 <0.3.0-0`).
- Node.js 20+.
- The plugin is independent of DeepSeek; DSH and the named providers are separate projects.

## License

MIT. See [LICENSE](LICENSE).
