# Electron 魔改计划：JS 对话框（alert / confirm / prompt / beforeunload）

> 历史内核设计。原表中的 Electron 41 是当时目标，当前宿主使用 45.0.0-cloudbypass.2 及本机修复构建；宿主已按能力探测优先使用原生 Handler，缺失时降级。 当前行为与验证边界见 [当前功能](./current-state.md)，全部文档见 [导航](./README.md)。

| 项 | 内容 |
|----|------|
| 状态 | **P0 已实现（JS 层）** — `setJsDialogHandler` / `js-dialog` / `setJsDialogTimeout` |
| 范围 | **仅 unofficial / cloudbypass Electron**，不含 Navora 业务对接 |
| 实现位置 | `lib/browser/api/web-contents.ts`（走既有 `-run-dialog`，无 C++ 改动） |
| 上游参考 | Electron `WebContents` + Chromium `JavaScriptDialogManager` |
| 消费方 | Navora 等（对接另见 `js-dialog-electron-api-plan.md`） |
| 目标版本锚点 | 当前 Navora 使用 `electron@41.0.0-cloudbypass.3`（Chromium ~150） |

---

## 0. 要解决什么

页面脚本触发的阻塞式对话框：

- `window.alert(message)`
- `window.confirm(message)` → boolean
- `window.prompt(message, defaultValue)` → string \| null
- `beforeunload` / `onbeforeunload` 离开确认

官方 Electron：多数情况直接弹**原生系统对话框**，应用层无法在不注入页面、不挂 CDP 的前提下统一拦截与自动应答。

本计划要在魔改 Electron 中增加**主进程可控**的拦截与应答接口，使得：

1. 页面主世界保持干净（不改写 `alert` 等）
2. 不必为对话框 `webContents.debugger.attach`
3. 行为可选：交给原生 UI，或由主进程同步/异步应答

---

## 1. 设计原则

| 原则 | 说明 |
|------|------|
| 默认兼容 | 未设置 Handler、未监听事件时，行为与现网官方/当前魔改一致（原生框） |
| 显式接管 | 只有 `setJsDialogHandler` 或 `preventDefault` 后才抑制原生框 |
| 禁止死锁 | `preventDefault` 后必须有超时默认应答，避免渲染进程永久卡住 |
| 不碰页面 JS | 不注入脚本、不改 `Function.prototype`、不暴露页面可枚举的自定义全局 |
| 可探测 | 提供稳定 feature 探测，供上层决定走 native 还是 CDP 回退 |
| 与现有魔改正交 | 不破坏已有 `setUserAgent(ua, options)`、`session.fetch`、`loadURLWithResponse` 等 |

---

## 2. 对外 API 草案

### 2.1 类型

```ts
type JsDialogType = 'alert' | 'confirm' | 'prompt' | 'beforeunload'

interface JsDialogDetails {
  type: JsDialogType
  message: string
  defaultPrompt?: string
  url?: string
  /** 若可取得：触发 frame 标识，便于多 frame 日志 */
  frameName?: string
  isMainFrame?: boolean
}

interface JsDialogResponse {
  /** confirm / prompt / beforeunload：是否接受；alert 固定 true 亦可忽略 */
  accept: boolean
  /** 仅 prompt 且 accept===true 时有效 */
  promptText?: string
}
```

### 2.2 WebContents：同步 Handler（P0 必做）

```ts
webContents.setJsDialogHandler(
  ((details: JsDialogDetails) => JsDialogResponse | null) | null,
)
```

- 返回 `JsDialogResponse` → 不弹原生框，立即按返回值关闭对话框管道
- 返回 `null` / `undefined` → 视为「不处理」，继续走事件或原生
- 传入 `null` → 清除 Handler

**推荐作为自动化场景的主 API**（Navora 一类可在创建窗口时设置策略闭包）。

### 2.3 WebContents：事件 + 异步应答（P0 必做）

```ts
webContents.on('js-dialog', (event, details: JsDialogDetails) => {
  event.preventDefault()
  // 允许微任务/Promise 后再答
  queueMicrotask(() => {
    event.respond({ accept: true, promptText: '' })
  })
})
```

`event` 扩展：

| 成员 | 含义 |
|------|------|
| `preventDefault()` | 抑制原生对话框 |
| `respond(response)` | 结束本次对话框；重复调用忽略或打日志 |
| `defaultPrevented` | 是否已 prevent |

规则：

1. 优先序：**Handler（非 null 返回）> 事件 preventDefault+respond > 原生对话框**
2. 仅 `preventDefault` 未 `respond`：启动 `timeoutMs`（默认 5000），超时用内置默认策略应答
3. 未 prevent：与现网一致弹原生框；用户点完后不需要 `respond`

### 2.4 超时与默认策略（P0）

```ts
webContents.setJsDialogTimeout(ms: number) // 默认 5000；0 = 禁用超时（不推荐）
```

超时默认（可后续做成 settable）：

| type | 超时默认 |
|------|----------|
| alert | accept |
| confirm | accept |
| prompt | accept + `defaultPrompt` 或 `''` |
| beforeunload | **dismiss**（偏安全，避免误关页；可配置） |

### 2.5 Session 级默认（P1）

```ts
session.setJsDialogHandler(handler | null)
// 仅当该 session 下 webContents 未设 Handler 时生效
```

### 2.6 能力探测（P0）

任选其一（实现时定一种并写进发行说明）：

```ts
// 方案 A（推荐）
app.isFeatureSupported?.('js-dialog') === true

// 方案 B
process.versions['cloudbypass-js-dialog'] === '1'

// 方案 C
typeof webContents.setJsDialogHandler === 'function'
```

发行说明中写明：**从 `41.0.0-cloudbypass.x` 哪一版起可用**。

### 2.7 TypeScript

同步更新魔改产物中的 `electron.d.ts`（及内部 `api/*.ts` 若有）。

---

## 3. Chromium / Electron 落地路径

### 3.1 调用链（概念）

```text
页面 alert/confirm/prompt/beforeunload
  → Blink
  → content::JavaScriptDialogManager::Run*Dialog
  → Electron 侧 JavaScriptDialogManager / WebContents 桥
       ├─ 有 Handler 且返回 response → 直接 Complete/Callback
       ├─ 发出 js-dialog；若 preventDefault → 等 respond / 超时
       └─ 否则 → 现有原生 dialog UI
```

### 3.2 建议改动触及点（实现时按仓库实际路径校准）

在 Electron 源码树中重点检索：

- `JavaScriptDialogManager`
- `electron::api::WebContents`
- 现有 `window-open` / `will-prevent-unload` 等事件注册模式（对齐 IPC/事件风格）
- macOS / Windows / Linux 原生 dialog 弹出入口（确保 prevent 后完全不走 UI）

实现清单：

1. [ ] 自定义或包装 `JavaScriptDialogManager`，在 Run 入口插入钩子
2. [ ] WebContents 增加 Handler 存储 + `js-dialog` 事件发射
3. [ ] `respond` 与 Chromium dialog callback 一一对应（accept / cancel / prompt 字符串）
4. [ ] 超时定时器（UI 线程/合适的 task runner，注意销毁 WebContents 时取消）
5. [ ] WebContents 销毁时：若有未完成对话框，按 dismiss/accept 安全收尾，禁止 UAF
6. [ ] `electron.d.ts` + 简短 `docs/api/web-contents-js-dialog.md`（魔改仓内）

### 3.3 beforeunload 专项

| 场景 | 期望 |
|------|------|
| 用户关窗 / `win.close()` | Handler 可 dismiss → 取消关闭；accept → 允许关闭 |
| 超时 | 默认 dismiss，避免自动化误关；文档写清 |
| 与 `will-prevent-unload` | 理清是否双通道；避免重复弹框或互相覆盖（实现前读现有 Electron 行为） |

### 3.4 多 frame / OOPIF

- **P0**：主 frame 正确即可
- **P1**：子 frame 的 `url` / `isMainFrame` 填准；应答仍关闭对应 dialog 请求
- 文档写明 P0 范围，避免调用方假设全 frame 已覆盖

### 3.5 与 CDP 的关系

- **不**依赖 CDP；本 API 与 `Page.handleJavaScriptDialog` 并行存在
- 若上层同时挂 debugger 并处理 JS dialog，定义优先级（建议：**原生 Handler/事件优先于 CDP**，或文档禁止混用）
- 目标：Navora 对话框路径可完全离开 debugger

---

## 4. 测试计划（魔改仓）

### 4.1 自动化（无交互）

| 用例 | 步骤 | 期望 |
|------|------|------|
| alert-handler | Handler 返回 accept | 页面脚本继续执行；无原生框 |
| confirm-true/false | Handler accept true/false | 页面得到 true/false |
| prompt-text | accept + promptText | 页面得到字符串 |
| prompt-cancel | accept false | 页面得到 null |
| event-async | preventDefault + 延迟 respond | 不超时则按 respond |
| event-timeout | preventDefault 不 respond | 超时后默认策略，进程不卡死 |
| no-hook | 不设 Handler、不听事件 | 与改前一致（可人工/平台测原生框） |
| destroy-mid-dialog | 对话框等待中 destroy WC | 无崩溃、无卡死 |
| beforeunload-dismiss | Handler dismiss | 导航/关闭被取消（按平台可测部分） |

### 4.2 手工 / 平台

- Windows 主路径（Navora 主战场）
- 如有资源：macOS / Linux 各跑一遍 confirm + beforeunload

### 4.3 回归

- 现有魔改：`setUserAgent(ua, metadata)`、`session.fetch`、`loadURLWithResponse`
- 快速打开多窗口连续 alert，无泄漏、无句柄涨死

---

## 5. 发布与版本

1. 版本建议：`41.0.0-cloudbypass.4`（或团队惯用序号）  
2. Changelog 明确：`WebContents.setJsDialogHandler` / `js-dialog` / feature 探测方式  
3. npm/镜像包更新后，通知 Navora 对齐 `package.json` 中 electron 版本  
4. 保留至少一版「无此 API」的回退说明，供上层 CDP 兼容

---

## 6. 工作量与阶段（仅 Electron）

| 阶段 | 内容 | 粗估 |
|------|------|------|
| E0 | 在源码树定位 dialog 路径 + 确认与 `will-prevent-unload` 关系 | 0.5–1d |
| E1 | P0 API：Handler + 事件 + respond + 超时 + d.ts | 2–4d |
| E2 | beforeunload 专项 + 销毁安全 + 单测 | 1–2d |
| E3 | Session 级 Handler（可选）+ 文档 + 打版 | 0.5–1d |

合计约 **4–8 人日**（视源码熟悉度与三平台而定）。

---

## 7. 非目标（本计划不做）

- 页面内注入或 hook `window.alert`
- 修改 DataDome / 站点脚本
- Navora `browser_dialog` 工具改写（属消费方计划）
- 拦截非 JS 的系统文件框、权限框、HTTP 认证框（可另开计划）
- 改变 `window.open` / 下载对话框行为

---

## 8. 验收标准（Electron 包本身）

1. 未设置任何钩子时，行为与升级前一致  
2. 仅设 Handler 时，alert/confirm/prompt 全自动应答，**进程内无 debugger attach**  
3. 仅用事件 `preventDefault`+`respond` 时同上  
4. `preventDefault` 后不 respond，超时后恢复，渲染进程不永久阻塞  
5. WebContents 中途销毁不崩溃  
6. `electron.d.ts` 完整；feature 可探测  
7. 发布包可被 Navora 以依赖版本引用

---

## 9. 开工前待确认（清单）

- [ ] 事件名用 `js-dialog` 还是 `javascript-dialog`（与 Electron 既有 kebab 风格对齐）  
- [ ] beforeunload 超时默认 accept 还是 dismiss  
- [ ] Handler 与 CDP 同时存在时的优先级  
- [ ] 是否需要 Session 级 API 进 P0（建议 P1）  
- [ ] 发行版本号与镜像发布流程负责人  

---

## 10. 文档关系

| 文档 | 职责 |
|------|------|
| **本文** | Electron 魔改：API、Chromium 钩子、测试、打版 |
| `js-dialog-electron-api-plan.md` | Navora 如何探测与双后端对接（消费方） |

**本阶段只产出计划，不实现。** 确认 §9 后从 E0 源码定位开始。
