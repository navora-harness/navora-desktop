# 计划：Electron 原生 JS Dialog API + Navora 对接

| 项 | 内容 |
|----|------|
| 状态 | **计划中**（先不实现） |
| 目标 | 用魔改 Electron 原生接口处理 `alert` / `confirm` / `prompt` / `beforeunload`，替代 CDP 懒挂载 |
| 动机 | 页面不注入、默认不 attach debugger，降低 DataDome 等指纹风险，同时保留 `browser_dialog` 自动应答能力 |
| 相关现状 | `js-dialog-host.ts`（CDP 懒挂载）；已移除 `__navoraDlg` 页面注入 |
| Electron 魔改专篇 | **[`electron-js-dialog-customization-plan.md`](./electron-js-dialog-customization-plan.md)**（API / Chromium 钩子 / 测试 / 打版） |

---

## 1. 背景与约束

当前三条路：

| 方案 | 页面干净 | 无 debugger | 自动应答 | 备注 |
|------|----------|-------------|----------|------|
| 页面改写 `alert` 等 | 否 | 是 | 是 | 已弃用（`__navoraDlg`） |
| CDP `Page.handleJavaScriptDialog` | 是 | 用时否 | 是 | **现状**（仅 `browser_dialog` 时 attach） |
| **Electron 原生 js-dialog** | 是 | **是** | 是 | **本计划目标** |

约束：

- 不向页面主世界注入全局变量或覆盖 native 函数
- 默认浏览路径不 attach `webContents.debugger`
- `browser_dialog` 工具语义尽量不变（list / set_policy / clear）
- 与文件上传等「临时 CDP」共存时不互相 detach 误伤（原生 API 落地后对话框路径应完全离开 debugger）

---

## 2. 目标 API 草案（魔改 Electron）

命名可按 electron-api 既有风格微调；以下为约定草案。

### 2.1 事件（推荐主路径）

```ts
webContents.on('js-dialog', (event, details) => {
  // details: {
  //   type: 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  //   message: string
  //   defaultPrompt?: string
  //   url?: string
  //   frameId?: number
  // }
  event.preventDefault() // 不弹系统原生框
  event.respond({ accept: boolean, promptText?: string })
})
```

未 `preventDefault`：保持 Chromium/Electron 默认原生对话框。  
`preventDefault` 后必须在有限时间内 `respond`，否则走可配置超时默认策略。

### 2.2 可选：同步 Handler

```ts
webContents.setJsDialogHandler((details) => {
  return { accept: true, promptText: '' } // 或 null → 交给默认/事件
})
webContents.setJsDialogHandler(null) // 清除
```

Handler 与 `js-dialog` 事件二选一优先序需在实现时写死（建议：Handler 优先，否则事件，否则原生）。

### 2.3 Session 级默认（可选 P2）

```ts
session.setDefaultJsDialogPolicy({
  alert: 'accept',
  confirm: 'accept' | 'dismiss',
  prompt: { accept: true, text: '' },
  beforeunload: 'accept' | 'dismiss',
  timeoutMs: 5000,
})
```

便于「整 Session 静默」而不给每个 WebContents 绑监听。

### 2.4 类型

- 写入魔改 Electron 的 `electron.d.ts`
- Navora `electron/types/custom-electron.d.ts` 同步 augment

---

## 3. Electron / Chromium 实现要点（魔改仓）

1. 定位 `JavaScriptDialogManager`（或 Electron 现有 dialog client 封装）
2. 在「即将展示对话框」处分支：
   - 若有 Handler / 监听方 `preventDefault` → 不调原生 UI，等 `respond`
   - 否则走现有原生对话框路径
3. `respond` 映射到 Chromium 的 accept / cancel / prompt 文本回调
4. `beforeunload` 单独回归：关闭窗口、刷新、`window.close` 勿死锁
5. 多 frame / OOPIF：至少主 frame 正确；子 frame 在 P1 写明是否支持
6. 自动化测试：无 UI 环境下 alert/confirm/prompt 全自动应答用例

交付物（魔改仓）：

- [ ] 运行时可加载的 Electron 构建（含上述 API）
- [ ] `electron.d.ts` 类型
- [ ] 最小 demo 或单测说明
- [ ] 版本号约定（便于 Navora `package.json` 对齐）

---

## 4. Navora 对接计划（本仓）

### 4.1 能力探测

```ts
function supportsNativeJsDialog(wc: WebContents): boolean {
  return typeof (wc as any).setJsDialogHandler === 'function'
    || wc.listenerCount?.('js-dialog') >= 0 && /* 或 feature flag */ false
}
```

更稳妥：魔改在 `process.versions` 或 `app.getAppMetrics` 旁增加 `process.versions.navoraDialog` / `app.isFeatureSupported('js-dialog')`（P1 选定一种）。

### 4.2 `js-dialog-host.ts` 双后端

| 后端 | 条件 | 行为 |
|------|------|------|
| `native` | 探测到新 API | 绑 `js-dialog` / Handler；**永不**为对话框 attach debugger |
| `cdp` | 回退 | 保持现有懒挂载 CDP（兼容旧 Electron） |

窗口创建：

- **不要**默认 install CDP
- 若 `native`：可在 `createWindow` 时轻量绑定 Handler（无 debugger，可接受）
- 若仅 `cdp`：继续仅在 `browser_dialog` 时 install

### 4.3 `browser_dialog` 工具

- 对外参数与返回值不变：`list` / `set_policy` / `clear`
- 返回增加 `via: 'native' | 'cdp'`
- 队列与 policy 仍在主进程内存（与现逻辑一致）

### 4.4 文档与配置

- 更新 `docs/modules.md`（js-dialog-host 描述）
- 可选配置（P2）：`browser.js_dialog_backend: auto | native | cdp`
- `config.example.yml` 注释一行即可

### 4.5 明确不改

- 不再恢复 `__navoraDlg` 页面注入
- 不把对话框能力塞进 preload（Agent 窗无特权 preload 策略不变）

---

## 5. 分阶段

### P0 — 计划与契约（本文档）

- [x] 写下 API 草案与对接边界
- [ ] 与魔改 Electron 维护者确认事件名 / 超时 / beforeunload 语义

### P1 — 魔改 Electron

- [ ] 实现 `js-dialog` + `respond`（或等价 Handler）
- [ ] 类型与最小测试
- [ ] 发可用构建，版本号通知 Navora

### P2 — Navora 接入

- [ ] `js-dialog-host` 增加 `native` 后端 + 能力探测
- [ ] `createWindow`：native 下绑定 Handler；cdp 仍懒挂载
- [ ] `browser_dialog` 返回 `via`
- [ ] 手工验收：economist 等敏感站仍不因对话框路径挂 CDP；本地页 `alert`/`confirm`/`prompt` 可被 policy 消化

### P3 — 收敛（可选）

- [ ] Session 级默认 policy
- [ ] 配置项强制 backend
- [ ] 旧 CDP 对话框路径标记 deprecated（保留一版回退）

---

## 6. 验收标准

1. **指纹**：新开 Agent 窗访问页面时，`debugger.isAttached() === false`（未调上传等其它 CDP 功能时）
2. **页面**：无 `__navoraDlg` / `__navoraDlgInstalled`；`alert.toString()` 含 `[native code]`
3. **功能**：`browser_dialog` set_policy 后，页面 `confirm()` / `prompt()` 按策略自动结束且不弹阻塞原生框
4. **兼容**：旧 Electron（无新 API）仍走 CDP 懒挂载，不崩溃
5. **回归**：`browser_upload`（临时 CDP）与 native 对话框路径互不拆对方 debugger

---

## 7. 风险

| 风险 | 缓解 |
|------|------|
| beforeunload 处理不当导致关不了窗 | 专项用例；超时默认 dismiss/accept 可配 |
| Handler 未 respond 死锁渲染进程 | 强制 timeoutMs + 默认应答 |
| OOPIF / 子 frame 漏拦 | P1 文档写清范围；P3 再补 |
| 魔改版本与 Navora 不同步 | 能力探测 + CDP 回退 |

---

## 8. 建议实现顺序（开工时）

1. 魔改仓先落地最小事件 API + 单测  
2. Navora 只加探测与 native 分支，默认 `auto`  
3. 敏感站 + 本地 dialog 页双验收通过后，再考虑弱化 CDP 回退文档

**本阶段不写代码。** 确认魔改 API 命名与超时语义后，再开 P1。
