# 项目检查报告（2026-11-03）

> 本文保留规划阶段的实施前检查。用户随后要求开始实现；新的正式修复与复查结果见[界面实施记录](./interface-implementation-check-2026-11-03.md)，不要用以下旧失败数量判断当前源码。

结论：检查已完成，当前代码**未达到全部检查通过**。桌面类型检查与构建通过，核心浏览器和关联工程多数测试通过；仍有输入控制权、弹层白屏、设置保存／生效和控件样式等问题，另有图标登记、类型检查与旧测试选择器失败。

本轮先完成 [界面统一规划](./interface-renovation-plan-2026-11.md)，再执行检查；用户随后补充的零页标签栏与安装版自动化问题已继续纳入规划和核查。交付是规划、交互示例与检查报告，**没有修复正式源代码，也没有生成新版安装包**。

## 1. 检查范围与数据边界

- 主工程：`navora-desktop`，含前端、Electron 主进程、共享契约、既有源码测试、五套真实 Electron 隔离检查、控件运行时探针。
- 关联工程：`navora-store`、`navora-plugin-sdk`、`navora-plugins`、`navora-flow-library-sdk`、`navora-flow-libraries`、`navora-flow-desktop`、`navora-monitor`。
- 未将 `navora-monitor-cleanup-20261026` 的旧副本当成当前产品重复测试。
- 构建仅写已核实归属的生成目录；保留既有工作区修改，没有提交、发布、安装或升级依赖。Monitor 没有执行会覆盖嵌入资源的 `stage-web`，原有 21 个嵌入文件前后摘要一致。
- 测试使用临时数据、离线页面或受控测试夹具，不调用真实模型，不使用用户摄像头／媒体或真实登录会话。原生检查使用正常 compositor，不以 offscreen 截图替代网页覆盖验证。
- 安装版仅按用户明确请求仅读最近一条对话、相关自动化设置、程序版本与包内控制器实现。保留的观察摘要只有错误编号／时间、设置与实现判断，没有聊天正文、密钥、Cookie 或网页内容。

## 2. 执行结果

### 桌面源码与构建

- Vue／TypeScript 工程检查通过：`node node_modules/vue-tsc/bin/vue-tsc.js -b --noEmit`。
- Electron 类型检查通过：`node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit`。
- 全部源码测试执行完成：**321 项，320 通过、1 失败**。唯一失败为图标目录覆盖检查，`ComposerSourcePicker.vue` 使用 `comment-dots`，共享目录／别名未登记该名称。
- 前端 Vite 构建、Electron 主进程与 preload 构建均通过。通过构建不代表交互或发布验收通过。
- 机器结果与日志：[desktop-core.json](../../_planning/project-checks/desktop-core.json)、[源码测试日志](../../_planning/project-checks/desktop-unit.log)。

### 真实 Electron 隔离检查

五套入口全部运行，**3 套通过、2 套失败**；通过套件中原报告列出 110 项检查。

- `browser-smoke-entry.ts`：36 项通过，包含真实原生能力、页面／会话生命周期、宿主转移与恢复。运行时探测确认 `virtualCursor`、原生输入序列与定点输入等能力存在。
- `ui-browser-automation-entry.ts`：53 项通过，覆盖 Agent 控制、下载与恢复等现有界面行为；不能据此证明工具之间的任务级输入保护正确。
- `ui-browser-tree-entry.ts`：21 项通过，覆盖现有三层树、页数／菜单槽位、打开复用及窄屏。
- `ui-main-window-entry.ts`：失败于标签菜单打开后等待 `.browser-frozen-frame.naturalWidth` 就绪。失败截图中页面区域为空白，支持弹层预览链路有实际回归，仍需修复后复测时序及慢／空截图等分支。
- `ui-renovation-entry.ts`：失败于访问已不存在的 `.global-title-actions`。属于测试选择器未跟随界面变更，不把后续尚未执行的设置／编辑器断言算作通过。
- 机器报告：[native-ui.json](../../_planning/project-checks/native-ui.json)。包含完整日志、原始完成记录与 29 张截图，隔离 profile 和临时生成入口已清理。

### 控件专项运行探针

独立打开真实设置与资源界面，仅操作临时配置，运行无渲染错误：

- 开关最终位移为关 −10px、开 +10px，覆盖项目的 ±7px。轨道 36×22、圆钮 16×16，贴边侧扣除边框后的内距为 −1px。
- 同特异度 Vuetify LTR 规则在编译样式中后出现，是此次位移覆盖的直接原因；不再仅作为截图猜测。
- 浏览器资源搜索框内部有 2px outline，外层同时有 2px 焦点阴影，确认双重焦点。
- 证据：[native-controls-probe.json](../../_planning/project-checks/native-controls-probe.json)、[开关](../../_planning/project-checks/native-controls-switches.png)、[搜索焦点](../../_planning/project-checks/native-controls-focus.png)。

### 插件、商店与 SDK

- `navora-store`：19/19 测试通过。
- 桌面 marketplace 隔离测试：6/6 通过。
- SDK CLI 校验既有 9 个插件包通过，检查运行时清单及模块导出，没有调用真实插件 `execute`。这不等于逐平台原生二进制和真实网络业务验收。
- `navora-plugin-sdk` 没有独立测试目录或测试脚本，记为覆盖缺口，不虚报 SDK 单元测试通过。
- 首轮 store／marketplace 因受限环境 `os.userInfo()` 失败；相同隔离命令在自动批准的常规权限环境重跑全过，原失败日志保留，不按多个业务缺陷重复统计。
- 报告：[plugin-ecosystem.json](../../_planning/project-checks/plugin-ecosystem.json)。

### Flow 与 Monitor

- Flow SDK：类型、14 项测试与构建通过。
- Flow libraries：3 项测试、构建及 manifest 验证通过；类型检查失败于 `tests/libraries.test.ts:24`，`LibraryModule` 类型没有 `default` 属性。
- Flow desktop：类型、32 项测试与构建通过。
- Monitor 前端：类型、21 个测试文件中的 135 项测试及直接 Vite 构建通过。以上 Vitest 合计 184 项全部通过。
- Monitor Go：离线全套运行，唯一失败是 Windows CIM 进程扫描对带空格／Unicode 临时路径的识别。相同目标测试在常规权限隔离复核通过，说明对环境敏感；没有宣称整套 Go 已在非受限环境全过。
- 非阻断提示包括 Flow 混合静态／动态导入和 Monitor 的较大 hls 产物，需要按实际加载体验评估，不列作测试失败。
- 报告：[related-projects.json](../../_planning/project-checks/related-projects.json)。

### 本轮交互示例

- 附加／富文本／工作区示例：25 项通过，桌面与窄屏共 5 张截图。
- 浏览器资源示例：16 项通过，共 3 张截图；最后一轮已加入“零页隐藏整条标签栏，创建首个新页恢复”的检查。
- 三款专属光标示例：11 项通过，包含明暗、独立 AI 路线、人工交还、键盘和窄屏；已检查浅色／深色／手机截图，运行无渲染错误。结果见 [cursor-demo-validation.json](../../_planning/cursor-demo-validation.json)。
- 示例没有访问网络或实际发送消息，只证明离线交互，不证明原生层、真实会话与设置提交已改造。

## 3. 优先处理的问题

### P1：工具间释放保护，鼠标事件误触发控制权中断

安装版为 **0.3.35**，最新对话 28 条消息中可确认多次 `browser_manual_control` 和一次 `browser_operation_invalidated`，新建窗口也被控制状态拦截。安装版设置 `show_virtual_cursor=true`、`protect_input=true`、`show_control_feedback=true`、`cursor_fps=60`，不能归因为用户没打开虚拟光标。

安装包和当前源均确认：`browser-automation-controller.ts` 在单次操作结束后调用 `syncNative(show_virtual_cursor,false)`，工具之间的等待期放开保护；`intervention` 不检查鼠标事件类型，等待期任意 `before-mouse-event` 都可调用暂停。安装包中没有 `setVirtualCursorImage` 调用，尚未接入专属光标图片。

这是与用户描述一致的明确实现缺口；最新对话没有低层事件 trace，不能据此断言当时一定只有 mouseMove。修复应把输入保护提升到任务对当前页面的控制期，区分观测、等待与人工接管，而不是关闭所有取消保护。细则与光标样式见 [输入控制权规划](./browser-input-ownership-and-cursor-plan-2026-11.md)。

证据：[安装对话错误摘要](../../_planning/project-checks/installed-chat-observation.json)、[安装包只读核对](../../_planning/project-checks/installed-package-observation.json)。

### P1：弹层截图与隐藏竞态造成页面白屏

`BrowserTabPanel.vue:275–283` 发起非阻塞截图后立刻提交空布局；`browser-host.ts:204` 将宿主 suspended 并隐藏 view，截图处理器又在返回时拒绝 suspended 结果。原本等待截图解码／呈现后再隐藏的顺序被打破。

本轮主窗口套件也在此类冻结画面等待上失败。按 [附加规划第 13 节](./composer-attachment-plan-2026-11.md#13-弹出层使浏览器视图变白的回归方案) 做有短超时和代次取消的呈现切换，并为截图失败提供独立原生菜单／浮层路径；不能用无限等待或直接留白换取菜单可点。

### P1：远程监听地址修改后未重绑，显示与实际监听可能不一致

`remote-server.ts:113–121` 的重绑判定只比较 `startedPort`，`status():72–82` 却读取当前 `cfg.host`。同端口从全接口地址改为回环地址时，状态可展示新地址，监听器仍保留原地址。

此项由源码确认，未对用户真实监听服务做实验。应把 host／port／运行实例的实际生效配置一起纳入提交结果和重绑判定，失败时不得显示已生效。完整路径及场景见插件生态报告 `CFG-1`。

### P2：设置并发保存可能覆盖其他修改

`SettingsPage.vue:2771–2774` 先 get，再重基，再提交全快照；`ConfigService.update()` 没有比较修订协议。两个客户端先拿到同一基线，随后保存不同字段，后一份全快照仍可能覆盖前一份修改。设置页也没有订阅配置变化完成持续重基。

需要主进程的字段／业务组事务与修订协议，不能只把全页保存按钮换成更多前端自动监听。见 [设置规划](./settings-immediate-save-plan-2026-11.md) 及 `CFG-2`。

### P2：连接配置与密钥可能部分提交

`SettingsPage.vue:2774` 先保存配置，`:2786` 后写密钥；远程 RPC 拒绝 `setApiKey`。远程编辑 URL 和 Key 时可出现 URL 已修改、Key 未修改，界面只报告应用失败的状态。没有对用户真实密钥做验证。

按业务事务或明确的分阶段回执处理；远程不可写密钥的边界应在编辑入口可见。见设置规划及 `CFG-3`。

### P2：开关几何与复合搜索焦点

已由专项探针确认，按设置规划第 7 节统一组件作用域／几何和唯一焦点归属。保留键盘可见焦点，不全局取消 outline；修复后补明暗、RTL、缩放、触控和 forced-colors 验证。

### P2：检查链尚不能作为发布门槛全绿

- 修正来源选择器未登记的图标名称／共享映射，恢复主源码测试全绿。
- 修正 Flow libraries 测试模块形状的类型约定，不以运行测试通过掩盖类型错误。
- 更新综合 UI 套件的旧选择器与断言归属，然后重跑完整后续流程，不只删除失败断言。
- 修复白屏后重新运行主窗口套件及慢／空截图、快速切换、多层浮层场景。
- 为 SDK 及新增控制期语义补独立覆盖；现有自动化 UI 通过不能代表鼠标悬停不会打断整个任务。

## 4. 实施与复查顺序

1. 先修输入控制期与弹层白屏，并保留停止／显式接管、清理确认和迟到结果隔离。
2. 修开关、双重焦点和图标登记，恢复测试基线。
3. 建立设置事务、生效状态和跨窗修订，再按模块迁移自动／手动提交，最后移除旧全局应用入口。
4. 接入附加与文档迁移、工作区对话标签、浏览器资源与零页标签栏；按统一规划逐批验收。
5. 更新过时测试并重跑相关失败项、真实系统输入法与多窗口操作，再考虑打包发布。

## 5. 尚未覆盖的边界

没有执行 macOS／Linux 真机、安装器交互、真实模型供应商、真实站点反自动化／登录、摄像头和长时录像、真实系统输入法全过程，也没有执行依赖漏洞全量审计或证明不存在其他缺陷。

当前失败与覆盖缺口均已记录，没有用原型截图、构建通过、单项环境复核或跳过断言来替代正式回归结果。下一轮应按上述优先级实施并逐项更新本报告。
