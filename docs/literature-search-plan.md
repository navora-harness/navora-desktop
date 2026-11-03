# 文献检索加速方案

状态：首版功能已落地；本文件后续阶段仍待实施。本文定义 Navora 桌面端文献检索模块的边界、接口、并发策略和验收顺序。

## 目标与边界

首版目标是用户提交一次主题后，并发查询多个学术元数据 API，在单个来源响应慢或失败时仍尽快展示其他来源结果；最终列表统一、去重、可追溯。浏览器自动化不作为主检索链路，网页只用于用户打开论文原始页面。

首版支持主题检索、年份筛选、来源选择、结果数量上限、取消检索、结果导出和打开来源链接。首版不做自动全文下载、付费数据库登录、系统综述级的 PRISMA 审核、AI 自动判定纳入/排除，也不承诺所有来源覆盖相同。

## 数据来源与接入顺序

| 优先级 | 来源 | 首版用途 | 接入方式与注意事项 |
| --- | --- | --- | --- |
| P0 | OpenAlex | 综合学术作品检索、作者/期刊、开放获取信息 | Works 搜索；字段用 `select` 收窄；单页最多 100 条。无 API key 可用，配置 key 后提升预算；搜索语义端点另有较低频率限制，按来源独立限流。 |
| P0 | Crossref | DOI、出版物元数据与题名检索补充 | REST Works 查询；设置 `mailto` 或 agent 标识进入 polite pool；从响应头读取速率及并发限制，429 后退避。不要把全局并发值写死成高数。 |
| P1 | Semantic Scholar | 相关性排序、引用数、开放 PDF 和学术关系补充 | Paper Search；仅请求列表需要的字段，默认每页最多 100 条；配置 API key（如用户持有）并分别限流。超过常规搜索上限时才考虑 bulk API。 |
| P2 | Europe PMC | 医学、生物领域增强 | 领域识别或用户启用后接入；REST search，可补 PMID、PMCID 和全文链接。 |

检索不应将所有来源强行拼成一条相同查询语法。建立通用检索意图（主题、短语、作者、年份、文献类型），再由适配器转换成各来源支持的参数。初版主题检索默认一条主查询加最多两条同义词扩展，不做指数式的“词组 × 数据源”展开。

## 架构

适配 Navora 当前 Electron + Vue 架构，网络请求在 Electron 主进程执行，渲染层不直接持有 API key。

```text
Vue LiteratureSearchPanel
  └─ preload typed bridge: literature.search / cancel / settings
       └─ Electron IPC handlers
            └─ SearchCoordinator
                 ├─ QueryPlanner (bounded query variants)
                 ├─ ProviderRegistry
                 │    ├─ OpenAlexAdapter
                 │    ├─ CrossrefAdapter
                 │    ├─ SemanticScholarAdapter
                 │    └─ EuropePmcAdapter (optional)
                 ├─ PerProviderRateLimiter + RetryPolicy
                 ├─ Normalizer + Deduplicator + Ranker
                 └─ SearchCache (SQLite later; JSON/IndexedDB prototype only if no existing DB)
```

建议模块边界：

- `shared/literature-search.ts`：IPC 请求/事件和统一文献记录类型。
- `electron/modules/literature-search.ts`：协调器、适配器、来源队列、重试和结果合并。
- `electron/main.ts`：注册 IPC handler；校验请求形状、查询长度、允许的数据源与页大小。
- `electron/preload.ts` 与 `electron/types/custom-electron.d.ts`：只暴露窄类型接口，不暴露任意 URL fetch。
- `src`：检索输入、来源开关、筛选、进度、结果列表和来源状态视图。

实现前应核对现有 settings-store、IPC 命名和 renderer 页面路由，复用现有配置存储，不另建平行设置体系。

## 并发执行策略

1. 点击查询后生成 `searchId`，由主进程为这一轮创建 `AbortController`；重复提交可选择取消上一轮或并行保留，首版默认取消上一轮，避免 UI 状态混淆。
2. 先并发启动所有启用来源的主查询。跨来源并行，不等最慢来源结束；每个来源完成后立即发送批次结果和状态事件给渲染层。
3. 每个来源有独立队列与 token bucket/semaphore。初始保守值：OpenAlex REST 2 并发、Crossref polite 2 并发、Semantic Scholar 1 并发、Europe PMC 2 并发。它们是客户端起始值，不是服务承诺；响应头或官方策略更严格时动态降低。
4. 同一来源的多个查询变体按来源上限调度，不无限 `Promise.all`。普通主题首版限制最多 3 个 query variant × 启用来源；只对高召回模式开放更多变体。
5. 分页与首轮查询分开：首屏请求先取 20–50 条并快速返回；用户点“加载更多”时再按来源分页。不同来源分页游标只由对应 adapter 保存。
6. 采用单次请求超时（建议 8 秒）、单来源预算（建议 15 秒）和整轮可取消控制。超时结束该来源本轮，其他来源继续；完成或取消后忽略迟到事件。
7. 对 `429` 优先读取 `Retry-After` 及来源速率响应头；若缺失使用带抖动指数退避（约 1、2、4 秒，最多重试 2 次）。对 `5xx` 和网络错误重试；对 `4xx` 参数错误不重试。429 重试期间也不阻塞其他来源。
8. 每条来源状态独立显示：排队、查询中、已完成、部分结果、限流等待、失败、已取消。全部来源失败才显示整轮失败；部分成功显示可用结果及失败来源。

并发不等于不受限制地同时发请求。Crossref 当前公开了速率/并发响应头并区分公共与 polite pool；OpenAlex 对无 key、key 及语义搜索设不同预算；所以 coordinator 的核心是“跨来源并发 + 来源内受控”，并根据响应头自适应。

## 统一数据结构

```ts
interface LiteratureWork {
  id: string;                 // 稳定内部 ID：优先 DOI，其次 provider:id
  title: string;
  authors: Array<{ name: string; id?: string }>;
  year?: number;
  publishedAt?: string;
  venue?: string;
  abstract?: string;
  doi?: string;
  urls: Array<{ kind: 'landing' | 'pdf' | 'doi'; url: string; source: string }>;
  citationCount?: number;
  openAccess?: boolean;
  type?: string;
  sources: string[];          // 合并记录的来源名
  sourceIds: Record<string, string>;
  relevance?: number;
}

interface ProviderStatus {
  provider: string;
  state: 'queued' | 'running' | 'complete' | 'partial' | 'rate_limited' | 'failed' | 'cancelled';
  resultCount: number;
  elapsedMs?: number;
  retryAt?: number;
  message?: string;           // 面向用户的简短错误，不带 key/请求认证信息
}
```

归一化要求：DOI 小写化并去除 `https://doi.org/` / `doi:` 前缀；标题做 Unicode NFKC、大小写折叠、标点与空白归一；作者名保留展示形式但可用规范化值做匹配；摘要保留原字段，不拼接不同来源的内容。

## 去重与排序

去重分两层：

1. DOI 完全一致则合并。
2. 无 DOI 时，对规范化题名 + 年份做候选匹配；使用 Jaro-Winkler 或 token 相似度（阈值先设 0.94），并要求年份一致或一方缺失。不要只按题名合并，以免短标题或同题不同版本误并。

合并采用“字段择优”而不是覆盖：保留最完整的作者、摘要、期刊、年份、URL；保留所有 `sources` 和 `sourceIds`。摘要若互相冲突，选择信息量更完整的一项，并在来源明细中允许查看其 provider。

排序分两层：先用来源原生 relevance（若有）归一化到 0–1；再以用户查询词标题/摘要命中、年份新旧、引用数（仅作弱特征）和字段完整度做混合排序。首版不把引用数当质量或因果证据。结果 UI 支持相关度、年份、引用数排序，默认相关度。

## API 密钥、隐私与可靠性

- API key 通过应用设置录入，使用 Electron safeStorage 或当前项目已有的安全凭据能力加密保存；禁止写入 renderer 日志、URL、错误文本、分析事件或文档示例。
- Crossref `mailto` 使用用户明确设置的联系邮箱；未设置时不伪造身份。
- 缓存 key = provider + 规范化 query + 筛选条件 + API schema version；建议成功结果缓存 24 小时，空结果缓存 1 小时，错误不缓存。用户可刷新绕过缓存或清理缓存。
- 仅缓存元数据与来源地址，不缓存付费全文；缓存数据记录 `fetchedAt` 和 provider，UI 可显示来源与抓取日期。
- 所有请求使用 HTTPS、固定 allowlist base URL、限制响应大小和解析耗时；禁止接受 renderer 任意 URL，避免 SSRF。
- 尊重来源服务条款、限流与署名/引用要求；API 可用性不作 SLA 承诺。

## 界面与交互

- 搜索栏：自然语言主题；可选年份范围、结果数量、学科/来源、开放获取开关。
- 来源选择默认开启 OpenAlex + Crossref + Semantic Scholar；医学领域可推荐 Europe PMC。各来源显示当前状态和命中数。
- 查询后立即显示 skeleton 和各 provider 状态；批次到达即追加结果，不等全体 `Promise.all` 完成。
- 提供取消按钮；完成后显示总条数、去重数、缓存命中和部分失败提示。
- 单条卡片显示题名、作者、年份、来源、DOI、摘要摘要片段、开放获取标记和“打开来源”；不默认下载 PDF。
- 支持复制 DOI/引用文本和导出 CSV/RIS/BibTeX（MVP 可先 CSV + BibTeX，RIS 后补）。

## IPC 契约草案

```ts
searchLiterature(input: SearchInput): Promise<{ searchId: string }>;
cancelLiteratureSearch(searchId: string): Promise<void>;
onLiteratureSearchEvent(callback: (event: SearchEvent) => void): Unsubscribe;
getLiteratureProviderSettings(): Promise<ProviderSettingsView>; // 不回传 secret，只回传 configured 状态
saveLiteratureProviderSettings(input: ProviderSettingsInput): Promise<void>;
```

`SearchEvent` 包含 `searchId`、递增 `sequence` 和以下类型之一：`provider-status`、`results-batch`、`search-summary`。渲染端只接受当前活动 `searchId` 的事件，按 sequence 忽略过期/乱序事件。preload API 使用明确参数，不暴露通用 IPC 或 fetch。

## 实施阶段与交付

### 阶段 0：对接准备

- 确认主进程模块注册模式、settings-store、安全存储、导航入口和现有列表样式。
- 固化类型、统一错误分类、provider adapter contract 和 mock transport。
- 交付：架构骨架和 IPC schema。

### 阶段 1：并发检索核心

- 实现 OpenAlex、Crossref 和 Semantic Scholar adapter。
- 实现来源级限流、有限并发、AbortController、超时、429/5xx 退避和事件式增量结果。
- 实现规范化、DOI/标题年份去重和基础相关度排序。
- 交付：输入主题即可得到多来源合并结果；单源失败不阻断其他源。

当前首版已接入三个来源的并发请求、增量事件、取消、基础 DOI/题名年份合并、来源级串行队列和有界限流/服务错误重试。按响应头自适应限流、丰富的排序、响应缓存、API key 设置与 Europe PMC 尚未实现。

### 阶段 2：桌面 UI 与可操作结果

- 接入搜索面板/页面、来源开关、筛选、进度、取消、加载更多、打开来源。
- 做 CSV/BibTeX 导出与 API 设置入口。
- 交付：普通用户无需开发者工具即可完成一轮检索和保存结果。

当前首版已提供检索入口、年份过滤、来源选择、逐源状态、取消、来源跳转和 CSV 导出；引用格式导出与更多筛选尚未实现。

### 阶段 3：缓存与领域扩展

- 加入持久缓存、刷新/清缓存、Europe PMC adapter、引用追踪/相似文献入口。
- 交付：重复检索响应显著加快，医学领域覆盖改善。

### 阶段 4：效果优化

- 收集脱敏后的本地耗时统计（仅用户开启诊断时），按 provider 查看 p50/p95、限流率、空结果率。
- 调整首屏字段、分页和 query variants；以真实检索场景决定是否增加更多来源。
- 不上传搜索主题或 API 返回内容作为默认遥测。

## 验收标准

1. 3 个首发来源同时启用时，真实网络请求可重叠；首个来源完成即展示，不等待最慢来源。
2. 模拟任一来源超时、429、500、畸形 JSON 时，其他来源正常返回；界面清楚标记部分失败。
3. 取消后不再追加该 `searchId` 的迟到结果；新检索不会被旧事件污染。
4. DOI 相同结果确定合并；无 DOI 的相似标题/年份结果按阈值合并，年份冲突不误并。
5. 页面重复查询可命中缓存，手动刷新绕过缓存；过期缓存按策略更新。
6. 并发数不超过各 provider limiter；429 退避符合响应头，不产生无上限重试。
7. API key 不出现在 renderer、日志、异常消息和导出字段中。
8. 每条结果保留来源、来源 ID、查询批次和抓取时间，用户能打开原始来源。
9. 类型检查、核心单元测试与桌面构建通过；另用 mock server 测调度和失败场景，真实 API 冒烟调用为可选手工验收，避免 CI 依赖外部服务。

## 外部 API 依据

- [OpenAlex API reference](https://help.openalex.org/api/) 与 [authentication and rate limits](https://help.openalex.org/api/authentication/)：API 查询、字段选择、分页及按身份/端点区分的限流说明。
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) 与 [access and authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication)：REST 元数据、polite pool、响应中的速率与并发头。具体额度可能变化，运行时读取响应头并遵守最新策略。
- [Semantic Scholar Academic Graph API](https://api.semanticscholar.org/api-docs/)：论文搜索、字段选择、分页上限及可选 `x-api-key`。
- [Europe PMC REST API](https://dev.europepmc.org/RestfulWebService)：医学/生命科学检索、全文与相关记录接口。

外部来源查阅日期：2026-11-03。实施时再次核对各服务官方文档和使用条款，尤其是额度、字段和访问策略。
