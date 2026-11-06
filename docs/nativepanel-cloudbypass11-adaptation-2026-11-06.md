# cloudbypass.11 NativePanel 适配计划与验证

日期：2026-11-06。

## 范围和实施顺序

1. 核对正式发布包、类型与构建来源，升级 Electron 依赖、锁文件、安装 pin 和打包路径；保留旧运行时，禁止用本地重编译文件替代正式 .11。
2. 统一扩展 NativePanel 桥接层，适配 API v2、正式 context-menu 事件、原生关联菜单、焦点／活动项／滚动、事务及 revision；保留宿主和会话校验。
3. 复用设置“窗口透明与模糊”的可信主进程状态，为全部 NativePanel 统一决定 Acrylic 或不透明背景；刷新已打开及隐藏实例，保留输入、焦点、滚动与会话。
4. 按实际用途调整调用方的搜索导航、文本换行、编辑校验、可访问性及下载菜单，避免重复在各组件写材质策略。
5. 完成类型检查、相关单元与桥接测试、实际 .11 窗口测试和应用构建；记录真实材质后端及降级原因，区分布局截图与系统合成效果证据。

## 发布依据

使用 [45.0.0-cloudbypass.11 正式发行](https://github.com/ChengHoward/edist/releases/tag/v45.0.0-cloudbypass.11)。分发版本与实际内核版本不同：npm 为 `45.0.0-cloudbypass.11`，内部 Electron 为 `45.0.0-beta.5`。构建来源为发行记录冻结的源码 `cb5ee5cdf622790ade2338511b5178ab735e7a4c`。

安装目录为 `node_modules/electron/dist/45.0.0-cloudbypass.11-9a24ef91a67a`。ZIP、npm 包、类型、构建 manifest、发布说明及 exe 的 SHA256 已核对；精确校验值以 `scripts/electron-runtime-manifest.json` 为准。核对依据保存在 `../_planning/electron11-upgrade/verified-assets.json`。

## 统一接口

NativePanel 实际能力由公开 `getCapabilities()` 读取，API v2、Views 后端且不创建 WebContents。应用桥接受已发布的布局约束、换行、虚拟列表、共享样式／令牌、状态样式、编辑与可访问性字段，并在进入原生层前验证和转换 DIP。

原生 `context-menu` 只通过 action 事件处理一次，规范化为应用既有 `contextMenu` 事件；锚点只在屏幕与宿主内容坐标之间转换一次。关联菜单通过公开 `panel.popupMenu()`，目标消失或父面板隐藏／销毁时由原生生命周期关闭。

桥提供 focus、setActiveItem、scrollTo、scrollListTo、getBounds 和 announce。`showFocused` 在 .11 上复用实例，并在异步能力读取前建立取消凭证。节点事务先校验候选树，再使用公开 applyPatch 一次提交；revision 不匹配或无效操作不改变原生状态。主题、材质更新省略内容树，保留编辑草稿与选区。

## 材质规则

唯一偏好为 `app.window_acrylic`，对应设置“窗口透明与模糊”。NativePanel 不信任 renderer 提交的任意 backgroundMaterial；主进程从宿主 WindowMaterialManager 获取已评估状态。主窗口、独立浏览器窗口与文件窗口共享同一规则。

有效状态为 Acrylic 时请求 `backgroundMaterial: 'acrylic'`，其他情况明确请求 `none`。关闭设置、旧系统、未知状态、高对比度、强制颜色和减少透明度均恢复不透明兜底。不会修改全局 `nativeTheme.themeSource` 或网页媒体查询。

主题 background 保持不透明，默认 materialTint 浅色为 `#CCFAFAFA`、深色为 `#B3202020`。调用方可提供正式 tint 与共享样式；普通行使用透明背景及原生 surfaceHover／surfaceSelected 令牌，避免用不透明列表表面盖住背景材质。设置与系统主题更新会刷新全部现存面板，隐藏实例不因此显示。

实际效果从公开 diagnostics 的 `backgroundMaterialApplied`、`materialBackend`、`materialFallbackReason` 读取。仅请求 acrylic 不算应用成功；Windows 系统或电源策略还可再次降级。

## 调用方覆盖

- 浏览器：Agent 控制、地址建议、下载、标签搜索、标签信息。
- 输入区：模型选择、上下文用量、回答方式、会话权限、格式工具等共享原生浮层。
- 编辑与查找：批注编辑、窗口查找；保留原生编辑右键，增加正式校验与可访问描述。
- 对话框：NativePanelDialog 及其读取来源、对话搜索、工作区文件选择等调用方。

下载使用正式 hoverOnly、contextMenu、maxLines 与关联菜单；不再根据字符数量估计文本高度。搜索入口使用 navigationTarget 保留输入焦点，选中项与键盘活动项分离。

## 验证记录

- 正式发布资产、实际运行时身份、安装幂等：通过。
- 原生文本 20 项、指针 22 项：通过。
- NativePanel 桥接（材质、宿主隔离、焦点、revision、事务、菜单与取消竞态）385 项断言：通过。
- 主／浏览器／文件三种宿主的材质切换和降级 10 场景：通过。当前测试环境中 Acrylic 实际后端为 composition-host-backdrop；关闭与降级为 none。
- 输入值、选区、锚点、窗口句柄、会话、隐藏状态与真实网页 identity 在材质切换后保留。
- 完整 `npm run build`（正式运行时安装校验、类型检查、972 项单元测试、前端与主进程构建）：通过。
- 实际浏览器原生面板集成 14 场景：通过。
- 下载面板 12 场景：通过，覆盖正式关联菜单目标、菜单关闭、输入焦点、原生两行换行、布局缓存、浅色／深色／窄屏；报告 `../_planning/electron11-native-consumers/download-card/completed.json`。
- 真实设置页 10 项：通过，保留默认 renderer sandbox，确认开关自动保存、能力不足与临时系统降级时的行为。
- 既有输入区浮层 13 场景：通过。这组入口按原策略仍使用 HTML，没有强制替换成原生面板，也没有额外隐藏网页或创建截图占位。
- 真实宿主最小化／恢复／最大化 5 场景：通过。为 .11 校准最大化／调整大小后的最终内容区锚点，保留原严格位置断言；隐藏面板不被恢复。

真实材质报告与截图：`../_planning/native-panel-material-2026-11-06/`。PrintWindow 截图可检查布局、颜色和圆角，不单独证明 DWM 桌面像素模糊。

## 已知的既有测试问题

综合 browser-smoke 的严格进程退出检查仍未通过。已用同一入口对照正式 .10 和 .11：两者均通过 36/36 业务检查并完成清理，打印 `app:quit 0` 后仍保留真实 Electron 主进程，最终触发原 60 秒期限。这不是本次 .11 升级新增；未将退出日志改判为进程已退出，也未放宽期限或修改无关业务。机器证据：`../_planning/electron11-upgrade/exit-comparison/comparison-summary.json`。
