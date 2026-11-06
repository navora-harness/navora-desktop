# 插件后台任务、双向通信与执行控制完整规划

日期：2026-11-06。状态：设计规划，尚未实施、构建或验收。本文覆盖用户提出的插件主动通知 Agent、运行状态、输入展示和执行控制，作为后续实施基线；参数为首版建议值，需实现验证后调整。

## 1. 目标与产品边界

建设宿主管理的插件后台任务运行时：Agent 启动插件任务后可以结束当前模型回合，宿主持有任务和续接记录；插件完成、失败或请求输入时，通过宿主可靠投递事件，按授权唤醒原对话。用户始终可以查看实际输入、执行状态、产物并控制任务。

核心闭环：提交输入 → 宿主登记任务与续接条件 → 入队和执行 → 实时可见 → 用户/Agent 控制 → 事件落盘 → 安全续接 → 结果处理完成。

必须区分三个事实：插件执行结束、事件已进入续接队列、Agent 已处理结果。不能把其中一个显示成另外两个。

等待一个尚未完成的异步工具本身不必然消耗模型 token；本项目消除的是模型轮询、重复推理和长工具调用占用，并补齐取消、崩溃检测及续接可靠性。

首版支持本机应用存活期间的后台任务。关闭应用即终止本机工作进程，重新打开后识别中断。关闭窗口与退出应用必须区分，窗口隐藏但应用存活时任务可继续。系统休眠期间不承诺执行，唤醒后检查真实进程状态；不因墙上时间跳变立即判定失败。

远程常驻执行服务、任意外部系统主动发起 Agent、新增跨平台发行认证不属于首版；后续复用事件协议扩展。

## 2. 现有基础与缺口

- `electron/modules/plugin-store.ts` 已有 activeExecutions、调用权限检查、插件替换/关闭保护；计数覆盖 execute 调用，不代表独立后台任务。
- `electron/modules/plugin-host.ts` 与 SDK PluginHostApi 已有当前 chatId、按次 approvedCapabilities、AbortSignal 及受控 runTool。后台任务不能保留旧 ctx 绕过调用有效性检查。
- `electron/modules/agent-inbox.ts` 已有队列、串行接收、去重与暂停；其对象是用户输入，插件事件需要独立类型和来源，不能伪装用户消息。
- `electron/modules/agent-runtime.ts` 已有运行续接、任务约束和 pendingEvents；内存事件不是持久化任务收件箱，也不能保证空闲 Agent 被唤醒。
- `electron/modules/fcurl-runtime.ts` 已有受控 oneshot 执行、排队及调用归属，可复用原则；现有专用协议不能直接宣称支持通用持久工作进程。
- 插件可靠性文档已明确父进程强杀回收尚未完成；后台任务发布必须与自有进程树回收要求衔接。

## 3. 用户体验

### 3.1 对话任务卡片

每次任务创建一张稳定卡片，使用 jobId 更新，不追加大量进度消息。默认显示插件/任务名称、执行状态、当前阶段、已完成数量、运行时长、Agent 等待/排队/处理情况及当前可用动作。

展开提供四个区域：输入、进度与日志、产物、控制记录。任务卡片创建前的权限失败也应有普通工具错误反馈，不能伪造已运行任务。

示意内容：爬虫插件 · 运行中；商品采集；500 / 2,000 条；抓取详情页；运行 3 分钟；Agent 等待结果；查看输入、暂停、取消。

不确定总量只展示已处理数量；预计剩余时间必须有可靠估算；没有心跳不能把进度长时间不变直接判死。

### 3.2 插件工作区与全局入口

插件列表保留安装/启用状态，额外展示活动任务数、等待输入数和异常摘要。插件可能同时有成功、运行、失败任务，不用单个状态覆盖全部事实。

新增任务列表，可按活动/待处理/历史、插件和所属对话筛选；点击跳转原对话卡片。详情和对话共享 JobStore 状态，支持窗口重开、暗色、窄窗、键盘操作、减少动画。

应用级任务入口显示活动数量。批量暂停/取消逐项返回结果，不承诺跨任务事务；首版优先单任务控制。

### 3.3 输入展示和编辑

保存三种输入：用户/Agent 提交值、宿主校验归一化后的执行值、实际脚本及文件快照引用。默认摘要显示目标、范围、上限、输出位置；展开查看完整参数和脚本，可复制脱敏版本。

字段来源记录 user / agent / default / plugin-normalized；来源不明不猜测。插件归一化只能在执行前经协议回传并校验，不能用任意运行后描述冒充实际执行参数。

脚本和输入文件按内容摘要保存不可变副本，外部绝对路径不能代替历史版本；敏感文件采用受控存储。结果中可列原始路径与执行快照，清楚区分。

运行中的历史输入只读；“修改后运行”打开新草稿，重新校验权限并创建关联新任务。排队任务首版也通过取消并创建新任务修改，避免并发编辑歧义。运行中动态调参推迟至后续独立协议。

密码、密钥、Cookie 默认遮蔽。凭据优先保存凭据库引用而非原文；一次性敏感值仅在必要执行期保留，不保证重启可重试。未知字段保守遮蔽并允许插件声明敏感 schema。普通复制、日志和诊断不包含秘密，插件 stdout/stderr 亦需限量及脱敏；脱敏不能只依赖字段名。

## 4. 状态模型

### 4.1 任务状态

queued → starting → running → succeeded / failed。

running → pausing → paused → resuming → running。

需要输入时进入 waiting_input，记录阻塞原因和允许的输入 schema；接收输入并确认后才能回到运行状态。

非终态可进入 cancelling；确认工作进程退出且必要清理完成后进入 cancelled。强制结束使用 terminating → terminated。进程异常、宿主重启等进入 interrupted。

终态为 succeeded、failed、cancelled、terminated、interrupted。重试/检查点恢复均建立新 jobId，关联 retryOf/resumeOf；旧任务终态不改回 running。

任务执行终态之外另记 cleanupState=pending/complete/failed。资源清理不完整必须可见，相关资源保持隔离，不能用“已取消”掩盖仍有进程存活。

### 4.2 其他独立状态

- 插件：启用/停用、加载健康、运行任务数、是否排空中，分别建模。
- 进程健康：healthy / unresponsive / exited / unknown，与业务进度分开。
- 事件投递：pending / leased / acknowledged / failed，表示调度消费情况。
- 续接：waiting / ready / queued / processing / processed / blocked / revoked。
- 用户暂停锁：记录操作者、原因和 generation，Agent 无权自动移除用户设置的锁。

首版暂停操作只有安全点确认才显示 paused；暂停期间不能继续发生受控业务副作用。已在途外部请求是否可中止由执行器说明，不能承诺撤回已送达请求。

## 5. 控制语义

用户与 Agent 走同一个宿主 CommandService，支持查询、暂停、继续、取消、强制终止、提交输入、重试、检查点恢复。查询不唤醒模型。

每条命令记录 commandId、jobId、expectedRevision、actor、action、参数摘要及时间；结果分 accepted、applied、rejected、timed_out。accepted 只说明宿主接收，applied 需要执行器确认和宿主状态校验。

重复 commandId 返回同一回执；重复 ID 携带不同参数拒绝。过期 revision 返回当前快照；完成与取消竞争以宿主持久化序列化提交为准，不能覆盖已经确认的终态。

- 暂停：执行器在安全检查点停止派发新业务操作；超时返回未暂停，可选择继续等待或取消。
- 继续：必须允许对应 actor 解除当前暂停原因；恢复前重新检查权限、插件版本及资源归属。
- 取消：撤销自动续接资格，发协作取消、停止接收新操作，回收资源并保留部分结果。
- 强制终止：用户可显式执行；Agent 只有已有任务策略明确允许取消超时升级时才可自动执行。杀的是宿主拥有的任务进程树，不能按任意 PID/进程名操作。
- 重试：新任务、新执行尝试和新权限检查。具有提交/支付/写入等外部副作用的任务默认不自动重试；需幂等键或可核验检查点。
- 提交输入：校验请求 ID 和版本，输入并入独立补充记录，原输入快照不被改写。明确等待用户输入的请求不能被 Agent 自行填充。

UI 按任务 capability 显示动作。新版后台任务必须可取消且有宿主强制终止保障；暂停和检查点恢复按能力声明提供，爬虫示例必须支持暂停/继续。

用户暂停优先于 Agent 自动控制；用户取消或终止后，迟到通知只入历史，不续接。手动“继续任务”仅解除任务暂停，不自动撤销用户另行设置的“暂停 Agent 自动处理”。

对话“停止”默认停止当前 Agent，并撤销该工作流续接资格、取消关联后台任务；若有多个独立工作流，按宿主归属限定范围。后台任务卡片始终有独立控制；后台等待时也保留停止该工作流入口。“仅停止 Agent、任务继续”作为明确的独立动作，不能隐式留下孤儿任务。

## 6. 架构与职责

建议新增：

- JobManager：任务准入、状态机、资源额度、归属和生命周期。
- JobStore：输入快照、任务、事件、命令及续接的持久化。
- PluginJobRunner：隔离执行进程、IPC、控制确认、心跳及进程树回收。
- JobCommandService：UI/Agent 共用的控制校验与回执。
- AgentEventInbox：有明确外部来源的持久事件收件箱。
- AgentContinuationScheduler：续接资格、对话串行、公平调度、预算及恢复。
- JobArtifactStore：输入/脚本、检查点、部分结果与最终产物。

逻辑链路：UI/Agent → JobManager → Runner；Runner → JobStore 事务提交 → UI 增量订阅 + EventInbox → ContinuationScheduler → AgentRuntime。

进程分离提供可终止性和崩溃隔离，不等于安全沙箱。现有插件入口运行在主进程，不能因此宣称第三方任意代码受权限强隔离。新版工作进程必须限制宿主桥调用、文件/网络等访问边界；无法限制的原生执行能力明确视为受信任代码并按现有权限策略准入。

## 7. SDK 与运行协议

旧 execute 保持兼容。新版增加显式后台工具声明和独立 worker 入口，使用 minHostVersion/协议版本能力协商；旧宿主拒绝不支持的后台模式，不静默降级为假后台。

Agent 调用后台工具时，宿主先创建 Job 和续接绑定，再启动 worker，立即返回结构化 `{kind:'background_job', jobId, state, capabilities}`。工具结果此时已正常结算；后续事件属于独立的带来源续接输入，不补造第二条同 toolCallId 的工具返回。

worker 接收宿主生成的任务上下文和不可变输入，仅能上报 progress、checkpoint、needs_input、complete、fail，并处理 pause/resume/cancel/input。插件 API 示例只是概念：job.progress(...)、job.checkpoint(...)、job.complete(...)；不能把 job.create 暴露成无限嵌套创建任务入口。

身份由宿主 IPC 通道注入：jobId、attemptId、pluginId、pluginVersion、chatId、workflowId、originRunId、toolCallId、generation。插件不能提交任意 chatId 选择接收者。worker 重启会轮换 generation，旧进程事件被拒绝。

协议消息使用 schemaVersion、messageId、sequence、type 和受限 payload；逐帧校验、长度限制和未知类型拒绝。IPC 默认本机私有管道，不开放公共 HTTP 端口。后续远程 webhook 另行设计认证、重放保护及绑定。

受控 browser/file/network 调用通过 job-scoped Host API，重新检查任务状态、权限和资源租约；不继承旧 ctx.signal，也不跳过 isCurrent。job 取消触发独立 job signal。执行中权限收紧立即阻止后续操作并暂停或失败，不能扩大为最初批准范围以外的能力。

## 8. 持久化与可靠投递

建议采用主进程独占写入的事务存储，优先评估 SQLite 与当前 Electron 打包兼容性；若不满足，采用追加 journal、原子快照及恢复校验的等价实现。具体实现选择在 P0 固化，不在普通 chat JSON 间假设跨文件原子事务。

任务创建与初始续接绑定须同事务提交，之后才能准入 runner。状态变化与待投递事件同事务提交，提交成功才向插件确认。崩溃后扫描 pending 事件重投。

事件至少一次投递；通过 eventId、jobId/attemptId/sequence 唯一约束幂等消费。重复消息内容不一致拒绝并诊断，乱序事件缓冲或按协议拒绝，终态不得被迟到进度覆盖。

续接使用原子 lease 和过期恢复；同一对话只有一个模型运行通道，接入现有运行准入，不另开平行模型。事件消费与创建持久 continuationRun 记录关联，避免“已确认但尚未启动”丢失。运行完成后才能将续接记为 processed。

模型执行及外部副作用不承诺 exactly-once：崩溃发生在副作用与回执之间时，需要执行证据、幂等键和检查点核验，不自动重放整个任务。

磁盘满/落盘失败：拒绝新任务及新的副作用准入，有限缓冲，尝试协作暂停/取消已有任务；持久化失败必须在 UI 标注“状态未保存”，不能向插件确认可靠接收。终态和控制事件不得被进度挤出。

## 9. Agent 唤醒与任务续接

Continuation 保存原用户任务引用、约束快照、等待 job 集合、触发规则、下一步计划摘要、模型配置引用、预算、自动处理许可和撤销 generation。计划摘要是提示，原用户授权与宿主合同才是约束来源。

完成/失败可触发续接；needs_input 默认先展示输入请求，需要用户的输入直接交给用户。进度和心跳不触发模型。运行中事件在安全回合边界合并消费，不随意中断在途工具；空闲时进入同一准入队列。用户输入优先，事件避免无限饥饿；不自行解除用户暂停的队列。

失败续接可以分析和建议修复，自动修改/重试仍受原任务授权及副作用策略限制。插件的成功报告是执行结果来源，不等于宿主独立验证全部业务正确；检查产物存在、摘要、schema，必要时由 Agent 验证实际结果。

首版支持一个工作流等待一个或多个显式 job，join 策略为 all/any/失败提前触发；调度器合并同工作流事件。any 触发后其他任务默认继续，只有创建时明确 cancelRemaining 才取消。等待注册时原子读取已完成状态，解决先完成后等待；同一 generation 仅取得一次逻辑续接资格。

取消、归档、删除对话及用户修改任务时校验资格。归档默认阻止自动唤醒并显示仍有任务，显式允许保留后台执行；删除对话先取消任务，保留最小清理墓碑至资源回收完成，不创建新对话接收迟到消息。

宿主重启：恢复任务日志，核验并回收旧工作进程，未确认存活任务标为 interrupted。已有完成事件可在原许可仍有效时重新排队；中断作业默认不自动重做，有验证过的 checkpoint 才显示恢复入口。

## 10. 数据契约

Job：id、schemaVersion、revision、workflowId、pluginId/version/artifactDigest、chatId、originRunId/toolCallId、attemptId/generation、state、health、capabilities、inputSnapshotRef/hash、permissionContractRef、progress、artifactRefs、checkpointRef、error、cleanupState、createdAt/startedAt/finishedAt、retryOf/resumeOf。

Event：id、jobId、attemptId/generation、sequence、type、payloadRef/summary、occurredAt/receivedAt、deliveryState。可信身份、接收时间由宿主生成，不能采信插件任意声明。

Command：id、jobId、expectedRevision、actor、action、payloadRef、status、reason、requestedAt/appliedAt。

Continuation：id、workflowId、chatId、origin refs、constraints ref、jobIds、joinPolicy、generation、state、lease、budget、triggerPolicy、continuationRunId。

UI 增量事件包含 revision；发现断档重新取快照，重连不依赖 renderer 缓存。所有查询、控制和产物读取均校验 chat/plugin 归属，包括远程桥入口。

## 11. 执行隔离、资源及运维

首版一任务一 worker，简化暂停/强杀隔离；不能为了终止一个任务杀掉共享进程中的其他任务。主进程只做调度和受控桥接，不能执行长 CPU 脚本。

Windows 需要自有进程树 Job Object/等价 kill-on-close 机制和实测；其他平台使用对应进程组及监护策略，并分别认证。父进程强杀后无残留是发布门槛，不能用正常退出测试替代。

初始建议：全局同时运行 4、单插件 2、单对话 2、全局排队 32；排队准入先占额度，后台 Job 与现有 fcurl 子调用使用分层额度，不互相绕开。暂停任务单独限制进程驻留量。资源预算包含运行时长、CPU/内存、磁盘、输出条数和网络速率，按执行器真实可用机制实施，不支持硬限制则明确标注。

建议心跳 5 秒，连续 30 秒无响应标记 unresponsive；暂停/取消确认等待 10 秒后展示超时，终止宽限期 5 秒。它们为可调默认值，不是所有任务统一失败期限。心跳由 runner 观察进程与桥健康，不能仅依赖插件业务回调。

进度 UI 最多每秒 2 次，持久化合并进度快照；控制、状态与终态立即提交。单帧初始上限 64 KiB，大内容走产物，日志有单任务/全局限额及截断标记。心跳不逐条永久保存。

升级/停用/卸载先进入 draining：不接新任务，用户选择等待或取消；未清理完成禁止替换对应版本。checkpoint 绑定插件摘要和 schema，新版本恢复必须显式迁移且验证兼容。开发热重载遵守相同规则。

退出提示同时统计运行 Agent、执行中/暂停的 Job 和未清理进程。退出按协作取消、宽限、进程树回收、持久化中断结果顺序执行，不用 Agent 已空闲作为安全退出依据。

输入/日志/产物采用可配置保留策略；初始建议日志 7 天、任务记录与输入快照 30 天，用户固定的结果另行保留。活动、待清理、未消费终态事件不得自动清理。删除历史先解除引用再回收对象，避免破坏其他任务共享产物。

诊断记录 job/attempt/event/command/continuation 关联 ID，覆盖队列等待、取消延迟、投递延迟、续接次数和失败原因；不记录原始凭据。

## 12. 安全与授权

外部文本、网页内容、插件报错和产物均以工具/外部数据来源进入模型，不能升级为 system 指令。插件只能报告结构化事实，不能自行指定模型、对话、权限或强制唤醒优先级。

后台任务权限是原合同的受限延续，不是永久能力。浏览器控制复用现有租约、输入所有权与页面 epoch；用户接管页面后，后台 worker 不能继续旧输入。资源冲突等待由宿主管理，禁止用心跳循环抢锁。

自动唤醒设置默认仅覆盖本次用户委托的 Job；全局限频、工作流次数/花费预算和失败退避。建议同一工作流连续自动修复最多 2 次，超限转为待用户处理；实际预算继承已有任务上限的更严格值。

所有任务控制记录 actor。用户控制优先，安全撤销优先；控制接口不给插件任意创建 shell 命令、越界读文件或杀进程的能力。

## 13. 实施拆分与交付门槛

### P0：契约与基础技术验证

固化状态机、停止语义、事件/命令 schema、持久化方案、worker IPC 和权限合同；用合成任务验证存储事务与目标 Electron 中的独立执行。交付契约及故障夹具。门槛：先完成后等待、重复投递、取消竞争设计可执行；存储/打包兼容有证据。

### P1：可控制的后台执行核心

实现 JobStore/Manager/Runner/CommandService、隔离进程、取消及强制回收、心跳、输入快照、产物和重启中断恢复；爬虫示例增加检查点暂停/继续。门槛：主进程不阻塞、单任务终止不影响其他任务、父进程强杀无自有残留、控制回执准确。只有内部入口，未有完整 UI 前不宣布首版完成。

### P2：任务卡片与工作区

接 main IPC、preload、远程桥和共享类型；实现对话卡片、输入/日志/结果详情、插件活动计数、控制入口及退出提示。门槛：真实窗口中控制完整执行，状态跨重开一致，秘密不泄露，支持窄窗/暗色/键盘。

### P3：可靠 Agent 续接与首版发布

实现 EventInbox/ContinuationScheduler、无轮询等待、原合同继承、用户优先及预算限制；用本地合成采集站完成端到端验证。门槛：P0–P3 全部通过后才算“后台任务首版”，爬虫从启动到自动结果处理闭环完成。

### P4：增强与扩展

补全更多插件检查点适配、批量控制、经验证的自动恢复及更细资源限制。远程任务、常驻服务和外部事件订阅另立协议与部署计划；不得把 P4 留项算入已完成能力。

不在缺少代码验证前给出固定工期。P0 后按实际存储/执行隔离风险估算 P1–P3；各阶段以门槛推进，不以单纯文件数量或单测数量判完成。

## 14. 文件落点建议

- shared/plugin-jobs.ts：任务、事件、命令及续接公共契约。
- electron/modules/plugin-job-store.ts、plugin-job-manager.ts、plugin-job-runner.ts、plugin-job-command.ts：后台执行核心；具体文件可按工程风格合并。
- electron/modules/agent-event-inbox.ts、agent-continuation-scheduler.ts：事件与模型调度。
- electron/modules/plugin-store.ts、plugin-host.ts：启动入口、归属、draining 及 job-scoped bridge。
- electron/modules/agent-runtime.ts、agent-inbox.ts：统一运行准入、等待释放与安全续接，不复用用户消息角色。
- electron/modules/chat-store.ts 及现有 IPC/preload/远程桥：历史引用、订阅与控制校验；实施时确定实际入口，避免新建平行通道。
- src/components/plugins/PluginWorkspace.vue、PluginLibraryList.vue、ChatPage.vue 及新增 PluginJobCard/Details：任务展示与操作。
- navora-plugin-sdk/navora-plugin.d.ts、SPEC.md、CLI/static-check：新契约、worker 打包与兼容校验。
- navora-plugins：新增合成/示例爬虫，保留现有 oneshot 插件行为。

本文仅新增规划及文档导航，以上文件均为未来实施范围。

## 15. 验收矩阵

1. 正常执行：Agent 启动后释放回合，后台进度持续，完成后自动读取产物；等待期间模型请求数不增加。
2. 失败处理：稳定错误码、可见部分结果、单次逻辑续接；自动修复有预算且不越权。
3. 快速完成：等待注册前任务已结束仍能续接；零丢通知。
4. 事件可靠性：重复、乱序、断线、提交后确认前崩溃、消费 lease 过期；无丢失且无同对话并行模型。
5. 控制竞争：暂停/完成、取消/完成、重复点击、过期 revision、错误 commandId 重用；终态与回执一致。
6. 用户优先：手动暂停不能被 Agent 解除；停止后旧事件不启动新运行；用户新输入与事件同到时不破坏任务约束。
7. 执行回收：插件卡死、业务失败、worker 强杀、宿主强杀、取消超时及清理失败；真实进程树与状态一致。
8. 输入追溯：修改原文件不改变历史脚本；重试建立新任务；一次性秘密不可用时明确要求重新提供。
9. 权限与资源：伪造 chat/job、旧 generation、权限撤销、用户接管浏览器、跨对话产物访问均受阻。
10. 生命周期：重启、休眠恢复、归档/删除对话、停用/更新/卸载/开发重载、退出时存在 paused Job；无孤儿任务和虚假运行中。
11. 存储故障：磁盘满、IO 拒绝、损坏记录、产物丢失、迁移失败；保留证据、阻止错误执行，不误报成功。
12. 界面与负载：真实主窗口/任务详情、暗色、窄窗、键盘、减少动画；高频进度与大日志不阻塞操作，重连可恢复。
13. 兼容与发行：旧 execute/oneshot 插件行为不变；新协议旧宿主清楚拒绝；当前支持平台的真实安装版/便携版与 SDK 独立产物分别验证。

验证顺序为状态/事务定向测试 → worker/IPC 集成与真实进程故障 → 合成 Agent 事件链 → 本地站点真实 Agent 端到端 → 真实 UI → 类型/构建及适当回归 → 发行制品验证。模拟模型测试不能代替真实 Agent 闭环，正常退出不能代替强杀回收。

## 16. 完成定义

首版完成需要：任务输入可追溯；运行、健康及 Agent 处理状态准确；取消与隔离强制终止可靠；示例爬虫可暂停/继续；结果/失败事件持久化并可靠续接；等待无模型轮询；用户停止优先；重启识别中断；旧插件兼容；实际 UI 和目标发行制品通过验收。

当前以上均为待实施，不因本规划创建而标记任何运行能力完成。
