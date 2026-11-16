/**
 * `dsh-web-fallback-chain` — Client half: the one settings page.
 *
 * This page is the reason four packages became one. Four packages meant four
 * pages, each showing a third of the knobs, and a reader who had to know which
 * page owned which switch. Everything a deployment can change is here.
 *
 * Everything visible is dsh's own client UI: `SettingsForm` for the chrome and
 * its save/discard states, `SettingsValueField` for text inputs, `Switch` for the
 * toggles. This file contains no stylesheet and no hand-made control — it only
 * says which fields exist and how a draft becomes a value, so the page cannot
 * drift away from the product's look.
 *
 * Every field below maps to a **real config key**. A synthetic field name would
 * be written into the profile patch as a key the host schema does not know.
 *
 * @module dsh-web-fallback-chain/client
 */

window.__ModuleLoader__.load({
  id: '@magic6/dsh-web-fallback-chain',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

    // Styles adapted from dsh-client-ui-settings-web-search's card module: a
    // toggle row is a two-column flex row, a hint is 12px tertiary text, and a
    // group is a 6px-gap grid. Without these the fields read as one paragraph.
    // Layout only. Every value here exists because the measured box model showed it
    // missing: `SettingsForm` gives its children NO spacing (all margins came back
    // 0), so without this the ladder rows touch each other and the section headings
    // sit flush against the control above them.
    //
    // Rhythm: 24px between sections, 16px between fields, 8px between ladder rows.
    const CSS = [
      // ── Root: owns the column width and the outer padding ──────────────────
      //
      // The host draws this card into a 960px flex section with `padding: 0`, so
      // without this the copy runs edge to edge against the panel border and the
      // right half of the row is empty. 640px is the reading width the product's own
      // settings pages use.
      '.wfb-root{display:block;max-width:640px;padding:4px 0 8px}',
      // ── Sections ──────────────────────────────────────────────────────────
      '.wfb-sectionTitle{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:28px 0 12px;padding-top:16px;border-top:.5px solid var(--dsw-alias-border-l2);display:flex;align-items:center;gap:8px}',
      // A short rule before the label turns the heading into a section marker without
      // needing a heavier type treatment.
      '.wfb-sectionTitle:before{content:"";width:10px;height:1.5px;background:var(--dsw-alias-label-tertiary);flex:none;border-radius:1px}',
      '.wfb-sectionTitle:first-child{margin-top:0;padding-top:0;border-top:0}',

      // ── One labelled control ──────────────────────────────────────────────
      '.wfb-field{display:block;margin:0 0 16px}',
      '.wfb-label{display:block;font-size:13px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-primary);margin:0 0 6px}',
      '.wfb-hint{display:block;color:var(--dsw-alias-label-tertiary);margin:6px 0 0;font-size:12px;line-height:17px}',
      '.wfb-note{display:block;color:var(--dsw-alias-label-tertiary);margin:20px 0 0;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:17px}',

      // ── A switch row: label left, control right ───────────────────────────
      '.wfb-toggle{display:block;margin:0 0 16px}',
      '.wfb-toggleRow{display:flex;justify-content:space-between;align-items:center;gap:16px;font-size:13px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-primary)}',

      // ── The ladder ────────────────────────────────────────────────────────
      '.wfb-legs{list-style:none;margin:0;padding:0;display:block}',
      '.wfb-leg{display:flex;align-items:center;gap:10px;padding:7px 8px 7px 0;border-radius:var(--dsw-radius-sm);min-height:34px}',
      '.wfb-leg+.wfb-leg{border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.wfb-leg:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.wfb-legNum{flex:none;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1;display:inline-flex;align-items:center;justify-content:center}',
      '.wfb-legBody{display:flex;flex-direction:row;align-items:baseline;gap:10px;min-width:0;flex:1}',
      '.wfb-legId{font-family:var(--ds-font-family-code);font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary);white-space:nowrap;flex:none}',
      '.wfb-legId:after{content:"";display:inline-block;width:1px;height:11px;background:var(--dsw-alias-border-l3);margin-left:10px;vertical-align:-1px}',
      '.wfb-legNote{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wfb-legSkipped{opacity:.45}',
      '.wfb-legSkipped .wfb-legNote{font-style:italic}',

      // ── Reorder arrows: revealed on hover so the list stays calm ──────────
      '.wfb-arrows{display:inline-flex;gap:2px;flex:none;opacity:0;transition:opacity .12s var(--ds-ease-in-out)}',
      '.wfb-leg:hover .wfb-arrows,.wfb-leg:focus-within .wfb-arrows{opacity:1}',
      '.wfb-arrow{width:24px;height:24px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary)}',
      '.wfb-arrow:hover:not(:disabled){background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}',
      '.wfb-arrow:disabled{opacity:.25;cursor:default}',

      // ── Inline text action ────────────────────────────────────────────────
      '.wfb-link{color:var(--dsw-alias-state-business-primary);font:inherit;cursor:pointer;background:0 0;border:0;padding:0;margin:10px 0 0;font-size:12px;display:inline-block}',
      '.wfb-link:hover{text-decoration:underline}',
      // ── The degraded panel, shown when the real form cannot render ─────────
      // ── Hidden but present ─────────────────────────────────────────────────
      //
      // `display:none` rather than not rendering. Removing the node changes the number
      // of hooks in this component, which React rejects with #300/#311 — the failure
      // that made this page vanish when a tagged domain was picked.
      '.wfb-hidden{display:none!important}',

      // ── The mount list: one leg per line ───────────────────────────────────
      //
      // Rendered inline, five checkboxes with capability suffixes ran together
      // ("deepseek-search-rich · searchdeepseek-fetch-rich · fetch") because each is an
      // inline <label>. A grid puts one per row and keeps the ids aligned.
      '.wfb-mount{display:grid;gap:7px;margin-top:2px}',
      '.wfb-mount label{display:flex;align-items:center;gap:7px;font-size:13px;line-height:18px;cursor:pointer}',
      '.wfb-mount label:has(input:disabled){cursor:default;opacity:.5}',

      // ── Billing rows ───────────────────────────────────────────────────────
      '.wfb-costRow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.wfb-costRow:last-child{border-bottom:0}',
      '.wfb-costId{font-family:var(--ds-font-family-code);font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary)}',

      '.wfb-fallback{display:block;padding:14px 16px;border:.5px solid var(--dsw-alias-state-error-primary);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform)}',
      '.wfb-error{color:var(--dsw-alias-state-error-primary);margin:8px 0 0;font-family:var(--ds-font-family-code);font-size:12px;line-height:17px;word-break:break-word}',
    ].join('');
    const PLUGIN_ID = 'dsh-web-fallback-chain';
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${PLUGIN_ID}"]`) === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = PLUGIN_ID;
      tag.dataset.pluginCss = PLUGIN_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** Dictionary namespace owned by this client half. */
    const NS = 'settings.webFallback';

    /** Loader row id of the host half; also its settings namespace. */
    const ENTRY_ID = 'web-fallback';

    /**
     * The npm package name, which is the identity 已安装插件 keys its config page on.
     *
     * Not the same string as `ENTRY_ID`: the settings namespace is the profile
     * entry's local id (`web-fallback`), while this slot is addressed by the package
     * name the plugin manager reports (`@magic6/dsh-web-fallback-chain`).
     */
    const PACKAGE_NAME = '@magic6/dsh-web-fallback-chain';

    /**
     * The four read depths, duplicated here on purpose.
     *
     * The browser bundle cannot import the host half's `policy/modes.js` (different
     * side of the seam, and a client bundle that pulls in server code does not load),
     * so the list is repeated. `client.test.js` asserts it still matches the host's
     * `MODES`, so the two cannot drift silently.
     */
    const MODES = ['brief', 'deep', 'list', 'page'];

    /** The depth used when nothing else decides; mirrors the host default. */
    const DEFAULT_MODE = 'brief';

    /**
     * The measured default order, duplicated for display.
     *
     * The browser bundle cannot import `policy/modes.js` (server side of the seam), so
     * this table is a copy. `client.test.js` asserts it still matches the host's
     * `DEFAULT_MODE_ORDERS`, so a policy change that is not mirrored here fails the
     * suite instead of showing the user a chain the plugin will not run.
     */
    const LADDER = {
      fetch: ['anysearch', 'tavily', 'deepseek-fetch-rich', 'http'],
      search: ['deepseek-search-rich', 'anysearch', 'tavily'],
    };

    /** Which legs cost money, so the preview can mark them and freeOnly can hide them. */
    const PAID = new Set(['deepseek-search-rich', 'deepseek-search-api', 'deepseek-fetch-rich', 'deepseek-fetch-api']);

    /** One-line description per leg, for the chain preview. */
    const LEGS = {
      'http': { zh: '直接抓 HTML', en: 'plain HTML fetch' },
      'anysearch': { zh: 'AnySearch 提取', en: 'AnySearch extract' },
      'tavily': { zh: 'Tavily 提取（能取 PDF）', en: 'Tavily extract (handles PDFs)' },
      'deepseek-search-rich': { zh: 'DeepSeek 搜索（收费，给成段答案）', en: 'DeepSeek search (paid, returns prose)' },
      'deepseek-search-api': { zh: 'DeepSeek 搜索 API（收费）', en: 'DeepSeek Search API (paid)' },
      'deepseek-fetch-rich': { zh: 'DeepSeek 抓取（收费）', en: 'DeepSeek fetch (paid)' },
      'deepseek-fetch-api': { zh: 'DeepSeek 抓取 API（收费）', en: 'DeepSeek Fetch API (paid)' },
    };

    /** Ids this plugin registers, and the values the seam must pin. */
    const CHAIN_FETCH_ID = 'fetch-chain';
    const CHAIN_SEARCH_ID = 'search-chain';

    /** Entry id of the seam whose selection decides whether the chains run. */
    const WEB_ENTRY_ID = 'web';

    /** English copy. */
    const en = {
      title: 'Web fallback chain',
      description: 'A ranked fallback chain for web search and web fetch, with a free-only switch.',

      freeOnly: 'Use free tools only',
      freeOnlyHint: 'Skips every provider that costs money. On by default: the billed fetch leg was measured answering "success" with only a site footer on several sites.',

      depth: 'How deep to read',
      mode_brief: 'brief · one fact',
      mode_deep: 'deep · whole document',
      mode_list: 'list · listing page',
      mode_page: 'page · whole page',
      depthHint: 'Which mode to use when intent is unclear. brief is 300 characters per result, deep 1200, list expects grouped items, page is untruncated.',

      fetchOrder: 'Fetch priority',
      fetchOrderHint: 'Comma separated, left first. Blank uses the shipped order.',
      searchOrder: 'Search priority',
      searchOrderHint: 'Comma separated, left first. Search and fetch rank independently. Blank uses the shipped order.',
      annotateFallback: 'Annotate fallbacks',
      annotateFallbackHint: 'When a later leg served, add one line saying which leg answered and why the earlier ones did not.',
      keyDeepseek: 'DeepSeek API key',
      keyDeepseekHint: 'Used by the billed legs deepseek-search-rich / deepseek-fetch-rich. Leave empty and those legs stay unavailable.',
      keyAnysearch: 'AnySearch API key',
      keyAnysearchHint: 'Used by the free anysearch leg, for both search and fetch.',
      keyTavily: 'Tavily API key',
      keyTavilyHint: 'Used by the free tavily leg, the only one here that extracts PDFs.',
      keySet: 'Set',
      keyUnset: 'Not set',
      fetchChainTitle: 'Fetch order (in effect)',
      fetchChainHint: 'Tried top to bottom; the first success wins. Ranked from measurement, so it needs no manual configuration.',
      searchChainTitle: 'Search order (in effect)',
      searchChainHint: 'Tried top to bottom; the first one with results wins. Use the arrows to change the order — the ranking above is the ranking used, and an edit here overrides the measured default for every mode.',
      moveUp: 'Move up',
      moveDown: 'Move down',
      resetToMeasured: 'Restore measured order',
      fetchChainCustom: 'This is your own ranking. Billed legs are hidden while free-only is on.',
      searchChainCustom: 'This is your own ranking. Billed legs are hidden while free-only is on.',
      saveNote: 'Saving rewrites this plugin\u2019s config block from what the page holds. Comments placed inside that block do not survive a save \u2014 keep notes here or in the README, not in the YAML.',
      costTitle: 'Billing per leg',
      costHint: 'Whether a leg bills per request. The free-only switch skips exactly the legs marked paid, so marking one free here stops it from being skipped. This does not reorder anything.',
      cost: 'billing',
      costFree: 'free',
      costPaid: 'paid',
      invalidNumber: 'Enter a number between 0 and 10.',
      groupAdvanced: 'Advanced',
      minBody200: '200 chars',
      minBody600: '600 chars',
      minBody2000: '2k chars',
      minBodyOff: 'status only',
      minBodyCharsLabel: 'Minimum body length',
      minBodyCharsHint: 'Off by default: HTTP status alone decides, and a short answer is returned as fetched. Turning it on means "my sites are all long, so a stub means extraction failed" \u2014 a re-fetch trigger, not a quality rule. Length cannot tell a site footer (142\u2013332 chars) from a legitimately short page (example.com has 171), which is why this is off.',
      timeoutMsLabel: 'Request timeout (ms)',
      timeoutMsHint: 'How long one leg may take before the chain moves on. Measured default: 30000.',
      enableLabel: 'Mounted legs',
      enableHint: 'Which legs this plugin registers at all. All ticked (the default) means every leg is mounted. Unticking a leg removes it from both chains \u2014 useful when you never want a provider called, e.g. to keep a billed leg out of reach even with free-only switched off. A mounted leg with no key still registers and reports itself unavailable, so the chain names it instead of looking unconfigured.',
      tagGeneral: 'general web',
      anysearchParamsRequired: 'This domain requires: {keys}. The API rejects the request without them.',
      anysearchParamsNotNeeded: 'The selected domain needs no parameters, so there is nothing to fill in.',
      anysearchTagLabel: 'AnySearch vertical',
      anysearchTagHint: 'A vertical domain such as code.doc or academic.paper; empty means general web search. A tag changes what the query MEANS, not just its ranking — the same query returns different sources.',
      anysearchParamsLabel: 'AnySearch vertical params',
      anysearchParamsHint: 'Required parameters for the chosen vertical, as key=value,key2=value2.',
      deepseekNeedContentLabel: 'DeepSeek search: full text',
      deepseekNeedContentHint: 'Ask DeepSeek search for full page text. Same price per call, but the response grows from about 5 KB to 45 KB.',
      groupBasic: 'Basics',
      groupChain: 'Fallback order',
      groupKeys: 'API keys',
      skippedByFreeOnly: 'skipped (billed)',

      overridden: 'Overridden',
      reset: 'Reset to default',
      orderInvalid: 'Write at least one leg name, and never the chain itself.',

      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      readOnly: 'This deployment stores settings read-only.',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
      save: 'Save',
      saving: 'Saving…',
    };

    /** Simplified Chinese copy. */
    const zh = {
      title: '网页回退链',
      description: '为网页搜索与网页抓取提供按实测排序的回退链，带一个「仅免费」开关。',

      freeOnly: '仅使用免费工具',
      freeOnlyHint: '打开后会跳过所有要花钱的档。默认打开：实测收费抓取档在多个站点上返回「成功」但正文只有站点页脚，等于没取到东西。',

      depth: '需要读多深',
      mode_brief: 'brief · 一句话事实',
      mode_deep: 'deep · 整篇文档',
      mode_list: 'list · 列表页',
      mode_page: 'page · 整页',
      depthHint: '判断不出意图时用哪一档。brief 每条 300 字，deep 1200 字，list 要成组条目，page 整页不截断。',

      fetchOrder: '抓取优先顺序',
      fetchOrderHint: '逗号分隔，左边先试。留空 = 使用内置顺序。',
      searchOrder: '搜索优先顺序',
      searchOrderHint: '逗号分隔，左边先试。搜索与抓取各自独立排序。留空 = 使用内置顺序。',
      annotateFallback: '标注降级来源',
      annotateFallbackHint: '换了备选档时，在结果里附一行说明是哪一档给的、前面几档为什么没成。',
      keyDeepseek: 'DeepSeek API key',
      keyDeepseekHint: '收费档 deepseek-search-rich / deepseek-fetch-rich 用这个。留空则这两档不可用。',
      keyAnysearch: 'AnySearch API key',
      keyAnysearchHint: '免费档 anysearch 用这个，搜索与抓取都靠它。',
      keyTavily: 'Tavily API key',
      keyTavilyHint: '免费档 tavily 用这个，唯一能取 PDF 的档。',
      keySet: '已设置',
      keyUnset: '未设置',
      fetchChainTitle: '抓取顺序（当前生效）',
      fetchChainHint: '从上往下试，第一个成功的就用。链由实测结果排定，不需要手动配置。',
      searchChainTitle: '搜索顺序（当前生效）',
      searchChainHint: '从上往下试，第一个有结果的就用。要调顺序用右边的箭头——这里显示的顺序就是实际生效的顺序，改过之后会覆盖所有模式的实测默认值。',
      moveUp: '上移',
      moveDown: '下移',
      resetToMeasured: '恢复实测顺序',
      fetchChainCustom: '这是你自己调整过的顺序。收费档在「仅使用免费工具」开启时会被隐藏。',
      searchChainCustom: '这是你自己调整过的顺序。收费档在「仅使用免费工具」开启时会被隐藏。',
      saveNote: '保存会用页面上的值重写本插件的配置块。写在这个块里的注释不会留到保存之后——要记笔记请写在这里或 README 里，不要写在 YAML 里。',
      costTitle: '各档是否计费',
      costHint: '这一档是否按次计费。「仅使用免费工具」跳过的正是标记为 paid 的档，所以把某档标成 free 后它就不会再被跳过。这里不改变排序。',
      cost: '计费',
      costFree: '免费',
      costPaid: '收费',
      invalidNumber: '请输入 0 到 10 之间的数字。',
      groupAdvanced: '高级',
      minBody200: '200 字',
      minBody600: '600 字',
      minBody2000: '2 千字',
      minBodyOff: '只看状态',
      minBodyCharsLabel: '正文最少字数',
      minBodyCharsHint: '默认关闭：只看 HTTP 状态，拿回来多短都算成功。开启它的含义是「我的站点都很长，出现短文说明提取失败」——这是重试触发器，不是质量判据。长度分不清页脚（142–332 字）和合法的短页面（example.com 正文只有 171 字），所以才默认关掉。',
      timeoutMsLabel: '单次超时（毫秒）',
      timeoutMsHint: '一档最多等多久，超时后换下一档。实测默认 30000。',
      enableLabel: '挂载哪些档',
      enableHint: '这个插件到底注册哪些档。全部勾选（默认）就是全都挂载；取消某档会把它从搜索和抓取两条链里都移除——适用于你完全不希望某个来源被调用的情况，例如即使关掉「仅免费」也不想碰收费档。已挂载但没有 key 的档仍会注册并自报不可用，这样链里会点名它，而不是看起来没配置。',
      tagGeneral: '通用搜索',
      anysearchParamsRequired: '该垂直域必须提供：{keys}。缺少时 API 会直接拒绝请求。',
      anysearchParamsNotNeeded: '当前选择的垂直域不需要参数，不用填任何东西。',
      anysearchTagLabel: 'AnySearch 垂直域',
      anysearchTagHint: '如 code.doc、academic.paper；留空为通用搜索。垂直域改变的是查询的语义，不只是排序——同一个 query 会命中不同来源。',
      anysearchParamsLabel: 'AnySearch 垂直参数',
      anysearchParamsHint: '所选垂直域的必填参数，格式 key=value,key2=value2。',
      deepseekNeedContentLabel: 'DeepSeek 搜索返回全文',
      deepseekNeedContentHint: '让 DeepSeek 搜索返回整页正文。按次计费不变，但响应会从约 5KB 涨到 45KB。',
      groupBasic: '基本',
      groupChain: '回退顺序',
      groupKeys: 'API 密钥',
      skippedByFreeOnly: '本次跳过（收费）',

      overridden: '已覆盖',
      reset: '恢复默认',
      orderInvalid: '至少写一个档名，且不能写链自己的名字。',

      unavailable: '该插件当前未加载，暂时无法配置。',
      readOnly: '本部署的设置为只读。',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
      save: '保存',
      saving: '保存中…',
    };

    /**
     * The per-mode order overrides, as config-entry drafts.
     *
     * Each entry is one `modeOrders.<capability>.<mode>` override. The page no
     * longer renders these as fields — a user who needs one edits the profile patch,
     * which is the right place for a set-once value. They stay in the form model so
     * an override written by hand is still read, staged and saved back intact rather
     * than being dropped on the next save.
     */
    const MODE_FIELDS = [
      { capability: 'fetch', mode: 'brief', key: 'modeFetchBrief' },
      { capability: 'fetch', mode: 'deep', key: 'modeFetchDeep' },
      { capability: 'fetch', mode: 'list', key: 'modeFetchList' },
      { capability: 'fetch', mode: 'page', key: 'modeFetchPage' },
      { capability: 'search', mode: 'brief', key: 'modeSearchBrief' },
      { capability: 'search', mode: 'deep', key: 'modeSearchDeep' },
      { capability: 'search', mode: 'list', key: 'modeSearchList' },
      { capability: 'search', mode: 'page', key: 'modeSearchPage' },
    ];

    /**
     * Assemble the `modeOrders` config value from the per-mode drafts.
     *
     * A field left empty is omitted rather than written as `[]`, so clearing a
     * field restores the measured default for that mode instead of pinning an
     * empty order that would fail at resolve time.
     *
     * @param drafts - the staged text of each mode field, keyed by `MODE_FIELDS.key`.
     * @returns the `modeOrders` object the host accepts.
     */
    function modeOrdersFrom(drafts) {
      const out = {};
      for (const { capability, mode, key } of MODE_FIELDS) {
        const ids = parseIds(drafts?.[key] ?? '');
        if (ids.length === 0) continue;
        if (out[capability] === undefined) out[capability] = {};
        out[capability][mode] = ids;
      }
      return out;
    }

    /** Form chrome labels the shared form component requires. */
    function formLabels(t) {
      return {
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('save'),
        saving: t('saving'),
      };
    }

    /** Split an order draft into provider ids. */
    function parseIds(text) {
      return String(text ?? '')
        .split(/[,\s]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    }

    /** Render provider ids the way the reader types them. */
    function formatIds(ids) {
      return Array.isArray(ids) ? ids.join(', ') : '';
    }

    /** Why an order draft is unacceptable, or `false` when it is fine. */
    function orderError(text) {
      const raw = String(text ?? '').trim();
      if (raw === '') return false;
      const ids = parseIds(raw);
      return ids.length === 0 || ids.includes(CHAIN_FETCH_ID) || ids.includes(CHAIN_SEARCH_ID);
    }

    /**
     * True when the depth draft is not one of the four known modes.
     *
     * Checked here rather than left to the host so a typo shows up under the field
     * instead of as a save failure.
     */
    function modeError(text) {
      const raw = String(text ?? '').trim();
      if (raw === '') return false;
      return !['brief', 'deep', 'list', 'page'].includes(raw);
    }

    /** Why a JSON-object draft is unacceptable, or `false` when it is fine. */
    function jsonError(text) {
      const raw = String(text ?? '').trim();
      if (raw === '') return false;
      try {
        const value = JSON.parse(raw);
        return value === null || typeof value !== 'object' || Array.isArray(value);
      } catch {
        return true;
      }
    }

    /** Why a positive-integer draft is unacceptable, or `false` when it is fine. */
    function numberError(text) {
      const raw = String(text ?? '').trim();
      if (raw === '') return false;
      const n = Number(raw);
      return !Number.isInteger(n) || n <= 0;
    }

    /** A text field that stages an array of provider ids. */
    function orderField(key) {
      return {
        ...primitives.settingsTextField(key),
        // BOTH halves must be replaced: `settingsTextField` is a *string* field and
        // its `format` is `(v) => typeof v === 'string' ? v : ''`, so an array
        // formats to the empty string. Without this the page rendered an empty box
        // for a stored order and then SAVED THE EMPTY VALUE back — the setting looked
        // applied and silently cleared itself.
        format: (value) => (Array.isArray(value) ? formatIds(value) : typeof value === 'string' ? value : ''),
        parse: (text) => (orderError(text) ? undefined : { kind: 'set', value: parseIds(text) }),
      };
    }

    /** A text field that stages a positive integer. */
    function numberField(key) {
      return {
        ...primitives.settingsTextField(key),
        // ...and a number is not a string either.
        format: (value) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value : ''),
        parse: (text) => {
          const raw = String(text ?? '').trim();
          if (raw === '') return { kind: 'unset' };
          return numberError(raw) ? undefined : { kind: 'set', value: Number(raw) };
        },
      };
    }

    /** A text field that stages a JSON object. */
    function jsonField(key) {
      return {
        ...primitives.settingsTextField(key),
        // Same trap as `orderField`: an object is not a string, so the stock
        // formatter yields '' and a save would overwrite the stored object with {}.
        format: (value) => {
          if (typeof value === 'string') return value
          if (value === null || value === undefined) return ''
          try {
            return JSON.stringify(value)
          } catch {
            return ''
          }
        },
        parse: (text) => {
          const raw = String(text ?? '').trim();
          if (raw === '') return { kind: 'set', value: {} };
          if (jsonError(raw)) return undefined;
          return { kind: 'set', value: JSON.parse(raw) };
        },
      };
    }

    /** A text field that stages a plain string. */
    function textField(key, fallback) {
      return {
        ...primitives.settingsTextField(key),
        parse: (text) => ({ kind: 'set', value: String(text ?? '').trim() || fallback }),
      };
    }

    /**
     * A boolean field.
     *
     * A boolean has no dedicated field primitive, so it rides a text draft that
     * the official `Switch` renders: the control and its states are the product's,
     * only the staged value is ours.
     */
    function booleanField(key) {
      return {
        ...primitives.settingsTextField(key),
        // BOTH directions must override the text spec.
        //
        // `settingsTextField` is a string field: its `format` is
        //   format: (value) => typeof value === 'string' ? value : ''
        // so a stored boolean `true` formats to `''`. The old spec overrode only
        // `parse`, leaving the read side returning an empty string — which is why
        // `freeOnly: true` rendered as an OFF switch. Both halves are replaced here:
        // `format` renders the boolean as 'true'/'false', `parse` reads it back.
        // `typeof value === 'boolean'` is the normal case; the string forms are
        // accepted because a config written through the patch file can hold `'true'`
        // and the descriptor would then hand it back as a string.
        format: (value) => {
          if (typeof value === 'boolean') return value ? 'true' : 'false';
          const raw = String(value ?? '').trim().toLowerCase();
          return raw === 'true' || raw === '1' || raw === 'on' ? 'true' : 'false';
        },
        parse: (text) => {
          const raw = String(text ?? '').trim().toLowerCase();
          return { kind: 'set', value: raw === 'true' || raw === '1' || raw === 'on' };
        },
      };
    }

    /** A switch row: the product's Switch plus a label and a hint. */
    /**
     * The effective depth, normalized to one of {@link MODES}.
     *
     * An empty draft means "no override", which behaves as `brief`, so the control
     * must show `brief` selected rather than nothing.
     *
     * @param field - the staged `defaultMode` field.
     * @returns one of the four mode names.
     */
    function modeOf(field) {
      const text = String(field?.text ?? field?.value ?? '').trim();
      return MODES.includes(text) ? text : DEFAULT_MODE;
    }

    /**
     * Read a boolean out of a staged field.
     *
     * The form model exposes a field's staged value as `text`. How a boolean is
     * rendered into that string is the form model's business, not ours, so relying
     * on `text === 'true'` made the switch read as OFF for a config that was
     * genuinely `true` — exactly the reported symptom. Accept the value the field
     * also carries (`value`) and treat any non-"false" text as on, so a
     * differently-stringified true cannot flip the switch off.
     *
     * @param field - one staged field from the card snapshot.
     * @returns whether the switch should render as on.
     */
    function boolOf(field) {
      if (field === undefined || field === null) return false;
      if (typeof field.value === 'boolean') return field.value;
      const text = String(field.text ?? '').trim().toLowerCase();
      return text === 'true' || text === '1' || text === 'on' || text === 'yes';
    }

    /**
     * Render one capability's ladder with up/down reordering.
     *
     * ## Why arrows and not a text field
     *
     * The order IS this plugin's product, so it has to be adjustable — but a
     * comma-separated box asks the user to retype an ordering the plugin already
     * measured, and one typo silently reorders the chain. Two arrows per row make the
     * operation the thing it actually is: move this leg one slot.
     *
     * ## What an edit writes
     *
     * Only the flat `order` / `searchOrder` list. That field is the documented
     * "user's own ranking" and takes precedence over the shipped per-mode default, so
     * one adjustment covers every mode at once — which is what someone dragging an
     * arrow expects. Per-mode overrides stay in the config file for the rare case.
     *
     * @param capability - `fetch` or `search`.
     * @param state - the card snapshot, for the freeOnly switch and current order.
     * @param handlers - `{ edit, resetField, t, lang }`.
     * @returns the ladder node.
     */
    function chainRow(capability, state, handlers) {
      const { t, lang, edit, resetField } = handlers;
      const freeOnly = boolOf(state.freeOnly);

      // The user's own ranking when they have one, else the measured default. Billed
      // legs are hidden — not reordered — under freeOnly, so flipping the switch back
      // restores the same sequence.
      const configuredField = capability === 'fetch' ? state.order : state.searchOrder;
      const configured = parseIds(String(configuredField?.text ?? ''));
      const base = configured.length > 0 ? configured : LADDER[capability];
      // Every leg is shown, always. `freeOnly` does NOT reorder or hide: the host
      // skips billed legs at call time while keeping the ranking, so the page must
      // show the one ranking that is actually stored. Hiding them here made the list
      // disagree with the config and made the switch look like it rewrote the order.
      const legs = base;

      const move = (from, to) => {
        if (to < 0 || to >= legs.length) return;
        const next = [...legs];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        // The whole ladder is visible, so the reordered list IS the new config value.
        edit(capability === 'fetch' ? 'order' : 'searchOrder', next.join(','));
      };

      // `Button` is a `React.forwardRef` component, NOT a plain function. Calling it
      // as `primitives.Button({...})` throws `TypeError: primitives.Button is not a
      // function` and took the whole page down. Every other primitive here is a
      // plain function, so this one alone must go through `createElement`.
      //
      // The icons ARE plain functions, so they stay on the call form.
      const arrow = (index, direction) => {
        const Icon = direction === 'up'
          ? primitives.IconChevronUpOutlineRegular
          : primitives.IconChevronDownOutlineRegular
        return React.createElement(primitives.Button, {
          variant: 'ghost',
          className: 'wfb-arrow',
          'aria-label': t(direction === 'up' ? 'moveUp' : 'moveDown'),
          disabled: direction === 'up' ? index === 0 : index === legs.length - 1,
          onClick: () => move(index, direction === 'up' ? index - 1 : index + 1),
        }, Icon({ size: 14 }))
      }

      const items = legs.map((id, index) => {
        const billed = PAID.has(id);
        const skipped = billed && freeOnly;
        return React.createElement('li', {
          key: id,
          className: `wfb-leg${billed ? ' wfb-legPaid' : ''}${skipped ? ' wfb-legSkipped' : ''}`,
        }, [
          React.createElement('span', { key: 'n', className: 'wfb-legNum' }, String(index + 1)),
          React.createElement('span', { key: 'body', className: 'wfb-legBody' }, [
            React.createElement('span', { key: 'id', className: 'wfb-legId' }, id),
            React.createElement('span', { key: 'note', className: 'wfb-legNote' }, skipped
              ? `${LEGS[id]?.[lang] ?? ''} · ${t('skippedByFreeOnly')}`
              : (LEGS[id]?.[lang] ?? '')),
          ]),
          React.createElement('span', { key: 'arrows', className: 'wfb-arrows' }, [arrow(index, 'up'), arrow(index, 'down')]),
        ]);
      });

      const hasOverride = configured.length > 0;
      return React.createElement('div', { key: `chain-${capability}`, className: 'wfb-field' }, [
        React.createElement('span', { key: 'label', className: 'wfb-label' }, t(capability === 'fetch' ? 'fetchChainTitle' : 'searchChainTitle')),
        React.createElement('ol', { key: 'list', className: 'wfb-legs' }, items),
        React.createElement('p', { key: 'hint', className: 'wfb-hint' }, hasOverride
          ? t(capability === 'fetch' ? 'fetchChainCustom' : 'searchChainCustom')
          : t(capability === 'fetch' ? 'fetchChainHint' : 'searchChainHint')),
        hasOverride
          ? React.createElement('button', {
            key: 'reset',
            type: 'button',
            className: 'wfb-link',
            onClick: () => resetField(capability === 'fetch' ? 'order' : 'searchOrder'),
          }, t('resetToMeasured'))
          : null,
      ]);
    }

    /**
     * A quiet section heading inside the form.
     *
     * The page has three distinct jobs — behaviour switches, chain order, credentials —
     * and without headings they read as one undifferentiated column of controls.
     *
     * @param key - React key.
     * @param title - localized heading text.
     * @returns the heading node.
     */
    /**
     * The body-length floor, as named choices.
     *
     * Measured spread: a site footer is 142–332 characters, a real article 63k–100k.
     * Because that cannot separate a footer from a legitimately short page, the shipped
     * default is 0 (`status only`) and the other values are for deployments that know
     * their sites are all long.
     */
    const MIN_BODY_CHOICES = (t) => [
      { value: 0, label: t('minBodyOff') },
      { value: 200, label: t('minBody200') },
      { value: 600, label: t('minBody600') },
      { value: 2000, label: t('minBody2000') },
    ]

    /** Per-leg timeout, as named choices. 30 s is the shipped default. */
    const TIMEOUT_CHOICES = (t) => [
      { value: 10000, label: '10s' },
      { value: 30000, label: '30s' },
      { value: 60000, label: '60s' },
    ]

    /**
     * The built-in legs whose billing classification the user can override.
     *
     * `cost` is the one provider metadata field that changes behaviour the moment it is
     * edited: it is exactly what `freeOnly` reads, and what `partitionByCost` partitions
     * on. `quality` is deliberately NOT exposed — nothing at runtime reads it (it only
     * documents how the shipped default order was derived), so an editable box for it
     * would accept input and change nothing, which is worse than not offering it.
     */
    const COST_LEGS = [
      { id: 'deepseek-search-rich', cost: 'paid' },
      { id: 'anysearch', cost: 'free' },
      { id: 'tavily', cost: 'free' },
      { id: 'deepseek-fetch-rich', cost: 'paid' },
      { id: 'http', cost: 'free' },
    ]

    /**
     * One billing row per built-in leg.
     *
     * `providers` is a nested object, so it cannot ride a single text field without
     * asking the user to write JSON by hand. Each row sets one value and the controller
     * recomposes the object, preserving every other key on the entry.
     *
     * @param options - state, disabled, onEdit, onReset, t.
     * @returns the rows.
     */
    function costRows(options) {
      const { state, disabled, onEdit, t: tr } = options
      const current = readProviders(state.providers)
      return COST_LEGS.map(({ id, cost }) => React.createElement('div', { key: id, className: 'wfb-costRow' }, [
        React.createElement('span', { key: 'id', className: 'wfb-costId' }, id),
        primitives.SegmentedControl({
          id: `plugin-config-web-fallback-cost-${id}`,
          label: `${id} ${tr('cost')}`,
          value: current[id]?.cost ?? cost,
          disabled,
          options: [
            { value: 'free', label: tr('costFree') },
            { value: 'paid', label: tr('costPaid') },
          ],
          onChange: (next) => onEdit(id, next),
        }),
      ]))
    }

    /**
     * Read the stored `providers` object.
     *
     * Everything the entry carries is kept, not just `cost`, so an edit to one key
     * cannot delete the others.
     *
     * @param field - the form-field snapshot for `providers`.
     * @returns the parsed object, or `{}` when it is empty or malformed.
     */
    function readProviders(field) {
      const raw = field?.text
      if (typeof raw !== 'string' || raw.trim() === '') return {}
      try {
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
      } catch {
        return {}
      }
    }

    /**
     * The AnySearch vertical domains, as verified against the live API.
     *
     * Every entry below was probed with a real request: `ok` means the tag works on its
     * own, `needs` names the parameter the API rejects it without (the error text is
     * literally `Missing required params for tag '<tag>': <names>`), and everything not
     * listed here answered `Invalid tag`. That is why this is a fixed list rather than a
     * text box — the valid vocabulary is small, closed, and not discoverable from the UI.
     *
     * `library` / `type` are free-form per the API, so they stay text; the row tells the
     * user which key to use, which is the part that was previously unknowable.
     */
    const ANYSEARCH_TAGS = [
      { tag: '', needs: null },
      { tag: 'academic.paper', needs: null },
      { tag: 'code.doc', needs: 'library' },
    ]

    /**
     * Domains verified to work but left out of the control.
     *
     * A segmented control lays its segments on one line: eight domains measured 949px
     * inside a 640px column, and the last three were clipped off the edge. The control
     * is an `inline-grid` with a position indicator, so wrapping it with CSS moves the
     * indicator out of alignment — the honest fix is fewer choices.
     *
     * The remaining domains are still honoured if present in the config; the page shows
     * them as their own option. They are simply not offered, because the two above plus
     * general search cover what this deployment is for.
     *
     * Verified working (probed against the live API): general.general, business.company
     * (no params); finance.quote, health.drug (need `type`); travel.flight (needs
     * date,arrival,depart). Invalid: legal.case, gaming.wiki, film.movie, security.cve,
     * ip.patent, geo.place, finance.stock.
     *
     * Add one of the working domains to {@link ANYSEARCH_TAGS} if a deployment needs it;
     * keep the list at four or fewer so the control stays on one line.
     */

    /**
     * The parameters a vertical domain requires, or null when it needs none.
     *
     * @param tag - a value from {@link ANYSEARCH_TAGS}.
     * @returns the parameter key list, or null.
     */
    function requiredParamsFor(tag) {
      return ANYSEARCH_TAGS.find((item) => item.tag === tag)?.needs ?? null
    }

    /** Ids `enable` can name: the legs this plugin actually registers. */
    const MOUNTABLE_LEGS = [
      'deepseek-search-rich',
      'deepseek-fetch-rich',
      'anysearch',
      'tavily',
      'http',
    ]

    /**
     * Read `enable` as a set.
     *
     * Empty means "mount everything", so an empty set is not "mount nothing" — that
     * distinction lives in the host (`enable.length === 0` mounts all).
     *
     * @param field - the form-field snapshot for `enable`.
     * @returns the set of ids the field names.
     */
    function mountedSet(field) {
      const raw = String(field?.text ?? '').trim()
      // The host reads an EMPTY list as "mount everything", so the page must show every
      // leg ticked for it. Showing them all unticked (which is what an empty list looks
      // like if you read it literally) made the control state the opposite of the truth.
      if (raw === '') return new Set(MOUNTABLE_LEGS)
      const named = new Set(raw.split(',').map((id) => id.trim()).filter((id) => id !== ''))
      return new Set(MOUNTABLE_LEGS.filter((id) => named.has(id)))
    }

    /**
     * Which capability a leg serves, for the label.
     *
     * `http` serves fetch only, so mounting it alone leaves the search chain empty —
     * a mistake the label now makes visible.
     *
     * @param id - provider id.
     * @returns 'search' | 'fetch' | 'search+fetch' | null.
     */
    function legCapability(id) {
      if (id === 'anysearch' || id === 'tavily') return 'search+fetch'
      if (id === 'http') return 'fetch'
      if (id.startsWith('deepseek-search')) return 'search'
      if (id.startsWith('deepseek-fetch')) return 'fetch'
      return null
    }

    /**
     * Read a numeric field, falling back to the shipped default.
     *
     * @param field - the form-field snapshot.
     * @param fallback - value used when the field is empty or unparseable.
     * @returns the number.
     */
    function numberOr(field, fallback) {
      const raw = String(field?.text ?? '').trim()
      if (raw === '') return fallback
      const value = Number(raw)
      return Number.isFinite(value) ? value : fallback
    }

    /**
     * A labelled row that offers named choices instead of a blank box.
     *
     * `minBodyChars` and `timeoutMs` were free-text number boxes, which asks the user to
     * invent a threshold the plugin already measured. The measured spread is three
     * orders of magnitude (a site footer is 142–332 chars; a real article is 63k–100k),
     * so precision to the single character buys nothing — a handful of named choices
     * covers every case and states what each one means.
     *
     * @param options - key, label, hint, value, options, disabled, onChange, t.
     * @returns the row element.
     */
    function choiceRow(options) {
      const { key, label, hint, value, choices, disabled, onChange } = options
      const nodes = [
        React.createElement('label', { key: 'label', className: 'wfb-label' }, label),
        primitives.SegmentedControl({
          id: `plugin-config-web-fallback-${key}`,
          label,
          value: String(value),
          disabled,
          options: choices.map((choice) => ({ value: String(choice.value), label: choice.label })),
          onChange,
        }),
      ]
      if (hint) nodes.push(React.createElement('p', { key: 'hint', className: 'wfb-hint' }, hint))
      return React.createElement('div', { key, className: 'wfb-field' }, nodes)
    }

    /**
     * A labelled value row for one config field.
     *
     * The page must be able to set EVERY field the schema declares. Seven of them used
     * to be reachable only by hand-editing the profile patch — and that file is
     * generated from the UI, so a value the UI cannot write is a value that drifts.
     *
     * The spread mirrors the product's own settings pages (`...state.<field>`): the
     * field object carries `text`, `invalid` and `overridden`, and `SettingsValueField`
     * needs all three to render the reset control and the invalid state. Passing
     * `text` alone drops both.
     *
     * @param options - key, label, field (the form-field snapshot), numeric, placeholder,
     *   disabled, onEdit, onReset, t.
     * @returns the row element.
     */
    function valueRow(options) {
      const { key, label, field, numeric, placeholder, disabled, onEdit, onReset, t: tr } = options
      return primitives.SettingsValueField({
        id: `plugin-config-web-fallback-${key}`,
        label,
        placeholder,
        overriddenLabel: tr('overridden'),
        resetLabel: tr('reset'),
        invalidLabel: tr('invalidNumber'),
        numeric: numeric === true,
        disabled,
        ...field,
        onEdit,
        onReset,
      })
    }

    function groupTitle(key, title) {
      return React.createElement('p', { key: `group-${key}`, className: 'wfb-sectionTitle' }, title);
    }

    function switchRow(options) {
      const { key, label, hint, checked, disabled, onEdit } = options;
      const nodes = [
        React.createElement('label', { key: 'label', className: 'wfb-toggleRow' }, [
          React.createElement('span', { key: 'text' }, label),
          primitives.Switch({
            checked,
            label,
            disabled,
            onChange: (next) => onEdit(next ? 'true' : 'false'),
          }),
        ]),
      ];
      if (hint) nodes.push(React.createElement('p', { key: 'hint', className: 'wfb-hint' }, hint));
      return React.createElement('div', { key, className: 'wfb-toggle' }, nodes);
    }


    /**
     * Render the one-liner or the settings form, as the Plugins page asks.
     *
     * The controls show the entry's **stored** values (read from the same
     * configuration scope the form writes to) and stage edits through the shared
     * form model, so what is on screen is what the deployment currently runs even
     * right after a save.
     *
     * @param props - asked view, locale copy, the form snapshot, its actions, the
     * entry's stored values, and the seam's pinned providers.
     * @returns the summary text, or the form.
     */
    /**
     * Render the settings card, degrading instead of disappearing.
     *
     * If anything in the rich layout throws — a primitive this shell does not
     * export, a value shape the model did not produce — the plain form is shown
     * instead. A card showing only a few switches is still usable; a card that
     * renders nothing is not, and it is indistinguishable from a plugin that never
     * loaded. Every "the page is gone" report so far was a render-time throw whose
     * only evidence was in the browser console.
     */
    function FallbackSettings(props) {
      if (props.view === 'summary') return props.t('description');
      try {
        return RichSettings(props);
      } catch (error) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[dsh-web-fallback-chain] rich settings failed, showing the plain form:', error);
        }
        // The fallback used to call a `PlainSettings` that had been deleted, so the
        // one path meant to survive a render failure threw a ReferenceError of its
        // own and the card vanished with only a browser-console trace. A recovery
        // path that cannot run is worse than none: it hides the original error.
        // Now it renders what is always safe to render — the localized description
        // plus the underlying message, so a broken form is visible and diagnosable.
        try {
          return PlainSettings(props, error);
        } catch (again) {
          if (typeof console !== 'undefined' && console.error) {
            console.error('[dsh-web-fallback-chain] plain settings failed too:', again);
          }
          return props.t('description');
        }
      }
    }

    /**
     * The last-resort rendering: never touches `props` state or primitives.
     *
     * It exists so a failure to render the real form produces something the user
     * can read in the page itself, instead of an empty card and a console message
     * they will never see.
     */
    function PlainSettings(props, cause) {
      const t = props.t;
      const message = String(cause && cause.message ? cause.message : cause || '');
      return React.createElement('div', { className: 'wfb-fallback' }, [
        React.createElement('p', { key: 'desc', className: 'wfb-hint' }, t('description')),
        React.createElement('p', { key: 'err', className: 'wfb-error' }, message),
      ]);
    }

    function RichSettings(props) {
      const { t } = props;
      if (props.view === 'summary') return t('description');

      const state = props.useFallbackCard((snapshot) => snapshot);
      const disabled = !state.writable;
      // The leg notes are prose, so they need the active language rather than a
      // dictionary key. `props.lang` comes from apply(), which owns the locale.
      const lang = props.lang === 'en' ? 'en' : 'zh';
      // The AnySearch domain and whether it demands parameters. Resolved once so the
      // control, the parameter row and the hint all read the same value.
      const tagValue = String(state.anysearchTag?.text ?? '').trim();
      const requiredParams = requiredParamsFor(tagValue);
      const paramsNeeded = requiredParams !== null;

      /** One staged-text field, with the props every official page spreads. */
      const valueField = (options) => primitives.SettingsValueField({
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        numeric: false,
        disabled,
        ...options,
      });

      // ── Why this page is five controls and not fourteen ────────────────────
      //
      // Every field here already has a measured default, so none of them is
      // something a user must fill in. Shipping all fourteen anyway produced the
      // exact complaint this rewrite answers: "一大堆框，根本不知道要填写什么".
      //
      // The official pages in this product top out at three inputs (web-search 3,
      // subagent 2, shell 2, agent-loop 1). This page keeps the five controls that
      // correspond to a real decision, and leaves the rest to the profile's
      // `cordis.patch.yml` — which is where a value you need to *change once* belongs,
      // not a form field you must scroll past on every visit.
      //
      //   switches  freeOnly, annotateFallback  — the two behaviour toggles
      //   choice    defaultMode                 — how deep to read by default
      //   order     fetchOrder, searchOrder     — the ranking, which is the point
      //                                          of the plugin
      // One wrapper around `SettingsForm`: it owns the column width and the outer
      // padding. The host renders this card into a 960px flex section with zero
      // padding, so without a wrapper every control runs edge to edge and the copy
      // sits flush against the panel border.
      return React.createElement('div', { className: 'wfb-root' }, primitives.SettingsForm({
        labels: formLabels(t),
        state,
        onSave: props.save,
        onDiscard: props.discard,
        children: [
          groupTitle('basic', t('groupBasic')),
          switchRow({
            key: 'free-only',
            label: t('freeOnly'),
            hint: t('freeOnlyHint'),
            checked: boolOf(state.freeOnly),
            disabled,
            onEdit: (text) => props.edit('freeOnly', text),
          }),
          switchRow({
            key: 'annotate-fallback',
            label: t('annotateFallback'),
            hint: t('annotateFallbackHint'),
            checked: boolOf(state.annotateFallback),
            disabled,
            onEdit: (text) => props.edit('annotateFallback', text),
          }),
          // Four known values, so present them as four choices.
          //
          // This was a free-text box for a value that can only be `brief`, `deep`,
          // `list` or `page` — a typo was a save-time failure and the user had to know
          // the vocabulary. `SegmentedControl` is the product's own control for exactly
          // this (see dsh-client-ui-settings-models, its only other user).
          React.createElement('div', { key: 'depth', className: 'wfb-field' }, [
            React.createElement('label', { key: 'label', className: 'wfb-label' }, t('depth')),
            primitives.SegmentedControl({
              id: 'plugin-config-web-fallback-mode',
              label: t('depth'),
              value: modeOf(state.defaultMode),
              disabled,
              options: MODES.map((mode) => ({ value: mode, label: t(`mode_${mode}`) })),
              onChange: (next) => props.edit('defaultMode', next),
            }),
            React.createElement('p', { key: 'hint', className: 'wfb-hint' }, t('depthHint')),
          ]),
          // ── What the chain actually does ────────────────────────────────────
          //
          // These were two free-text boxes ("comma-separated, leftmost first") that
          // asked the user to retype an order the plugin had already measured. That is
          // the wrong question: the ranking IS the product, so the page's job is to
          // show the running ladder, not to hand over a text field and hope.
          //
          // `freeOnly` is the one thing that changes this list, so the preview is
          // rendered from the switch's current position.
          groupTitle('chain', t('groupChain')),
          chainRow('fetch', state, { t, lang, edit: props.edit, resetField: props.resetField }),
          chainRow('search', state, { t, lang, edit: props.edit, resetField: props.resetField }),
          // ── Credentials ────────────────────────────────────────────────────
          //
          // These were simply absent before: the page could toggle and reorder legs
          // but gave no way to see whether a leg had a key, let alone set one, so
          // "how do I configure the API key" had no answer in the GUI at all.
          //
          // One field per leg, showing SET / NOT SET from the Host and accepting a
          // replacement. `SettingsSecretField` never renders a stored value back —
          // `set` is write-only and `describe` returns presence only.
          // ── Advanced ────────────────────────────────────────────────────────
          //
          // Everything here has a measured default and most users never touch it —
          // but "rarely changed" is not "never changed", and the only other way to
          // change these was to hand-edit the profile patch that this page writes.
          // `minBodyChars` in particular is the fix for the most damaging failure the
          // benchmark found (a site footer counting as a successful fetch), so it has
          // to be reachable when a deployment's pages are unusually short.
          groupTitle('advanced', t('groupAdvanced')),
          choiceRow({
            key: 'min-body-chars',
            label: t('minBodyCharsLabel'),
            hint: t('minBodyCharsHint'),
            value: numberOr(state.minBodyChars, 0),
            disabled,
            choices: MIN_BODY_CHOICES(t),
            onChange: (next) => props.edit('minBodyChars', next),
          }),
          choiceRow({
            key: 'timeout-ms',
            label: t('timeoutMsLabel'),
            hint: t('timeoutMsHint'),
            value: numberOr(state.timeoutMs, 30000),
            disabled,
            choices: TIMEOUT_CHOICES(t),
            onChange: (next) => props.edit('timeoutMs', next),
          }),
          // Which legs to mount. A comma-separated id list asked the user to type
          // provider ids from memory — so instead every leg is a checkbox, and the
          // stored value is composed from what is ticked.
          React.createElement('div', { key: 'enable', className: 'wfb-field' }, [
            React.createElement('label', { key: 'label', className: 'wfb-label' }, t('enableLabel')),
            // One checkbox per leg. `Checkbox` is a plain function taking
            // {checked, onChange, label, disabled} — verified against the shipped bundle
            // rather than assumed.
            React.createElement('div', { key: 'mount', className: 'wfb-mount' },
              MOUNTABLE_LEGS.map((id) => primitives.Checkbox({
                key: id,
                label: `${id}${legCapability(id) === null ? '' : ` · ${legCapability(id)}`}`,
                checked: mountedSet(state.enable).has(id),
                disabled,
                onChange: (checked) => {
                  const next = new Set(mountedSet(state.enable))
                  if (checked) next.add(id); else next.delete(id)
                  // All-on is stored as the empty list, because that is the host's
                  // "mount everything" value. Anything less is stored as the explicit
                  // allow-list. Unchecking the last leg cannot be expressed — `[]` means
                  // all — so it is refused rather than silently mounting everything.
                  if (next.size === 0) return
                  props.edit('enable', next.size === MOUNTABLE_LEGS.length ? '' : [...next].join(','))
                },
              }))),
            React.createElement('p', { key: 'hint', className: 'wfb-hint' }, t('enableHint')),
          ]),
          // The vertical domain is a closed vocabulary validated against the live API, so
          // it is a choice, not a text box. Only the domain that needs parameters shows
          // the parameter row, and it says which key the API insists on.
          choiceRow({
            key: 'anysearch-tag',
            label: t('anysearchTagLabel'),
            hint: t('anysearchTagHint'),
            value: tagValue,
            disabled,
            choices: [
              ...ANYSEARCH_TAGS.map(({ tag }) => ({ value: tag, label: tag === '' ? t('tagGeneral') : tag })),
              // A tag set outside this list still has to be visible, or the control
              // would look like "general" while the config says something else.
              ...(ANYSEARCH_TAGS.some((item) => item.tag === tagValue)
                ? []
                : [{ value: tagValue, label: tagValue }]),
            ],
            onChange: (next) => {
              props.edit('anysearchTag', next)
              // A tag whose required params are not supplied is a guaranteed API error,
              // so switching away from one clears the params it belonged to.
              if (requiredParamsFor(next) === null) props.edit('anysearchParams', '')
            },
          }),
          // ALWAYS rendered, never conditionally.
          //
          // This row used to appear only for a domain that needs parameters. That made
          // the number of hooks in this component change with the selected tag, and
          // React aborts the whole slot when that happens — error #300 "rendered more
          // hooks than during the previous render" / #311 "fewer hooks", and the config
          // page simply vanished the moment you picked `code.doc`. A stable element
          // list that is merely disabled is the only safe shape here.
          // Kept in the element list unconditionally, and hidden with CSS when the
          // selected domain needs no parameters. Conditionally *rendering* it changed
          // the hook count and blanked the page (React #300/#311); hiding it with a
          // class changes nothing structural.
          React.createElement('div', {
            key: 'params',
            className: paramsNeeded ? 'wfb-field' : 'wfb-field wfb-hidden',
          }, [
            valueRow({
              key: 'anysearch-params',
              label: t('anysearchParamsLabel'),
              field: state.anysearchParams,
              disabled,
              onEdit: (text) => props.edit('anysearchParams', text),
              onReset: () => props.resetField('anysearchParams'),
              t,
            }),
            React.createElement('p', { key: 'params-hint', className: 'wfb-hint' },
              t('anysearchParamsRequired').replace('{keys}', requiredParams ?? '')),
          ]),
          React.createElement('p', {
            key: 'params-idle',
            className: paramsNeeded ? 'wfb-hint wfb-hidden' : 'wfb-hint',
          }, t('anysearchParamsNotNeeded')),
          // Billing classification per leg. This is the one `providers` field that
          // changes behaviour the moment it is edited: `freeOnly` reads exactly this.
          // Marking a leg free here makes the switch stop skipping it.
          React.createElement('div', { key: 'cost', className: 'wfb-field' }, [
            React.createElement('label', { key: 'label', className: 'wfb-label' }, t('costTitle')),
            React.createElement('p', { key: 'hint', className: 'wfb-hint' }, t('costHint')),
            ...costRows({
              state,
              disabled,
              onEdit: (id, next) => props.edit(`cost:${id}`, next),
              t,
            }),
          ]),
          switchRow({
            key: 'deepseek-need-content',
            label: t('deepseekNeedContentLabel'),
            hint: t('deepseekNeedContentHint'),
            checked: boolOf(state.deepseekNeedContent),
            disabled,
            onEdit: (text) => props.edit('deepseekNeedContent', text),
          }),
          groupTitle('keys', t('groupKeys')),
          ...CREDENTIALS.map(({ ref, labelKey, hintKey }) => primitives.SettingsSecretField({
            id: `plugin-config-web-fallback-key-${ref.toLowerCase().replaceAll('_', '-')}`,
            label: t(labelKey),
            hint: t(hintKey),
            disabled: state.credentials?.[ref]?.writable === false,
            text: state.credentialDrafts?.[ref] ?? '',
            configured: state.credentials?.[ref]?.configured === true,
            stateLabel: state.credentials?.[ref]?.configured === true ? t('keySet') : t('keyUnset'),
            onEdit: (text) => props.editCredential(ref, text),
          })),

          // Says where the rest went, so a missing knob reads as "documented", not
          // as "the plugin forgot to expose it".
          React.createElement('p', { key: 'save-note', className: 'wfb-note' }, t('saveNote')),
        ],
      }));
    }

    /** Services the page registers against. */
    // `remote.credentials` is a hard dependency on purpose, and it is what the
    // official web-search page declares too: without it the page could not show
    // whether a key is set, and a settings page that cannot answer that is the
    // state the user just rejected ("不知道怎么看 api key").
    const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.credentials'];

    /**
     * The credential references this plugin's legs read.
     *
     * Matches `policy/providers.js` `requiresKey` exactly: the leg asks the store
     * for this name, so the settings page must write the same one. `http` has no
     * key and is absent by design.
     */
    const CREDENTIALS = [
      { ref: 'DEEPSEEK_API_KEY', labelKey: 'keyDeepseek', hintKey: 'keyDeepseekHint', legs: 'deepseek-search-rich / deepseek-fetch-rich' },
      { ref: 'ANYSEARCH_API_KEY', labelKey: 'keyAnysearch', hintKey: 'keyAnysearchHint', legs: 'anysearch' },
      { ref: 'TAVILY_API_KEY', labelKey: 'keyTavily', hintKey: 'keyTavilyHint', legs: 'tavily' },
    ];

    /**
     * Mount this bundle's configuration page.
     *
     * @param ctx - browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-fallback: dictionaries');

      const card = new CardController(ctx.configForms.get(ENTRY_ID));

      // The credential bridge. Its state is pushed into the card's snapshot so the
      // key fields re-render when a value is stored, without a second store.
      const credentialBridge = new CredentialController(ctx, (state) => card.setCredentials(state));
      card.bridge = credentialBridge;
      // `ctx.locale.current()` is the product's accessor for the active language.
      try {
        const current = typeof ctx.locale.current === 'function' ? ctx.locale.current() : undefined;
        card.lang = String(current ?? '').toLowerCase().startsWith('en') ? 'en' : 'zh';
      } catch {
        card.lang = 'zh';
      }
      credentialBridge.refresh();
      ctx.effect(() => () => card.dispose(), 'web-fallback: form subscription');

      // Registered into `plugins.bundle.config`, keyed by PACKAGE name.
      //
      // The Plugins page has two different slots and they are not interchangeable:
      //
      //   · `plugins.item`          — cards for the harness's OWN built-in plugins
      //                               (the `extensions` group). A card registered here
      //                               is attached to a built-in plugin that does not
      //                               exist, which is why an earlier revision of this
      //                               file showed up under 「内置插件配置」 even though
      //                               this package is plainly an installed one.
      //   · `plugins.bundle.config` — the configuration page of an INSTALLED package
      //                               (the `bundles` group, 「已安装插件」), matched by
      //                               the package name the manager passes as `entryKey`.
      //
      // Same mistake, same fix as an earlier plugin of ours (see the long note above its
      // own registration): use `key`, not `id`, and pass the package name — the string that
      // pairs this card with our row in 已安装插件.
      //
      // `whileServed` keeps its original job: it defers registration until the Host
      // serves one of our entries and re-runs when that changes, so the page never
      // shows a config section that resolves to `unavailable`. Its argument is the
      // CONFIG ENTRY id (`web-fallback`), not the package name.
      ctx.effect(
        () => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: PACKAGE_NAME,
          order: 40,
          locale: NS,
          inject: () => card.inject(),
        }, FallbackSettings))),
        'web-fallback: page',
      );
    }

    /**
     * The page's staged form over the plugin's settings namespace.
     *
     * Same shape as the official card controller: one `SettingsFormModel`, a bound
     * projection per field, and `inject()` handing the slot both the snapshot store
     * and the actions.
     */
    /**
     * Reads and writes the three credential references through the Host.
     *
     * Same shape as the official web-search page's bridge, deliberately: the value
     * never comes back over the wire (`set` only writes; `describe` answers
     * configured/writable), so the page can report "set / not set" and accept a new
     * value, and nothing more.
     */
    class CredentialController {
      /**
       * @param ctx - browser plugin context carrying `remote.credentials`.
       * @param onChange - called with the new `{ ref: {configured, writable} }` map.
       */
      constructor(ctx, onChange) {
        this.ctx = ctx;
        this.onChange = onChange;
        /** @type {Record<string, {configured: boolean, writable: boolean}>} */
        this.state = {};
        /** Staged text per ref, never persisted, never echoed back by the Host. */
        this.drafts = {};
        this.disposed = false;
      }

      /** The refs this page manages. */
      refs() {
        return CREDENTIALS.map((entry) => entry.ref);
      }

      /** Ask the Host which of our refs carry a value. */
      async refresh() {
        try {
          const response = await this.ctx.remote.credentials.describe(this.refs());
          if (this.disposed || !response?.ok) return;
          const next = {};
          for (const ref of this.refs()) {
            const view = response.value?.[ref];
            next[ref] = { configured: view?.configured === true, writable: view?.writable !== false };
          }
          this.state = next;
          this.onChange(this.state);
        } catch (error) {
          // A deployment without a credential provider is a supported state: the
          // keys then come from the environment only, and the page says so by
          // showing every field as unset rather than failing to render.
          if (typeof console !== 'undefined' && console.error) {
            console.error('[dsh-web-fallback-chain] credentials unavailable:', error);
          }
        }
      }

      /** Stage a value for one ref; nothing is written until save. */
      edit(ref, text) {
        this.drafts[ref] = String(text ?? '');
        this.onChange(this.state);
      }

      /** Write every staged value, then re-read what the Host now holds. */
      async commit() {
        for (const [ref, value] of Object.entries(this.drafts)) {
          if (value.length === 0) continue;
          await this.ctx.remote.credentials.set(ref, value);
        }
        this.drafts = {};
        await this.refresh();
      }

      /** Whether anything is staged. */
      get dirty() {
        return Object.values(this.drafts).some((value) => value.length > 0);
      }

      /** Drop staged values and event handlers. */
      dispose() {
        this.disposed = true;
        this.drafts = {};
      }
    }

    class CardController {
      /**
       * @param scope - the bound settings scope for this plugin's namespace.
       */
      constructor(scope) {
        this.scope = scope;
        this.form = new primitives.SettingsFormModel(scope, [
          booleanField('freeOnly'),
          booleanField('annotateFallback'),
          textField('defaultMode', 'brief'),
          orderField('order'),
          orderField('searchOrder'),
          // NOTE: the eight `modeOrders.<capability>.<mode>` lists are deliberately NOT
          // registered here. They are not config fields — the schema has one
          // `modeOrders` object — so a spec under those names would stage edits the
          // host silently drops. `edit()` composes them into `modeOrders` directly.
          jsonField('providers'),
          numberField('minBodyChars'),
          numberField('timeoutMs'),
          // ─── fields the page used to leave to the patch file ───────────────
          //
          // Every one of these is read by the host (`readField`), so leaving them
          // out of the form meant they could only be changed by hand-editing YAML
          // that the UI itself generates. The rule is the other way round: if the
          // schema declares it, the page must be able to write it.
          booleanField('deepseekNeedContent'),
          textField('anysearchTag', ''),
          textField('anysearchParams', ''),
          orderField('enable'),
        ]);
        // Staged per-mode drafts, keyed by `MODE_FIELDS.key`. They exist because
        // eight inputs share one stored `modeOrders` object and the generic form
        // model stages one draft per *config field*.
        this.modeDrafts = this.draftsFromScope(scope);
        /** Credential presence, pushed in by the bridge after each Host read. */
        this.credentialState = {};
        /** Set by `apply` to the live credential bridge (write path for keys). */
        this.bridge = undefined;
        /** Active language for the few prose strings that are not dictionary keys. */
        this.lang = 'zh';
        this.store = this.form.bind(() => this.projection());
      }

      /**
       * Receive credential presence from the bridge and republish the snapshot.
       *
       * @param state - `{ ref: {configured, writable} }` as the Host reported it.
       */
      setCredentials(state) {
        this.credentialState = state ?? {};
        // `store` is created in the constructor, but `setCredentials` can run from a
        // bridge callback that fires before the first render; guard rather than
        // throw, because losing a repaint is survivable and losing the page is not.
        if (this.store !== undefined && typeof this.store.set === 'function') {
          this.store.set(this.projection());
        }
      }

      /**
       * Seed the per-mode drafts from what the namespace currently stores.
       *
       * Reading through `form.field` is not possible here — the form model keys
       * drafts by config field name, and these eight are not config fields — so the
       * scope's snapshot is read directly. A scope that cannot describe itself
       * (a read-only deployment, a test double) simply yields empty drafts, which
       * means "use the measured default".
       */
      draftsFromScope(scope) {
        const drafts = {};
        try {
          const snapshot = scope?.getSnapshot?.();
          const value = snapshot?.value ?? snapshot ?? {};
          const orders = value?.modeOrders ?? {};
          for (const { capability, mode, key } of MODE_FIELDS) {
            const ids = orders?.[capability]?.[mode];
            if (Array.isArray(ids) && ids.length > 0) drafts[key] = formatIds(ids);
          }
        } catch {
          // A snapshot that throws is not worth failing the page over: empty
          // drafts render the same controls with the defaults in effect.
        }
        return drafts;
      }

      /**
       * The card's snapshot: the form shell plus each field's own staged state.
       *
       * `form.field(name)` is what the official pages spread straight into
       * `SettingsValueField` (`...state.maxParallelToolCalls`); reading raw values
       * instead would bypass the staged/edit-tracking behaviour the form needs.
       */
      projection() {
        return {
          ...this.form.shell(),
          freeOnly: this.form.field('freeOnly'),
          annotateFallback: this.form.field('annotateFallback'),
          defaultMode: this.form.field('defaultMode'),
          order: this.form.field('order'),
          searchOrder: this.form.field('searchOrder'),
          // Per-mode drafts are staged outside the form model (see the constructor note);
          // the page reads them from `modeDrafts`, not from `form.field`.
          ...Object.fromEntries(MODE_FIELDS.map(({ key }) => [key, { text: this.modeDrafts[key] ?? '' }])),
          providers: this.form.field('providers'),
          deepseekNeedContent: this.form.field('deepseekNeedContent'),
          anysearchTag: this.form.field('anysearchTag'),
          anysearchParams: this.form.field('anysearchParams'),
          enable: this.form.field('enable'),
          credentials: this.credentialState,
          minBodyChars: this.form.field('minBodyChars'),
          timeoutMs: this.form.field('timeoutMs'),
        };
      }

      /**
       * Stage one leg's billing classification inside `providers`.
       *
       * Preserves every other key on the entry: `providers` also carries `maxChars`,
       * `requiresKey` and `note`, and rebuilding from `{ cost }` alone would delete
       * whichever of those the deployment had set.
       *
       * @param id - provider id.
       * @param text - 'paid' | 'free'; anything else removes the override.
       */
      editCost(id, text) {
        const value = String(text ?? '').trim()
        const next = { ...readProviders(this.projection().providers) }
        const entry = { ...(next[id] ?? {}) }

        if (value === 'paid' || value === 'free') entry.cost = value
        else delete entry.cost

        if (Object.keys(entry).length === 0) delete next[id]
        else next[id] = entry
        this.form.actions().edit('providers', JSON.stringify(next))
      }

      /**
       * Build the face the slot registration injects.
       *
       * @returns the page's snapshot store and its form actions.
       */
      inject() {
        return {
          hooks: { fallbackCard: this.store },
          lang: this.lang,
          credentials: this.credentialState,
          editCredential: (ref, text) => this.bridge?.edit(ref, text),
          ...this.form.actions(),
          // One Save button for both halves of the page.
          //
          // The generic `save` only commits the config form; a staged API key would
          // be silently discarded, which is the worst possible outcome for a secret
          // the user just pasted. So the credentials are written first (a key that
          // fails to store must not look saved), then the config form commits.
          save: async () => {
            await this.bridge?.commit();
            await this.form.actions().save();
          },
          // The per-mode fields are drafts of ONE stored value, so the generic
          // `edit(key, text)` cannot write them: it would look up a config field
          // named `modeFetchBrief`, which does not exist. Each edit restages that
          // draft and recomposes the whole `modeOrders` object from all eight.
          edit: (key, text) => {
            // `quality:<id>` edits one number inside the nested `providers` object.
            // One row per leg beats a JSON box: the user types a score, not a schema.
            if (key.startsWith('cost:')) {
              this.editCost(key.slice('cost:'.length), text);
              return;
            }
            const modeField = MODE_FIELDS.find((field) => field.key === key);
            if (modeField === undefined) {
              this.form.actions().edit(key, text);
              return;
            }
            this.modeDrafts[modeField.key] = String(text ?? '');
            this.form.actions().edit('modeOrders', JSON.stringify(modeOrdersFrom(this.modeDrafts)));
          },
          resetField: (key) => {
            if (key.startsWith('cost:')) {
              this.editCost(key.slice('cost:'.length), '');
              return;
            }
            const modeField = MODE_FIELDS.find((field) => field.key === key);
            if (modeField === undefined) {
              this.form.actions().resetField(key);
              return;
            }
            delete this.modeDrafts[modeField.key];
            this.form.actions().edit('modeOrders', JSON.stringify(modeOrdersFrom(this.modeDrafts)));
          },
        };
      }

      /** Release accepted-value subscriptions. */
      dispose() {
        this.form.dispose();
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
