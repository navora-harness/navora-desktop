# 桌面自动化接口调研与规划（搁置）

<!-- planning-completion-review:2026-11-06 -->
## 完成情况复核（2026-11-06）

**当前状态：搁置；只标记调研完成。** 本节依据现有源码、实施记录和报告复核；下文旧日期状态保留历史含义，当前完成范围以本节为准。

- [x] **已完成**｜2026-11-05：本机参考实现、原生输入／捕获与通信接口调查及规划记录已完成。
- [ ] **保留事项**｜Windows helper／UIA／捕获输入原型及权限接管仍未实施；用户明确搁置，不因本轮复核自动恢复。

证据：[desktop-automation-codex-reference-plan-2026-11-05.md](./desktop-automation-codex-reference-plan-2026-11-05.md)。
<!-- /planning-completion-review:2026-11-06 -->


> 2026-11-05 规划整理核对：**搁置**。本机实现调研已完成，但 Windows helper/UIA/捕获/输入原型及权限接管尚未实施；用户明确搁置，不自动恢复。 状态与归档口径见[规划状态总览](./planning-status-and-next-work-2026-11-04.md)。

日期：2026-11-05。

状态：**搁置。用户明确要求记录规划并搁置；保留调研结论，不启动实现、不纳入当前实施批次、不自动恢复。** 后续仅在用户明确要求恢复时重新评估。

## 1. 目标与范围

为 Navora 后续跨应用桌面自动化保留技术参考：窗口发现、截图与控件树观察、控件级动作、鼠标键盘输入、本地连续执行与可见反馈。本条目独立于现有浏览器自动化修复，不扩大现有工具的桌面权限。

## 2. 本机 Codex 调研依据

检查对象：Windows 安装包 `OpenAI.Codex_26.930.4958.0_x64__2p2nqsd0c76g0`。检查方式为安装文件静态读取和进程列表查看；未读取聊天、登录凭据，未注入或调试进程，未实际操作其他应用。

安装根目录：`C:/Program Files/WindowsApps/OpenAI.Codex_26.930.4958.0_x64__2p2nqsd0c76g0/app/`。以下路径均相对于该目录，升级后可能变化。

### 2.1 JavaScript 桌面接口

`resources/plugins/openai-bundled/plugins/computer-use/docs/api.md` 记录 `@oai/sky` 的 Windows window2 接口：

- `list_apps`、`list_windows`、`get_window`、`launch_app`、`activate_window`：应用与窗口发现、启动和激活。
- `get_window_state`：可按需获取窗口截图及无障碍控件树；返回控件索引、焦点、选区及文档文本等观察数据。
- `click`：既支持窗口相对坐标，也支持 `element_index` 控件编号。
- `set_value`、`perform_secondary_action`：设置可编辑控件值、执行控件的辅助动作。
- `press_key`、`type_text`、`scroll`、`drag`：按键、文本、滚动和拖动。
- `screenshotId`：坐标操作可关联目标窗口缓存的截图；不据此宣称所有过期界面都已被安全处理。

### 2.2 本地通信与原生程序

`resources/cua_node/bin/node_modules/@oai/sky/dist/project/cua/sky_js/src/targets/windows/internal/computer_use_client.js` 包含两种通信路径：

- 原生管道：通过 `SKY_CUA_NATIVE_PIPE` 选择，使用 Windows 命名管道传输 JSON-RPC；帧由 4 字节小端长度和 UTF-8 JSON 正文组成。客户端缓存连接，并按顺序提交请求。
- 辅助进程：由 `helper_transport.js` 启动原生 helper，通过标准输入输出交换逐行 JSON；包含共享 transport 和引用计数复用逻辑。

`resources/app.asar` 的主进程代码包含命名管道服务和 `codex-computer-use-swift.exe` 路径解析。原生程序位于 `resources/cua_node/bin/node_modules/@oai/sky/bin/windows/`，含普通 helper 和 `swift/x64/codex-computer-use-swift.exe`。检查时进程列表中存在 `codex-computer-use-swift`。

上述证据确认安装实现及运行组件，尚未追踪某一次操作实际选择的完整通信链路。

### 2.3 Windows 系统接口证据

原生二进制中发现下列接口名称、调用标记或符号：

- 无障碍控件：`CoCreateInstance(CUIAutomation8)`、`IUIAutomationInvokePattern.Invoke`、`IUIAutomationValuePattern.SetValue`。
- 鼠标键盘：`SendInput`、`SetCursorPos`。
- 窗口管理：`EnumWindows`、`GetWindowRect`、`SetForegroundWindow`。
- 图形捕获：`D3D11CreateDevice`、`CreateDirect3D11DeviceFromDXGIDevice`、`Direct3D11CaptureFramePool.FrameArrived`、`CachedGraphicsCaptureSession`，指向 Windows Graphics Capture / Direct3D 11 截图链路及会话缓存。
- 剪贴板：`OpenClipboard`、`GetClipboardData`、`SetClipboardData`；只能确认具备相关实现线索，不能认定所有文本输入都走粘贴。

静态符号存在不等于每次动作都会使用该接口，也不是运行时性能测量。

### 2.4 可见反馈与浏览器通道

Swift 程序包含 `WindowsCursorTransition`、`WindowsWindowCursor`、`CompositionOverlay`、`AnimationCoordinator` 等源码路径或符号，表明有独立的本地光标和动画组件。其对流畅感的贡献属于合理推断，尚无耗时或帧率数据。

Chrome 插件的 `resources/plugins/openai-bundled/plugins/chrome/scripts/browser-service.mjs` 包含 `Accessibility.getFullAXTree`、`Input.dispatchMouseEvent`、`Runtime.evaluate` 等 CDP 调用。浏览器有结构化控制通道；不能将其与 Windows 全桌面控制混为一项能力。

## 3. 恢复后可评估的技术方向

以下均为候选方案，**尚未实现或验收**：

1. Electron 宿主维护任务、窗口归属及授权，由常驻原生 helper 承担系统交互，通过本地管道与上层工具通信。
2. 同时提供窗口截图和 UI Automation 控件树，按控件可用性选择控件级动作或坐标输入，并处理多屏 DPI、窗口移动和弹出窗口的坐标映射。
3. 短动作组在本地连续执行，关键界面变化后重新观察；复用进程和截图会话，以实测决定是否优化。
4. 光标与进度反馈独立于模型推理，只显示真实派发的动作；遵守减少动态效果设置，保留人工接管、取消和输入归属。
5. 浏览器继续评估既有原生浏览器接口／CDP，应用专用集成与全桌面输入分别声明能力和权限。

不将 Codex 私有组件作为 Navora 可直接分发的依赖；恢复后选择可维护、许可明确的实现。

## 4. 恢复门槛与待验证项

- 用户明确恢复并确认首批目标应用、支持平台及交付范围。
- 先做 Windows 单窗口原型，验证 UIA 控件操作、截图、输入、停止和人工接管；未知部分执行不得自动重放。
- 检查权限拒绝、目标关闭／切换、控件树过期、窗口失焦、中文输入和混合 DPI。
- 分别测量模型等待、本地通信、控件读取、截图、动作执行及动画帧率，避免将视觉顺滑当作任务执行更快的证据。
- 跨应用操作范围与现有网页控制权限分别校验；验收通过前不宣称支持通用桌面自动化。

当前决定：**仅归档调研和候选规划，保持搁置。**
