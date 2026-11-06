# 原生网页与原生菜单面板规划

<!-- planning-completion-review:2026-11-06 -->
## 完成情况复核（2026-11-06）

**当前状态：部分完成；沿现行 Menu／NativePanel 路线。** 本节依据现有源码、实施记录和报告复核；下文旧日期状态保留历史含义，当前完成范围以本节为准。

- [x] **已完成**｜2026-11-04—05：常用原生菜单／面板已接入；普通浮层不再通用截图或隐藏真实 View，已随 0.4.10 交付。
- [ ] **保留事项**｜高级原生侧栏、被动提示／父子面板等能力仍由后续专题跟踪；网页 View 圆角已取消，六类显式遮罩确认保留兼容，均不算欠交付。

证据：[confirmed-plans-implementation-2026-11-05.md](./confirmed-plans-implementation-2026-11-05.md)；[browser-live-view-overlay-cleanup-plan-2026-11-05.md](./已完成/browser-live-view-overlay-cleanup-plan-2026-11-05.md)；[native-panels-followup-plan-2026-11-04.md](./native-panels-followup-plan-2026-11-04.md)。
<!-- /planning-completion-review:2026-11-06 -->


<!-- planning-obsolescence:2026-11-06 -->
> **【部分过时】标记日期：2026-11-06；原文/演进日期：2026-11-03—04，范围于 2026-11-05 收窄。**
> **过时范围：**新增顶层浮层 WebContentsView、网页 View 圆角、普通 DOM 浮层继续通用截图隐藏，以及等待截图总退出的原安排。
> **当前依据/保留范围：**当前使用 Menu/NativePanel 或布局避让，普通浮层实时显示已完成，六类显式遮罩确认保留兼容；高级原生交互缺口仍按专题跟踪。
> **接续证据：**[confirmed-plans-implementation-2026-11-05.md](./confirmed-plans-implementation-2026-11-05.md)；[current-state.md](./current-state.md)。
<!-- /planning-obsolescence:2026-11-06 -->

> 2026-11-05 规划整理核对：**部分完成**。顶层 WebContentsView 提案已被 Menu/NativePanel 路线替代，网页圆角已取消；常用入口已接入，剩余复杂浮层与截图替代总路径仍未退出。 状态与归档口径见[规划状态总览](./planning-status-and-next-work-2026-11-04.md)。

日期：2026-11-03；接入更新：2026-11-04。状态：**已随 `45.0.0-cloudbypass.5` 接入常用入口，0.3.38 已编译核验；未迁移入口及实机边界见实施记录**。

2026-11-04 用户决定：**取消网页 WebContentsView 的圆角要求**，不再将网页圆角裁切或角部命中作为实施与验收目标。此决定仅针对网页 View；原生菜单／NativePanel 自身的外观仍按各自规划处理。最初仅记录，后续 `.7` 实施已移除应用对网页的 `setBorderRadius(12)` 调用，不影响已运行的旧实例。

`.7` 更新：应用已升级并开始实施，实际源码、检查和未完成项见[实施进展](./native7-implementation-progress-2026-11-04.md)，范围见[总规划](./electron-7-readiness-and-implementation-plan-2026-11-04.md)。原生 item 与 Menu controls 延续 `.6`，新增 textarea、面板 Acrylic 与独立滚动槽；自动增高、被动提示全域穿透和复杂侧栏等仍缺能力。内核自身的网站信息／证书变化独立核对，应用保持原调用，不承诺升级后与 `.5` 逐像素相同。后文 `.5` 实施与原“搁置”状态均保留其历史范围。

最新决定：NativePanel 自身 Acrylic 先搁置，已发布契约留档，面板采用普通不透明主题，不随宿主窗口材质开关启用；宿主材质规划保留。面板模糊不再属于当前接入或发行门槛，原生面板／菜单覆盖实时网页路线继续。

采用“官方原生菜单与专用原生面板”的路线，覆盖原来的单窗口浮层 WebContentsView 提案。网页继续使用 WebContentsView，不为原生面板新增网页渲染器。用户在定制包发布后已授权开始接入。

定制要求见 [Electron 原生浮层定制接口清单](./electron-native-panels-customization-spec-2026-11.md)。实现以 `.5` 随包类型及 [已发布接口说明](https://github.com/ChengHoward/edist/blob/main/NATIVE-PANELS.zh-CN.md) 为准；运行时能力检查决定是否启用。应用接入与验收边界见 [本轮实施记录](./native-ui-integration-2026-11-04.md)。

2026-11-04 `.5` 阶段后续见 [浏览器窗口一致性与原生浮层补全](./native-panels-followup-plan-2026-11-04.md)与[当时进展](./browser-presentation-and-overlay-progress-2026-11-04.md)：白屏恢复、配色以及标签搜索／当前对话更多的原生迁移已落源码，其余截图入口待完成。用户明确要求等内核能力补齐、全部消除弹层截图替换后再打包；当时恢复为待实施的地址建议视觉改版和横排缩放，随后已随 `.7` 接入。内核扩展由用户安排的定制 Electron 智能体提供；`showPageInfoDialog` 应用调用不改，附加菜单沿用 0.3.39 的 HTML 特例，其它覆盖网页的面板不因此改回 HTML。

## 1 选定的显示方式

- **普通操作菜单**：使用已有 Menu.buildFromTemplate、Menu.popup 和 Menu.closePopup。承载图标、分组、勾选、快捷键和子菜单，沿用当前 Electron 即有能力。
- **网站信息面板**：通过新增 webContents.showPageInfoDialog 展示连接安全、证书和已接入的本站权限；网站设置按钮回到 Navora。
- **复杂原生面板**：通过 NativePanel 承载 Agent 控制、下载列表、地址建议、模型等原生控件界面。使用原生 Bubble 或 Popup，可显示到主窗口之外。附加选择按 0.3.39 的单独决定保留 HTML。
- **网页本身**：保留现有 WebContentsView、会话、页面身份、原生输入控制和跨窗口移动逻辑。
- **网页边界**：取消 WebContentsView 圆角方案，使用矩形网页视口；不再计划为网页调用 View.setBorderRadius。

普通菜单和原生面板展示时，原网页保持实时显示。正常路径不抓取页面作为背景，不隐藏原网页，不为浮层重新加载或迁移网页。

通用面板采用原生控件绘制，不为面板创建 WebContents 或网页渲染进程。已有 Vue 富面板需要转换为控件描述，不能直接搬入原生面板。浮层本身仍有原生窗口、控件和绘制资源成本。

## 2 已发布的内核能力

首版依赖：

- webContents.showPageInfoDialog。
- NativePanel 构造、isSupported、show、update、hide、destroy 及 action、dismissed、closed 事件。
- NativePanel 内部的锚点定位、窗口外显示、原生圆角与命中、阴影、主题、键盘、输入法、外部点击关闭和资源释放。

可选能力：

- BrowserWindow.isInputShapeSupported 与 win.setInputShape；若原生面板内部已满足命中要求，不必再公开这两个窗口接口。
- webContents.setPageCapturePaintLeaseEnabled；只在后台或隐藏页面持续捕获确有需要时加入，不作为普通浮层的前置条件。

所有必做接口以接口清单为准，不将 Electron 包版本号等同于实际能力。收到定制二进制后，同时核对其匹配的类型、接口说明和构建标识。编译完成表示可以开始接入验证，不表示产品已经迁移完成。

保持 WebContentsView，不增加 createWebViewTransfer、adoptWebContents 或 webview 接收租约接口。

## 3 应用侧接入位置

本轮应用侧按以下分工接入：

- 已新增 electron/modules/native-ui.ts、shared/native-ui.ts、shared/native-ui-validation.ts 和 src/composables/useNativeUi.ts，统一菜单及面板请求、窗口归属、控件结构、图标和结果返回。
- electron/main.ts 与 electron/preload.ts 接入本地窄 IPC；请求从 sender 确认窗口身份，不由网页或插件任意打开应用菜单。
- src/components/ActionMenu.vue 接入浏览器更多、批注更多及其他普通动作菜单。
- src/components/BrowserTabContextMenu.vue、sidebar/SidebarContextMenu.vue 和 sidebar/SidebarMoreMenu.vue 接入标签与侧栏菜单。
- src/components/ApplicationMenuBar.vue 保留标题栏按钮和既有命令定义，展开部分由原生菜单承载。
- src/components/TextContextMenuHost.vue 保留输入目标和选区，使用原生菜单返回编辑命令。
- BrowserAddressBar.vue、BrowserAgentControl.vue 和 BrowserDownloadsMenu.vue 分别对接网站信息、原生控件面板与实时状态更新。
- 输入区的模型和选区工具按各自交互需求接入原生面板；附加按单独决定保留 HTML。保留编辑器草稿、选区、搜索和滚动状态。
- src/navora-remote-shim.ts 保留远程界面适用的 DOM 展示，并明确本地原生面板能力不可用。

沿用 shared/app-commands.ts、shared/app-shortcuts.ts、shared/ui-icons.ts 和现有标签、下载、设置与 Agent 业务服务。菜单回传动作标识，实际动作仍由原业务执行，并核对当前目标是否有效。

原生图标使用随包提供的资源和 nativeImage，按主题及 DPI 复用。普通原生菜单外观遵循运行时和系统主题；NativePanel 的色板、字体、圆角和控件布局通过新接口配置。

## 4 位置和交互要求

- 原生面板锚点采用屏幕 DIP。界面 CSS 坐标先按所属界面 zoom 转为内容区 DIP，再加窗口内容区原点，不重复乘系统 deviceScaleFactor。
- 面板跟随父窗口移动和显示缩放变化；锚点自身变化由应用更新。空间不足时翻转、贴边或在面板内部滚动。
- 面板只随所属窗口层叠，不单独进入任务栏或窗口切换列表；主窗口最小化、隐藏和关闭时处理从属面板。
- 明确圆角、阴影和透明留白的命中行为。需要输入穿透时只影响对应浮层，不把整个主窗口设为穿透，不合成重放用户点击。
- Esc 优先交给输入法组合输入，再按面板层级关闭；子菜单和输入法候选窗口不能被误认为普通外部点击。
- 面板关闭时恢复仍有效的触发器、编辑器选区或手动网页焦点。Agent 持有网页时，焦点恢复遵守现有控制权，不无条件调用会呈现或切换页面的操作。
- 隐藏面板供复用，销毁时释放原生窗口、监听和应用引用。页面相关面板在导航、关闭或转移后失效，迟到的动作不能命中新页面。

悬浮侧栏、悬浮批注和复杂对话框仍需各自明确原生控件与业务状态映射，不能仅因 NativePanel 存在就宣称已经完成。这些入口与 [悬浮侧栏规划](./workspace-responsive-and-floating-sidebar-plan-2026-11.md) 和 [网页悬浮批注规划](./已完成/browser-floating-annotation-plan-2026-11.md)衔接。

## 5 旧截图逻辑的迁移

既有 BrowserTabPanel.vue 通过 overlayCoversPage、prepareBrowserOverlayFrame 和空布局隐藏网页，为 DOM 浮层提供截图占位。本轮已将原生与 DOM 打开状态分离：已迁移的普通菜单和原生面板不再进入此路径，尚未迁移的独立 DOM 编辑界面保留兼容行为。

必须区分“原生菜单已打开”和“DOM 浮层覆盖网页”。原生菜单或原生面板的打开状态只用于互斥和交互协调，不再触发 frozenFrame、页面预览捕获或空布局隐藏。

按入口逐项迁移、逐项解除旧截图条件。尚未迁移的 DOM 面板继续走明确的兼容路径，防止菜单被网页盖住。迁移后的普通浮层路径应记录到截图调用为零，并确认真实网页仍在持续重绘。

用户主动截图、页面预览、批注证据等独立业务保留。shared/browser-overlay-frame.ts 和 browser-workspace-ipc.ts 中的 preview 不因菜单迁移被整批删除。

网页左上角错位按 [独立回归规划](./已完成/browser-view-origin-regression-plan-2026-11.md)及其实施记录跟踪；浮层展示不能掩盖错误网页矩形，也不能绕过有效布局提交。

## 6 Agent 和页面连续性

打开、隐藏、输入面板搜索、切换主题、失焦或恢复焦点，都不等于人工接管。只有用户选择接管、暂停、恢复等明确动作时，才调用现有 Agent 控制器。

保留原 WebContents、会话、页面宿主、运行身份和输入保护。普通菜单开关不调用 pause、abort、reload 或 transfer。页面自身的真实布局变化继续由现有布局与控制代次机制处理。

原生面板的输入与网页定向输入分别路由，避免用户在面板内输入时文字进入网页，也避免 Agent 输入落到面板上。使用现有 dispatchInputSequence 和虚拟光标，验证中文 IME、多框架及动作清理期间的交互。

## 7 接入与验收安排

本节按以下顺序执行，逐项保留应用侧证据。

1. 核对实际运行时和首版必做接口，验证原生面板可显示、可交互且不创建额外网页渲染器。
2. 先迁移浏览器更多菜单，再迁移标签右键、应用菜单、侧栏和文本菜单。
3. 接入网站信息、Agent 控制、下载及地址建议；随后迁移输入区和其他复杂面板。
4. 每完成一个入口，验证真实网页连续重绘、无截图占位、焦点和输入保护，再解除该入口的旧截图条件。
5. 完成多窗口、窗口外显示、多 DPI、中文输入法、资源释放与持续 Agent 操作验证后，再安排产品发行。

已完成的产品入口、仍用 DOM 的入口、自动检查结果及未完成的物理交互验收分别记录，不能将内核发布报告计为 Navora 应用通过记录。

## 8 既有证据的边界

原方案的 [隐藏探针报告](../../_planning/native-overlay-capabilities-results/report.json)保留为历史记录：完成部分方法和兄弟视图排序检查，但整体 ok 为 false，RAF 为 0。它没有证明可见实时合成、真正点击命中或新 NativePanel 能力。

旧探针不是本方案的验收通过记录。新的方法、类型及构建检查也不能代替真实窗口、视频重绘、物理输入、IME 和资源使用验证。
