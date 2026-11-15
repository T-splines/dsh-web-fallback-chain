/**
 * Plugin configuration for `dsh-web-fallback-chain`.
 *
 * One schema, one page. The chains, the vendors and the shared policy used to be
 * four packages with four schemas, which meant four settings pages and a user
 * who had to know which one to open. They are one plugin now: everything that a
 * deployment can reasonably want to change is a field here.
 *
 * ## Why these fields are `volatile()`
 *
 * A volatile field is what puts an entry on the dsh settings surface: the
 * settings service describes only the volatile subset of a plugin's schema, and
 * the browser generates the page from it — dsh's own components, no custom form
 * to keep in sync. Writes land in the active profile's patch (the same file a
 * deployment configures by hand) and apply live, so reordering the chain needs
 * no restart.
 *
 * A volatile field reaches the plugin as a getter (`{ get(): T }`) because its
 * value may change while the service runs. `readField` below accepts both shapes,
 * so plain objects (tests, non-UI callers) work unchanged.
 *
 * ## Reading volatile fields
 *
 * Reading one before this plugin's injection completes throws
 * `cannot get property "X" without inject`. Nothing here reads config at mount
 * for that reason: validation and resolution happen on the first real call.
 *
 * @module dsh-web-fallback-chain/config
 */

import z from '@deepseek-ai/schemastery'
import { MODES } from './policy/modes.js'

/** Provider id the fetch chain registers; pin it as `fetchProvider`. */
export const CHAIN_FETCH_PROVIDER_ID = 'fetch-chain'

/** Provider id the search chain registers; pin it as `searchProvider`. */
export const CHAIN_SEARCH_PROVIDER_ID = 'search-chain'

/** Server-side DeepSeek legs. Both bill per successful request. */
export const DEEPSEEK_SEARCH_PROVIDER_ID = 'deepseek-search-rich'
export const DEEPSEEK_FETCH_PROVIDER_ID = 'deepseek-fetch-rich'

/** The local HTTP(S) fetcher's id, whoever mounts it. */
export const LOCAL_FETCH_PROVIDER_ID = 'http'

/**
 * Read one config field, accepting both a resolved value and a volatile getter.
 *
 * Resolution is per call on purpose: a settings-page edit must reach the next
 * search or fetch without remounting the plugin.
 *
 * @param config - resolved plugin config (plain values or volatile getters).
 * @param key - field name.
 * @param fallback - value used when the field is absent.
 * @returns the current value.
 */
export function readField(config, key, fallback) {
  const raw = config?.[key]
  const value = raw !== null && typeof raw === 'object' && typeof raw.get === 'function' ? raw.get() : raw
  return value === undefined ? fallback : value
}

/**
 * Move billed providers last, preserving relative order inside each group.
 *
 * A stable partition rather than a sort: the configured order keeps deciding
 * everything except which side of the paid/free line each leg sits on, so turning
 * the switch on and off is exactly reversible.
 *
 * `paid` is supplied by the caller from the merged provider metadata. The default
 * list exists only so a caller with no metadata still gets sane behaviour;
 * deriving from metadata is always preferred, because a hard-coded list goes stale
 * the moment a new billed leg is added.
 *
 * @param order - configured provider ids.
 * @param paid - ids that bill per request.
 * @returns the effective order.
 */
export function paidLast(order, paid = [DEEPSEEK_FETCH_PROVIDER_ID, DEEPSEEK_SEARCH_PROVIDER_ID]) {
  const billed = Array.isArray(paid) ? paid : []
  return [
    ...order.filter((id) => !billed.includes(id)),
    ...order.filter((id) => billed.includes(id)),
  ]
}

/**
 * One provider-metadata override, as a user would write it in the patch.
 *
 * Permissive on purpose: `policy/providers.js` validates the merged result and
 * reports the offending id and field, so this schema does not duplicate those
 * rules and cannot drift from them.
 */
const ProviderOverride = z.object({
  cost: z.union([z.const('free'), z.const('paid')]).description('是否计费；freeOnly 只读取这一项'),
  quality: z.number().min(0).max(10).description('排序用 0–10 分，越大越靠前'),
  maxChars: z.dict(z.number()).description('按模式的每条字符预算，如 { brief: 300, deep: 1200 }'),
  requiresKey: z.string().description('需要的环境变量名，仅用于预检提示'),
  kinds: z.array(z.string()).description('该档能提供的能力：search / fetch'),
  note: z.string().description('给人看的一行说明'),
}).description('覆盖或新增一个 provider 的元数据')

const modeUnion = z.union(MODES.map((m) => z.const(m)))

export const Config = z.object({
  // ─── the switch that matters ─────────────────────────────────────────────

  /**
   * Skip every provider whose metadata says `cost: paid`.
   *
   * On by default. Measured: the billed fetch leg returned a site footer (332 and
   * 142 characters) with HTTP 200 on several sites, so it "succeeded" while
   * serving nothing and the chain never fell through. A free leg that fails
   * loudly is easier to recover from than a paid leg that quietly succeeds.
   */
  freeOnly: z.boolean().default(true).volatile()
    .description('仅使用免费工具。打开后，链里标记为 paid 的档会被跳过'),

  /**
   * Mode used when the request does not imply one.
   *
   * Delivery detail: the model-facing `web_search` / `web_fetch` tools accept
   * only `{queries}` / `{url}` and the seam has no channel for a mode, so in
   * practice a URL's shape or the query's shape decides. This is the fallback
   * for the cases the classifier cannot place.
   */
  defaultMode: modeUnion.default('brief').volatile()
    .description('无法判断意图时用的模式。brief 最省 token，deep 要全文'),

  // ─── per-mode ranking ────────────────────────────────────────────────────

  /**
   * Per-capability, per-mode orders: `{ fetch: { brief: [...] }, search: {...} }`.
   *
   * Empty means the shipped per-mode defaults, which encode this repository's
   * benchmark ranking. A mode you do not configure falls back to `order`; if `order`
   * is empty too, the shipped list applies, which is how the no-config default works.
   */
  modeOrders: z.dict(z.dict(z.array(z.string())))
    .description('按模式排的档位顺序，如 { fetch: { brief: [http, anysearch] } }')
    .volatile(),

  /**
   * Flat order, used for any mode `modeOrders` does not cover.
   *
   * Empty is valid when `modeOrders` is configured, which is the recommended
   * shape: the shipped defaults are per-mode and better than one flat list.
   */
  order: z.array(z.string()).default([])
    .description('抓取链：未在 modeOrders.fetch 中配置的模式使用的顺序')
    .volatile(),

  /**
   * The search chain's flat order, symmetric with `order`.
   *
   * Separate from `order` on purpose: one key shared by both capabilities means
   * editing the fetch ranking silently rewrites the search ranking. They are
   * different questions and get different answers.
   */
  searchOrder: z.array(z.string()).default([])
    .description('搜索链：未在 modeOrders.search 中配置的模式使用的顺序')
    .volatile(),

  // ─── the fetch chain's floor ─────────────────────────────────────────────

  /**
   * A fetched body shorter than this counts as a miss, so the chain continues.
   *
   * **Off by default (0).** It was 600, and that turned out to be worse than the
   * problem it solved. Length cannot tell a site footer (142–332 chars) apart from a
   * legitimately short page: `example.com` has 171 characters of real content, and
   * under the 600 floor it was rejected, so the chain fell through to a leg that
   * happened to return 958 characters — the same paragraph repeated in six languages.
   * A longer, worse answer that looks like a success.
   *
   * Only HTTP status decides now. When this is left at 0 every 2xx/4xx payload is
   * returned as fetched, and the provenance marker records how many characters each
   * leg produced, so an unusually short answer is visible rather than silently
   * replaced. Set it above 0 only if you know your sites are all long.
   */
  minBodyChars: z.number().min(0).default(0).volatile()
    .description('抓取正文少于这个字符数算未命中，继续下一档。默认 0 = 关闭：只看 HTTP 状态'),

  // ─── legible degradation ─────────────────────────────────────────────────

  /**
   * Append a one-line provenance marker when an earlier leg did not serve.
   *
   * A degraded fetch that is indistinguishable from a clean one is a fetch whose
   * reliability you cannot reason about. Off only for byte-comparison tests.
   */
  annotateFallback: z.boolean().default(true).volatile()
    .description('回落发生在正文/首条结果末尾留一行说明，不静默降级'),

  // ─── which legs to mount ─────────────────────────────────────────────────

  /**
   * Which legs this plugin registers. Empty means all of them.
   *
   * A leg whose key is missing still registers and reports `available() === false`,
   * so the chain names it in the attempts instead of looking unconfigured.
   */
  enable: z.array(z.string())
    .description('挂载哪些档；留空=全部。无 key 的档仍注册但自报不可用')
    .volatile(),

  // ─── provider metadata ───────────────────────────────────────────────────

  /**
   * Provider metadata: cost, quality, per-mode budget.
   *
   * Redeclaring a built-in id patches it field-by-field; a new id adds a leg this
   * plugin never tested, which then participates in ordering, `freeOnly` and the
   * per-mode budget exactly like a built-in.
   */
  providers: z.dict(ProviderOverride).default({}).volatile()
    .description('覆盖内置档的元数据，或新增你自己的档'),

  // ─── transport ───────────────────────────────────────────────────────────

  timeoutMs: z.number().min(1000).default(30000).volatile()
    .description('单次请求超时（毫秒）'),

  /** Send `need_content: true` to DeepSeek search (same price, ~9× the payload). */
  deepseekNeedContent: z.boolean().default(false).volatile()
    .description('DeepSeek 搜索返回全文（不额外计费，但响应大很多）'),

  /**
   * AnySearch vertical domain tag, e.g. `code.doc` or `finance.quote`.
   *
   * Empty means general web search. A tag changes what the query *means*, not
   * just its ranking: `cordis registerService` under `general.general` returns the
   * EU research database CORDIS; under `code.doc` it returns the actual source
   * docs. Explicit opt-in for that reason.
   */
  anysearchTag: z.string().default('').volatile()
    .description('AnySearch 垂直域，如 code.doc / academic.paper；留空=通用搜索'),

  /** Extra AnySearch vertical params, as `key=value,key2=value2`. */
  anysearchParams: z.string().default('').volatile()
    .description('垂直域的必填参数，如 library=cordis'),
})

export default Config
