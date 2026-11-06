# Electron 原生浮层定制接口清单

<!-- planning-completion-review:2026-11-06 -->
## 完成情况复核（2026-11-06）

**当前状态：部分完成；接口设想与实际契约分别保留。** 本节依据现有源码、实施记录和报告复核；下文旧日期状态保留历史含义，当前完成范围以本节为准。

- [x] **已完成**｜2026-11-04—05：已发布的基础列表／多行／独立滚动槽已有应用消费，常用菜单与批注、自适应高度及主题已有后续实施证据。
- [ ] **保留事项**｜持久侧栏／父子面板、被动交互、宿主材质公开状态及首显、子 frame 可信编辑等仍缺；旧拟议字段不能当作公开接口已实现。

证据：[native7-implementation-progress-2026-11-04.md](./native7-implementation-progress-2026-11-04.md)；[native-annotation-and-dark-mode-implementation-2026-11-04.md](./native-annotation-and-dark-mode-implementation-2026-11-04.md)；[panel-density-and-annotation-chat-implementation-2026-11-05.md](./panel-density-and-annotation-chat-implementation-2026-11-05.md)。
<!-- /planning-completion-review:2026-11-06 -->


<!-- planning-obsolescence:2026-11-06 -->
> **【部分过时】标记日期：2026-11-06；原文/演进日期：2026-11-03—04。**
> **过时范围：**“.7 应用尚未接入”、基础多行/列表等待接入，以及把早期拟定接口直接当作当前已发布契约的叙述。
> **当前依据/保留范围：**已经落地的基础能力不重复开发；公开材质状态、子 frame 可信编辑、持久侧栏/父子面板等缺口保留，未发布的字段仍不能推定存在。
> **接续证据：**[native-ui-integration-2026-11-04.md](./native-ui-integration-2026-11-04.md)；[panel-density-and-annotation-chat-implementation-2026-11-05.md](./panel-density-and-annotation-chat-implementation-2026-11-05.md)；[current-state.md](./current-state.md)。
<!-- /planning-obsolescence:2026-11-06 -->

> 2026-11-05 规划整理核对：**部分完成**。.5/.7 基础控件已发布并被应用接入；持久侧栏/父子浮层、宿主材质首次合成与公开状态、子 frame 可信编辑等后续能力尚未收口，面板 Acrylic 搁置。 状态与归档口径见[规划状态总览](./planning-status-and-next-work-2026-11-04.md)。

日期：2026-11-03；更新：2026-11-04。状态：历史定制要求；首版已发布为 `45.0.0-cloudbypass.5`，应用开始接入。

`.7` 已发布，已核对 textarea／submitOnEnter、NativePanel 构造及 update 的 backgroundMaterial，以及面板／list／textarea 各自的 scrollbarPlacement；应用尚未接入。当前契约、缺口与顺序以[.7 总规划](./electron-7-readiness-and-implementation-plan-2026-11-04.md)为准，下面 `.5` 拟定契约保留历史，不作为新字段的依据。

范围调整：面板 Acrylic 已按用户要求搁置，backgroundMaterial 仅保留已发布能力记录，当前不启用面板模糊或透明配色；宿主窗口材质规划独立保留。此搁置不阻塞原生面板迁移、截图退出或发行。

多行批注详见[原生批注面板规划](./已完成/native-annotation-multiline-panel-plan-2026-11-04.md)：Enter 确认、Shift+Enter 换行和下方按钮可按已发布控件接入；原生排版驱动的自动增高、按钮取得最新组合文本的明确契约仍需补充或验证。不能把固定高度内部滚动、私有诊断或开发草稿当成这些缺口已经解决。

2026-11-04 实施补充：浏览器更多菜单的父窗口内展开（U05）需要公开的真实锚点／边界约束。`.7` Menu.popup 仍只有窗口内容区相对 DIP x／y，固定左上锚点；appearance.width 在 `native_menu.cc:537` 实为最小首选宽度，不能当作最终菜单宽度。请求增加公开 placement／anchorBounds／constraintBounds 或等效契约，由原生实际测量、处理右对齐、父窗口及工作区边界、窄窗滚动和子菜单。**用户最新纠正：空间不足时自适应位置与可用尺寸，保持默认对齐意图，不采用方向翻转作为方案。** 字段名以正式发行接口为准；不调用私有 `_getPopupState`，不按标题猜宽，不先弹出再测量重开。应用侧坐标只转换一次，保留网页实时显示与原控制权。具体见[交互规划 U05](./browser-chrome-interaction-followup-plan-2026-11-04.md#6-u05菜单默认向窗口内部展开)。

保留 WebContentsView。普通操作菜单使用已有 Menu.popup；本次定制解决网站信息和复杂原生面板的显示、定位及交互。以下保留原拟定契约；实际接入以 `.5` 随包 `electron.d.ts` 和 [发布接口说明](https://github.com/ChengHoward/edist/blob/main/NATIVE-PANELS.zh-CN.md) 为准。应用当前实施范围见 [接入记录](./native-ui-integration-2026-11-04.md)。

首版必做第 1、2 节；第 3 节仅按实际需要增加。

## 1 网站信息面板

### webContents.showPageInfoDialog

~~~ts
webContents.showPageInfoDialog(options: {
  anchorBounds: { x: number; y: number; width: number; height: number };
  siteUrl?: string;
}): boolean
~~~

参数：

- anchorBounds：地址栏触发按钮的位置，使用屏幕 DIP 坐标。
- siteUrl：可选。省略时读取当前已提交网页地址；传入时必须与当前网页来源一致，防止显示错误的网站信息。

能力：

- 原生显示网站域名、真实连接安全状态、证书摘要及已接入的本站权限状态。
- 面板可覆盖 WebContentsView，并伸出主窗口；自动避让屏幕边缘。
- 支持圆角、阴影、主题、键盘、点击外部关闭和焦点恢复。
- 页面导航、关闭或转移宿主时关闭旧面板。
- 点击“网站设置”时发出 page-info-open-site-settings 事件，由 Navora 打开对应设置；权限修改接入宿主现有权限逻辑。

返回值：true 表示已创建并请求显示面板；平台不支持时返回 false。非法参数、已销毁页面或缺少有效宿主应报告明确错误。

初次调研时本地 CloudBypass 尚无该方法；`.5` 已发布此接口。应用通过能力查询和真实委托检查，不能以本文中的历史描述判断新包能力。

## 2 通用原生面板 NativePanel

用于 Agent 控制、下载列表、模型选择等需要自定义控件的浮层。这是为 Navora 新设计的模块。

### new NativePanel

~~~ts
const panel = new NativePanel({
  parent,
  sourceWebContents,
  content,
  theme,
  radius,
  shadow,
  focusMode,
  dismissOnOutsideClick,
  dismissOnEscape,
});
~~~

参数：

- parent：必填，所属 BaseWindow 或 BrowserWindow。
- sourceWebContents：可选，绑定的网页。网页导航、关闭或转移宿主后，使原面板失效。
- content：必填，原生控件树。至少支持行列布局、文本、图标、按钮、开关、单行输入、选项、可滚动列表、分隔线和进度条。控件具有稳定 id，用于更新和回传动作。
- theme：可选，system、light、dark 模式及应用色板；支持背景、正文、辅助文字、强调色、边框和字体配置，不使用网页 CSS。
- radius：可选，圆角半径，单位 DIP，默认 12。
- shadow：可选，是否显示阴影，默认 true。
- focusMode：可选，none、menu、input；默认 menu。none 用于纯提示，input 支持文本输入和原生输入法。
- dismissOnOutsideClick：可选，点击外部关闭，默认 true。
- dismissOnEscape：可选，Esc 关闭，默认 true；输入法组合输入优先处理 Esc。

共同能力：

- 在现有主进程中使用原生控件绘制，不为面板创建 WebContents 或网页渲染进程。
- 覆盖所属窗口的 WebContentsView，允许伸出主窗口，不单独进入任务栏或窗口切换列表。
- 跟随所属窗口移动、缩放和隐藏；父窗口销毁时释放面板。
- 圆角与实际点击区域一致，透明边缘和阴影不无故拦截底层输入。
- 支持键盘导航、滚动、输入法和焦点恢复；支持保留列表位置及尚未提交的输入。
- 打开和关闭面板保持原网页实时显示，不触发截图占位、网页重载、人工接管或 Agent 暂停。

已有 Vue 面板需要转换成原生控件描述，不能直接将 Vue DOM 作为 content 传入。

### NativePanel.isSupported

~~~ts
NativePanel.isSupported(): boolean
~~~

无参数。查询当前运行时和平台是否具备该模块，不能只依据 Electron 版本号推断。首版目标为 Windows x64，其他平台明确返回不支持。

### panel.show

~~~ts
panel.show(options: {
  anchorBounds: { x: number; y: number; width: number; height: number };
  placement?: 'auto' | 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
}): void
~~~

- anchorBounds：触发按钮或目标区域的屏幕 DIP 矩形。
- placement：首选展开方向，默认 auto；空间不足时翻转、贴边或限制高度并提供内部滚动。
- 能力：显示或复用已有面板，跟随父窗口更新锚点。应用界面缩放或锚点自身变化时，可通过 update 提交新矩形。

### panel.update

~~~ts
panel.update(patch: {
  content?: NativePanelContent;
  anchorBounds?: { x: number; y: number; width: number; height: number };
  theme?: NativePanelTheme;
  radius?: number;
  shadow?: boolean;
}): void
~~~

参数只包含需要更新的字段。NativePanelContent 和 NativePanelTheme 分别对应构造参数中的原生控件树和主题配置。

能力：更新控件状态、列表内容、主题及锚点，保留稳定控件的焦点、输入和滚动位置。主题或内容更新不销毁重建整个面板；校验失败不应用半份更新。

### panel.hide

~~~ts
panel.hide(): void
~~~

无参数。隐藏面板、结束当前交互并恢复合适的焦点，保留实例供下次 show 复用。恢复焦点遵守 Agent 控制权，不因此解除网页输入保护。

### panel.destroy

~~~ts
panel.destroy(): void
~~~

无参数。彻底释放原生窗口、控件和监听；重复调用安全。所属窗口销毁时自动执行，销毁后不能再次 show。

### 面板事件

- action：回传控件 id、动作类型及新值，例如点击、开关变化、选择、输入提交。实际业务操作由 Navora 执行。
- dismissed：用户通过外部点击、Esc 或失焦收起面板，携带原因。
- closed：实例已销毁，用于清理应用侧引用。

事件使用既有 EventEmitter 订阅方式，不另设一套事件注册方法。

## 3 可选扩展

### 输入命中区域

~~~ts
BrowserWindow.isInputShapeSupported(): boolean
win.setInputShape(rects: Array<{ x: number; y: number; width: number; height: number }>): boolean
~~~

- isInputShapeSupported 无参数，用于探测平台能力。
- rects 使用窗口内容区 DIP 坐标，表示允许接收输入的区域；区域之外穿透到下层。空数组表示全窗口穿透，恢复普通矩形时传入覆盖内容区的矩形。
- 只改变输入命中范围，保留可见像素和阴影。现有 setShape 同时影响绘制和交互，不能直接视为同一能力。
- 如果这项能力只服务 NativePanel，可以在模块内部实现，不必同时公开这两个窗口接口。

Codex 浮动界面中已确认调用同名方法，当前本地内核源码未发现。

### 页面持续绘制租约

~~~ts
webContents.setPageCapturePaintLeaseEnabled(enabled: boolean): void
~~~

- enabled 为 true 时保持页面捕获所需的绘制，false 时取消本方法设置的强制保持状态；不得抢前台或解除输入保护。
- 仅在后台或隐藏页面捕获确实需要时定制；普通浮层不隐藏底层网页，不依赖此接口。
- 同一页面有多个持有者时，由应用层计数，仅在 0 与 1 的边界调用。本方法不得取消其他捕获机制持有的绘制需求，页面销毁时自动清理。

Codex 应用包中已确认调用同名方法，当前本地内核源码未发现。不纳入首版必做接口。

## 4 已有能力继续复用

Menu.buildFromTemplate、Menu.popup、Menu.closePopup、View.setBorderRadius、现有 WebContentsView 跨窗口移动、虚拟光标和 dispatchInputSequence 均继续复用，不作为本次新增方法。

不增加 createWebViewTransfer、adoptWebContents 或 webview 接收租约接口。原生面板展示后，由应用逐项解除已迁移入口的旧截图触发逻辑。

## 5 各接口的用途与交互场景

### 普通操作菜单

浏览器更多、标签右键、侧栏右键、文件编辑视图帮助等使用现有 Menu.popup。需要图标、分组、子菜单、勾选和键盘操作，但不需要原生面板的复杂控件。菜单可伸出窗口，底层网页继续实时显示，打开菜单不触发截图占位。

### 网站信息与站点设置

showPageInfoDialog 用于地址栏锁图标或站点信息按钮，展示真实域名、连接安全、证书及已接入的本站权限。要考虑导航尚未完成、证书错误、同 URL 重新加载、切页和跨窗口移动，避免旧网站面板误操作新网页。网站设置入口回到 Navora，由现有业务处理。

### Agent 控制与下载列表

NativePanel 用于显示 Agent 控制状态、显式接管或恢复操作、下载进度和下载动作。update 需要持续刷新状态而不跳动列表、不丢失当前焦点。打开面板、鼠标进入面板或关闭面板都不等于人工接管；只有用户选择对应动作时才调用现有控制器。底层视频、动画和 Agent 输入保持原有运行状态。

### 地址建议与输入区面板

NativePanel 可用于地址建议、模型选择、附加来源选择和文本格式工具。要考虑搜索输入、中文输入法、长列表滚动、方向键、Enter 和 Esc。附加面板需要在编辑器上方左对齐；地址建议需要随空间翻转。文本格式操作由应用保存并恢复编辑器选区，原生面板通过 action 回传操作，不接管编辑器文档。

### 圆角透明区域与多窗口

输入命中区域能力用于浮层圆角、阴影和透明留白，避免看得见网页却点不到。用于浮层时只改变对应弹出窗口，不设置整个主窗口穿透，也不靠重放点击模拟穿透。需要考虑窗口移动、混合 DPI、界面缩放、多级菜单、输入法候选窗以及父窗口最小化和关闭。

原生面板属于创建它的窗口；网页移窗时关闭原宿主的页面相关面板。新窗口按需要重新打开，面板不能留在旧位置或操作已转移的页面。

### 后台捕获与资源使用

持续绘制租约仅用于后台 Agent 或隐藏页面确有持续捕获需求的场景。面板打开时底层网页保持可见，不为展示面板申请长期绘制租约。结束捕获、页面销毁或任务失败后应释放保持状态。

NativePanel 的原生绘制不新增网页渲染进程，但仍占用窗口、控件、内存和绘制资源。hide 后供复用，停止无意义的动画和更新；destroy 或父窗口关闭时完整释放。复杂面板使用原生控件布局，不能以新增网页渲染器替代后仍宣称没有额外渲染进程。

## 6 宿主材质状态与首次激活问题（待内核补充）

本节针对应用宿主 `BrowserWindow`，**不恢复已搁置的 NativePanel Acrylic**，也不改变 `showPageInfoDialog`。

应用侧 `.7` 实测：Windows `10.0.26100`、系统浅色、公开辅助功能限制均为 false，隐藏构造后请求 `acrylic`、宿主 DOM 透明链正确，首次主窗在真实前景仍呈灰色；重新激活后正常显示模糊。首次图前后 `isFocused()` 为真，系统 `GetForegroundWindow()` 匹配该窗 HWND；Electron 桌面捕获和独立 GDI 裁剪一致。构造后在首次 `ready-to-show`、首次 `show`、自然首次 `focus` 重申相同材质，及等待受控背景首次绘制完成，均未消除该现象。原始／对照证据和受限验证范围见[宿主材质专题第 9 节](./window-acrylic-material-plan-2026-11-04.md#9-本轮接入与验证范围)。不得以强制聚焦、窗口隐藏重显、长延时、反复切换材质或截图背景掩盖。

现有公开 `setBackgroundMaterial()` 返回 `void`，DWM 失败可能只记原生日志；`NativeWindowViews::SetBackgroundMaterial()` 已调用非客户区激活消息，不能假设应用重复一次相同调用就能修复首次视觉状态。请内核检查首次激活、窗口透明状态、DesktopWindowTreeHost／合成器与背景刷新的时序，并提供正常首次显示即可生效的路径，保留实时网页和原输入／窗口所有权。

建议补充**公开、逐宿主、可订阅的材质请求／回退状态**，具体 API 名称待双方确认，当前并无可直接调用的新接口。状态至少区分请求值、平台／辅助功能不允许、原生调用失败及可获得的原生失败原因；使用现有窗口生命周期，关闭后停止通知。原生 DWM 设置成功只证明系统接受请求，不能包装成“屏幕已显示模糊”；无法确定实际合成时须明确 unknown，并让应用有依据同步撤销额外透明配色。不能以私有 `_getState()` 或截图轮询作为生产契约。

验收需覆盖支持系统上的真正首次前景显示、失焦／重新激活、设置透明开关与高对比／减少透明度、浅深色和系统不支持／原生失败，记录首次与后续视觉证据及公开回执。没有焦点抢占、重载、材质来回切换或额外渲染器；原生请求失败和无法观测真实效果分别报告。此项是宿主材质后续能力，不阻塞已完成的原生普通面板迁移或网页截图替换退出。

## 7 网页右键的 frame 目标与编辑凭据（待公开能力）

`.7` 页面右键基础菜单已能使用真实 `context-menu`、原生 Menu 和 `params.frame`。应用已为主 frame 保存隔离世界内的焦点／选区与可观察命中节点，并复核页面／宿主／文档代次。`WebFrameMain` 当前没有公开的隔离世界执行方法；不能把子 frame 的临时编辑凭据放进页面主世界，也不能把外层 iframe 的节点身份当成内部命中节点的身份。

真实隔离复现已证明：页面可修改主世界 `__navoraMenuEdit`，让旧菜单“全选”操作另一个输入框；子 frame 内部替换节点、不滚动时，仅比外层 iframe 和视口仍会错误放行检查。应用已移除这两条路径，子 frame 暂禁菜单编辑与坐标检查／复制图片；保留页面控制、链接、DevTools 和基于原生选区快照的显式文字复制，不伪称完整 frame 编辑已完成。

需要公开、绑定真实 frame／document／命中节点及选择状态的上下文凭据和操作入口，或能达到同样保证的公开 frame 隔离执行能力。具体 API 名称由内核定稿；当前没有可直接调用的新方法。凭据应不可由网页脚本伪造或更新，绑定来源 WebContents，支持普通／跨源／嵌套 iframe、shadow DOM 及导航失效；编辑不能因同 frame 焦点变了就作用于新控件，检查与复制图片不能只复用已过期坐标。无需为组菜单读取或公开表单 value，密码规则及输入法行为保留原生语义。

原生编辑仍由应用核对 Agent owner、租约、未完成输入和来源权限；不以新增接口绕过保护、不自动交还、不读取宿主聊天编辑器，也不因检查元素强制拆除现有 debugger。菜单关闭、导航、移窗或销毁后旧回调拒绝。此项不涉及新的 HTML 浮层、额外渲染器、网页圆角或截图替换。
