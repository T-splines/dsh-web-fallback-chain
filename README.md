# dsh-web-fallback-chain

[English](https://github.com/T-splines/dsh-web-fallback-chain/blob/main/README.en.md) | **简体中文**

**给 DeepSeek Harness 的网页搜索与抓取提供一条按质量排序、带成本感知的回退链——实测排序、free-only 开关、一个设置页。**

DSH 的 `ctx.web` 每个能力只能选**一个** provider，配置里写的是固定 id 而不是优先级列表，
所以「先试最好的，失败后自动退到免费的」无法在 profile 里表达。本插件为每个能力注册一个
provider，其内部顺序就是那张优先级列表；同时把每个独立档位也注册出来，想单钉哪一个都可以。

- [为什么需要它](#为什么需要它)
- [差异点](#差异点)
- [注册了什么](#注册了什么)
- [安装](#安装)
- [默认排序](#默认排序)
- [free-only 开关](#free-only-开关)
- [设置页](#设置页)
- [配置](#配置)
- [为什么是一个包而不是四个](#为什么是一个包而不是四个)
- [测试](#测试)
- [兼容性](#兼容性)

## 为什么需要它

DSH profile 能指定「用哪个网页 provider」，但不能指定「按什么顺序试多个」。主搜索或抓取
失败时请求就失败，没有「再试下一个免费档」的接缝。若在每个部署里各写一遍，就会变成四个包、
四个设置页，以及升级时必须同步改的锁步问题。

本插件把有序链放回 provider 槽位：

```
web_search ──▶ search-chain ──▶ deepseek-search-rich ──▶ anysearch ──▶ tavily
web_fetch  ──▶ fetch-chain  ──▶ anysearch ──▶ tavily ──▶ deepseek-fetch-rich ──▶ http*
```

`http*` 是可选的普通 HTTP 档，由部署方另行提供（例如另一个 web-fetch 插件）；本包
**不注册**它。链首的**可用**档服务每个请求；其余档只在它失败或返回内容太少时才尝试。
顺序按「返回质量」排，不是按「尝试成本」排。默认 `freeOnly: true` 时付费档在调用时被
跳过，所以实际链首是第一个免费可用档。

## 差异点

- **实测排序，不是拍脑袋。** 默认顺序来自本插件自己的 benchmark：15 个页面盲评抓取质量、
  10 条查询盲评搜索相关性、20 个站点的可用性测试。数字是起点，不是对某个页面的承诺。
- **free-only 真的会跳过付费档。** `freeOnly` 在**调用时**判断；关闭后恢复的是**同一份**
  顺序，而不是另外维护一张表。
- **一个包、一个设置页。** ▲▼ 调整档位、切换 free-only、标注回退来源、切换读取模式；
  没有第二份配置需要同步。
- **诚实的回退。** 链结果是无损 JSON，可以把实际服务的档位写进输出；短正文默认不算失败
  （`minBodyChars` 默认 0），需要时再开启长度门槛。
- **每个 provider 都有明确价值。** DeepSeek 搜索映射 `summary`（600–800 字）而不只是
  snippet；AnySearch 是实测能穿过 bot 墙的档位；Tavily 是免费档里能抽取 PDF 的那个。
- **在关键位置有测试。** 162 个 `node --test` 用例，包括用 `vm` + 假模块加载器渲染真实设置页，
  以及每个设置字段的往返测试。

## 注册了什么

| id | 能力 | 说明 |
|:--|:--|:--|
| `search-chain` | search | 有序搜索链（把 `searchProvider` 钉到它） |
| `fetch-chain` | fetch | 有序抓取链（把 `fetchProvider` 钉到它） |
| `deepseek-search-rich` | search | DeepSeek 搜索，映射 `summary`（600–800 字） |
| `deepseek-fetch-rich` | fetch | DeepSeek 抓取 |
| `anysearch` | search + fetch | AnySearch；实测唯一能穿过 bot 墙的档位 |
| `tavily` | search + fetch | Tavily；免费档里唯一能抽取 PDF 的 |

`http` 故意**不在**这张表里：它由部署方提供，不属于本包。链里可以点名它；当另一个插件
注册了该 id 时，抓取链退到它就会使用它。

## 安装

要求：DSH `0.2.2-rc.x`、Node.js 20+，以及 `DEEPSEEK_API_KEY`、`ANYSEARCH_API_KEY`、
`TAVILY_API_KEY` 中**至少一个**。没有 key 的档仍会注册并自报不可用，所以一个 key 都没有
时链里没有可调用的档。可选的普通 HTTP 档（`http`）需要另装 web-fetch 插件提供。

### 从 npm 安装

```bash
dsh plugin --profile web add @magic6/dsh-web-fallback-chain
```

### 从源码安装

```bash
git clone https://github.com/T-splines/dsh-web-fallback-chain.git
cd dsh-web-fallback-chain
dsh plugin --profile web add "$PWD"
```

包本身是一个 bundle（`dsh.bundle.patch`），默认 entry 由 bundle 挂载。把链 provider 钉到
profile 补丁里（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）：

```yaml
- id: web
  config:
    searchProvider: search-chain
    fetchProvider: fetch-chain
```

重新加载 profile（或重启 web app），打开 **插件 → 已安装插件 → 网页回退链
（@magic6/dsh-web-fallback-chain）**，设置卡片就在插件详情页上。如果 profile 里已经钉了别的
provider，把那些钉换掉即可。

profile entry id 仍是 `web-fallback`。如果从旧包名 `dsh-web-fallback` 升级，请先卸载旧包；
两个都装会把同一个 entry 挂载两次。entry id 没变，原有设置继续有效。

不启动 agent 验证组合树：

```bash
dsh --profile web --dump-config | grep -A6 'id: web-fallback'
```

## 默认排序

默认**严格按实测质量降序**，所有读取模式一致：

| 档位 | 质量 | 成本 | key |
|:--|:--|:--|:--|
| `deepseek-search-rich` | 9.6 | 付费 | `DEEPSEEK_API_KEY` |
| `anysearch` | 7.3 | 免费 | `ANYSEARCH_API_KEY` |
| `tavily` | 7.3 | 免费 | `TAVILY_API_KEY` |
| `deepseek-fetch-rich` | 5.4 | 付费 | `DEEPSEEK_API_KEY` |
| `http` | 4.0 | 免费 | —（外部档，不由本包提供） |

搜索顺序：`deepseek-search-rich → anysearch → tavily`。
抓取顺序：`anysearch → tavily → deepseek-fetch-rich → http`（最后一档只有外部
web-fetch 插件注册时才存在）。

`quality` 只用于排序，不是对某个页面的承诺；数字来自本插件自己的 benchmark，你的语料可能
排序不同。设置页调整后写入扁平的 `order` / `searchOrder`，对所有模式同时生效。

## free-only 开关

`freeOnly`（默认**开启**）在**调用时**跳过所有标记为 `paid` 的档位。它**不重排**：排序只有
一份，关闭开关后恢复同一序列。设置页把付费档灰显而不是隐藏，所以显示顺序始终等于存储顺序。

## 设置页

设置页在插件详情页上——**插件 → 已安装插件 → 网页回退链**——不在「设置」里。
卡片只有五个主要控件，因为每个设置都有实测默认值，没有一个是必须填的：

- 两个开关：`freeOnly`、`annotateFallback`
- 一个选择：`defaultMode`（`brief` / `deep` / `list` / `page`）
- 两个 ▲▼ 阶梯：搜索链、抓取链

卡片里还有一个**高级**区，放的是比较可能调整的设置：`minBodyChars`、`timeoutMs`、
`enable` 白名单（以挂载勾选框呈现）、每档 `cost`、`deepseekNeedContent`、
`anysearchTag`，以及三个 API key。

## 配置

下表是完整字段参考，包括少数只能写补丁的字段：

| 字段 | 位置 | 含义 |
|:--|:--|:--|
| `minBodyChars` | 高级 | **默认 0（关闭）：只看 HTTP 状态。** 设置后，短正文算未命中并继续链。长度门槛分不清页脚（142–332 字）和合法短页面：`example.com` 有 171 字真实正文。 |
| `timeoutMs` | 高级 | 单档超时，默认 30000。 |
| `order` / `searchOrder` | ▲▼ 箭头 | 每个能力的扁平阶梯；覆盖所有模式，优先于内置的按模式默认值。 |
| `modeOrders` | 仅补丁 | 按能力、按模式的覆盖：`{ fetch: { deep: [...] } }`。只给需要特殊行为的模式用；未覆盖的模式回落到 `order`。如果 `order` 也为空，则使用内置的按模式默认值——这正是「零配置默认行为」的来源。 |
| `enable` | 高级 | 允许注册的档位白名单。**空 = 全部**。用来让某个 provider 永远不被调用。 |
| `providers` | 高级（cost）/ 补丁（其余） | 每档元数据覆盖：`cost`（`freeOnly` 读它）、`maxChars`、`requiresKey`、`kinds`、`note`。`quality` 只作文档，运行时不读。 |
| `deepseekNeedContent` | 高级 | DeepSeek 搜索全文；无论开关都按次计费，响应从 ~5 KB 涨到 ~45 KB。 |
| `anysearchTag` | 高级 | 垂直路由，例如 `code.doc`；改变查询语义，不改变排序。 |
| `anysearchParams` | 仅补丁 | 额外 AnySearch 参数，原样透传。 |

> **保存会重写 config 块。** 设置页通过宿主的 `configForms` 写入器整体替换 `config` 映射，
> 所以 config 块里的注释不会在保存后保留。这就是本表存在的原因；文件其它位置的注释不受影响。

API key 在设置页输入，存进宿主凭据库；各档位**先查凭据库、再查环境变量**，所以页面上
输入的 key 无需重启即可生效。

## 测试

```bash
npm install --no-audit --no-fund   # peer 依赖提供测试所需的 import
npm test
```

没有构建步骤，但干净 checkout 必须先 `npm install`：测试会 import
`@deepseek-ai/schemastery` 与 `@deepseek-ai/dsh-web`，它们声明为 peer 依赖，不随包分发。

`test/client-render.test.js` 用 `vm`、假 `__ModuleLoader__`、假 `primitives` 和按宿主方式
展开 `inject().hooks` 的假上下文，运行真实的 `client.js`。静态检查曾漏掉五种「页面消失」的
方式（包括 `Button` 是 `forwardRef` 对象而不是可调用函数），所以这里用真实渲染路径锁住。

另有一类 bug 出现过三次：`settingsTextField` 是**字符串**字段，spec 只覆盖 `parse` 会让读取方向
失效，任何非字符串值（boolean/array/object）都读回 `''`。现在对每个注册字段都做往返断言。

## 为什么是一个包而不是四个

最初按单一职责拆成四个包（策略 / 厂商 / 抓取链 / 搜索链）。实际结果是四个设置页、一个
根本无法配置的包（共享策略没有 `apply()`），以及升级时必须同步改版本的锁步问题。模块是
内部拆分的好单位；安装和配置的单位应当是包，而且只应该有一个。

```
config.js         一份 schema -> 一个设置页
policy/           谁免费、哪个模式要什么顺序、正文取多少
providers/        各厂商 HTTP 档
chains/           排序与回退逻辑
prompt.js         唯一一段系统提示（何时使用 web_search）
client.js         设置页
cordis.patch.yml  默认配置，每个字段都列出
```

## 兼容性

- DSH `0.2.2-rc.x`（`engines.dsh` 为 `>=0.2.2-0 <0.3.0-0`）。
- Node.js 20+。
- 本插件与 DeepSeek 官方无关；DSH 与文中 provider 都是独立项目。

## 许可

MIT，见 [LICENSE](LICENSE)。
