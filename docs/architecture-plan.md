# Navora — 架构与实现规划

| 项 | 内容 |
|----|------|
| 文档版本 | 0.12（草案） |
| 日期 | 2026-09-10 |
| 状态 | **P1–P5 主线已落地**（持续打磨与增强中） |
| 变更 | 同步 README：Registry/工具面/Agent/工作区/远程/打包已实现；仓库为 `navora-desktop` |
| **产品名称** | **Navora**（副标题：AI Agent Browser） |
| **appId** | `com.navora.app` |
| 产品定位 | 桌面端 AI Agent Harness + 可控浏览器会话（Chat 驱动自动化） |
| 运行时 | **定制 Electron** |
| 前端 | Vite + Vue 3 + Vuetify + TypeScript |
| UA / Session | `UserAgentObject` + `setUserAgent`（定制 Electron） |
| 默认 UA | **Edge 152** 预设（设置可改） |
| 数据目录 | 开发 → `portable/`；便携 → `<exe>/data/`；安装版 → `%APPDATA%\Navora` |
| 一期 LLM | **OpenAI 兼容**（流式 + tools）；设置页多家预设 |
| HTTP | Agent 可用绑定 Session 的 **`session.fetch`** |

### 品牌说明

**Navora** = *Navigate* + *Aura/Ora*：用对话「领航」浏览器。本文件为早期规划草案，实现状态以 [`modules.md`](./modules.md) 与代码为准。

---

## 1. 目标与范围

### 1.1 要做什么（MVP）

1. **主窗口**：AI Chat + 当前会话下的浏览器 Session/Window 资源树
2. **系统托盘**：显示/隐藏主窗口、退出
3. **浏览器会话**：`{chatId}-{sessionIndex}` 分区；UA + `setUserAgent`；网络拦截；`session.fetch`；Session 全控（过权限门）
4. **设置**：基本 / 模型 / 浏览器 / 权限 / 关于
5. **工具面**：窗控、导航交互、读 DOM/HTML、隔离世界 evaluate、网络规则、fetch
6. **一期 LLM**：仅 OpenAI 兼容；Provider 架构预留其它厂商
7. **页面理解**：不向模型传截图
8. **生命周期**：删 Chat 级联清浏览器；关窗销毁并通知运行中 Agent；停止=终止该 Chat 全部 Agent 工作
9. **多 Chat**：可并行各自控浏览器，互不串台，并做防卡顿
10. **`window.open`**：必须入资源树，由对应 Chat 控制

### 1.2 明确不做（一期）

| 不做 | 说明 |
|------|------|
| 完整 Playwright 级能力 | 无录制回放、无复杂选择器策略引擎 |
| Chrome 式多 Tab 产品壳 | 独立 `BrowserWindow` + 主窗资源树 |
| 视觉多模态 / 截图喂模型 | 分析 DOM/HTML/文本即可 |
| 站点专用复杂流程 | 不写入产品代码与系统提示；由技能 / 后续插件描述与实现 |
| 云端同步 / 插件市场 | 本地优先 |

---

## 2. 产品形态

### 2.1 主窗口（AI Chat + 浏览器资源树）

```
┌─────────────────┬──────────────────────────────────────┐
│ AI 会话列表      │  当前 AI 会话标题 / 模型徽章            │
│ + 新会话         │──────────────────────────────────────│
│ · 会话 A     ◀  │  消息流（用户 / 助手 / 工具调用卡片）     │
│ · 会话 B        │                                       │
│─────────────────│                                       │
│ 浏览器资源       │                                       │
│ ▼ 会话 sess-1   │                                       │
│   ○ 窗口: 标题A │                                       │
│     [显示|隐藏] │                                       │
│ ▶ 会话 sess-2   │──────────────────────────────────────│
│─────────────────│  输入框 + 发送 / 停止                   │
│ 设置入口         │                                       │
└─────────────────┴──────────────────────────────────────┘
```

| 层级 | 含义 |
|------|------|
| AI 会话（Chat） | 对话线程；左侧列表 |
| 浏览器 Session | 某 Chat 下的 `partition` |
| 浏览器 Window | Session 下真实 `BrowserWindow`；实时标题 + 显示/隐藏 |

要点：资源树绑定**当前** AI 会话；其它 Chat 仅显示数量徽章。关闭主窗默认藏托盘。

#### 2.1.1 标题与状态实时同步

Registry 订阅 `page-title-updated`、`did-navigate`、`did-start/stop-loading`、`show`/`hide`/`closed`，经 IPC patch（debounce）推到主窗；提供 `browser:getTree(chatId)` 全量拉取。

#### 2.1.2 显示 / 隐藏 / 关闭

| 操作 | 行为 |
|------|------|
| 新建默认显隐 | 设置 `show_agent_windows`（默认 **false**）；工具可覆盖 |
| 条目显示/隐藏 | `show` / `hide`，**不**销毁 |
| 工具关闭窗 | 销毁并移出树 |
| **用户点系统关闭（X）** | **销毁**；移出树；Agent 运行中则注入事件（§2.5.3） |

### 2.2 托盘

显示主窗口 / 隐藏主窗口 / 退出（退出前清理全部 Agent 浏览器窗）。

### 2.3 设置页结构

| Tab | 内容 |
|-----|------|
| **基本** | 语言、启动行为、关主窗到托盘、主题 |
| **模型** | OpenAI 兼容：Base URL、API Key、模型、超时 |
| **浏览器** | UA、新建窗显隐、尺寸、等待策略、超时、并发上限、`block_window_open`、**URL 白名单** |
| **权限** | 能力权限分级（§2.4） |
| **关于** | Navora、版本、Electron/Chromium |

#### 2.3.1 等待策略与导航超时

| 项 | 默认建议 |
|----|----------|
| `wait.load` | 开 |
| `wait.network_idle` | 关 |
| `wait.network_idle_ms` | 500 |
| `wait.delay_ms` | 0 |
| `navigation_timeout_ms` | 30000 |
| `action_timeout_ms` | 15000 |

工具调用可覆盖；超时返回明确错误。

#### 2.3.2 URL 白名单（已拍板）

作用于 **`navigate` 与 `session.fetch`**（目标 URL 校验；`window.open` 弹出的导航同样校验，不匹配则拒绝打开或拒绝加载——实现时统一走同一匹配器）。

| 项 | 约定 |
|----|------|
| 配置方式 | **仅用户主动配置**（设置 → 浏览器）；不内置站点列表 |
| 默认值 | **空数组 `[]`** |
| 空列表语义 | **不启用域名限制**（只走权限档位）；避免出厂即无法使用 |
| 非空语义 | 仅允许匹配项；不匹配则工具返回 `url_not_allowed` |
| 匹配形态（建议） | 主机名精确匹配、`*.example.com` 后缀、可选完整 origin；实现阶段定细则 |
| 与权限关系 | 白名单是**额外硬门闸**，在权限 `allow` 之后仍会拦 |

### 2.4 Agent 功能权限分级

#### 2.4.1 档位

| mode | UI | 行为 |
|------|-----|------|
| `deny` | 拒绝 | 永不执行 |
| `ask` | 每次询问 | 每次确认 |
| `ask_chat` | 本会话询问一次 | 本 Chat 内首次询问后记忆 |
| `allow_notify` | 自动（通知） | 执行并轻提示 |
| `allow` | 完全自动 | 仅审计/工具卡片 |

确认卡片：允许一次 / 本会话允许 / 始终允许 / 拒绝 / 始终拒绝。  
**用户口头授权**可对本轮短路 `ask`。确认超时默认 120s。

#### 2.4.2 预设

保守 / **均衡（出厂）** / 放手。

#### 2.4.3 能力默认（均衡）

| 能力 ID | 保守 | 均衡 | 放手 |
|---------|------|------|------|
| `session.create` | ask_chat | allow | allow |
| `session.persist` | ask | ask | ask |
| `session.close` | ask_chat | allow | allow |
| `session.clear` | ask | allow | allow |
| `session.set_proxy` | ask | ask | allow_notify |
| `session.set_ua` | ask | ask_chat | allow |
| `session.cookies_read` | ask | ask_chat | allow_notify |
| `session.cookies_write` | deny | ask | ask_chat |
| `session.fetch` | ask_chat | allow_notify | allow |
| `window.create` | ask_chat | allow | allow |
| `window.close` | ask_chat | allow | allow |
| `window.set_visible` | allow | allow | allow |
| `navigate` | ask_chat | allow_notify | allow |
| `wait` | allow | allow | allow |
| `click` | ask_chat | allow | allow |
| `type` | ask | ask_chat | allow_notify |
| `get_page` | allow | allow | allow |
| `evaluate` | deny | ask | ask_chat |
| `network.observe` | ask_chat | allow | allow |
| `network.modify` | deny | ask | ask_chat |
| `network.block` | deny | ask | ask_chat |

### 2.5 生命周期与并发（已拍板）

#### 2.5.1 删除 AI 会话 → 级联清空

删除 `ChatSession` 时必须：

1. Abort 该 Chat 上正在跑的 Agent
2. 销毁其下所有 `BrowserWindow`
3. 清空并释放每个 `BrowserSession`；`persist:` 分区数据一并清除
4. 删除该 Chat 消息与元数据
5. 更新资源树与列表

删除 Chat 本身即强确认，不再问「是否清浏览器」。

#### 2.5.2 停止按钮语义

「停止」= **终止该 Chat 上 Agent 的全部工作**（不是只停吐字）：

- 取消 LLM 流
- 停止工具队列
- 中断 navigate/wait/click/type
- Abort `session.fetch` / `evaluate`
- 挂起的权限确认视为取消

**不**自动销毁浏览器 Session/窗口。消息流提示「已停止全部 Agent 工作」。

#### 2.5.3 用户关闭浏览器窗 → 销毁 + 通知 Agent

- 系统关闭键：**销毁**，移出树
- Agent 运行中：推送 `browser_window_closed`，工具调用失败原因 `window_closed_by_user`
- Agent 未运行：只更新 UI

#### 2.5.4 多 Chat × 多浏览器（隔离 + 防卡顿）

允许多 Chat 并行控浏览器；**禁止串台**：

| 规则 | 说明 |
|------|------|
| 归属 | 每个 Session/Window 唯一 `chatId`；跨 Chat 调用拒绝 |
| Cookie | partition 按 chat 隔离 |
| 权限确认 | 挂在对应 Chat；非当前 Tab 角标提醒 |
| Runtime | 每 Chat 独立调度器 + AbortController |

防卡顿：同 Chat 工具默认串行；跨 Chat 可并行但设全局上限；树更新 debounce+patch；仅当前 Chat 细绘资源树。

#### 2.5.5 `window.open`（一期必须）

创建 Agent 窗即挂 `setWindowOpenHandler`：

| 行为 | 约定 |
|------|------|
| 默认 | 允许；同 session/chat 新窗，继承 partition、UA |
| 资源树 | 立即登记；标题/URL 同步 |
| 控制权 | 仅所属 Chat |
| 显隐 | 遵循 `show_agent_windows` |
| 可选 | `block_window_open` → deny |
| 通知 | Agent 运行中推送 `browser_window_opened` |

用 `did-create-window` 完成 Registry 注册，避免空窗期。

---

## 3. 技术选型

| 层 | 选型 |
|----|------|
| 运行时 | 定制 Electron 41 |
| 前端 | Vite + Vue 3 + TS + Vuetify |
| 配置 | YAML 热更新，落在 `dataRoot` |
| AI | Provider 注册表；一期仅 OpenAI 兼容 |
| 浏览器控制 | 主进程 WebContents / Session API |

### 3.1 数据目录（已拍板）

| 形态 | dataRoot |
|------|----------|
| 便携 | `dirname(execPath)`；建议 `app.setPath('userData', dataRoot)` |
| 安装版 | `%APPDATA%\Navora` |
| 开发 | 项目 `portable/` 或 `NAVORA_DATA_ROOT` |

```text
<dataRoot>/config.yml, chats/, logs/, secrets/, .navora-portable?
```

---

## 4. 进程与模块

```
electron/
  main.ts, preload.ts
  modules/
    tray.ts, window-main.ts, config-service.ts
    browser-session.ts, browser-window.ts, browser-registry.ts
    browser-network.ts, browser-wait.ts, browser-actions.ts
    browser-evaluate.ts, browser-fetch.ts
    permission-gate.ts, agent-runtime.ts
    llm/…, chat-store.ts
shared/
  user-agent.ts, ua-presets.ts, config.ts, browser-tree.ts
src/   # Vue：Chat + 资源树 + Settings
```

原则：业务在主进程；工具过权限门；资源按 `chatId` 隔离。

---

## 5. UA、Session、网络与 fetch

### 5.1 UA

移植 `UserAgentObject`；默认 edge152；`setUserAgent(ua, options)` 失败则降级。

### 5.2 Session / Window

- partition：`{chatId}-{sessionIndex}`；持久化：`persist:{chatId}-{sessionIndex}`
- 持久化创建走权限 `session.persist`（默认 ask）
- 用户说清空 → 直接 `session.clear`（口头授权短路）

### 5.3 网络拦截

Session `webRequest`：观察 / 改头 / 阻断；与 `network_idle` 联动。

**`webRequest` 规则是否作用于 `session.fetch`**：不在文档里猜死；**P1 骨架开工前**用定制 Electron 写最小测试（同 partition 上挂 `onBeforeRequest`/`onBeforeSendHeaders`，再调 `ses.fetch`，看是否进回调）。结果写入 `docs/notes/webrequest-vs-fetch.md` 并回填本节。

### 5.4 `session.fetch`（已拍板）

工具 `browser_session_fetch`；绑定 `sessionId`；共享 Cookie/代理/UA；正文截断；禁止用 Node 全局 fetch。  
`redirect` 一期仅 `follow`/`error`。目标 URL 过 §2.3.2 白名单。

### 5.5 人机接管（已拍板）

当 Agent **正在运行** 时，用户在对应浏览器窗内的手动操作 **不中断** Agent 回合；系统把操作写成 **可读日志**，并注入当前回合上下文，让模型清楚「用户刚做了什么」。

| 项 | 约定 |
|----|------|
| 生效条件 | **仅**该窗所属 Chat 上 Agent 回合进行中；空闲时用户操作只更新 UI，**不**写 Agent 可见日志、不喂模型 |
| Agent 行为 | **继续运行**；不因用户操作自动暂停/中止 |
| 输出形态 | **操作日志**（结构化 + 短自然语言摘要），例如：`[user] navigated → https://…`、`[user] clicked …`、`[user] typed N chars in #password` |
| 投递 | ① 写入该 Chat 的 Agent 事件/工具日志流（消息区可折叠展示）② 同时注入当前回合上下文，供模型下一步使用 |
| 建议采集 | 导航变化；点击/键入摘要（节流合并）；可选焦点变化 |
| 密度控制 | 输入按停顿合并；导航去重；防止刷爆上下文与 UI |
| 敏感 | 密码框只记「输入了 N 字符」，不记明文 |

一期优先：**导航类日志必达**；点击/输入日志随后补齐。

---

## 6. AI Agent 工具面（一期）

### 6.1 Session / Window

`browser_session_create` / `close` / `clear` / `set_proxy` / `set_ua` / **`fetch`**  
`browser_window_create` / `close` / `set_visible`

### 6.2 导航 / 交互 / 读取

`browser_navigate` / `wait` / `click` / `type` / `get`（title/url/text/html/dom_summary，无 screenshot）

### 6.3 网络

`browser_network_rule_add|remove|list` / `get` / `clear`

### 6.4 JS：必须隔离世界

`browser_evaluate` → **仅** `webContents.executeJavaScriptInIsolatedWorld`；固定 `worldId`（默认 1000）；返回可序列化并截断。  
主世界 `executeJavaScript` 仅内部用。

### 6.5 二期候选

文件上传、完整 HAR、iframe 深度、CDP、截图视觉、主窗内嵌预览。

---

## 7. 多模型

`ChatProvider` 接口 + Registry；一期实现 `openai_compatible`；`anthropic`/`gemini`/`ollama` 占位灰显。

---

## 8. 安全与权限

| 风险 | 缓解 |
|------|------|
| 误操作 | 权限档位 + 确认卡片 |
| fetch 带 Cookie | 绑定 sessionId；截断；审计 |
| evaluate | Isolated World；默认 ask |
| 删 Chat 残留 | 级联 clear persist |
| 串台 | chatId 隔离 |
| 卡顿 | 并发上限 + IPC debounce |

---

## 9. 配置草案（摘录）

```yaml
app:
  language: zh-CN
  close_to_tray: true
  start_minimized: false

browser:
  default_ua_preset: edge152
  accept_language: zh-CN,zh;q=0.9,en;q=0.8
  show_agent_windows: false
  default_width: 1280
  default_height: 800
  navigation_timeout_ms: 30000
  action_timeout_ms: 15000
  wait:
    load: true
    network_idle: false
    network_idle_ms: 500
    delay_ms: 0
  page_get_max_chars: 80000
  network_log_buffer: 200
  evaluate_world_id: 1000
  evaluate_code_max_chars: 32000
  evaluate_result_max_chars: 80000
  fetch_timeout_ms: 30000
  fetch_max_body_chars: 200000
  fetch_max_body_bytes: 524288
  block_window_open: false
  # 空 = 不限制；非空则 navigate / session.fetch 仅允许匹配
  url_allowlist: []
  max_windows_total: 24
  max_fetch_inflight: 8
  max_parallel_agent_chats: 4
  tree_update_debounce_ms: 100

permissions:
  preset: balanced
  confirm_timeout_ms: 120000
  user_intent_bypass_ask: true
  modes:
    session.create: allow
    session.persist: ask
    session.close: allow
    session.clear: allow
    session.set_proxy: ask
    session.set_ua: ask_chat
    session.cookies_read: ask_chat
    session.cookies_write: ask
    session.fetch: allow_notify
    window.create: allow
    window.close: allow
    window.set_visible: allow
    navigate: allow_notify
    wait: allow
    click: allow
    type: ask_chat
    get_page: allow
    evaluate: ask
    network.observe: allow
    network.modify: ask
    network.block: ask

ai:
  default_provider: openai_compatible
  providers:
    - id: openai_compatible
      type: openai_compatible
      label: OpenAI Compatible
      base_url: https://api.openai.com/v1
      api_key_ref: secrets/openai
      model: gpt-4.1
      timeout_ms: 120000
```

---

## 10. 待拍板清单

### 10.0 高优先级状态

| 项 | 状态 |
|----|------|
| 删 Chat 级联清 Session | **已拍板** §2.5.1 |
| 关窗销毁 + 通知 Agent | **已拍板** §2.5.3 |
| 停止=终止全部 Agent 工作 | **已拍板** §2.5.2 |
| 多 Chat 隔离 + 防卡顿 | **已拍板** §2.5.4 |
| window.open 入树 | **已拍板** §2.5.5 |
| navigate / fetch URL 白名单 | **已拍板** §2.3.2：默认空=不限制；用户主动配置后生效 |
| webRequest × session.fetch | **开工前实测**，结果回填 §5.3 |
| 人机接管 | **已拍板** §5.5：Agent 运行时输出**操作日志**并注入上下文；空闲不记 |
| 子 frame 边界 | 待定 |
| sessionIndex 复用 / 口头授权边界 | 待定 |
| 单实例锁 / 自动更新 / 名称最终确认 | 待定 |

### 10.1 其它

选择器方案、iframe、下载权限弹窗、指纹、dom_summary、上下文裁剪、系统 Prompt（含 window 事件）、审计与测试、ToS/隐私。

---

## 11. 落地顺序

| 阶段 | 内容 | 状态 |
|------|------|------|
| P0 | 确认剩余项；**webRequest×fetch 实测** | 部分待回填文档 |
| P1 | 建包、dataRoot、Chat+树、托盘、设置（含白名单）、权限 | **已完成** |
| P2 | Session、Registry、生命周期、window.open、多 Chat 隔离 | **已完成** |
| P3 | 工具面 + 停止 Abort + **用户操作日志（Agent 运行时可见）** | **已完成** |
| P4 | OpenAI 流式 + tool calling + 事件注入 | **已完成** |
| P5 | 并发调参、IPC 防卡顿、打包 | **基本完成**（持续优化） |
| 增强 | 工作区文件/下载/shell、远程访问、引导、分叉决策 UX | **已落地** |

---

## 12. 实现落点（本仓库）

| 能力 | 位置 |
|------|------|
| 前端 / 托盘 / 便携 | `src/`、`electron/modules/tray.ts`、`electron/data-root.ts` |
| session.fetch | `electron/modules/browser-tools.ts` 等 |
| UA / setUserAgent | `shared/ua-presets.ts`、`shared/user-agent.ts` |
| 网络 / 代理 | `electron/modules/browser-network.ts` |
| 隔离世界 evaluate | `electron/modules/browser-tools.ts`（isolated world） |
| 弹窗入树 | `setWindowOpenHandler` / `did-create-window`（browser 模块） |
| 插件契约 | 同级仓库 `navora-plugin-sdk` |
| 官方插件 | 同级仓库 `navora-plugins` |

---

## 13. 评审结论

- [x] Navora / `com.navora.app`
- [x] 主窗资源树 + 显隐 + 标题同步
- [x] Session 分区/持久化/清空；UA edge152
- [x] 等待超时；网络拦截；session.fetch；Isolated evaluate
- [x] 权限五档 + 预设；数据目录分流；一期 OpenAI
- [x] **删 Chat 级联清空下级 Session**
- [x] **用户关窗=销毁；Agent 运行中则通知**
- [x] **停止=终止该 Chat 全部 Agent 工作**
- [x] **多 Chat 多浏览器、互不串台、防卡顿**
- [x] **window.open 入树并由对应 Chat 控制**
- [x] **URL 白名单**：默认空不限制；用户配置后约束 navigate/fetch
- [x] **人机接管**：Agent 运行时输出操作日志（并注入上下文）；空闲不记
- [x] **P1 骨架已落地**：可 `npm run electron:dev`（Chat/托盘/设置/配置）
- [x] **P2**：Session / Registry / 生命周期 / window.open / 多 Chat 隔离
- [x] **P3–P4**：工具面、停止 Abort、运行日志、OpenAI 流式 + tool calling
- [x] **P5**：打包（portable / NSIS）；并发与 IPC 持续调参
- [x] **增强**：工作区文件、远程访问、引导向导、路径分叉询问
