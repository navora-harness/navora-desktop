# 浏览器输入控制权与专属虚拟光标规划（2026-11）

> 状态：**核心控制权与原生光标已实施**（2026-11-03）。以下保留原始问题与验收约定；最新实施证据见第 9 节。隔离窗口验证不等于真实系统输入与肉眼呈现验收。
> 用户反馈：真实鼠标进入网页后自动化可能中断，且未看到虚拟光标；本轮安装版记录只证明控制权错误，不能独立证明 mouseMove 是触发原因。
> 关联：[自动化现状](./browser-agent-automation.md)、[原控制规划](./browser-automation-control-plan.md)、[设置与控件规划](./settings-immediate-save-plan-2026-11.md)。

## 1. 目标与边界

- 用户允许 AI 操作某页后，本轮任务在该页持有输入租约；工具间思考、等待和结果核对不反复交还。
- 真实鼠标移动、进入、离开网页不自动切换控制权，不打断 AI，不使旧观察无故失效。
- 已启用保护的 AI 所有页面，真实点击、滚轮、拖动及键盘输入不得送进网页；用户从宿主按钮显式切换人工操作。
- 保护仅作用于当前 run 明确拥有的页面 WebContents；其它网页、地址栏、标签、聊天、设置及系统桌面照常使用。
- 暂停、停止、失败和退出有明确交还路径；清理或原生释放未确认时不能假报人工操作已就绪。
- 光标显示、轨迹平滑、输入保护为三个独立偏好；隐藏 AI 光标不应取消网页输入保护。

## 2. 源码已确认的问题链

- 主检查已只读核对安装版最新对话：browser_navigate 多次返回 browser_manual_control，另有 browser_operation_invalidated，新建窗口也受 manual 状态拦截。
- 安装配置已开启 show_virtual_cursor、protect_input、show_control_feedback、smooth_pointer，cursor_fps=60；不能归因为用户未开启光标。
- 这些记录没有底层事件 type，不保存用户对话正文，也不把助手的解释当成原生事件证据。
- 安装主包为 0.3.35，同样存在 enabled&&protect、每动作 finally 放开保护及未读取 event.type 的 intervention；未发现 setVirtualCursorImage 调用。
- 安装版核对摘要见[主包观察](../../_planning/project-checks/installed-package-observation.json)与[错误/设置观察](../../_planning/project-checks/installed-chat-observation.json)，仅保留枚举和配置摘要。
- `electron/modules/browser-automation-controller.ts:124` 的 `intervention` 不读取事件类型，mouse/input 共用回调。
- 当 owner=ai、没有 active、inputProtected=false 且 activity=idle/waiting 时，任意 before-mouse-event 会请求 pause。
- `:336` 每个完整工具动作 finally 执行 `syncNative(show_virtual_cursor,false)`，在工具间留下未保护间隙。
- 因此“工具间放开保护 + 没有区分鼠标事件”的组合可以解释反馈，仍需对照安装版事件和运行记录确认触发时序。
- `:315` 单动作开始时确认原生保护，动作内 waiting 保持保护；缺口主要在动作与任务生命周期之间。
- `:221`、`:223` 阻断值为 enabled&&protect；关闭 show_virtual_cursor 会同时使 inputProtected=false。
- `:487` 设置热应用重新同步时也传 protect=false，须跟随新租约语义修正，不能只改 finally 一处。
- `:391` 已有 finishRun；`agent-runtime.ts:1321` 在任务 finally 遍历网页调用，提供接入基础但尚无 runId 租约归属校验。
- `:365` handoff 已实现门闸、旧代次失效、drain、清理、原生释放确认；应保留并扩展，不绕过现有安全顺序。

## 3. 定制 Electron API 核对

- 本地依赖锁定 `45.0.0-cloudbypass.4`；运行中二进制能力须现场探测，不能仅看 process.versions 的上游版本号。
- `node_modules/electron/electron.d.ts:29192`：VirtualCursorOptions 有可选 blockRealPointer、blockRealKeyboard。
- `:29231`：`setVirtualCursorEnabled(enabled, options)` 返回 Promise<void>，必须 await 原生确认。
- 每次明确传入两个 block flags；现有宿主注释说明省略可能保留旧模式，不依赖隐含默认值解除保护。
- `:29196`：VirtualCursorImageOptions 只有 hotspot?:Point；没有声明独立 visibility/opacity 参数。
- `:29232`：`setVirtualCursorImage(image:NativeImage|null,options?)` 返回 void，不能当作异步呈现确认。
- `:29233`：`setVirtualCursorFrameRate(fps)` 为绘制频率接口，与输入采样间隔不同。
- 当前 CursorApi 仅包含 enable/fps，生产没有调用 setVirtualCursorImage，尚未接入专属图形和热点。
- `browser-capabilities.ts:14` 只探测 enable 方法；不能据此证明自定义图像、阻断选项与实际画面都已支持。
- 后续增加分项能力与失败状态：enable、customImage、frameRate、原生阻断实测；无证据项显示未知。
- 项目文档说明 `.4` 的保护依赖原生启用；隐藏图形时仍需保留原生 enabled，不能用 enabled=false 达到“仅隐藏”。
- 透明 NativeImage 能否保持阻断且完全隐藏须隔离实测；不支持时需定制内核增加独立渲染开关，明确列为前置能力。
- image=null 不作为“隐藏”承诺，其恢复/重置语义也需按内核实现或实测确认。
- [上游 Agent 文档](https://github.com/ChengHoward/edist/blob/main/AGENT.zh-CN.md) 当前仍标注 `.3`，不足以证明 `.4` 的光标选项；本规划以本地声明和待执行原生验证区分证据。

## 4. 页面级任务租约（待实施）

- 引入 `{runId,pageId,leaseId,generation}`，记录租约持有人、当前阶段、原生确认和清理状态。
- 在 run 获得该页操作权限、首次派发前确认租约；任务仅做其它事情时，不提前锁住所有浏览器页面。
- 同一 run 后续工具复用租约，包含模型思考、工具排队、站点加载及权限等待；waiting 不再代表人工可输入。
- 新页需显式授予归属；不能因同对话里存在某页就全部锁住，也不能从页面内嵌调用悄悄扩展到其它页。
- 单动作 finally 仍闭合按键/按钮/触摸与在途 native commits，但成功后保留租约的原生阻断，不交还真实输入。
- 正常任务结束统一 releaseLease(runId)；旧 run 的 finally 不得释放新 run 或其它子任务持有的页面。
- 多任务竞争同页沿用串行授权，不允许两个 run 同时拥有写权限；多页租约按明确顺序获取避免死锁。
- 临时权限弹窗只在宿主操作，guest 保持保护；明确要求用户在网页里登录/输入时，先走人工交还，再等待显式恢复。
- 普通页面导航保留同页租约但提升 documentEpoch，作废引用/坐标；页面关闭/销毁结束该页租约。
- 转移窗口、缩放和布局变化沿用 drain/几何失效；宿主变化后确认原生状态和显示矩形，不恢复旧坐标。
- 标签后台化不把 AI 页面交给人工；未被租约拥有的其它标签始终可以使用。

## 5. 事件、保护与交还规则（待实施）

- before-mouse-event 显式忽略 mouseMove/mouseEnter/mouseLeave 等纯位置事件，具体类型以运行时事件载荷为准。
- 租约有效且保护已确认时，真实 down/up/wheel/drag/key 不作为接管意图；由 native flags 拦截到达网页之前。
- 不用一层透明 DOM 罩住 guest 来替代原生保护；必须覆盖独立窗口、iframe/OOPIF 与非焦点输入路径。
- 若本机启用的内核不支持保护，显示“当前页面输入保护不可用”，不能只改 state.inputProtected=true。
- 为满足本轮需求，保护默认开启；用户主动关闭时明确网页可受真实输入影响，仍不把 hover 当作自动接管。
- “我来操作/暂停本页”入口位于宿主工具栏，不依赖已被阻断的 guest 键盘/鼠标事件。
- 顺序保持：关闭新写入 → 失效旧代次 → 取消可取消动作 → 等待已提交原生工作 → 释放按住输入 → 解除原生保护并确认。
- 交还成功后才显示 owner=user；解除失败显示 release_unconfirmed，并保留宿主重试、暂停任务和必要恢复入口。
- 终止、模型失败、工具不可恢复失败、窗口关闭、任务取消均进入租约结算；可恢复查询失败不必假装整个任务结束。
- AI 程序异常时由宿主监管器处理失联 run 的租约；超时不能在不可取消动作仍执行时直接放开输入。
- 恢复 AI 产生新代次并重新观察，不自动重放旧点击、旧队列或已结束的对话任务。
- 原生释放无法确认时，保留用户从页面外采取恢复操作的能力；`.4` 的渲染无响应交还保证仍是已知限制。

## 6. 虚拟光标不显示的诊断（待实施）

- 先记录实际安装运行时、pageId/WebContentsId、租约、show_virtual_cursor/protect_input、nativePending/nativeConfirmed。
- 分别检查 enabled 请求是否成功、原生当前坐标是否更新、页面是否可见、WebContentsView 宿主/裁剪区域是否正确。
- 检查 60fps/自定义 fps、主题对比度、网页缩放与系统 DPI；“有 API”或“Promise 成功”不能等同肉眼可见。
- 工具间保护释放不是“不显示”的唯一根因：现有 finally 仍可能 enabled=true，需分别排查绘制层和生命周期。
- 当前面板把 cursorEnabled 显示为“已显示”；改为“原生已启用”，另列实际可见验证结果或未知。
- 在实际可见宿主中运行一次可控短移动，用户可看到位置与点击反馈；隐藏窗口/DOM 跟随指针不能替代。
- 已有文档说明 browser screenshot 不绘制原生光标；guest capturePage 缺图不证明光标没出现，需宿主/系统合成捕获确认。
- 隐藏网页不把虚拟光标画到其它页面；切回时按当前 native 坐标恢复，不从鼠标真实位置借坐标。

## 7. 三款专属样式与资源规范（待实施）

- **领航箭头**：默认通用操作，32×32 逻辑画布，热点 (4,3)，箭头尖端正对目标；蓝色主体、白色内边和深色外描边。
- **环形瞄点**：24×24 逻辑画布，热点 (12,12)，中心实点与分段圆环；强调当前位置，适合浏览、点击与演示。
- **精密十字**：28×28 逻辑画布，热点 (14,14)，中空十字及中心点，适合小目标和区域选择；不遮挡目标中心。
- SVG 为源码资产，导出带 alpha 的 1×/1.25×/1.5×/2×/3× NativeImage representations；传 API 的 NativeImage 不等于直接传 SVG 字符串。
- 热点先按逻辑像素设计；定制 API 的 hotspot 是否按 DIP/位图像素解释需原生测试，不能随图片倍数重复放大。
- 光标尺寸与系统 DPI 联动，与网页 zoom 分开；以目标中心与箭头尖端/中心点对齐检查点击误差。
- 浅底/深底都有双色描边，禁用色只解释状态；光标不因网站 CSS cursor、pointer-lock 或主题变成不可辨认图形。
- 点击显示 160–220ms 单次收缩/扩散反馈，拖动增加实心中心，不用持续脉冲；减少动态效果改为短暂静态高亮。
- 等待态保留静止光标与工具栏文字，不用持续移动装作有工作；错误交还后不留假的“AI 正在操作”光标。
- 可见光标与原生输入的精确点相同；轨迹和点击反馈不得伪造已完成操作。
- [离线交互示例](../../_planning/navora-cursor-style-example.html) 可切换三款、明暗背景、播放示例与人工接管，明确为 DOM 样式演示。

## 8. 实施批次与验收（待实施）

1. **P0 控制权修复**：先在隔离页补事件 type/阶段证据，随即接入 run/page 租约、调整 finally/热应用/finishRun、过滤纯位置事件，保留清理与交还顺序；不等光标换肤才修复中断。
2. **P1 原生光标**：分项能力探测、自定义图形/热点、多 DPI、可见宿主验证；显示与保护解耦的内核能力单独验收。
3. **P2 整合**：独立窗口、菜单、标签切换、远程查看、批注临时人工、停止/失败及新任务隔离，更新旧文档与测试预期；不采集输入正文或秘密。

- 单元回归增加 move/enter/leave 不 pause；工具间 waiting 不释放租约；旧 run 完成不释放新租约；不影响未拥有页面。
- 现有控制器测试首项明确期待每动作后 protect=false，须更新为新需求；不能把保留旧行为的通过结果当作新方案验收。
- 原生验证通过真实系统输入检查 click/wheel/drag/key 被阻断，同时 AI 输入可信并可完成；测试范围覆盖 iframe、宿主缩放与转移。
- 确认 toolbar 接管可用，按下未释放、不可取消输入、停止/失败、native释放失败均有准确状态且不会自动重放。
- 原生画面分别验证三款、热点、多 DPI、明暗与点击反馈；单独记录截屏方式，HTML 演示通过不算原生通过。
- 本轮交付仅文档和示例；没有启动原生验证、改变输入保护策略或修改用户运行实例。

## 9. 本轮实施与验证记录

- `ToolExecContext.browserRunId` 与运行时两处工具派发、任务 finally 已连接。授权目标页首次写入获得 run 租约；新建页面通过 `claimRun` 接入，未持有页面不被锁定。
- 工具完成后保留该租约的原生 pointer/keyboard 阻断；结束时 `finishRun(runId)` 仅释放同一 run。短调用无 runId 时仍采用动作范围，旧 run、读操作和其它页不能解除当前任务保护。
- 纯鼠标位置/进入/离开事件不触发暂停；显式接管仍按失效、drain、清理、原生释放确认顺序执行，失败不假报人工就绪。
- `show_virtual_cursor` 与 `protect_input` 已解耦：隐藏图形使用非空透明 NativeImage，并明确传入 `blockRealPointer`、`blockRealKeyboard`；缺少图像接口时拒绝受保护的隐藏模式，不静默放开输入。
- 三款样式 `navora-arrow`、`focus-ring`、`precision-cross` 已接 `setVirtualCursorImage`，提供 1/1.25/1.5/2/3 倍表示，热点保持逻辑像素；设置中的 `cursor_style` 通过共享配置校验与热应用。
- 能力返回增加自定义图像/帧率分项，物理输入阻断能力明确为 available-unverified；`cursorEnabled` 表示原生启用，`cursorVisible` 是已请求的图形状态，不宣称肉眼已验证。
- 控制器、协调器、配置、光标与资源/会话纯逻辑共 68 项针对性单元检查通过。
- `node scripts/browser-ownership-smoke.mjs`：真实定制 Electron 的隐藏隔离窗口完成 13 项检查，包括双阻断请求、可信原生点击、iframe、工具间保持、透明图像、五档倍率与旧任务隔离。结果在 `release/browser-ownership/browser-ownership-native.json`；同目录保留三款实际 NativeImage 导出的 PNG/SVG。
- 更新后的正式自动化 UI 另完成 59 项检查，覆盖设置分组草稿、整轮保持、hover、隐藏图形、样式热应用、旧 run、任务结束释放，以及原生交还/恢复、故障、下载、标签、独立窗口、缩放和项目主题。报告 `release/ui-browser-automation/completed.json`。
- 这些验证没有操作用户安装版或当前页面。物理 OS 点击/滚轮/拖动/键盘、系统合成层上的光标可见性及跨设备 DPI，仍需前台原生验收；不以 DOM 模拟、guest 截图或 API 成功替代该证据。

## 10. 新增光标选择界面规划（尚未实施）

用户要求浏览器设置中的样式选择与外观主题选择形式一致。保留现有三款真实原生样式、枚举与自动保存，改用含图形预览、名称、用途和已选状态的卡片；提取纯共享几何供卡片与原生图像共同使用，避免预览与实际光标两套图案。关闭图形时可预选，明确“开启后使用”，不自动改变显示开关或输入保护。详细交互、键盘选择和失败回滚见[光标卡片与设置导航规划](./settings-navigation-and-cursor-plan-2026-11.md)。
