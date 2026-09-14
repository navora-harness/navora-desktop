# Navora 项目与插件开发说明（供外部 AI 分析）

| 项 | 内容 |
|----|------|
| 文档用途 | 交给其它 AI / 协作者快速理解产品能力与插件开发契约 |
| 对应代码 | `navora-desktop` + `navora-plugin-sdk` + `navora-plugins` |
| 整理日期 | 2026-09-14 |
| 详细模块 | 见同目录 [`modules.md`](./modules.md)、[`architecture-plan.md`](./architecture-plan.md) |
| 插件规范原文 | [`../../navora-plugin-sdk/SPEC.md`](../../navora-plugin-sdk/SPEC.md) |

---

## 0. 一句话

**Navora** = 桌面端 **AI Agent Browser Harness**：外部 OpenAI 兼容模型 + 本地可控浏览器会话 + 权限门闩 + 可加载插件。模型在外部，工具执行在本机主进程。

- 产品名：Navora（副标题：AI Agent Browser）
- appId：`com.navora.app`
- 桌面版本：以 `navora-desktop/package.json` 的 `version` 为准

---

## 1. 仓库布局（四仓并列）

```text
navora-harness/
├── navora-desktop/          # 宿主：Electron 主进程 + Vue UI；加载插件，不编译插件
├── navora-plugin-sdk/       # 契约类型 + SPEC + CLI（navora-plugin）
├── navora-plugins/          # 官方插件源码 monorepo
└── navora-store/            # 本地测试目录仓（CLI 发布 + 静态 serve；无用户/公共市场）
```

---

## 2. 支持环境与运行时

| 项 | 说明 |
|----|------|
| OS | 主要面向 **Windows x64**（portable / NSIS） |
| 运行时 | **定制 Electron**（非原版 Electron） |
| 前端 | Vite + Vue 3 + Vuetify + TypeScript |
| LLM | **OpenAI 兼容** HTTP API（流式 + tool calling）；设置页多家预设 |
| Node（插件 CLI） | ≥ 20（sdk）；协议库侧常用 ≥ 18 |
| 插件运行位置 | **Electron 主进程**（与宿主同进程，高信任） |
| 插件产物格式 | **CJS**（默认 `main.cjs`），`require(main)` 加载 |
| 默认是否带插件 | **否**；安装包默认不含插件 |

### 数据目录

| 模式 | 路径 |
|------|------|
| 开发 | `<navora-desktop>/portable/` |
| 便携版 | `<exe 同目录>/data/` |
| NSIS | `%APPDATA%\Navora` |
| 覆盖 | 环境变量 `NAVORA_DATA_ROOT` |

含：配置、会话、密钥、工作区、已安装插件等。开发勿提交 `portable/`、`secrets/`、`config.yml`。

### 架构数据流

```text
Renderer (Vue)
  └─ preload / 远程 WS
       └─ Main IPC/RPC
            ├─ AgentRuntime → 外部 LLM
            │     └─ executeAgentTool / PluginStore.execute
            ├─ BrowserRegistry（Session / Window）
            ├─ PermissionGate
            ├─ ChatStore / Config / Secrets / Skills / Plugins
            └─ WorkspaceFiles / Downloads / Shell
```

---

## 3. 产品核心功能

### 3.1 Chat 驱动自动化

- 多 Chat 并行；每个 Chat 可挂多个浏览器 Session / Window
- Session partition：`{chatId}-{sessionIndex}`，互不串 cookie/UA
- Agent 工具：导航、点击、输入、等待、读 DOM、隔离世界 `evaluate`、网络规则、`session.fetch` 等
- **默认不向模型传截图**（理解靠 DOM/HTML/文本；截图工具存在但非默认喂模型）
- 停止 Agent = 终止该 Chat 全部进行中工作；关窗可通知运行中 Agent

### 3.2 浏览器能力要点

- UA：`UserAgentObject` + `setUserAgent`（定制 Electron）
- 代理 / Cookie / 网络拦截与修改
- `browser_session_fetch`：走 Session 网络栈（共享 cookie/代理/UA）
- `browser_load_url_with_response`：在目标 origin 下注入自定义主文档（Turnstile harness 等）
- iframe 点击：经 `browser_click` / `browser_flow` + `iframeSelector`
- URL 白名单（可选）：作用于 navigate / session.fetch；空列表 = 不限制

### 3.3 权限门闩（PermissionGate）

能力（capability）按档位控制，例如：`deny` / `ask` / `ask_chat` / `allow_notify` / `allow`。

插件与核心工具共用同一套 capability 语义。插件必须在 `planPermissions` 中申报本次调用所需能力，且 **非空**，否则拒绝执行。

### 3.4 技能（Skills）

- 用户可导入/编辑 Markdown 技能，影响 Agent 行为提示
- 与插件不同：技能偏「提示与流程描述」；插件偏「可执行 tools」

### 3.5 工作区与文件

- Chat 绑定工作区目录；`file_*`、`file_download`、`shell_exec` 等
- 下载可走 Session 网络（防盗链/Referer）

### 3.6 子对话

- `agent_spawn_subchat`：子对话看不到父全文；需把 URL/sitekey 写入 `context`
- 宿主会尝试从父对话近期消息补全 http(s) URL 与 Turnstile sitekey
- 子对话结束清理其创建的浏览器资源

### 3.7 远程

- 可选局域网 RemoteServer：把同一套 RPC 暴露给 Web UI（`navora-remote-shim`）
- 部分本机对话框类通道对远程禁止/降级

### 3.8 设置页结构

基本 / 模型 / 浏览器 / 权限 / **插件** / 关于等。

插件：外链文件夹、导入 zip、导出、启用开关、批量卸载、**查看说明**（`README.md` / `docs.md`；无文件则按钮禁用）。

---

## 4. 核心 Agent 工具清单（按域）

工具 schema：`navora-desktop/shared/agent-tools.ts`；执行：`electron/modules/browser-tools.ts` 等。

| 域 | 工具名（节选） |
|----|----------------|
| Agent 协作 | `agent_ask_user`, `agent_spawn_subchat`, `agent_await_subchats`, `agent_subchat_status` |
| 系统信息 | `datetime_now`, `geolocation_get` |
| Session | `browser_open`, `browser_session_create/close/clear`, `browser_session_set_proxy`, `browser_session_set_ua`, `browser_session_fetch` |
| Cookie | `browser_cookies_get/set/remove` |
| Window | `browser_window_create/close/set_visible/set_bounds/focus` |
| 导航 | `browser_navigate`, `browser_load_url_with_response`, `browser_back/forward/reload` |
| 等待/流程 | `browser_wait`, `browser_flow` |
| 交互 | `browser_click`, `browser_hover`, `browser_scroll`, `browser_type`, `browser_press`, `browser_select`, `browser_upload`, `browser_dialog` |
| 读取 | `browser_find`, `browser_get`, `browser_query_deep`, `browser_evaluate` |
| 截图 | `browser_screenshot`, `desktop_screenshot` |
| 网络 | `browser_network_rule_add/remove/list`, `browser_network_log/clear` |
| 资源树 | `browser_list_resources` |
| 工作区/文件 | `workspace_info/set`, `file_list/stat/read/write/mkdir/delete/move/copy/concat`, `file_download`, `file_download_compose`, `file_reveal`, `file_open` |
| Shell | `shell_exec` |
| 设置/模型 | `app_settings_get/update`, `app_models_list`, `app_provider_add` |
| 插件（只读发现） | `plugin_list`, `plugin_read` |
| 插件开发（需开启开发模式） | `plugin_build`, `plugin_check`, `plugin_pack`, `plugin_link` |
| 技能 | `skill_list/read/create/update/delete/export` |

插件启用后，其 `tools` **与上述核心工具并列**注册给 LLM（工具名必须全局唯一）。

---

## 5. 插件系统

### 5.1 设计目标

- 默认安装包 **零插件**；用户按需外链或导入
- 插件 = 一组 OpenAI function tools + 权限计划 + 主进程执行逻辑
- **禁止**插件直接 `require` 宿主内部模块；只能走受控 `PluginHostApi`

### 5.2 插件目录约定

```text
<navora-plugins>/<id>/
├── plugin.json           # 作者清单（可含 entries[] 多入口）
├── main.ts               # 单入口源码（推荐）
├── README.md             # 可选说明（设置页「查看说明」）
└── dist/<packageId>/     # 编译产物（外链 / pack 用这个目录）
    ├── plugin.json
    ├── main.cjs
    └── …
```

`plugin.json` 示例（单入口）：

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "一句话说明",
  "main": "main.cjs",
  "defaultEnabled": true,
  "bundled": false
}
```

多入口时在同一工程声明 `entries`（各 `id` + `entry` 源码路径），编译到 `dist/<entry.id>/`，用户可按包选择性导入。`pack` 无 `--entry` 时另打 `*-suite.zip`（含全部变体）；文件安装时选变体，商店仍按单包下载。详见 SDK `SPEC.md`。

- `bundled: true` 仅产品种子；不可删、不可被导入覆盖
- 作者包保持 `bundled: false`
- 可选 `suite`（kebab-case）：同套件最多保留一个已安装包；导入冲突需确认卸载（`replaceSuite`）；启用其一自动禁用同套件其它。供 Settings 与后续插件市场共用
- zip ≤ **200MB**；文件夹外链不限
- **开发外链请指向 `dist/<packageId>`**，不要指工程根
### 5.3 模块契约（TypeScript）

```ts
import type {
  NavoraPluginModule,
  PluginHostApi,
  PermissionCapability,
} from 'navora-plugin-sdk'

const plugin: NavoraPluginModule = {
  tools: [/* ChatCompletionTool[] */],

  planPermissions(toolName, args, planCtx) {
    // 必须返回非空 capabilities
    return { capabilities: ['session.fetch'] }
  },

  async execute(toolName, args, api: PluginHostApi) {
    // 只允许 api.registry / api.runTool / api.getConfig / api.helpers
    return { ok: true }
  },
}

export default plugin
```

硬性规则：

1. `planPermissions` 必填且 capabilities 非空
2. 只用 `PluginHostApi`；禁止引用 `navora-desktop` 源码路径
3. `registry` 写操作与 `runTool` 所用能力必须已申报
4. 工具名全局唯一

### 5.4 PermissionCapability 全集

```text
session.create | session.persist | session.close | session.clear
session.set_proxy | session.set_ua
session.cookies_read | session.cookies_write | session.fetch
window.create | window.close | window.set_visible
navigate | wait | click | type | get_page | evaluate
screenshot | desktop.screenshot
network.observe | network.modify | network.block
file.read | file.write | file.download | file.download.passive
shell.open | shell.exec
settings.read | settings.write | skills.write
browser.geolocation | compute.local
```

常见映射：

| 场景 | 申报 | 调用 |
|------|------|------|
| 主文档点击 | `click` | `api.runTool('browser_click', { selector })` |
| iframe 点击 | `click` | `browser_click` / `browser_flow` + `iframeSelector` |
| 自定义文档注入 | `navigate` | `browser_load_url_with_response` |
| 读 DOM / token | `evaluate` / `get_page` | `browser_evaluate` / `browser_get` |
| 纯出站 HTTPS（插件自建 HTTP） | 常申报 `session.fetch`（语义门闩） | 可不用 `runTool`，但 capability 仍须非空 |
| 设代理（含清空 `""`） | `session.set_proxy` | `api.registry.setProxy` |

### 5.5 PluginHostApi（宿主接口）

```ts
type PluginHostApi = {
  chatId: string
  signal: AbortSignal
  approvedCapabilities: readonly PermissionCapability[]
  helpers: {
    isUrlAllowed: (url: string, allowlist?: string[] | null) => boolean
  }
  getConfig: () => { browser: { url_allowlist?: string[] | null } } & Record<string, unknown>
  registry: {
    createSession(chatId, opts?): { sessionId: string }
    createWindow(sessionId, opts?): { windowId: string }
    closeWindow(windowId): void
    closeSession(sessionId, clear?): void | Promise<void>
    assertSessionOwned(chatId, sessionId)
    assertWindowOwned(chatId, windowId)
    getSessionRecord(sessionId)
    getTree(chatId): Array<{ sessionId: string }>
    setUserAgent(sessionId, ua): void
    setProxy(sessionId, proxy: string | null): void | Promise<void>
  }
  runTool(name: string, args: Record<string, unknown>): Promise<unknown>
}
```

只读 registry（`getTree` / `assert*` / `getSessionRecord`）一般不要求 capability。  
特例：已批 `window.create` 时可 `closeWindow`；已批 `session.create` 时可 `closeSession`。

### 5.6 编译 / 检查 / 打包（CLI）

包：`navora-plugin-sdk`，命令：`navora-plugin` 或在 plugins 仓 `npm run plugin -- …`

| 命令 | 作用 |
|------|------|
| `build [id]` | esbuild → `<project>/dist/<packageId>/main.cjs`（仅 external `electron`；依赖默认打进包） |
| `check [id]` | require dist 产物，校验 `tools` / `planPermissions` / `execute` |
| `pack <id>` | 从 dist 包打 zip；多入口默认：`dist/<projectId>/*-plugin.zip` + `dist/<suite>-suite.zip`；可选 `--entry` |
| `init <id>` | 脚手架 |

```bash
cd navora-plugins
npm run plugin -- build <plugin-id>
npm run plugin -- check <plugin-id>
npm run plugin -- pack <plugin-id>
# → 产物目录：<plugin-id>/dist/<packageId>/
# → zip：dist/<packageId>-<ver>-plugin.zip
```

插件根解析顺序：`--root` → `NAVORA_PLUGINS_ROOT` → cwd 下含 `plugin.json` 的子目录 → 单插件模式 → 同级 `../navora-plugins` → cwd。

### 5.7 加载方式

| 方式 | 用途 |
|------|------|
| 设置 → 外链文件夹 | 开发：指到 `navora-plugins/<id>/dist/<packageId>`；开发模式开启时 dist 变更自动重载 |
| 设置 → 导入 zip | 单包直接装；套件总包先选变体，再装到 `dataRoot/plugins/<packageId>/` |
| 设置 → 导出 | 从已加载目录打 zip |
| `NAVORA_BUNDLE_PLUGINS=1` | 打包时带宿主仓种子插件（默认关闭） |

### 5.7.1 插件开发模式

设置 → **插件** → **插件开发模式**（`plugins.dev_mode`，默认关）：

1. 打开开关：Agent 系统提示注入精简 SDK 契约（`shared/plugin-dev-prompt.md`），并暴露 **`plugin_build` / `plugin_check` / `plugin_pack` / `plugin_link`**。
2. `plugin_build` / `plugin_link` 默认将 `dist/<packageId>` **外链到当前会话**（及子对话），写入该 Chat 的 `devPluginLinks`，**不写入**全局 `plugins/index.json`。设置页「外链文件夹」仍是全局。
3. 将 Chat **工作区**设为插件工程根；热重载监视本会话外链的 dist。
4. 工具在**下次发消息**可用；`plugin_list` 中 `kind=session` 为本会话开发外链。

关闭开关后：不再注入 SDK 附录、隐藏上述工具，并停止外链目录监听。

### 5.8 安全边界

- 插件 = 本机主进程代码信任级别；无签名/市场吊销
- 最小权限原则；勿泄露密钥
- 清空代理也要报 `session.set_proxy`
- 不要绕过 `runTool` 直接操作 `BrowserWindow` / 未授权 Session

---

## 6. 官方插件（当前）

### 6.0 `crypto-suite`（多入口）

- 工程：`navora-plugins/crypto-suite`（v0.7）
- 分发包：`core` · `modern` · `web` · `pki` · `compat` · `universal`（套件 `crypto-suite`，勿同时加载）
- Core：编码（+base32/58/html/json/unicode/cookie）、`crypto_random`、哈希（+SHA-3/SHAKE）、HMAC-SHA3、AES、RSA、compress、pipeline、inspect
- Modern：+ ChaCha/XChaCha、Ed25519/**Ed448**、X25519/**X448**、ECDSA/ECDH、KDF、BLAKE2/SM3
- Web：+ **crypto_jwt**（decode/sign/verify/**JWE**/generate-jwk/**jwk-thumbprint**）
- PKI：+ **crypto_certificate**（inspect/CSR/**check-host**/verify/**verify-chain**/PKCS#12、PEM↔DER）
- Compat：Core + 遗留 MD4/RIPEMD-160/Whirlpool、DES/3DES/RC2/RC4（带 `recommended:false`）
- Universal：以上全部
- 权限：`compute.local`
- 外链：`crypto-suite/dist/crypto-suite-{core|modern|web|pki|compat|universal}`
- 返回值均为 JSON 安全字符串/对象，**不返回 Buffer**

其它官方插件以 `navora-plugins` 仓为准，宿主文档不逐一列举。

---

## 7. 开发联调速查

```bash
# 宿主
cd navora-desktop
npm install
npm run electron:dev          # 开发（数据在 portable/）

# 插件
cd navora-plugin-sdk && npm install
cd ../navora-plugins && npm install
npm run plugin -- build <id>
npm run plugin -- pack <id>
```

定制 Electron 二进制常经本机 mirror（见 desktop README / `.npmrc.example`）。

---

## 8. 明确「不做 / 未做」（避免臆造）

- 完整 Playwright 级录制回放 / 复杂选择器引擎：无
- Chrome 式多 Tab 产品壳：无（独立 BrowserWindow + 资源树）
- 视觉多模态默认喂模型：无
- 云端同步 / 公共插件市场 / 插件签名吊销：无（签名方案搁置）
- **插件/技能商店**：[`navora-store`](../../navora-store/README.md) 目录仓 + 契约 [`PROTOCOL.md`](../../navora-store/PROTOCOL.md)（schema v1：`kind`+`productId` 联合主键、catalog 相对路径、semver、`minHostVersion` / `yanked`、size+sha256）。`store.*` IPC；Settings「插件商店」「技能商店」。Agent 可用 `store_search` 查目录并在 Chat「推荐安装」用与设置页相同的列表卡片引导安装（不自动安装）。非 HTTPS 源黄叹号提示；套件合并展示；详情可拉 README/SKILL 说明；安装/更新/更改用与导入一致的确认窗，进度跟下载/校验/解压挂钩，卸载单独确认。配置项 `store.base_url`（默认 `http://127.0.0.1:8791`）。
- 默认安装包内置插件：无

---

## 9. 关键代码入口

| 主题 | 路径 |
|------|------|
| 宿主 README | `navora-desktop/README.md` |
| 模块说明 | `navora-desktop/docs/modules.md` |
| 架构规划 | `navora-desktop/docs/architecture-plan.md` |
| 核心工具 schema | `navora-desktop/shared/agent-tools.ts` |
| 插件类型契约 | `navora-plugin-sdk/navora-plugin.d.ts` |
| 插件规范 | `navora-plugin-sdk/SPEC.md` |
| 插件 CLI | `navora-plugin-sdk/bin/navora-plugin.mjs` |
| 官方插件列表 | `navora-plugins/README.md` |
| 商店协议 | `navora-store/PROTOCOL.md` |
| 商店客户端 | `navora-desktop/electron/modules/marketplace-client.ts` |
| 插件加载实现 | `navora-desktop/electron/modules/plugin-store.ts` |
| 权限门闩 | `navora-desktop/electron/modules/permission-gate.ts` |
| Agent 运行时 | `navora-desktop/electron/modules/agent-runtime.ts` |
| 工具执行 | `navora-desktop/electron/modules/browser-tools.ts` |
