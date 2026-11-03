# 浏览器 Agent 自动化（Electron cloudbypass.3）

Navora 的浏览器 Agent 使用 Electron `45.0.0-cloudbypass.3` 提供的原生 DOM 快照和定向输入能力。此功能当前只随 Windows x64 定制运行时发布。

## 读取页面

- `browser_get(what: "agent_snapshot")` 返回 DOM/无障碍信息、当前表单状态、frame 覆盖状态和截断原因。
- `browser_get(what: "agent_find", agentQuery: {...})` 可按 role、name、text、label、disabled、checked、selected 或 CSS selector 筛选。
- 快照覆盖主文档、同源 iframe、跨域 OOPIF、开放和封闭 Shadow DOM。查看结果时先检查 `complete`、`frames` 和 `truncationReasons`；不完整快照里没找到元素不能证明元素不存在。
- 密码和文件输入值默认会被隐藏。每个 `target` 只对生成它时的文档有效；导航或节点变化后重新取快照。
- `browser_get(what: "capabilities")` 返回实际运行时 API 探测结果。旧 `snapshot`、`text` 和 `dom_summary` 仍保留。

## 执行交互

将快照元素的 `target` 传给 `browser_click`、`browser_mouse`、`browser_type` 或 `browser_press`，即可对 iframe/Shadow DOM 中的目标发送可信事件，也可操作未显示或未聚焦的浏览器窗口，而不激活系统前台窗口。鼠标按下/移动/滚轮坐标是相对目标元素的 CSS 像素偏移；按下和释放必须复用同一 target。派发结果为 `dispatched` 只表示事件已送入原生输入通道；随后应重新读取页面状态确认操作效果。

触摸序列使用 `browser_touch`：传入同一元素 target、`touchStart`/`touchMove`/`touchEnd`/`touchCancel` 和触摸点。点坐标是相对目标元素的 CSS 像素偏移；`touchEnd` 与 `touchCancel` 使用空点列表。

`browser_query_deep` 保留原有的几何结果；增加 `agentInfo: true` 且 `acrossDocuments: true` 时，返回带覆盖信息的原生 AgentSnapshot。

## 限制

- `dispatched` 不表示网页已接受输入；页面可能拦截事件或保持原状态，需重新读取确认。
- 原生下拉框不会因定向点击而弹出；用键盘方向键选择并回读当前值。系统文件、颜色、日期和时间选择器不支持该输入通道；文件上传继续使用 `browser_upload`。
- 版本 `.3` 发布包只提供 Windows x64；Linux 未验证，macOS/Linux 构建不应复用这个定制运行时。

上游接口与完整限制：[Electron cloudbypass Agent 自动化说明](https://github.com/ChengHoward/edist/blob/main/AGENT.zh-CN.md)。
