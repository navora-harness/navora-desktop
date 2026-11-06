# 浏览器 Agent 自动化（Electron cloudbypass.8）

Navora 固定使用 Electron `45.0.0-cloudbypass.8`，提供原生 DOM 快照、定向输入、`dispatchInputSequence` 定时输入，以及逐页独立的后台输入隔离和渲染保活。此版本随 Windows x64 定制运行时发布；分发版本由包、运行时摘要与能力探测确认，内部 `process.versions.electron` 仍为上游的 `45.0.0-beta.5`。

原生调用使用 `clickElement({selector|target,...})`、`setAutomationOptions`、`getAutomationState`、`resetAutomationOptions`；旧 `clickSelector` 和 `setVirtualCursorEnabled` 已退出。鼠标与触摸点在主视口使用 `position`，在 target 内使用 `offset`；Agent 工具现有 `x/y/from` 参数由宿主转换，几何结果与 `sendInputEvent` 保留原坐标格式。跨文档几何查询保留 `.target`；工具的旧 `agentInfo` 参数由宿主组合几何查询与快照，不再透传给原生查询。

> 2026-11-06 光标补全：任务取得保护时先隐藏图形，成功指针回执后才显示；导航、几何或 reset 清除资格，隐藏不解除输入保护。enabled 只表示已启用，实际画面不由该值确认。已修复输入与导航并发时的取消等待，当前证据和首批完整回执后显示的限制见[实施记录](./cursor-first-position-and-handoff-implementation-2026-11-06.md)。

## 读取页面

- `browser_get(what: "agent_snapshot")` 返回 DOM/无障碍信息、当前表单状态、frame 覆盖状态和截断原因。
- `browser_get(what: "agent_find", agentQuery: {...})` 可按 role、name、text、label、disabled、checked、selected 或 CSS selector 筛选。
- 快照覆盖主文档、同源 iframe、跨域 OOPIF、开放和封闭 Shadow DOM。查看结果时先检查 `complete`、`frames` 和 `truncationReasons`；不完整快照里没找到元素不能证明元素不存在。
- 密码和文件输入值默认会被隐藏。每个 `target` 只对生成它时的文档有效；导航或节点变化后重新取快照。
- 原生 `agent_snapshot` / `agent_find` 的每个元素增加宿主管理的短 `ref`，普通点击、悬停、输入可直接用 `windowId + ref`。引用绑定页面、文档与控制代次；旧 `snapshot` 的页面索引引用继续支持。
- `browser_get(what: "capabilities")` 返回实际运行时 API 探测结果。旧 `snapshot`、`text` 和 `dom_summary` 仍保留。

## 执行交互

将快照元素的 `target` 传给 `browser_click`、`browser_mouse`、`browser_type` 或 `browser_press`，即可对 iframe/Shadow DOM 中的目标发送可信事件，也可操作未显示或未聚焦的浏览器窗口，而不激活系统前台窗口。鼠标按下/移动/滚轮坐标是相对目标元素的 CSS 像素偏移；按下和释放必须复用同一 target。派发结果为 `dispatched` 只表示事件已送入原生输入通道；随后应重新读取页面状态确认操作效果。

触摸序列使用 `browser_touch`：传入同一元素 target、`touchStart`/`touchMove`/`touchEnd`/`touchCancel` 和触摸点。点坐标是相对目标元素的 CSS 像素偏移；`touchEnd` 与 `touchCancel` 使用空点列表。

`browser_query_deep` 保留原有的几何结果；增加 `agentInfo: true` 且 `acrossDocuments: true` 时，返回带覆盖信息的原生 AgentSnapshot。

## 带时间的光标移动

`capabilities.inputSequence` / `pointerTrajectory` 表示支持原生定时输入。`browser_mouse` 的 `move`、`click`、`drag` 使用共享轨迹生成器，整段轨迹只调用一次 `dispatchInputSequence`；坐标点击和拖动的按下/释放在同一批内闭合，不能跨调用保持按住。

```json
{
  "windowId": "实际窗口 ID",
  "action": "drag",
  "from": { "x": 90, "y": 240 },
  "x": 260,
  "y": 290,
  "motion": { "durationMs": 600, "speedMultiplier": 1.05, "intervalMs": 7.5, "seed": "move-1" }
}
```

- 不传 `target` 时，`from/x/y` 都为顶层视口 CSS 坐标；传入 `target` 时，所有点都为相对同一目标元素的 CSS 偏移，支持 iframe 目标。不能混用两个坐标系。
- 同一 WebContents 串行执行完整操作（定位、接近、提交、必要结果核对）；Flow 子调用复用作用域。移动／点击只复用已确认的主视口位置；起点未知时先用单个原生事件建立终点，不假定从 `(0,0)` 开始。`from` 用于明确拖动起点，不能证明当前虚拟指针已在那里；目标局部点不建立主视口位置。导航、控制权变化、未保护间隙、外部输入、失败或取消清除位置缓存。出队后和真正派发前重验操作代次，不让旧队列进入新文档。
- `motion.speedMultiplier` 大于 `1` 加速、小于 `1` 减速；`intervalMs` 控制事件采样间隔，与 `sampleRateHz` 二选一。`motion.holdMs` 只用于显式坐标点击的按下/释放停留时间。详细参数见 [轨迹生成器](pointer-trajectory.md)。
- 普通 selector/ref 的 `browser_click` 默认先平滑移动，再调用原生目标中心点击，保留遮挡、失效引用和缩放检查；`browser_hover` 支持 ref、target 和 selector。主文档原生 target 的接近使用 CSS box-model 几何，不把带设备缩放的快照 `bounds` 当作输入坐标。主文档点击及悬停结束后，以隔离世界实际可信鼠标事件核对落点，只有操作／文档／几何代次均匹配且完整回执成功时才恢复起点；不能用预测中心或 target offset 代替确认。回执读取有 250ms 截止并响应取消，迟到结果不更新缓存。`motionApplied` 区分单点定位与实际多点、非零用时的移动，回执保留起点、规划步数、用时及已确认累计移动量；关闭平滑覆盖拖动前接近段，闭环轨迹也按实际移动计量。
- iframe 原生 target 没有可靠的顶层 CSS 几何时，默认保留原生中心事件并返回 `motionApplied: false`，不猜测偏移。需要 iframe 轨迹时使用 `browser_mouse` 加新 target 和元素局部 `from/x/y`。旧 `iframeSelector` 保持兼容，使用可取消的闭合序列。普通中心点击不支持 `holdMs`，应改用显式坐标点击。
- 运动参数省略时继承用户设置；对象覆盖单次运动字段；`motion: false` 关闭曲线插值，坐标操作仍用一个原生批次闭合按下/释放，不拆分拖动。
- `down/up/wheel` 保留 target 参数，不接受轨迹参数。遗留按下、触摸开始会登记专属释放，在完整动作结束或取消时清理，不把持有状态带入下一次工具调用；持续鼠标拖动使用一次 `drag`。远程查看的 down/move/up 属于同一受管手势，断开时释放。
- 返回计划步数、持续时间、原生派发数、停止位置、迟到统计和清理结果。原生中心点击采用独立接口，因此其 `dispatchedCount` 为 `null`，移动数量在 `movementDispatchedCount`，点击结果在 `clickDispatch`；不要把移动计数当作整个点击的派发计数。
- 取消或部分失败不走备用路径、不自动重放；`browser_flow` 也会立即停止并保留失败汇总。已经派发的输入不可回滚，应读取页面结果后再决定后续动作。
- `automationOptions`、`automationState`、`automationReset` 和光标相关能力来自实际方法探测。逐页状态从 `getAutomationState` 回读 `isolateInput`、`inputProtected`、`keepRendering`、光标开关及 `rendering`；配置、视图可用、保活需求和实际新帧分别核对。`nativeConfirmed` 不表示肉眼已看见光标。

## 设置与控制权

“设置 → 浏览器 → AI 自动化”提供显示虚拟光标、平滑移动、操作反馈、移动速度、自然/精确风格、采样间隔、刷新率、光标样式与大小。后台独立操作在 Agent 控制页面期间始终开启。默认速度 `0.6`、采样间隔 `1000/120` 毫秒、绘制上限 `60 fps`。采样与绘制分别生效，不把 60 fps 解释成只发送 60 个输入点。

配置由共享策略校验，设置页和 Agent 按变更叶子更新，策略合并后校验点数、时长和互斥采样参数。在途轨迹不因速度修改而被改写；原生模式热更新带版本，旧回调不能覆盖最后一次设置。Agent 租约期间统一启用 `isolateInput`、`blockRealPointer`、`blockRealKeyboard`、`keepRendering`；历史 `protect_input:false` 不会关闭这四项。隐藏光标直接设置 `virtualCursor.enabled:false`，不再依赖透明图片；隐藏图形不解除隔离、保护或后台保活。

地址栏右端的 Agent 图标控制当前显示页面：左键在允许 AI 和人工操作之间切换，暂停状态下左键允许新的 AI 操作；右键、Shift+F10、菜单键、向下键或触控长按打开同一个详情面板。打开面板不改变控制权。面板显示当前页面、动作、实际光标与输入保护状态，提供暂停、恢复、故障处理及“自动化设置”入口。交还中保留详情入口并防止重复提交。

控制器先关闭新写入、作废旧权限/队列意图，再取消可取消输入、结算已提交工作、核对清理并确认解除保护。恢复后要求重新观察，只允许新操作，不重新启动已经结束的聊天。暂停期间 `browser_get` 等只读操作可用，但不会恢复写入门闸；同轮尚未执行的旧调用也不会因恢复而复活。

Agent 任务首次获得某页操作权后，以 runId 持有该页租约，模型思考、工具间等待和权限确认期间保留原生输入保护；其它未持有页面不受影响。任务 finally 仅释放匹配 runId 的租约，旧任务不能释放新任务；无 runId 的兼容短调用仍只持有动作范围。真实鼠标移动/进入/离开不会触发接管，受保护期间的真实点击、滚轮与键盘由定制内核参数拦截，人工操作须使用宿主按钮显式交还。布局/缩放变化、页面转移和导航使旧坐标失效并要求新观察。工具栏固定 44px，网页外框预留 2px；已移除下方状态行与独立文字接管按钮，状态变化及下载入口显隐不改变原生网页矩形。批注为图标按钮，有内容时以小点提示。浏览器截图不绘制原生虚拟光标。

无法确认按钮释放或解除保护时，图标显示告警，面板保留恢复说明，不重放输入，也不自动刷新或关闭页面。完整交还使用 `resetAutomationOptions` 取消本通道任务、清理持有状态并释放长期配置，再核对实际状态；正常任务结束先结算已提交工作。清理或重置失败继续显示未确认，不能只因光标消失就宣布交还成功。解除保护未确认可重试解除；需要重新加载时仍由用户主动选择并保留未保存内容提示。

Agent 与新批注使用当前网页的实际身份，不随标签多选或后台右键目标改变。下载汇总该网页所属对话；无记录时隐藏图标，活动下载以字节加权圆环显示，未知大小使用不定长环，完成记录保留到主动清除。更多菜单始终能打开同一下载列表。缺少对话身份的局部入口不会退回全局列表。

Agent、下载、更多、地址建议、连接信息和标签菜单互斥，并使用原生 View 避让机制；截图挂起不阻塞面板。地址草稿与选区保留，批注选择期间 Agent 入口仍可用；页面失活时关闭所属弹层，复制或关闭恢复的新页面不继承旧控制状态。

标准工具、别名、Flow、iframe、插件 `runTool`、显式 Registry 写方法和远程输入经过控制检查。受信任旧插件直接持有原始 `WebContents` / `Session` 的接口保留兼容，不属于强制隔离边界。已有页面作用域内不得再扩展到新页面，防止跨页嵌套死锁；多页操作应由独立的外层工具调用统一申请。

完整设计与验收要求见 [自动化控制规划](已完成/browser-automation-control-plan.md)及[地址栏精简交付记录](已完成/browser-toolbar-compact-plan.md#交付记录2026-11-03)。

## 验证

`npm run test:browser:pointer` 执行本地页面的隐藏窗口实测。可用 `NAVORA_POINTER_ELECTRON` 指定已安装的 `.4` 可执行文件，直接运行 `node scripts/pointer-smoke.mjs` 验证独立运行时；脚本会检查其包版本。不会关闭正在运行的 Navora，也不打开可见测试窗口。

Windows `.4` 实测覆盖可信移动与小数终点、速度与采样间隔、同批坐标点击/拖动、实际 DOM 状态、主文档与 iframe 的元素相对坐标、125% 缩放、默认点击/悬停、遮挡和失效目标、流程不重试、取消及按钮清理。普通隐藏窗口中 `setPointerCapture` 请求未稳定转为实际捕获，旧单事件、序列及启用虚拟光标三种方式均能复现；测试验证文档级拖动处理，不将指针捕获宣称为通过。

`npm run test:ui:browser:automation` 构建前端并运行隔离界面验收；可用 `NAVORA_UI_ELECTRON` 指定 `.4` 可执行文件。2026-11-03 运行 53 项通过，覆盖设置、图标交互、地址草稿、模拟长按、批注选择、原生接管/恢复、截图挂起、下载状态和晚快照、标签生命周期、窄独立窗口、175% 系统缩放、125% 网页缩放及明暗主题。浏览器原生检查 36 项、轨迹检查 20 项通过；后续 `0.3.34` 打包已修复 3 项既有测试阻断，最新完整源码测试 321/321 通过。截图与报告位于 `release/ui-browser-automation`；WebContentsView 截图与宿主截图分开保留，合成浏览器预览不代表原生虚拟光标已通过截图视觉验证。

## 2026-11-03 控制权与会话重构验证

- 控制器、工具协调、配置、三款光标和会话/筛选纯逻辑合计 68 项针对性单元检查通过。
- `node scripts/browser-ownership-smoke.mjs` 在真实定制 Electron 的独立隐藏页通过 13 项检查：可信原生点击与 iframe、工具间保护保持、透明图像仍设置双阻断、五档 NativeImage 表示/逻辑热点、旧 run 隔离与显式交还。报告与实际图像导出位于 `release/browser-ownership/`。
- `node scripts/browser-session-smoke.mjs` 通过 14 项原生会话检查，实测 Cookie/localStorage 保留与清除、持久元数据恢复、取消关闭、并发锁、清理失败和持久化失败回滚。
- 浏览器资源正式 UI 在正常/减少动态模式各通过 18 项检查，截图和结果在 `release/ui-browser-tree/`。
- 本轮更新后的自动化正式 UI 通过 59 项检查，保留原有控制/故障/下载/独立窗口/全主题覆盖，并新增整轮租约、hover、隐藏光标保持保护、样式热应用、旧 run 与任务完成释放；结果在 `release/ui-browser-automation/completed.json`，`03-task-cursor-hidden.png` 展示真实网页与“图形已隐藏，输入保护中”详情面板。
- 上述隐藏页验证未覆盖物理 OS 点击/滚轮/拖动/键盘过滤、原生合成层上的肉眼可见性及不同设备 DPI。API 成功、可信 Agent 输入与 guest 截图不能替代这些前台验收。没有修改正在运行的安装版或用户会话。

## 限制

- `dispatched` 不表示网页已接受输入；页面可能拦截事件或保持原状态，需重新读取确认。
- 原生下拉框不会因定向点击而弹出；用键盘方向键选择并回读当前值。系统文件、颜色、日期和时间选择器不支持该输入通道；文件上传继续使用 `browser_upload`。
- 版本 `.8` 发布包只提供 Windows x64；macOS/Linux 构建不应复用这个定制运行时。完整跨 frame 光标连续性仍搁置；后台隔离不代表跨文档指针捕获或完整进入／退出事件链已通过。

上游接口与完整限制：[Electron cloudbypass .8 Agent 自动化说明](https://github.com/ChengHoward/edist/releases/download/v45.0.0-cloudbypass.8/AGENT-AUTOMATION.zh-CN.md)。上方带日期的 `.4` 验证记录保留为历史证据；本轮 `.8` 应用验证及发行边界见 [实施记录](./electron-8-automation-implementation-2026-11-05.md)。
