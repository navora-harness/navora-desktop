# Navora 模块与功能说明

| 项 | 内容 |
|----|------|
| 文档版本 | 1.3 |
| 日期 | 2026-09-11 |
| 对应代码 | `package.json`（产品名 Navora；仓库 `navora-desktop`） |
| 相关文档 | [`architecture-plan.md`](./architecture-plan.md)、[`README.md`](../README.md) |
| 关联仓库 | [`navora-plugin-sdk`](https://github.com/navora-harness/navora-plugin-sdk)、[`navora-plugins`](https://github.com/navora-harness/navora-plugins) |
| 变更 | §9 风险项 **R1–R6 / R8–R9 已落地**；**R10 Chat 防抖写盘 + 下载/下载列表 IPC 节流**已落地；§3.4 插件 zip/外链已落地；**§12 插件签名方案搁置（仅文档）** |

---

## 0. 一句话架构

**主进程是系统真相源**（Chat / Config / Agent / Browser / Files）；**渲染进程是 UI 与事件消费者**；**preload 定义契约**；**RemoteServer 把同一套 RPC 暴露到局域网**。Agent 能力由 `shared/agent-tools.ts` 声明，经 `agent-runtime` + `browser-tools` 执行，由 `PermissionGate` 与用户分叉 / 技能审核约束。

```
Renderer (Vue) ──preload/WS──► Main IPC/RPC
                                 ├─ AgentRuntime ──► LLM (OpenAI 兼容)
                                 │       └─ executeAgentTool (browser-tools)
                                 ├─ BrowserRegistry / Network / Downloads
                                 ├─ ChatStore / Config / Secrets / Skills / Plugins
                                 └─ WorkspaceFiles / FileDownload / Shell
```

---

## 1. 顶层目录

| 路径 | 职责 |
|------|------|
| `electron/` | 主进程：生命周期、IPC、Agent、浏览器、工作区、远程 |
| `electron/preload.ts` | `contextBridge` → `window.navora` / `window.navoraElectron` |
| `shared/` | 主/渲染共用：工具 schema、配置类型、技能、加密、日志等 |
| `src/` | 渲染进程：Vue 3 + Vuetify + Router |
| `scripts/` | `dev.mjs`（联调）、`build-electron.mjs`（esbuild 打包 main/preload） |
| `docs/` | 架构规划与本模块文档 |
| `portable/` | 开发态数据根（配置、会话、密钥、工作区；勿提交密钥） |
| `config.example.yml` | 首次生成 `config.yml` 的模板 |

**数据根解析**（`electron/data-root.ts`）：

| 运行方式 | 路径 |
|----------|------|
| 开发 | `<项目>/portable/` |
| 便携版 | `<exe 同目录>/data/` |
| NSIS | `%APPDATA%\Navora` |
| 覆盖 | 环境变量 `NAVORA_DATA_ROOT` |

---

## 2. 启动与生命周期

### 2.1 开发启动

`npm run electron:dev` → `scripts/dev.mjs`：

1. 占用 `127.0.0.1:5174`（Vite）
2. esbuild 打包 `electron/main.ts` + `preload.ts` → `dist-electron/`
3. 启动 Electron，注入 `VITE_DEV_SERVER_URL`

### 2.2 主进程 boot（`electron/main.ts`）

1. `requestSingleInstanceLock`
2. 解析 dataRoot → `applyUserDataPath`（可选）
3. `app.whenReady`：确保 `logs` / `secrets` / `workspace` 等目录
4. 构造服务：`ConfigService`、`ChatStore`、`Secrets`、`SkillStore`、`PluginStore`、`BrowserRegistry`、`BrowserNetworkManager`、`WorkspaceFiles`、`FileDownload`、`WorkspaceShell`、`PermissionGate`、`AgentRuntime`
5. `RemoteServer` + `NavoraRpcRegistry`；`registerIpc()`（本地 `ipcMain` + 远程 RPC）
6. 托盘；按配置是否显示主窗

主窗安全策略：`contextIsolation: true`、`nodeIntegration: false`，但 **`sandbox: false`**。

### 2.3 渲染进程 boot

`index.html` → `src/main.ts` → Vue + Router + Vuetify → `App.vue`（Onboarding）→ `ChatPage`（keep-alive）。

远程 Web：鉴权后 `navora-remote-shim` 用 WS 填充与桌面同构的 `window.navora`。

---

## 3. Electron 主进程模块

### 3.1 入口与桥

| 文件 | 细化功能 |
|------|----------|
| `electron/main.ts` | 单实例、生命周期、IPC/RPC 总表、pending 权限/询问/技能审核、事件推送与远程广播、托盘联动 |
| `electron/preload.ts` | 类型化 API：`invoke` 通道 + `on` 事件订阅 |
| `electron/data-root.ts` | 数据根、便携标记、`ensureDir` |
| `electron/modules/tray.ts` | 系统托盘：显示/隐藏主窗、退出 |
| `electron/modules/window-state.ts` | 主窗位置/尺寸持久化 |

### 3.2 Agent 与 LLM

| 文件 | 细化功能 |
|------|----------|
| `modules/agent-runtime.ts` | 每 Chat 一个 `AbortController`；构建 messages + tools；流式 LLM；tool_calls 调度；`agent_ask_user` 分叉记忆；技能审核；下载确认询问；轮次上限 / 停止 |
| `modules/browser-tools.ts` | `executeAgentTool`：全部工具实现的大开关（浏览器 / 文件 / shell / 设置 / 技能等） |
| `modules/llm/openai-compatible.ts` | OpenAI 兼容流式 completion、超时解析 |
| `modules/permission-gate.ts` | 五档：`deny` / `ask` / `ask_chat` / `allow_notify` / `allow`；进程内 `alwaysAllow` / `alwaysDeny`；按 Chat 的 `ask_chat` 记忆 |

### 3.3 浏览器子系统

| 文件 | 细化功能 |
|------|----------|
| `modules/browser-registry.ts` | Session（partition 按 Chat 隔离）/ Window 树；导航与关窗；`will-download` 暂停确认；`window.open` 入树；权限钩子 |
| `modules/browser-network.ts` | 网络规则增删查、请求观察日志 |
| `modules/browser-download-list.ts` | 浏览器下载列表状态（内存）与变更事件 |
| `modules/deep-dom.ts` | 深读 DOM / 跨 frame 查询辅助 |
| `modules/iframe-click.ts` | iframe 内点击 |
| `modules/trusted-input.ts` | CDP / `dispatchMouseEvent` 等可信输入 |
| `modules/geolocation.ts` | 地理位置工具实现 |
| `modules/load-document-response.ts` | `loadURLWithResponse` / 协议回退：自定义主文档 |

### 3.4 持久化与配置

| 文件 | 细化功能 |
|------|----------|
| `modules/chat-store.ts` | Chat CRUD；消息增改；draft LWW；`workspaceRoot`；权限覆盖；同步 `writeFileSync` 落盘 `chats/*.json` |
| `modules/config-service.ts` | `config.yml` 读写、deepMerge、变更通知 |
| `modules/secrets.ts` | API Key 文件存储（`secrets/<ref>.key`）；IPC 仅返回 preview |
| `modules/skill-store.ts` | Cursor 兼容 `SKILL.md`；索引；提案（create/update 可 defer）；导入导出 |
| `modules/plugin-store.ts` | 扫描 `dataRoot/plugins/*/plugin.json` + index 外链；zip 安装（≤200MB）/ 文件夹外链（不复制）；导出 zip；加载时要求 `planPermissions`+`execute`+`tools`；HostApi 按已批准能力约束 registry/runTool（含 iframe 点击经 `browser_click` 继承 `click`） |
| `electron/plugins/<id>/` | （可选）仅当 `NAVORA_BUNDLE_PLUGINS=1` 时打入安装包；**默认产品包不含任何插件** |
| `../navora-plugins/` | 官方/作者插件源码；规范、类型与 `navora-plugin` CLI 见同级 `navora-plugin-sdk`；经设置外链/导入 zip，不进默认安装包 |

### 3.5 工作区与下载

| 文件 | 细化功能 |
|------|----------|
| `modules/workspace-files.ts` | 默认 `dataRoot/workspace/<chatId>`；相对路径 `resolve` 防逃逸；list/stat/read/write/mkdir/delete/move/copy/concat |
| `modules/file-download.ts` | 经 Session `fetch` 流式下载进工作区；反盗链头；多分片 compose；大小上限 |
| `modules/workspace-shell.ts` | `file_reveal` / `file_open`；`shell_exec`（cwd 限制在工作区，`spawn` + 可选 `shell:true`） |

### 3.6 远程访问

| 文件 | 细化功能 |
|------|----------|
| `modules/remote-server.ts` | HTTP 静态 SPA + 登录；WebSocket；RPC 与 bridge 帧 |
| `modules/remote-rpc.ts` | 本地/远程共用 handler 注册表；远程裁剪部分通道；事件广播 |
| `modules/bridge-remote.ts` | 远程看窗 / 控鼠桥接 |
| `modules/ws-lite.ts` | 轻量 WebSocket 实现 |

默认：远程关闭；开启后默认 `0.0.0.0:8790`，默认密码哈希对应 **`admin`**（见 `shared/config.ts`）。

---

## 4. Shared 层

| 文件 | 细化功能 |
|------|----------|
| `shared/agent-tools.ts` | `AGENT_TOOLS` 全量 schema + `SYSTEM_PROMPT` / `buildSystemPrompt` |
| `shared/settings-tools.ts` | 设置类工具辅助 |
| `shared/config.ts` | `AppConfig`、默认值、fork_decision、远程默认哈希 |
| `shared/types.ts` | Chat / Agent 事件 / 权限 / 浏览器树等类型 |
| `shared/skills.ts` | 技能 frontmatter / 校验 |
| `shared/plugins.ts` | 插件清单 / 导入预览 / index 外链字段；`PLUGIN_ZIP_MAX_BYTES`（200MB） |
| `shared/openai-types.ts` | ChatCompletion / ToolCall 类型 |
| `shared/model-providers.ts` / `model-presets.ts` / `openai-models.ts` | Provider 解析与预设 |
| `shared/ua-presets.ts` / `user-agent.ts` | UA 预设（默认 Edge） |
| `shared/url-allowlist.ts` | URL 允许列表辅助 |
| `shared/crypto-util.ts` | scrypt 等（远程密码） |
| `shared/run-logs.ts` | Agent 运行日志条目 |
| `shared/tool-display.ts` | 工具卡片展示文案 |
| `shared/answer-sources.ts` | 回答来源收集 |
| `shared/export-chat.ts` | 会话导出格式 |
| `shared/bridge-frame.ts` | 远程 bridge 帧协议 |

---

## 5. Agent 工具面（按域）

定义于 `shared/agent-tools.ts`，实现于 `electron/modules/browser-tools.ts`（及依赖模块）。

### 5.1 元能力 / 环境

| 工具 | 功能 |
|------|------|
| `agent_ask_user` | 路径分叉询问（选项 / 自定义 / 证据 / 超时） |
| `agent_spawn_subchat` | 异步并行子对话；子对话看不到父消息，须把 URL/sitekey 等写入 `context`（宿主会尝试从父对话近期消息补全） |
| `agent_await_subchats` | 等待一个或多个子对话结束并收集结果 |
| `agent_subchat_status` | 查询子对话状态 |
| `datetime_now` | 当前时间 |
| `geolocation_get` | 地理位置 |

### 5.2 浏览器 Session / Window

| 工具 | 功能 |
|------|------|
| `browser_open` | 快捷打开 |
| `browser_session_create` / `_close` / `_clear` | Session 生命周期 |
| `browser_session_set_proxy` / `_set_ua` | 代理与 UA |
| `browser_session_fetch` | 绑定 Session 的 HTTP |
| `browser_cookies_get` / `_set` / `_remove` | Cookie |
| `browser_window_create` / `_close` / `_set_visible` / `_focus` | 窗控 |
| `browser_list_resources` | 资源树快照 |

### 5.3 导航与交互

| 工具 | 功能 |
|------|------|
| `browser_navigate` / `_back` / `_forward` / `_reload` | 导航 |
| `browser_wait` | load / network idle / delay |
| `browser_click` / `_hover` / `_scroll` / `_type` / `_press` / `_select` / `_upload` | 交互 |
| `browser_flow` | 多步流程 |
| `browser_find` / `_query_deep` | 查找 / 深查 |
| `browser_dialog` | 对话框 |
| `browser_get` | 读 DOM/HTML/文本等 |
| `browser_evaluate` | 隔离世界脚本 |
| `browser_screenshot` / `desktop_screenshot` | 截图（产品定位不以视觉喂模型为主） |

### 5.4 网络

| 工具 | 功能 |
|------|------|
| `browser_network_rule_add` / `_remove` / `_list` | 规则 |
| `browser_network_log` / `_clear` | 观察日志 |
| `browser_load_url_with_response` | 自定义主文档导航（origin 不变）；可选 `prefer`/`injectMode`: `native` \| `protocol` |

### 5.5 工作区 / 文件 / Shell

| 工具 | 功能 |
|------|------|
| `workspace_info` / `workspace_set` | 查询 / **设置 Chat 工作区绝对路径** |
| `file_list` / `_stat` / `_read` / `_write` / `_mkdir` / `_delete` / `_move` / `_copy` / `_concat` | 沙箱相对路径文件 API |
| `file_download` / `file_download_compose` | 下载与多分片拼接 |
| `file_reveal` / `file_open` | 资源管理器 / 系统打开 |
| `shell_exec` | 工作区 cwd 下执行命令 |

### 5.6 设置与技能

| 工具 | 功能 |
|------|------|
| `app_settings_get` / `_update` | 读/改配置 |
| `app_models_list` / `app_provider_add` | 模型列表 / 添加 Provider |
| `skill_list` / `_read` | 列表与读取（注入系统提示） |
| `skill_create` / `_update` | 提案 + 用户预览确认（可 defer） |
| `skill_delete` / `_export` | 删除 / 导出（不可搁置，可选 wait） |

---

## 6. 渲染进程模块

| 路径 | 细化功能 |
|------|----------|
| `src/main.ts` | 创建 Vue App、Router、Vuetify |
| `src/App.vue` | 壳层、Onboarding |
| `src/router.ts` | 本地 Chat/Settings/Docs；远程 Login/Home/Bridge |
| `src/pages/ChatPage.vue` | **主 UI**：会话列表、消息流、工具卡、权限/询问、浏览器树、发送/停止（逻辑高度集中） |
| `src/pages/SettingsPage.vue` | 设置页（也可经 Dialog） |
| `src/pages/DocsPage.vue` | 内置文档页 |
| `src/pages/RemoteLoginPage.vue` / `RemoteHomePage.vue` / `RemoteBridgePage.vue` | 远程 Web UI |
| `src/components/SettingsDialog.vue` / `DocsDialog.vue` | 对话框壳 |
| `src/components/OnboardingWizard.vue` | 首次引导 |
| `src/components/BrowserDownloadsMenu.vue` | 下载菜单 |
| `src/components/ChatMarkdown.vue` | Markdown（marked + DOMPurify） |
| `src/components/skills/*` | 技能编辑/导入/导出/批量/删除/审核宿主 |
| `src/composables/useOnboarding.ts` / `useMobileLayout.ts` | 引导与移动布局 |
| `src/navora-remote-shim.ts` | 浏览器端模拟 `window.navora` |
| `src/remote-api.ts` / `remote-token.ts` | 远程 HTTP/WS 与 token |
| `src/utils/markdown.ts` / `chat-media.ts` | Markdown 与媒体 |

无 Pinia：会话与 Agent 状态以主进程为准，UI 订阅推送事件。

---

## 7. 运行时数据流

| 域 | 权威存储 | 推送事件 | 备注 |
|----|----------|----------|------|
| Chat | `chats/<id>.json` | `navora:chats.changed`、`navora:agent.event` | 默认同步整文件写入 |
| Config | `config.yml` | `navora:config.changed` | deepMerge |
| Secrets | `secrets/<ref>.key` | — | IPC 不回传明文全文 |
| Skills | `skills/` + `index.json` + `proposals.json` | `skill.review.*`、`skills.proposalsChanged` | |
| Browser 树 | 内存 Registry | `navora:browser.treeUpdated` | partition 按 Chat |
| 下载列表 | 内存 | `navora:downloads.changed` | 文件落工作区 |
| Agent | `runs: Map<chatId, AbortController>` | phase / status / message / done / error | 每 Chat 至多一个 run |
| 权限 / 询问 | pending Map | request / cancel | 超时默认 deny / timeout |
| 远程 | WS clients | 同名事件 broadcast | 与本地双通道 |

### Agent 一轮消息（简图）

```
UI send → navora:agent.run
  → ChatStore.appendMessage(user) + 临时标题 + 清 draft
  → AgentRuntime.run
       → LLM stream → tool_calls → PermissionGate → 工具实现
       → emit agent.event（主窗 + remote）
  → finally: status=false, done, 可选 AI 标题润色
```

---

## 8. IPC / RPC 清单（摘要）

约定：`rpcHandle` = **本地 ipcMain + 远程 WS**（除非另行裁剪）；仅本地：`navora:app.quit`。

### 8.1 请求-响应（主要）

- 应用：`app.info` / `app.openExternal` / `app.quit`（仅本地）
- 配置：`config.get` / `config.save` / UA 相关
- 远程：`remote.status` / `remote.openWindow`（远程改为返回 route）
- 工作区：`workspace.info` / `setChatRoot` / `readMedia`；`pickDirectory` **远程拒绝**
- 密钥：`secrets.getApiKey` / `setApiKey`
- 会话：`chats.*`（`export` **远程拒绝**）
- Agent：`agent.run` / `stop` / `isRunning` / `agent.ask.respond`
- 权限：`permission.respond`
- 浏览器：`browser.*`
- 下载：`downloads.*`
- 技能：`skills.*` / `skill.review.respond`（pick/export 等远程拒绝）

### 8.2 主 → 渲染推送

`agent.event`、`agent.ask` / `.cancel`、`permission.request` / `.cancel`、`skill.review.request` / `.cancel`、`skills.proposalsChanged`、`chats.changed`、`config.changed`、`browser.treeUpdated`、`downloads.changed`。

---

## 9. 运行时逻辑风险与解决方案

> **落地状态（2026-09-11）**：R1（默认本机绑定 + 改密门闩 + 远程危险 RPC 裁剪）、R2、R3、R4、R5、R6、R8（远程禁 import/parsePath）、R9、**R10（Chat 防抖写盘 / 紧凑 JSON / 退出 flush；下载进度与下载列表 IPC 节流）** 已合入代码。R7（CSP/sandbox）、R11–R12 仍为后续项。

按严重度排序。每项含：**问题** → **方案** → **改动落点** → **验收**。

### 9.1 高危

#### R1 — 远程信任面过大

| 项 | 内容 |
|----|------|
| 问题 | 登录后几乎可调全套 RPC（改密钥、跑 Agent、改工作区根、控浏览器）。默认密码 `admin`，默认绑定 `0.0.0.0`。 |
| 方案 | **(A) 默认收紧**：`remote.host` 默认改为 `127.0.0.1`；首次启用远程若仍是默认哈希，强制设置页改密，未改密则拒绝 `start`。**(B) RPC 分级**：在 `remote-rpc.ts` 维护三档白名单——`viewer`（只读 chats/browser 树）、`operator`（agent.run/stop、权限答复）、`admin`（secrets / workspace.setChatRoot / shell 相关 / config.save）。登录签发带 role 的 token；`invokeForRemote` 按 role 拒绝。**(C) 危险通道默认远程拒**：`secrets.setApiKey`、`workspace.setChatRoot`、`skills.import*`、任意带绝对路径的 import 默认 `remote_forbidden`，仅本机或显式 `admin` 开启。 |
| 落点 | `shared/config.ts`（默认 host/哈希策略）、`electron/modules/remote-server.ts`（改密门闩 + token role）、`electron/modules/remote-rpc.ts`（白名单）、设置页「远程」UI |
| 验收 | 未改密无法启用远程；`127.0.0.1` 外网不可达；viewer token 调 `agent.run` / `secrets.setApiKey` 返回拒绝 |

#### R2 — `workspace_set` / `setChatRoot` 可逃出沙箱

| 项 | 内容 |
|----|------|
| 问题 | `chat-store.setWorkspaceRoot` 接受任意绝对路径；根改出后 `file_*` / `shell_exec` 跟随。 |
| 方案 | **(A) 允许根集合**：仅允许 (1) `dataRoot/workspace/<chatId>`；(2) `config.files.custom_root/<chatId>`；(3) 用户经本机 `pickDirectory` 选中并写入 `allowedWorkspaceRoots[]` 的路径。**(B) 校验函数**：`assertAllowedWorkspaceRoot(abs)`：`path.resolve` 后必须等于白名单项或其子路径（注意 `path.sep` 边界，防 `C:\data` vs `C:\data-evil`）。**(C) 工具侧**：`workspace_set` 若传入非白名单绝对路径 → 返回错误，并提示「请在设置中选取目录」；远程 IPC 直接拒绝 `setChatRoot`（与 R1 对齐）。**(D) 迁移**：已有越界 `workspaceRoot` 启动时检测，无效则清除并回退 builtin。 |
| 落点 | `chat-store.ts`、`workspace-files.ts`、`browser-tools.ts`（`workspace_set`）、`main.ts`（`setChatRoot` / pickDirectory 写入白名单） |
| 验收 | Agent 无法把根设到 `C:\Windows`；本机挑目录后可读写该目录；远程调用 `setChatRoot` 失败 |

#### R3 — `shell_exec` 无命令白名单

| 项 | 内容 |
|----|------|
| 问题 | 仅限制 cwd；`shell: true` + 继承完整 `process.env`；依赖 ask 质量。 |
| 方案 | **(A) 默认模式 `deny`**：`permissions.modes.shell_exec`（或现有 capability）默认 `ask` 保留，但增加硬限制。**(B) 命令白名单**：配置 `files.shell_allowlist: string[]`（如 `git`、`node`、`python`、`npm`、`dir`/`ls`）；`command` 必须是 basename 命中，禁止 path 分隔符与 `..`。**(C) 禁用 `shell: true`**（或仅 allowlist 内显式开启）：一律 `spawn(file, args, { shell: false })`，避免 `cmd /c` 注入。**(D) 环境净化**：`env` 使用精简子集（`PATH`/`PATHEXT`/`SystemRoot`/`LANG` 等），去掉 `ELECTRON_*`、密钥类变量。**(E) 参数扫描**：拒绝含 `\0`、异常超长 args；可选拒绝 `&&`/`|`/重定向字符（在 shell:false 时次要）。 |
| 落点 | `workspace-shell.ts`、`shared/config.ts` + `config.example.yml`、`permission-gate` capability 文案 |
| 验收 | `shell_exec({ command: "cmd", args: ["/c","del ..."], shell: true })` 被拒；白名单内 `git status` 可跑；环境中无 API Key |

### 9.2 中危

#### R4 — `agent.run` 孤儿用户消息

| 项 | 内容 |
|----|------|
| 问题 | `main.ts` 先 `appendMessage` 再 `agent.run`；已在跑 / 并行上限时异常只打日志，消息已落盘。 |
| 方案 | **推荐事务顺序**：`if (agent.isRunning(chatId)) throw 'agent_already_running'` → 再 `appendMessage` → `await agent.run(...)`（或 `run` 内部登记 runs 后再由调用方落盘）。**备选回滚**：`run` 在登记前失败则 `chats.deleteMessage(chatId, userMsg.id)` 并 `pushChatChanged`。**远程**：返回明确错误码给 shim，UI toast「该会话正在运行」。并行上限同样先检查。 |
| 落点 | `electron/main.ts`（`navora:agent.run`）、可选 `chat-store.deleteMessage`、`ChatPage` / remote shim 错误展示 |
| 验收 | 连点发送 / 双端同时发：第二条失败且不落盘；第一条正常跑完 |

#### R5 — `window-all-closed` 几乎不退出

| 项 | 内容 |
|----|------|
| 问题 | 仅 `isQuitting` 为真才 `quit`；关主窗且 `close_to_tray=false` 时可能无窗后台残留。 |
| 方案 | **明确三态**：(1) `close_to_tray=true`：关主窗 → 隐藏，保留托盘与 Agent 窗；(2) `close_to_tray=false`：关主窗 → 若无其它 BrowserWindow（或仅剩应销毁的 agent 窗）则 `app.quit()`；(3) 托盘「退出」→ `isQuitting=true` → `stopAll` → `quit`。修改 `window-all-closed`：`if (process.platform !== 'darwin' && (!config.close_to_tray \|\| isQuitting)) app.quit()`，并在 close 处理器里区分 hide vs destroy。 |
| 落点 | `electron/main.ts`、`tray.ts`、设置「关闭主窗口」文案 |
| 验收 | `close_to_tray=false` 关主窗后进程退出；`true` 时托盘仍在且可唤回 |

#### R6 — `always_allow` / `always_deny` 跨 Chat 全局

| 项 | 内容 |
|----|------|
| 问题 | 进程内全局 Set；跨 Chat 串台；不落盘则重启丢失（语义不清）。 |
| 方案 | **按 Chat 作用域**：将 `alwaysAllow`/`alwaysDeny` 改为 `Map<chatId, Set<capability>>`（与 `chatAllow` 一致）；UI「始终允许」文案改为「本会话始终允许」。**可选持久化**：写入 `chat.permissions.modes` 为 `allow`/`deny`，或单独 `sticky` 字段。进程级「全局始终」仅保留给设置页显式「全局权限预设」。 |
| 落点 | `permission-gate.ts`、权限弹窗响应处理（`main.ts`）、设置页文案 |
| 验收 | Chat A 点「始终允许」不影响 Chat B；重启后行为与文档一致 |

#### R7 — 主窗 `sandbox: false`

| 项 | 内容 |
|----|------|
| 问题 | 渲染沙箱弱；XSS/注入时影响面更大（unofficial Electron / 自定义能力可能依赖非沙箱）。 |
| 方案 | **短期**：保持 `sandbox: false` 若 fork 硬依赖；强化 `ChatMarkdown` DOMPurify、禁止加载远程任意脚本、CSP（`session.defaultSession.webRequest` 或 `session.setCSP`）限制主窗。**中期**：对主窗试开 `sandbox: true`，回归 preload/IPC；Agent 浏览器窗可继续 false。**硬规则**：主窗不执行 Agent `evaluate`；远程 HTML 不进主窗特权上下文。 |
| 落点 | `main.ts` `webPreferences`、CSP 配置、`src/utils/markdown.ts` |
| 验收 | 主窗无法 `require('fs')`；恶意 Markdown 脚本被剥除 |

#### R8 — 技能 import 可读任意主机路径

| 项 | 内容 |
|----|------|
| 问题 | `parsePath` / import 接受绝对路径；远程登录后可读任意可读文件。 |
| 方案 | **本机**：仅允许 `dialog.showOpenDialog` 返回的路径，或 `dataRoot/skills-inbox/` 下相对路径。**远程**：继续拒绝 pick；额外拒绝任何带绝对 path 的 `skills.import` / `parsePath` RPC。**内容校验**：导入后只解析 YAML frontmatter + Markdown，限制文件大小；拒绝符号链接逃逸（`realpath` 后仍在允许根内）。 |
| 落点 | `skill-store.ts`、`main.ts` skills IPC、`remote-rpc.ts` |
| 验收 | 远程传 `C:\Users\...\secrets\*.key` 导入失败；本机对话框导入成功 |

### 9.3 低–中危

| ID | 问题 | 解决方案 | 落点 |
|----|------|----------|------|
| R9 | 消息 ID 仅 UUID 前 8 位 | 改为完整 `randomUUID()` 或 `m_` + 12+ hex；已有短 ID 保持兼容 | `chat-store.ts` |
| R10 | 频繁 `writeFileSync` 整份 JSON | 按 chatId **防抖写**（如 50–100ms）+ 流式 `updateMessage` 合并；进程退出 `flush`；可选 JSONL append-only | `chat-store.ts`、`before-quit` |
| R11 | 下载 `pause()` 失败被吞 | `pause` 失败则 `cancel` 下载并返回错误，不进入「确认后保存」；或改用 `setSavePath` 到临时目录再 `move` | `browser-registry.ts` |
| R12 | 文档 / 结构漂移 | 同步 `architecture-plan`；本文件为模块真源；逐步从 `ChatPage.vue` 抽 composable（agent 事件、权限、浏览器树） | `docs/*`、`src/composables/*` |

### 9.4 实施优先级与工期估测

| 优先级 | ID | 方案摘要 | 估测 |
|--------|-----|----------|------|
| P0 | R1 | 默认本机绑定 + 改密门闩 + 远程 RPC 分级 | 0.5–1d |
| P0 | R4 | `isRunning` 先于 `appendMessage` | 0.5h |
| P0 | R2 | 工作区根白名单 + 远程拒 setChatRoot | 0.5d |
| P1 | R3 | shell allowlist + `shell:false` + 净化 env | 0.5d |
| P1 | R5 | 关窗退出语义对齐 `close_to_tray` | 1–2h |
| P1 | R6 | always* 改为 per-chat | 1–2h |
| P2 | R8 | 技能路径仅 dialog / inbox | 2–3h |
| P2 | R7 | CSP + 评估 sandbox | 0.5–1d |
| P3 | R9–R12 | ID / 防抖写盘 / pause / 文档与拆分 | 按需 |

### 9.5 推荐落地顺序（迭代）

1. **热修包（半天内）**：R4 竞态 → R5 退出语义 → R1 默认 host=`127.0.0.1` + 默认密码警告门闩  
2. **安全包**：R2 工作区白名单 → R3 shell 白名单 → R8 技能路径 → R1 RPC 分级  
3. **硬化包**：R6 per-chat always* → R7 CSP → R10 防抖写盘 → R9 全长 UUID  

---


## 10. 与规划文档的差异

| 项 | 规划 / README | 现状 |
|----|---------------|------|
| 版本号 | README 曾写 0.3.6 | `package.json` **0.3.8** |
| 站点专用流程 | 规划未展开 | 写在技能里；产品文档只说明「技能优先」 |
| 测试 | — | 未见 unit / e2e 目录 |
| 状态管理 | — | 无独立 store 层，逻辑集中在 `ChatPage.vue` |

---

## 11. 维护提示

- 新增工具：先改 `shared/agent-tools.ts` schema，再在 `browser-tools.ts` 实现，并映射 `PermissionGate` capability。
- 新增 IPC：在 `main.ts` 用 `rpcHandle` 或仅本地 `ipcMain.handle`；同步 `preload.ts` 与 `navora-remote-shim.ts`；评估是否加入 `invokeForRemote` 裁剪。
- 改持久化格式：注意 `chats/*.json` 与 `config.yml` 的兼容与迁移。
- 复杂站点 / 业务编排：写在仓库旁的 `skills-dev/`（技能开发区），经「设置 → 技能 → 导入」进入用户数据目录；**不要**写进产品代码或系统提示。

---

## 12. 搁置：插件包签名方案（未实现）

> **状态**：仅设计记录，**不进入当前迭代**。现有 zip 导入只做结构校验与 200MB 上限，不做密码学验签。

### 12.1 动机与边界

插件经 `require` 进入主进程，风险高于技能 Markdown。签名解决的是：

| 目标 | 签名能否覆盖 |
|------|----------------|
| 分发后篡改（改 `main.cjs`） | 能 |
| 确认来自某发布方（信任其公钥） | 能 |
| 恶意但「自签」的插件 | **不能**（签名 ≠ 审计） |
| 文件夹外链（开发模式） | 不强制；可标「未签名」 |

### 12.2 推荐形态

导出 zip 内附签名清单（不参与自身哈希）：

```
plugin.zip
├── plugin.json
├── main.cjs
├── …资源
└── .navora-sig.json
```

`.navora-sig.json` 字段草案：

```json
{
  "version": 1,
  "alg": "ed25519",
  "publisher": "example-publisher",
  "pluginId": "example-plugin",
  "pluginVersion": "1.0.12",
  "createdAt": "2026-09-11T15:00:00Z",
  "files": [
    { "path": "plugin.json", "sha256": "…" },
    { "path": "main.cjs", "sha256": "…" }
  ],
  "signature": "<base64 ed25519 over canonical digest of files[]>"
}
```

实现要点（落地时）：

1. 对包内文件（排除 `.navora-sig.json`）算 SHA-256，规范序列化后再 Ed25519 签名（Node `crypto` 即可）。
2. **导出**：算哈希 → 私钥签 → 写入 zip。
3. **导入（zip）**：校验哈希 + 验签；失败错误码如 `plugin_sig_invalid` / `plugin_sig_missing`。
4. **公钥**：v1 应用内置信任表（如 `trusted-publishers.json`）；v2 可选用户导入公钥。
5. **外链文件夹**：不验签；UI 标明开发外链。
6. 策略：zip 默认要求验签通过；设置项可「允许未签名压缩包」（默认关或开按产品决定）。

### 12.3 策略矩阵（草案）

| 模式 | 验签 |
|------|------|
| zip 安装 | 默认要信任公钥通过；可选允许未签名 |
| 文件夹外链 | 不验签 |
| bundled 随附 | 可跳过或与应用同签 |

### 12.4 非目标

- 不用 zip 密码 / 对称加密冒充「身份」。
- 不做完整插件市场与在线吊销列表（可后续加 `revoked` 指纹）。
- 不替代代码审查；签名只证明「未被改 + 来自持钥方」。

### 12.5 粗估（恢复开发时）

| 项 | 估测 |
|----|------|
| `signPluginDir` / `verifyPluginDir` + 导出写入 / 导入拦截 | 0.5–1d |
| 信任公钥配置 + 设置开关 + 错误文案 | ~0.5d |
| 发布私钥保管 / CI 签名流程 | 流程项，非产品代码主路径 |

落点候选：`electron/modules/plugin-store.ts`、`shared/plugins.ts`、设置页插件区、可选 `electron/assets/trusted-publishers.json`。
|
