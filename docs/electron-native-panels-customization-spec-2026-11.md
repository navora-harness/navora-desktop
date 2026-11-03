# Electron 原生浮层定制接口清单

日期：2026-11-03；更新：2026-11-04。状态：历史定制要求；首版已发布为 `45.0.0-cloudbypass.5`，应用开始接入。

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
