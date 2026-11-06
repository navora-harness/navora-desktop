# 菜单动作补齐实施记录

日期：2026-11-05。状态：浏览器、文件与通用编辑菜单的本轮源码工作已完成；定向逻辑与实际 Vue 菜单 fixture 检查通过，主任务统一构建 0.4.10 已通过。本记录不声称已打包或安装，也未读取个人聊天、浏览记录或文件内容。

关联：[总规划](./已完成/menu-audit-and-followup-plan-2026-11-05.md)、[浏览器审计基线](./menu-audit-browser-2026-11-05.md)、[普通浮层与确认框边界](./已完成/browser-live-view-overlay-cleanup-plan-2026-11-05.md)。

## 已实现的浏览器菜单

- 主工作区与独立窗口的标签右键、浏览器更多、浏览器资源页面菜单、应用菜单和真实网页右键补齐“在外部浏览器中打开”。真实网页中的 HTTP／HTTPS 链接另有明确的“在外部浏览器中打开链接”。
- 正常页面使用已提交地址；正在导航时等待网址确认。加载失败使用明确的“在外部浏览器中尝试打开此网址”，绑定主进程记录的失败目标。内部页、其他协议和带用户名密码的地址不能从这些入口外传。
- 共享 `browser-page-address` 状态模型和主进程执行服务校验所属对话、页面、宿主、文档代次、地址及正常／失败类型。切页、重定向、移动或关闭后，旧菜单不能作用于新目标。复制多个页面先统一验证，再一次性写入剪贴板；外部打开只接受一个明确目标。
- 系统浏览器启动结果被等待并报告失败；只传目标网址，不转交 Cookie、缓存、认证信息或页面内容。配置的地址访问范围仍生效。远程页面不调用远程宿主的系统浏览器。
- 主／独立窗口统一复制网址、刷新、忽略缓存重载和静音入口；缩放下拉使用共享范围。真实网页右键保留既有 frame、命中、控制权与文档验证。

主要落点：`shared/browser-page-address.ts`、`electron/modules/browser-page-address.ts`、`browser-workspace-ipc.ts`、`browser-page-context-menu.ts`、`shared/app-commands.ts`、`useBrowserTabActions.ts`、`useBrowserTabController.ts`、`BrowserTabPanel.vue`、`BrowserHostPage.vue`、`BrowserResourcesPanel.vue`。主页面的应用菜单接线由主任务合并。

## 已实现的文件与通用菜单

- 文件列表的普通文件、已完成下载、空白目录；主工作区与独立文件窗口的文件标签；侧栏文件树均复用 `useWorkspaceFileActions`。已有预览、默认应用、选择打开方式、另存为、复制完整／相对路径、复制文本、定位文件夹按实际能力显示，不新增改名、删除或批量 ZIP 业务。
- 文件动作保留所属对话、路径和文件修订。异步检查、弹出菜单和选择后复核来源；切目录、切对话、组件关闭或文件变化后，迟到选择取消并提示重试。完成下载的“移除记录”与文件内容操作保持独立。
- 文件行、文件树和标签支持菜单键／Shift+F10。问卷标签可返回其所属对话。文件页更多补“刷新文件列表”“打开当前文件夹”，沿用原事件由主页面接线。
- 对话链接菜单支持菜单键／Shift+F10，保留原链接与所属对话；原生菜单不可用给出明确反馈。普通文本编辑菜单同样支持键盘入口，保留输入框或富文本选区；异步读取剪贴板后确认目标仍有效才粘贴。
- 编辑器右键补可用状态对应的撤销、重做。子对话列表补打开、定位父对话、导出，以及运行中的停止；全部绑定菜单对象，停止携带捕获的 runId，主进程发现任务已变化时拒绝操作。
- 托盘“退出 Navora”与主窗口退出命令使用同一确认意图；先确保主窗口可见，等待确认监听装载后再投递，不提前停止 Agent。确认时由主页面先保存问卷与编辑草稿，再调用可信主窗口专用的实际退出接口；主进程单次提交，远程端明确不提供退出宿主能力。窗口关闭按钮行为不在此次改动范围。

主要落点：`useWorkspaceFileActions.ts`、`FileManager.vue`、`FileWorkspace.vue`、`FileHostPage.vue`、`WorkspaceFilesPanel.vue`、`WorkspaceTreeNode.vue`、`useAppLinks.ts`、`AppLinksHost.vue`、`TextContextMenuHost.vue`、`editable-context.ts`、`ComposerEditor.vue`、`SubchatList.vue`、`SubchatWorkspace.vue`、`ChatResourcesMenu.vue`。

## DOM 兼容菜单与实时网页

共享 `browser-popup-placement` 只读取明确上报的 View 矩形和当前弹出层尺寸。DOM 兼容菜单优先留在原位置；与真实 View 重叠时移到可容纳的聊天列、侧栏或网页上方，所有 View 都参与排除。无足够区域时关闭菜单，并提示“当前窗口没有足够空间显示菜单，请调整布局后重试。”，不截图、不隐藏或重建网页。没有 View 的界面维持原 DOM 定位行为。

覆盖 `ActionMenu`、`SidebarContextMenu`、`ApplicationMenuBar`、浏览器标签二级菜单、Agent 面板、地址建议与网站信息、下载主面板与二级菜单、标签列表。仅观察当前弹出层的尺寸／样式、窗口变化与显式 View 几何，不加入全 body 观察器。正常原生菜单／原生面板流程不变。主任务统一承接 `navora:ui-notice` 提示。

确认框是否暂藏 View 由显式确认类型决定，与本定位规则独立。会话改名／新建所属对话改用内容面板，会话关闭／清理／删除改用明确确认包装；确认取消恢复同一页面，业务确认本来关闭页面时不复活页面。

## 验证与边界

- 62 项定向单元测试通过：浏览器地址选择与系统启动、链接路由、原生面板动作、文件标签、完整文件文本解码、下载呈现、6 项安全几何定位，以及 3 项退出意图与监听就绪案例。
- `scripts/test-workspace-file-menus.mjs` 11 项通过：实际异步菜单协调代码的来源／修订／生命周期检查、额外动作复核、键盘锚点、不可用菜单反馈、链接来源和延迟粘贴保护。其 NativeUi／文件服务为受控测试替身，不调用系统文件选择器或打开用户文件。
- 相关文件 `git diff --check` 通过。全仓类型检查交由主任务统一执行；本次定向检查未出现菜单范围类型错误。
- 实际 Electron renderer 中加载当前 Vue 菜单源码的 fixture 通过：native 24 项、unsupported 13 项、remote 13 项，共 50 项。验证既有命令分发、上下文／选区、失效动作隔离、兼容 DOM 菜单避开显式 View 区域、无空间关闭和提示。首次启动受沙箱 ACL 检查中止，未修改 ACL；随后通过已批准的隔离 Electron 启动方式重跑。空间不足检查最初只等到关闭状态、未等退出动画卸载，修正等待条件后通过。
- 结果位于 `../../_planning/native-menus-components-current/{native,unsupported,remote}/completed.json`。此 fixture 使用受控 NativeUiApi 和显式矩形来验证实际组件行为；不声称已经验证操作系统菜单绘制／物理键盘选择或真实 WCV 遮挡与视频连续性。浏览器页面地址执行的归属／文档校验由上述后端单元覆盖，未在此 fixture 启动系统浏览器。

统一主窗口整合回归已覆盖菜单四入口等价、原生查找、DOM 普通菜单与 View 动画连续、图片/帮助避让、确认取消和文档返回；最终成品也已打包与核验，详见[本轮汇总](./confirmed-plans-implementation-2026-11-05.md)。所有平台、DPI、错误站点和原生操作系统菜单物理选择不作穷尽覆盖声明。后续下载重试、批量外部打开、保存图片等增强仍未纳入本轮。
