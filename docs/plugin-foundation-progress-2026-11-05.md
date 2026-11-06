# 插件 S1 / Fastls F0 首批实施记录

> 后续更新：2026-11-06 的生产依赖 staging、IO 恢复重试、恢复界面及真实 Windows 文件故障见[第二批实施记录](./plugin-reliability-followup-2026-11-06.md)。本文保留首批已发行范围；第 6 节的剩余项由后续记录进一步核销。

日期：2026-11-05 开始，2026-11-06 完成本轮交付。状态：**安装/运行时、SDK 及桌面 pack 首批已实施，最终构建与双包验证完成；S1/F0 全部验收尚未完成**。本页衔接[插件跨平台规划](./plugin-platform-installation-plan.md)与[Fastls 规划](./fastls-plugin-plan.md)，保留本轮证据及未测边界。

## 1. 版本与交付范围

- 宿主源码版本：0.4.13；构建与真实退出夹具结果见第 5 节，不以源码版本代替成品验证。
- SDK 仍为 0.2.0、Fastls 插件仍为 0.1.0、fcurl 固定 0.2.0。本轮修改本地源码与检查器，没有发布 SDK、重发插件 dist ZIP、更新正式商店或切换上游字节。
- 执行环境为 Windows x64。macOS/Linux 仅涉及目标静态检查与平台探测解释器，未取得对应 Navora 宿主实机认证。五目标缓存/包存在不等于五平台运行通过。
- 测试使用临时数据根、合成插件、固定缓存或 localhost；没有替换个人插件、读取真实账户 Cookie 或向真实账户发送请求。

## 2. 本轮安装与静态检查改动

`plugin-store.ts`、`plugin-install-transaction.ts` 将 ZIP 安装、全局外链切换和卸载纳入共同保留备份事务。候选先校验/加载，再切换目录及 index；失败恢复原目录、套件同伴、启用状态及链接来源。链接源工程不归宿主管理，不删除；开发工程若位于插件管理根内则拒绝建立全局外链。

package/suite 归一化锁与同步 index 提交屏障防止重入。正在执行的 JavaScript、runtime 准备、排队和进程均计入繁忙；更新/卸载继续返回 `plugin_busy`，没有新增自动停止升级。权限异步等待返回后重新核对模块身份，旧批准不能调用已经替换的入口。只重载受影响 ID，保留不相关运行模块身份。会话外链和热重载候选失败保留旧模块；随附同步也先检查候选。

journal 使用严格字段/类型、目录名称和管理根边界校验，拒绝 junction/symlink 转向外部工程。index/journal 采用独占临时文件、文件 fsync、原子替换和可用时的目录同步。回滚使用不被消耗的备份，整体恢复成功后才清理；损坏 journal 移到 `plugins/.transaction-quarantine`，保留诊断并阻止加载半提交状态。`recoveryStatus()` 提供阻塞和诊断目录，尚无图形化恢复操作。

本地 ZIP 与 SDK/商店统一压缩 200 MiB、展开 500 MiB、10,000 条目。SDK `build`、`check --static`、`pack` 静态检查不 require 入口；旧 `check` 明确为 Node + Electron stub 导出检查，异平台不假装执行。桌面 pack 已独立补齐：移除 require 入口、pack 重写 inventory 及刷新资产；采用随 main 打包的纯 JavaScript parser 和 Node 静态 resolve，按同等规则检查可见字面 require/import 及传递引用，不直接复用 SDK helper，也不需要外置 SDK/Node 进程。v2 按已验证 inventory 完整归档，不另注入工程依赖；legacy 多 entry/suite 保持兼容。运行文件清单、摘要、二进制头及包内字面依赖/传递引用纳入验证，缺失/父级逃逸、无法核实的动态加载和 `.node` 拒绝；没有新增固定 lockfile 的生产依赖自动 staging。这类可见引用静态检查不构成任意动态加载认证或操作系统沙箱；桌面 plugin_build/check 后的受信候选外链加载仍可执行插件，不能把 pack 的零入口执行扩大到全部工具路径。

macOS 探测固定 `/usr/bin/sw_vers -productVersion`，预算 1.5 秒/4 KiB，不拿 Darwin kernel 当产品版本。Linux 仅凭 report 的明确 glibc 版本或 ld-musl 共享对象识别 libc，未知和未证实的 musl 版本保持未知；相关判断已有解释器单测，目标机器执行尚未验证。

## 3. 本轮 Fastls 运行边界

运行时预留含完整性检查/建目录准备，默认全局 16、单 chat 4；等待队列全局 32、单 chat 8。输入验证后、入队前使用单调时钟计算统一截止时间，覆盖等待、准备、进程和清理，CLI 只获得剩余预算。request 保持默认 30 秒、范围 1–120000 毫秒；status/profiles 为 10 秒。队列可取消，溢出在未发送前返回。

`dispose()` 同步关闭准入并取消等待/活动项；`cancelAndWait()`、`drain()` 等待直接子进程 close 和目录清理。取消与旧运行同时失效仍保留 request_cancelled 分类，runtime_cleanup_failed 不被 request_stale 覆盖。清理失败按 plugin/chat 归属保留、可重试，dispose 重试不会重新开放调用。启动清理使用父/子进程及关闭记录；仅父进程死亡不足以删除目录，未知旧记录及活动 orphan 保留。

宿主为每次 runtime call 生成 requestId，为实际 spawn 生成 attemptId；AgentRuntime 提供可信 runId/toolCallId 与当前运行对象检查。受控网络请求在排队后、派发前重新检查本轮或显式续跑 waiting checkpoint；独立新任务不继承历史页面的全局网络封锁。最小 `PluginRuntimeReceipt` 由宿主回调独立收集，每工具最多最近 256 条，记录身份、派发、状态、时间、HTTP 状态、字节数及错误，不含 URL/头/正文。插件自报 JSON 和 HTTP 200 均不提升浏览器业务验证、不解除 blocker。

证书环境保留宿主构造时 SSL_CERT_FILE/SSL_CERT_DIR 快照，校验绝对路径与文件/目录类型；非法配置明确失败。结果标注 system/environment_custom，status 明示 system_default/host_environment，以及 direct_child_close、parentDeathCleanup=false。没有新增任意 CA 或代理凭据输入，也未关闭 TLS 验证。

Fastls 收集器补固定归档/元数据摘要、BUILD.target、二进制机器头、源码树/模块 hash、toolchain 与 RELEASE/SOURCE_VERIFICATION/SHA256SUMS 关联核对。五目标缓存检查通过；`--verify-cache` 不重新下载归档，不能把它写成重新下载后的摘要验证或重新发包。

## 4. 本轮验证证据与复跑入口

各组存在交叉覆盖，以下数量不应简单相加作为独立能力总数。

- 桌面最终完整构建：`npm run build` **897 / 897 单测通过、0 跳过，类型检查和 renderer/main/preload 构建通过**。日志：[build.log](../../_planning/release-0.4.13-2026-11-05/build.log)。该日志为桌面 pack 补齐后的最终重跑；早期 882/889 数量不作为最终结果。
- 安装事务与平台解释器：14 项事务、2 项平台解释器单测通过，包含 Windows junction 对外部工程的保护。已包含在完整单测中。
- 真实 PluginStore/文件系统：`node scripts/test-plugin-store-reliability.mjs`，**39 项检查通过**。Electron 仅替换应用身份；没有假造 store 或文件系统。覆盖候选/迟发失败、原启用及链接保留、套件、会话、重入、权限等待后替换、活动 JavaScript、不同插件身份保持、ZIP 预算、损坏隔离及关闭屏障。
- 进程中断恢复：`node scripts/test-plugin-transaction-interruption.mjs`，**6 个中断位置通过**：journal、首/次目录备份、候选 rename、index、commit 标记。4 处在恢复已完成第一个目录 rename 后再次直接退出，重启恢复及重复恢复均通过。采用新子进程 `exit(93)`、不运行 finally；不代表物理断电或磁盘设备故障。
- 运行时定向：**15 / 15 通过、0 跳过**，Windows 原始 fcurl + localhost HTTP/代理及真实 OS spawn 失败。报告：[validation.json](../_planning/fastls-f0-2026-11-05/validation.json)；复跑入口按报告为 `node --test _planning/fcurl-runtime-f0.test.mjs`，运行临时编译入口前需按对应夹具重新生成。
- SDK 静态检查：在 SDK 目录执行 `node --test test/static-check.test.mjs`，**9 项通过**；测试根通过 `NAVORA_SDK_TEST_ROOT` 显式设为工作区隔离目录。Fastls 来源 `source-verification.test.mjs` **9 项通过**。
- 桌面 pack：新增 **8 项单测通过**，覆盖零入口执行、篡改不重签、v2 inventory ZIP 闭包、目标一致、legacy entry/suite 及依赖拒绝。另有最终真实 main/preload/renderer + AgentRuntime + PermissionGate + plugin_pack 工具夹具通过，报告：[completed.json](../../_planning/plugin-pack-main-2026-11-05/completed.json)。本地模型两轮共 4 次请求；含 marker/throw 的插件入口未执行，成功 ZIP 内清单摘要全部一致；将 fcurl 最后一字节改动后工具以 runtime_hash_mismatch 拒绝，未产生第二个 ZIP，inventory 原字节不变。observedSpawns/errors 均为空、自然 exit 0、forcedKill=false、临时 profile 清理成功。
- 既有构建产物：9 个官方已构建分发包的 SDK static/default check 通过；五目标 `collect-fcurl.mjs --verify-cache --all` 通过。default check 仍只是 Node/Electron stub 层，不等于真实目标认证。

本轮 `test:plugins:platform` 初次在测试商店准备阶段遇到 `uv_os_get_passwd returned ENOMEM` 环境失败；主代理随后重跑已通过常规真实 Electron 平台闭环。最终成功重跑日志：[platform-smoke.log](../../_planning/plugin-foundation-2026-11-05/platform-smoke.log)，覆盖 v2 catalog、自动选包、预览变化拒绝、安装、runtime request、错误平台、失败替换、桌面 pack 和卸载。以本轮重跑结果记通过，不沿用历史闭环。

## 5. 构建、真实退出与成品状态

宿主源码 0.4.13 在桌面 pack 补齐后已完成最终 `npm run build`、真实主窗口 pack/退出、平台闭环与双包重打/验证。真实构建后的 main/preload/renderer、AgentRuntime、PermissionGate 和固定 Windows fcurl 完成两阶段主窗口夹具，报告：[completed.json](../../_planning/plugin-foundation-main-2026-11-05/completed.json)。共 **21 项检查（9 + 12）通过**：

- 活动退出：真实 Agent 运行、localhost 慢 HTTP 持有 fcurl；第一次 before-quit 仍观察到子进程和私有 call 目录，主进程等待 fcurl close、目录清空后才进入第二次 before-quit/will-quit，自然 exit 0。
- 停止再退出：真实 agent.stop 后子进程关闭，宿主回执 state=cancelled、dispatched=true，并绑定 run/chat/tool-call；Agent 数为 0，再自然退出。
- 两阶段都真实排入第二条合成消息，退出/停止过程中本地模型都只收到一次请求，待发任务没有被取消完成事件重新唤醒。被观察 fcurl PID 已不存在、HTTP 连接真实关闭、errors 为空、forcedKill=false，临时 profile/ZIP 已清理。

退出链先关闭 Agent 新任务准入并暂停已有待发队列，再取消/drain 插件；清理失败不直接销毁窗口，主窗口退出状态及 Agent 准入可恢复供用户处理；已经关闭的插件 runtime 仍保持关闭屏障，可重试清理/退出，不宣称自动重新开放插件。该证据针对正常停止/退出，不是宿主被强杀、Job Object 或其他平台验证。

0.4.13 最终安装版与便携版已重新构建，并完成以下独立成品验证；另一次独立复核也通过：

- [package-verification.json](../release/v0.4.13/package-verification.json)：静态成品检查通过，匹配 28 个应用构建文件、67 个固定 runtime 资源，版本 0.4.13。
- [payload-verification.json](../release/v0.4.13/payload-verification.json)：两个 EXE 的实际 payload 各核对 77 个文件，核心 app.asar/Navora.exe 摘要与已验证构建一致。未把打包命令成功单独当作内容验证。
- [startup-report.json](../release/v0.4.13/startup-report.json)：使用隔离 profile 实际启动成品 win-unpacked，确认 0.4.13、工作区加载、errors 为空；自然 exit 0、未强制终止，profile 清理成功。

最终打包 main、真实 pack 工具夹具及两阶段退出夹具的 main.js SHA-256 均为 `9d24e6a437dfa73f8659083a3b12ed2a155e32439fe27a8ceba7ccefbd2705c5`，确认验证针对同一最终构建，没有沿用首轮产物证据。

启动证据仅针对 win-unpacked，不是运行 NSIS 安装器或 portable launcher 的端到端测试，也未替代现有用户数据迁移、其他 OS 或操作系统输入/光标行为验收。

## 6. 未实现或未验收边界及后续顺序

本轮没有实现 Cookie context、jar 事务锁/权限、逐跳 follow、profile 摘要缓存、持久状态、任意 sidecar 或 Node 原生 ABI 支持。后续先完成 F0 剩余门槛，再进入 F1/F2；不会因这次运行可靠性修复自动增加工具列表。

仍待：Windows Job Object/Unix 父死进程树回收及宿主强杀实测；Windows 私有目录 ACL、严格临时磁盘配额；磁盘满、完整文件锁/权限变化/物理断电矩阵；完整 TLS/代理/DNS/证书负例、休眠/网络切换；固定 lockfile 生产依赖 staging。直接子进程取消、目录轮询和文件 fsync 不能分别替代整树父死回收、硬磁盘配额和完整断电保证。

macOS/Linux 等能力自定义 Electron、runner、实际安装/工具/TLS/退出、签名/公证/quarantine/noexec 与正式下载链仍未验收，对应目标保持 planned。SDK/Fastls/商店发布独立于宿主修复；没有发布的内容不标为已向用户分发。
