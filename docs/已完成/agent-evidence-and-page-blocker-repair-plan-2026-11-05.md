# Agent 历史执行事实与网页阻断修复实施规划

> 2026-11-05 再次核对：**已完成并归档，已纳入 0.4.10**。原规划核心范围已完成；保留合成环境、物理设备与其它平台等原验证边界。 当前依据见[实施与验证](../confirmed-plans-implementation-2026-11-05.md)；下文旧状态保留其历史日期。

> 2026-11-05 最新实施更新：历史执行证据与网页阻断交接已接入，版本化回执、恢复进度与实际页面专项见[本轮实施与验收](../confirmed-plans-implementation-2026-11-05.md)。下文规划和审计基线保留追溯，不再代表当前源码尚未实施。

日期：2026-11-05。状态：**详细规划，尚未实施、尚未打包**。

本文承接[只读诊断](./agent-history-and-page-blocker-diagnosis-2026-11-05.md)，只规划以下两项：后续追问不能丢掉已执行的事实；网页已出现验证或其他前台阻断时，Agent 能说明情况并交给用户。没有重新读取个人聊天、配置或密钥，没有访问真实验证网站，也没有重放用户操作。

## 1. 用户会看到什么变化

1. 用户问“刚才到底操作了吗”，Agent 应能回答：“上轮确实派发了操作，其中几项已回读确认，后来遇到页面失效；本次追问没有新操作。”不能因为这一轮没有调用工具，就否定上一轮的真实回执。
2. 页面出现必须本人完成的验证时，Agent 提示“页面需要你验证，我已暂停这个页面，完成后可以继续”，保留当前网页和原任务。不能一边读取底层商品 DOM，一边当作验证不存在。
3. 只发现可疑验证组件、还不确定是否遮挡时，先进行一次有限的只读核实；不能看见验证服务域名就报“已被验证码拦截”。检查失败则说明“暂时无法确认页面能否继续操作”。
4. 用户完成验证后，先看现在的页面，再继续原任务剩余部分。已经点击、输入、提交或下载的步骤，不能整段重来。

修复不包含解题、自动通过验证码、模拟人工验证或绕过站点限制。

## 2. 已核对的代码边界

- `electron/modules/agent-runtime.ts` 的运行上下文已有 `id`、`turnId`、`sequence`；消息经 `appendRunMessage()` 写入 `runId` / `turnId` / `runSequence`。可以在现有持久化消息上增加明确作用域的摘要，无需另造一套聊天数据库。
- 该文件的快速问答路径只读取最近 user / assistant 文本；`buildMessages()` 的完整路径读取 user / assistant / log，均没有把工具回执作为可定位的历史执行事实恢复。因此仅把“为什么”强制切到 Agent 模式不足以解决。
- 每个运行新建 `AgentProgressPolicy`；请求中 `[宿主执行事实]` 目前未携带 run / turn 作用域。`agent_run_end` 已保存 `policy`、`completionEvidence`、`stopReason` 和 `settlement`，是新协议的优先接入点。
- `shared/agent-progress-policy.ts` 的 `observations` 只覆盖固定观察工具；不包括 `browser_evaluate`。`keyboard.effectsIndependentlyConfirmed` 当前恒为 `false`。目标明确的字段回读不能证明此前 Tab 切换了焦点或 Ctrl+A 改变了选区。
- 同一策略的 `actionsReportedDispatched` 基于需观察工具成功的计数，里面可能包括 `browser_evaluate`；这个旧指标不能迁移成“物理输入次数”或“业务完成次数”。
- `browser-tools.ts` 的原生快照默认 `maxNodes=300`，提供 `complete`、`truncated`、`frames` 及原因；目前没有稳定的页面阻断摘要。`browser_evaluate.ok=true` 仅说明脚本执行并返回结果。
- 当前 Electron 类型实际提供 `AgentTarget` 的文档身份、`AgentElement.visible/bounds`、`AgentFrameCoverage.status/reason/documentId`，没有统一的无遮挡结论或现成 `pageBlocker` 接口。下文所有新增协议均为**应用层拟议协议**，不是声称内核已有这些能力。
- `shared/page-digest.ts` 正文压缩优先元素，其他 frame 用剩余预算；极端回退可输出空 frame 清单。新增阻断元数据需要独立预算和保底序列化。
- `shared/agent-prompt.ts` 已要求登录／站点验证时说明并保留现场。此次必须增加宿主事实恢复、检测和暂停接入，不能只增加提示词就宣布完成。
- `browser-automation-controller.ts`、`browser-tool-coordination.ts` 已有控制 epoch、document epoch、输入租约、暂停／接管／恢复和旧意图失效机制，应复用并扩展。`BrowserTabPanel.vue` 已显示控制权和恢复状态。

## 3. 第一项：让历史执行事实跟随任务

### 3.1 最小共享协议

拟新增 `shared/agent-execution-evidence.ts`，声明版本化的 `RunEvidenceSummaryV1` 与纯函数校验、降级和压缩规则。先保存事实，不保存原始页面文本或新的模型自述。

- 身份：`version=1`、`chatId`、`runId`、`turnId`、`startedAt`、`updatedAt`、`state`；`state` 区分 `running / ended / interrupted / legacy_incomplete`。
- 作用域：固定 `scope=current_run`；历史封装另用 `scope=historical_runs` 和所含 runId 列表，不能把多个运行不加说明地合成“本轮”。
- 计数：`toolsStarted/toolsSettled/toolsFailed`、`inputsDispatched`、`fieldValuesVerified`、`pageEffectsObserved`、`businessResultsVerified`、`unresolvedInputs`。不支持的指标用 `unknown`，不能填 0。
- 结果列表：有限个 `evidenceId`、`messageId`、`toolCallId`、`toolName`、`state`、标准化 `errorCode`、时间和所在页面身份。状态区分 `dispatched / value_verified / page_effect_observed / business_verified / failed / unresolved`，不能用一个 `ok` 包办。
- 完结事实：`stopReason`、`settlement` 的白名单摘要、`hasUnresolvedSideEffects`、`retainedPageCount`；明确已结束、被用户停止、等待本人验证、结果未核实。停止不反向抹去此前动作。
- 来源：`source=native_receipt / host_readback / tool_result / legacy_run_end / legacy_receipt`；区分宿主已核验字段与网页提供的不可信文字。摘要不能由 assistant 文本推导，也不采纳工具结果中的“忽略指令”等自然语言为宿主规则。

正文中只向模型传递必要记录的引用和受限事实。底层完整回执保留在原消息内，需要展开证据时按 ID 读取，不把聊天全部原样塞入系统消息。

### 3.2 何时写入、何时恢复

1. `runTool()` 在获得最终、未作模型压缩的工具回执后，生成标准化 evidence 片段。running 卡片不能当作完成；中止后不清掉已经派发但结果未知的片段。
2. `AgentProgressPolicy.recordTool()` 接收同一规范化片段，计数和结束摘要共用口径；保持现有输入不确定性和禁止重放机制。不能因历史恢复给当前策略注入旧的输入租约。
3. 每次模型请求前，使用一个共同的历史上下文构造器：快速问答、完整 Agent、总结轮、继续运行都接入。当前运行事实与历史事实分开注入，分别标记身份。
4. 每次已结算的工具回执更新持久化的摘要片段；`agent_run_end` 再写最终摘要。使用现有 ChatStore 消息持久化与原子保存习惯，不另增高频全量历史复制。
5. 重启发现有工具片段但没有 run_end，标为 `interrupted`；只记录最后已知事实、未结算步骤和停止状态，不能补造结束原因或自动恢复操作。
6. 用户插入新指令时保留 `runId`，但记清该片段对应的 `turnId/messageId`；问卷继续、人工恢复形成的新 run 用 `resumesRunId/resumesTurnId` 明确链接。相同回执按 `runId + toolCallId + phase` 去重，不能重复计数。

拟新增 `electron/modules/agent-evidence-history.ts` 负责从 ChatStore 读取和构造；`agent-runtime.ts` 只负责接线。`shared/types.ts` 中现有消息 meta 可加可选版本字段，旧消息保持可读。

### 3.3 历史取舍与长度预算

历史以“任务轮”为单位选择，不能先截最近 30 条再寻找证据；一个任务轮的目标、摘要、结束／阻断事实必须一起保留。

第一版建议的可调预算：历史执行事实最多 4,000 个模型 token（字符预算按中文保守换算），当前运行最多 1,500 token；最多详细保留 3 个相关运行，每运行 8 个代表证据。协议大小上限、超限标志和实际预算都可观测。小上下文模型按可用上下文缩减细节；不能无边界扩张请求。

优先级依次为：用户明确引用的任务轮；最近相关任务轮；仍有未决输入或本人验证的任务；其他历史。没有可靠语义匹配时至少保留最近一个有工具事实的完整轮摘要，并说明指代可能有歧义。auto/chat 跟随同样规则；解释历史不必打开工具权限。

压缩顺序固定为：先删冗余证据条目，再压缩较旧任务，再缩短非必要说明。最后仍需保留相关任务的 runId、时间、已执行非零事实、失败码、停止原因、未决状态及证据引用。原始页面内容、成功叙述和失败日志不能挤掉这些保底字段。

若最小事实包仍放不进上下文，宿主明确返回 `history_evidence_unavailable/context_budget`，或使用宿主格式化的简短事实答复；不能静默丢失后让模型猜测“未执行”。历史压缩和 provider 内容过滤重试都使用同一保底通道，不使用模型生成摘要替换这份宿主摘要。

完整历史取舍之外，再做两项区分：

- **没有记录**与**有完整记录且零次操作**不同；当前轮为零只能说明“当前运行尚无新操作”。
- **当时观察到**与**现在仍然如此**不同。旧字段值、旧页面状态不得当作当前页面事实；页面后续导航也不撤销当时执行过的事实。

### 3.4 evaluate 与键盘效果的准确口径

把“工具调用成功”“观察到某些数据”“可见页面变化”“业务成功”分成独立指标。通用 `browser_evaluate` 的成功至多记作 `script_completed`，其返回内容作为带来源的脚本结果；任意脚本可能写页面，也不能伪装成只读观察。

第一版不分析任意脚本来自动认定业务成功。需要确认输入或焦点时，增加宿主控制的只读回读助手，固定读取目标身份、当前文档、字段值是否相符、焦点／选区变化等必要字段，不接受页面自己声明“验证成功”。原值只在即时比对使用，摘要保存布尔结果和 evidenceId。

键盘独立确认从单一恒 false 改为逐事件状态，建议 `not_observed / confirmed / contradicted / unavailable`。Tab 要求同文档、同控制代次、前后焦点变化与按键事件关联；Ctrl+A 要求同目标且选区覆盖预期内容；缺前置样本或中间有另一次指定目标输入，均不能倒推按键效果。旧版恒 false 迁为“未独立记录”，不能解释成“按键无效”。

上述回读也不能证明服务端保存成功；业务成功需要针对目标的明确结果证据，缺少就保持未核实。

### 3.5 错误诊断与旧数据兼容

- 旧消息优先读 `agent_run_end.completionEvidence`；没有时才从已保存的工具回执保守重建。不同来源冲突则保留冲突标志与引用，不采用较乐观一份。
- 旧 runId/turnId 缺失时，只按连续用户消息边界形成 `legacyGroupId`，标明身份不完整；不把多轮工具统计混成一次运行。没有最终回执的 running 卡记录为未结算。
- 不就地重写所有个人聊天；按读取惰性构造，后续新运行保存新版摘要。损坏／不认识的版本保留原消息并降级为 unknown。
- `BrowserAutomationError` 拟加可选诊断详情，`browserControlFailure()` 负责白名单输出：`cause=control_changed/document_changed/geometry_changed/run_cancelled/page_destroyed/renderer_gone/native_cleanup_unconfirmed/unknown`，`stage=before_dispatch/after_dispatch/cleanup`，期望／实际 epoch、documentEpoch、是否已派发、是否需新观察。
- 原始 `browser_operation_invalidated` 没有细分原因时就写 unknown；不能猜用户接管。未知枚举由旧客户端忽略，已有 `error` 码保持兼容。
- 诊断只保存本地随机 ID、枚举、时间、计数和截断标志；不新增输入正文、验证码内容、cookie、token、IP、URL 查询参数或原始堆栈持久化。页面标题、URL 等不进入新增诊断白名单。

## 4. 第二项：识别网页阻断并交还用户

### 4.1 独立状态协议

拟新增 `shared/page-blocker.ts`，定义 `PageBlockerSummaryV1`。正文和业务选择器输出再短，都必须保留这份小摘要。

- 身份：`version=1`、`chatId/windowId/webContentsId`、宿主 `documentEpoch/controlEpoch`、所涉 frame 的 `processId/routingId/documentId`（可用时）、`observedAt`、`observationId`、`layoutRevision`。
- 状态：`unknown / not_observed / suspected / confirmed`。选择 `not_observed` 代替无条件 `none`：只表示在这次有覆盖说明的检查中未见阻断，不承诺整个页面绝无验证。
- 类型：`human_verification / login_required / permission_prompt / site_dialog / other_overlay / unknown`。普通 Cookie 选择、营销弹窗可识别为 site_dialog，不自动宣告 CAPTCHA。
- 覆盖：`coverage=complete_for_scope/partial/unavailable`、`scope=visible_viewport/top_document/selected_frames`、`reasonCodes`、遗漏 frame 数、是否截断；“完整”也只限当前检查范围。
- 有限证据：最多 4 条由宿主归一化的 `visible_verification_text / visible_challenge_control / suspected_frame / blocking_container / foreground_hit_test / visual_confirmation`，包含 frame 身份与可选视口范围，不存题目、答案、token 或大段页面文字。
- 控制建议：`requiresUser`、`blocksInteraction=yes/no/unknown`、`followup=none/one_read_only_probe/user_handoff`、`probeUsed`。模型能引用这些事实，但无权通过自然语言把 suspected 自行升级成宿主 confirmed。

不把 blocker 与正文 `ok` 混用：一次提取可同时是 `ok:true`、`dataRead:true`、`pageBlocker=confirmed`。同样，`partial:true` 不自动等于有验证码。

### 4.2 检测通道和证据标准

拟新增 `electron/modules/page-blocker-observer.ts`，在应用层汇总现有能力：

1. 宿主 frame 清单与原生 frame coverage，独立于商品列表／正文的节点预算。检查 frame 存在、文档身份、被跳过原因，URL 仅在进程内做候选匹配，不把 query 或验证参数写入新摘要。
2. 顶层与可读取 frame 的固定、只读探测：有限验证提示、验证控件、dialog／覆盖容器、可见范围、CSS 隐藏状态与视口交集。探测脚本由宿主提供，不能使用 Agent 任意 evaluate 代码作为可信检测器。
3. 在顶层检测候选 iframe 的容器边界与有限命中点，核对是否位于实际前景；需要子 frame 内证据时复用实际可用的原生快照或受宿主约束的逐 frame 读取。`framesInSubtree` 等能力须先核对当前 Electron 实际行为，不能虚构原生“检测验证码”接口。
4. 跨域不等于失败：可以使用已有原生快照覆盖跨域文档；若当前内核／读取路径无法覆盖，只输出 unknown/suspected 与原因，不绕过同源限制，不假设顶层 DOM 读得到子 frame 内容。
5. 原生 `visible:true` 和非空 `bounds` 只提供可见线索，不能证明无遮挡。跨层命中点、嵌套 frame、缩放、滚动、pointer-events、透明遮罩和视口外元素需要明确范围或降级 unknown。

状态标准：只有域名／脚本／隐藏 iframe 时不确认阻断；有候选线索但可见性、前景或内容未确定，记 suspected；当前视口有明确本人验证提示／交互控件，并与前景阻断容器或独立视觉证据相符，才确认需要交给用户。看不清、截图失败、frame 脱离、超时、MAX_NODES 或目标定位失败都不能变成“没有阻断”。

隐藏或 1×1 的验证同步 frame、页脚验证隐私说明、普通正文讨论 CAPTCHA 都应成为误报夹具。单纯面积小不能证明不阻断，单纯面积大也不能证明是验证。

### 4.3 独立预算与最多一次补观测

建议第一版固定上限：阻断摘要 1,500 个字符；宿主探测超时 1,500 ms、最多 64 个候选容器和 8 个 frame 的有限文本／控件采样；正文快照仍沿用现有业务预算。具体阈值经本地夹具调优，超限写明 coverage=partial。不可每个节点逐项远程读回。

正文用尽 MAX_NODES 时，不能因此省掉阻断采样；采样有自己的计数和截止时间。frame 枚举本身超限也必须记录，不允许返回貌似 complete 的空列表。

同一个 `(windowId, documentEpoch, blockerObservationGeneration)` 首次 suspected 时，最多一次有针对性的只读补观测；目标是候选 frame／前景容器，不重复读取整页商品列表。可增加原生候选选择器快照预算，或读取主框架容器与实际支持的子 frame，无法覆盖则如实退出。

需要视觉核实时可使用**观察截图**，与去除 UI 截图替代 View 是两回事。先检查当前模型图像能力；不支持时交给用户确认，不能声称看过图像。截图只在用户原授权页面范围内临时使用，默认不把整图持久化到新增诊断中。

补观测后仍不确定则 unknown，并提示页面未核实；不要无上限自动刷新、循环等待、反复点击“重试”、加载验证码音频或另开浏览器规避。页面产生新的文档或检测到新的前景状态才允许新一代检查，不能每次工具调用重置 probeUsed。

### 4.4 接入点与控制流程

1. `browser_get(agent_snapshot/agent_find)` 完成后附 `pageBlocker`；普通 text/dom_summary/snapshot 的宿主包装同样附当前代次摘要或明确 unknown。原生 unavailable 仍保持原错误，附带“未完成检测”。
2. 在 `browser-tools.ts` 的 evaluate 回执附页面身份、`scriptCompleted` 与 blocker 状态，避免把读取到底层 DOM 当作前台畅通；不把其 arbitrary code 结果升级为宿主观察。
3. `shared/page-digest.ts` 先预留 blocker 字段，再压正文、frames 和 capabilities；safe digest、通用 shrink、极端空快照回退都必须保留状态、身份、覆盖和 reason。保不全则输出显式 unknown+预算原因，不能默默丢字段。
4. `agent-runtime.ts` 将摘要纳入当前运行事实和最终／历史摘要。确认本人验证时，发出结构化 `page_blocker_detected` 日志，暂停**对应页面**的新输入及依赖该页继续抓取的任务步骤；其他无关页面和聊天不因此全局停止。
5. 工具准入在 `browser-tool-coordination.ts` 统一检查，覆盖单工具、Flow 与插件宿主调用。confirmed 时不允许继续点击、输入、evaluate 或以 session fetch／下载替代原受阻步骤；已有在途操作照现有结算机制收尾，已经保存的数据保留但标明来源与时刻。
6. suspected 时先暂停依赖“可见且可操作”的新输入，允许那一次宿主只读核实；单纯数据读取不宣称目标完成。unknown 时保留明确未核实状态，不根据“DOM 还能读”放开高副作用动作。
7. 复用 `BrowserAutomationController` 的安全清理、takeControl/pause/resume 和输入 lease；加应用层 blocker reason、等待目标和 `ResumeCheckpoint`，不要另建绕开控制器的“强制恢复”。
8. `BrowserTabPanel.vue` 及现有页面状态反馈显示“需要你完成验证”；提供“前往页面／接管”“我已完成，重新检查”“停止此页面任务”。界面只解释状态和下一步，不暴露 epoch、frame 编号等内部细节。

`ResumeCheckpoint` 只保存原 `chatId/task/turn/run` 引用、受阻 window、原授权与约束引用、最后已结算 evidenceId、未决步骤和停止原因。没有新授权的副作用仍遵循原约束；不能从 checkpoint 回放工具队列或完整 Flow。

在运行仍在等待时，“我已完成”触发一次复查，再由当前任务继续；运行已结束时，用户明确继续才启动链接原 run 的新运行。单纯 `resume()` 只恢复允许新操作，不能自行唤醒一个已终止聊天。这与当前控制器已有“恢复不自动启动已结束聊天”规则保持一致。

### 4.5 页面变化、误报、竞态与恢复

- 缓存键包含 webContents 身份、宿主 documentEpoch、frame documentId 和观测代次；navigation、reload、同文档路由变化、renderer gone、frame detach、关闭页面均使相应证据过期。
- DOM 浮层可在文档不变时出现／消失，不能只依靠导航失效。有限节流的前景候选变化、布局／视口变化和恢复检查生成新观测；每次依赖页面交互前核对摘要新鲜度。
- 页面隐藏、缩放／滚动后旧遮挡证据未必仍有效，先 unknown 并重查；迟到的旧文档结果按 epoch 丢弃，不能把新页面重新锁回旧验证码。
- 用户说“已完成”只是恢复检查请求，不是检测结果。复查仍 blocked 则保持等待；复查 unknown 则说明未确认，不盲目恢复；not_observed 才按现有控制器重新观察要求准备**新**动作。
- confirmed 变为 not_observed 时保留先前阻断历史和解除时间，不让模型误以为从未阻断。隐藏候选的错误升级需可撤销，界面说明“重新检查后未再发现阻挡”。
- 只读探测不能擅自切焦点、滚动、触发验证按钮；用户已接管时也不能因后台探测夺回控制权。原生清理未确认则沿用暂停错误状态，不能因 blocker 消失而解除。
- 运行取消／页面关闭／聊天删除时丢弃未开始的恢复意图；在途探测回执按身份过滤。两次“继续”请求需幂等，恢复不能重复启动 run 或重下已完成文件。
- 识别能力缺失、跨域覆盖不足、超时和模型不支持图像都提供标准 reason，第一版宁可显示“未确认”，也不把未检查当畅通。绝不承诺所有网站验证码都能识别。

## 5. 分阶段实施顺序

### 阶段 A：事实协议与历史恢复

先做 shared 版本协议、宿主工具片段、run_end 摘要和快速／完整路径的共同上下文构造器；加当前轮零与历史非零的作用域说明。随后做旧数据惰性兼容和上下文保底。先把“已经发生的事”讲准确，不依赖网页识别完成。

### 阶段 B：错误口径与独立回读

补操作失效 cause/stage 和 epoch 白名单；拆 evaluate、输入派发、字段回读与业务确认指标；把键盘恒 false 改为明确未观测／独立回读结果。验证现有不确定输入和禁止重放策略仍有效。

### 阶段 C：阻断观察与模型压缩保底

实现纯规则判定、有限宿主采样和一次补观测；先在隔离的本地主 frame／跨域 frame 夹具验证，接入各观察工具与 page-digest。此阶段只见日志尚不算整项完成，必须继续接准入和 UI。

### 阶段 D：暂停、交接与恢复

统一工具准入、现有控制器安全交接、UI 提示、原任务 checkpoint 和新观察后继续。覆盖运行活跃与已终止两种情况，证明不会重复提交、下载或复活旧 Flow。

### 阶段 E：集成验收与文档

完成下列有意义的单元／隔离运行／真实 Electron 本地页面验收，更新诊断和 current-state 的状态。用户要求打包时再构建成品并做成品启动检查；源码通过不提前记为某版本安装包已修复。

## 6. 验收清单与完成条件

### 历史事实

- 真实模拟工具成功 → 新轮 auto 问“刚才执行了吗”，模型请求包含前轮证据、本轮零次与独立 runId；无需为了回答再次调用浏览器。
- 部分成功 + `browser_operation_invalidated` + 旧 ref 失败 → 后续 chat/agent 解释保留成功、失败、未知原因；不把错误自动归因为用户接管，也不重放旧 ref。
- 发生 evaluate 回读但未独立观测 Tab/Ctrl+A → 只承认脚本/字段证据，不把恒 false 说成失败，也不因修改统计变成按键成功。
- 用户中止、超时、provider 失败、重启断电式中断、问卷继续、插入指令与子对话结果分别保留 scope；父子聊天的回执不能串身份。
- 长历史超过原最近 30 条、正文超大、低上下文模型、safe digest 重试 → 最近相关完整任务摘要仍存在；最小事实包放不下时显式失败，无无声裁掉。
- 旧 end 摘要、无 end 工具回执、缺 runId、重复回执、损坏版本 → 保守迁移且不修改原数据；零与未知不混淆。

基于 `shared/agent-progress-policy.test.ts`、`electron/modules/agent-runtime-policy.test.ts` 扩展，并为新历史构造器添加纯函数测试。隔离 runtime 使用本地假 provider 记录实际发送请求，不能只验证“组装函数看起来正确”。

### 网页阻断

- 本地顶层明确验证页；另一个 localhost 端口跨域 iframe 验证遮罩；大量商品节点耗尽 MAX_NODES 但 iframe 被 skipped；三者均能保留独立线索并按规则核实／交接。
- 底层商品 DOM 仍可读且 evaluate 成功 → 页面受阻仍呈现，不误报目标完成；不继续读取受阻页面来规避验证。
- 隐藏验证 iframe、普通正文提到验证码、页脚品牌链接、Cookie 弹层、登录页和非验证遮罩 → 区分类型、不凭域名确认、不盲目要求本人验证。
- 透明遮挡、nested iframe、视口外候选、缩放／滚动、frame detach、renderer gone、探测超时、截图失败与无图像模型 → 覆盖不足明确 unknown，不返回无依据的 none。
- suspected 一次补观测后仍不明 → 调用数封顶、无刷新重试循环；文档变化后新检查不会接受旧回执。
- 本人接管、清理等待、完成后复查、误报撤销、连续点两次继续、任务已结束后恢复控制 → 先复查、同任务链接、不开重复运行、不重放既有输入／提交／下载。
- page-digest 各预算层、safe 分支、极端回退 → blocker 状态／身份／coverage／原因均保底存在，或明确预算失败。

纯判定和压缩测试可放 `shared/page-blocker.test.ts`、`shared/page-digest-native.test.ts`；控制测试接 `browser-tool-coordination.test.ts` 和 `browser-automation-controller.test.ts`。真实 Electron 隔离夹具使用临时 profile、本地合成网页和本地假 provider，分别保留前景页面截图、结构化检测回执、暂停前后控制状态与恢复调用序列；无需真实站点验证码或用户账号。

两项各自的完成条件：实现对应数据流与 UI 行为；上述失败和恢复场景通过；类型检查与相关现有回归通过；证据可追溯且不新增敏感日志；源码、文档、安装包的发布状态明确。仅写 prompt、仅改模式识别、仅加关键词检测或只有单元测试，都不能标记完整修复。
