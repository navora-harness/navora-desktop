# 插件跨平台安装与原生运行时规划

> 2026-11-06 第二批：已补 IO 恢复重试、图形恢复入口、受限 lockfile 生产依赖 staging；两项真实 Windows 文件故障、故障注入与恢复界面已有证据。完整 S1/强杀回收/跨平台认证仍未完成。当前范围以[第二批实施记录](./plugin-reliability-followup-2026-11-06.md)为准；下列首批发行证据保留原范围，本批尚未发行。


<!-- planning-completion-review:2026-11-06 -->
## 完成情况复核（2026-11-06）

**当前状态：部分完成；S1 两批已有实现，完整 S1 及跨平台交付未验收。** 本节依据现有源码、实施记录和报告复核；下文旧日期状态保留历史含义，当前完成范围以本节为准。

- [x] **已完成**｜2026-11-05—06：备份事务／启动恢复、安装忙状态、SDK 与桌面静态打包检查、运行时有界队列和正常取消／退出排空首批已纳入 0.4.13。
- [x] **已完成**｜2026-11-06：SDK 受限 lockfile 生产依赖 staging、IO 故障恢复重试和图形入口已完成源码与定向验证：插件单测 93 项、SDK 15 项、两项真实 Windows 文件故障、两种动画模式界面通过；宿主改动后续纳入 0.4.14，SDK／插件／正式商店未重发。
- [ ] **保留事项**｜真实磁盘耗尽／完整锁／ACL／断电矩阵、自动排空后升级、私有目录 ACL／硬配额、父死进程树回收和 macOS／Linux 实机及分发认证仍缺。

证据：[plugin-foundation-progress-2026-11-05.md](./plugin-foundation-progress-2026-11-05.md)；[plugin-reliability-followup-2026-11-06.md](./plugin-reliability-followup-2026-11-06.md)；[plugin-install-transaction.ts](./../electron/modules/plugin-install-transaction.ts)。
<!-- /planning-completion-review:2026-11-06 -->

> 实施：2026-11-05 开始，2026-11-06 完成本轮交付。状态：**S1 安装/运行时、SDK 及桌面 pack 首批已实施并验证；S1 完整验收及其他平台交付仍待完成**。本轮修改宿主安装事务、运行生命周期和 SDK 静态检查，未发布 SDK/Fastls 新包或认证新平台。证据与边界见[本轮实施记录](./plugin-foundation-progress-2026-11-05.md)，总体状态见[规划状态总览](./planning-status-and-next-work-2026-11-04.md)。

关联：[Fastls 功能规划](./fastls-plugin-plan.md)、[已有集成进展](./fastls-integration-progress.md)。版本基线仍为 SDK 0.2.0、Fastls 插件 0.1.0、fcurl 0.2.0；本轮宿主源码版本为 0.4.13，构建/退出夹具与成品交付结果在实施记录中分别记录。

## 1. 用户最终会得到什么

同一个插件、同一个版本可以提供不同系统和架构的安装包。商店根据正在运行的 Navora 自动选择，用户不需要理解平台包、不需要安装 Node/npm 或编译工具。安装失败保留原来的可用插件，运行被拒绝时说明原因和下一步。

平台包存在、安装器能校验、目标机器能执行、正式桌面能分发，是四个分别验收的条件。只有四项通过，才能把该平台标为“已支持”。

## 2. 已有事实与当前缺口

以下是本次对照源码与已有验证记录得到的基线，不把先前计划中的功能重复列为尚未开发。

### 2.1 已有基础机制

- `shared/plugin-platform.ts` 已提供 v2 的 artifact/target/runtime、最低宿主条件、平台匹配和歧义拒绝。SDK 与商店由 `scripts/sync-plugin-contract.mjs` 同步生成契约。
- SDK 已支持 `build/check/pack --target <artifactId>`、`build.external`、按目标复制声明的运行文件并生成 `runtime-files.json`。桌面内置 `plugin-pack.ts` 也理解 target 和文件清单。
- 商店已有 `index-v2.json` 和同版本多 artifacts；平台版本不投影至 v1；预览、更新筛选、安装复核和摘要缓存已接入平台选择。
- `plugin-package.ts` 已验证目标、运行文件摘要、完整覆盖、符号链接和 PE/ELF/薄 Mach-O 的架构；Linux static 声明已有 ELF interpreter/dynamic segment 检查；Unix 安装会对清单内的可执行文件恢复执行位。
- ZIP 安装已有同卷 staging、候选加载、旧目录和 index 备份、提交 journal、失败恢复及启动恢复入口。现行顺序允许候选拒绝时保留旧包。
- 实际运行时实现是 `fcurl-runtime.ts` 的 `FcurlRuntimeManager`，提供固定 fcurl 一次性调用，绑定插件、chat、权限与取消信号；不是尚待新建的通用运行时管理器。
- Windows 已有真实 Electron 的商店选择、预览变化拒绝、安装、请求、错误平台拒绝、失败替换保留旧包、内置打包与卸载验证。历史记录中五平台 ZIP 已生成、Linux ELF 已检查；本次不将历史执行结果改写为当前版本重新实测。

### 2.2 本轮已落地的补齐

- ZIP、全局外链切换与卸载共用保留备份的提交/回滚事务；套件替换候选失败保留旧目录、index、启用状态和外链来源。会话外链及开发热重载候选失败保留旧模块，随附更新也先校验候选。外链源工程不由宿主删除。
- package/suite 归一化互斥及 index 同步提交屏障已接入安装、链接、卸载和导出；活跃 JavaScript 执行、运行时准备及排队均计繁忙，返回 `plugin_busy`。只重载受影响 ID，其他正在执行的插件不被替换。
- journal 已严格验证 schema、字段、名称及管理目录范围；index/journal 使用临时文件、文件 fsync 和原子替换，平台允许时同步目录。回滚保留不可变备份直至整体成功；损坏记录隔离并阻止加载可能半提交的插件。已测六处子进程直接退出后重启恢复，四处再中断恢复本身；这不是物理断电认证。
- 本地 ZIP、SDK 静态包检查统一压缩 200 MiB、展开 500 MiB、10,000 条目。原先本地展开 1 GiB/50,000 条目的差异已消除。
- SDK 增加 `check --static`，build/pack 的静态验证不 require 插件；原 `check` 明确标注 Node + Electron stub 层，异平台宿主执行检查拒绝。桌面 pack 已采用同等静态规则的纯 JavaScript 解析器，随 main 交付，不执行入口、不重写 inventory/刷新资产，已独立完成单测及真实主窗口工具验证；不是直接复用 SDK helper。
- 运行时增加含准备阶段的并发预留、有界可取消队列、从入队起的总预算、可 await 的 drain/dispose、归属明确的清理失败重试；status 明示直接子进程关闭及尚不支持父死回收。可信调用身份和 checkpoint 准入见 Fastls 规划。
- macOS 已接入固定 `/usr/bin/sw_vers -productVersion`，Linux 区分 report 中明确 glibc、明确 musl loader 和未知；产品版本/libc 解释器单测通过，未在 macOS/Linux 实机验收。

### 2.3 仍不能宣称完成的部分

1. **桌面运行时仍仅 Windows x64。** 自定义 Electron 安装脚本、运行时清单及打包 pin 仍固定该产物。`dist:mac` / `dist:linux` 配置不代表有等能力目标宿主，也没有新增非 Windows 实机报告。
2. **已有受限生产依赖自动交付。** SDK 显式 `build.stageDependencies` 按 npm lock v2/v3 在独立目录收集生产/optional 闭包，禁用安装脚本，不复制开发 node_modules；已测资源/许可证、锁漂移/摘要拒绝和源码移走后的离线调用。原生依赖、安装脚本生成文件、任意动态加载和其他平台真实宿主认证仍不支持。
3. **事务故障矩阵尚未全满。** 六处受控进程退出及恢复幂等、六类 IO 故障注入、真实 Windows 索引文件占用与只读属性已验证；真实磁盘耗尽、完整文件锁/ACL 变化、断电与设备故障仍需逐项实测。当前没有版本指针或完整强断电保证。
4. **更新仍是繁忙拒绝。** drain API 与退出等待已实现，但更新/卸载没有新增“自动停止并排空后升级”交互；恢复界面已支持中文诊断、显式重试与脱敏复制。损坏 journal 保留证据并阻塞，不提供丢弃备份绕过检查。
5. **运行时支持范围未扩大。** 仍只承诺 `electron-main` 与固定 `fcurl-cli-v0.2` oneshot；没有通用原生 ABI/N-API、任意 sidecar、持久协议或热卸载认证。
6. **父进程强杀后的进程树回收未完成。** 可 await 的正常取消/close/清理不等于 Job Object 或 Unix 父死策略。未知/仍有活动所有者的临时目录保留，磁盘硬配额与 Windows ACL 验证也仍待完成。

## 3. 保持不变的设计决定

- 发布已构建产物，安装阶段只下载、检查和提交，不在用户电脑运行 npm、安装脚本或编译器。
- `suite/packageId` 表示能力变体；`artifactId` 表示该变体的系统产物。界面不要求用户把平台当套件变体来选。
- 根据实际宿主 `process.arch` 选包。Rosetta 下的 x64 Navora 仍选 x64 包，硬件是 arm64 不触发自动改选；模拟运行作为独立验收维度。
- 未声明平台的旧包保持 legacy 兼容，显示“未声明平台”，不自动认证为 portable。新纯 JS 包显式 portable；平台依赖不能借 legacy 声明绕过检查。
- Fastls 继续使用真实 `fcurl` / `fcurl.exe`、固定适配器和一次一进程。通用平台工作不引入 npm Fastls/Koffi、不实现 fcurl 本身。
- 列表、预览、ZIP 静态检查、平台选择不执行插件入口。授权安装后的受控健康检查与实际调用分别记录。
- 插件仍属于高信任扩展。权限门约束宿主提供的 API，独立进程用于生命周期和故障隔离；二者都不构成任意第三方代码的操作系统沙箱。

## 4. 平台契约与系统探测完善

### 4.1 以已实现类型为准

v2 插件清单已经包含 `packageFormatVersion: 2`、`artifactId`、`target`、`runtime` 和可选 `minHostVersion`。target 为 portable，或指定 win32/darwin/linux、x64/arm64，附 Linux linkage/libc 与最低版本约束。当前 runtime 为 electron-main，或固定 fcurl oneshot 适配器。

后续新增字段必须先进入共享类型、SDK、商店、契约样例，再对外使用。不得只修改文档就让旧宿主忽略一个新的必需运行条件。需要扩展能力时用新的宿主最低版本和明确的契约版本边界。

`runtime-files.json` 覆盖所有运行文件，逐项记录路径、大小、SHA-256 和必要执行位；清单本身由 ZIP 摘要覆盖。摘要证明内容一致性，不等于作者身份签名。商店目录、下载源信任与代码签名分开记录。

### 4.2 已接入的探测与待验收规则

- Windows：固定 OS 版本/构建号字段的语义，区分最低系统要求与当前定制 Electron 的实际支持范围；不能只依据 Windows 产品名称匹配。
- macOS：已通过固定路径 sw_vers、1.5 秒及 4 KiB 输出预算读取产品版本，不拿 Darwin 内核版本替代 minOsVersion；无法满足必要探测条件返回 `platform_detection_failed`。实际 Mac runner 与分发验证仍待完成。
- Linux：已分开记录内核与 libc；只接受 process report 的 glibc 版本或明确 ld-musl 共享对象证据，未核实的 musl 版本保持未知。动态包按必要条件拒绝。static 包仍需目标机器上的内核、执行位/noexec 和宿主分发验收。
- 架构：安装和加载均由主进程独立探测，不信任渲染端提交值。迁移用户数据到另一系统后重新匹配，不直接加载原来的二进制。
- 静态/动态：static Linux 包禁止 libc 声明，必须有 ELF 证据；动态包必须声明已核实的 libc。Mach-O universal/fat 如有需求，先扩展验证再发布，目前不能当作已可识别。

兼容选择维持平台包优先 portable、匹配的 libc 专属包优先 static、同优先级多候选拒绝。当前实现并不按所有最低版本约束建立完整偏序；第一阶段保持拒绝歧义，不额外引入多个同优先级重叠包来碰运气。

## 5. SDK、依赖与产物准备

### 5.1 分开三类检查

1. **静态检查**：只检查 manifest、路径、完整清单、依赖闭包、二进制格式/架构、目标声明与摘要，不 require 入口、不启动二进制；可在非目标系统执行。
2. **宿主加载检查**：在目标 Navora 的真实 Electron 中验证模块导出与宿主 API；不能用 SDK 的 Node stub 替代。
3. **运行健康检查**：在已授权安装的目标机器上执行受控版本/能力查询与最小本地用例，记录实际运行结果。非目标机器的“未执行”不得显示为通过。

SDK 已提供显式 `check --static`，build/pack 使用静态检查；原 `check` 保留 Node + Electron stub 导出检查并标注层级，异平台不假执行。桌面内置 pack 已移除 require 入口及 pack 重写 inventory/刷新资产的步骤，采用随 main 打包的纯 JavaScript parser 和 Node 静态 resolve，检查可见字面 require/import 及传递引用；无需外部 SDK/Node 进程，不将 SDK helper 引入成品。这种静态检查不是任意动态行为认证或操作系统沙箱。桌面 plugin_build/check 后的受信候选外链加载仍可执行插件，不能泛化为全部工具路径零执行。真实 Electron 加载和目标运行仍独立验收。纯 JS 未声明 targets 的现有工程暂仍按旧格式构建，不自动转 portable。

### 5.2 依赖闭包

- 作者显式声明需保留目录结构的生产运行依赖；构建机在独立 staging 按固定 lockfile 收集完整闭包，保留合法包元数据与目标需要的 optional dependencies。
- `external` 仅表示不打进 bundle，不能视为依赖已经随包带上。包内字面/传递依赖检查仍拒绝缺失、父级 node_modules 逃逸、不可静态核实加载与 `.node`。11-06 已补 SDK 显式 lockfile staging，保留生产/optional 依赖、资源和许可证，记录锁摘要；仅对应 OS/架构 runner 构建，portable 拒绝平台限制依赖。Windows 离线合成夹具已通过，其他目标 Electron/分发认证仍待完成。
- `--include-node-modules` 保持旧兼容，不作为新生产包的默认方案；禁止复制整份 Windows node_modules 后改名发布到 Linux。
- 原生依赖需使用目标 runner 和实际定制 Electron 的头文件/ABI。未来支持 N-API 也仍需检查 OS、架构和外部库；ABI 数值匹配只是必要条件。[Electron 原生模块文档](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)说明了 Electron ABI 与普通 Node 的差别及定制构建头文件要求。
- 进程内原生支持单列后续里程碑。未完成契约、实机和重启切换前，不承诺热卸载或仅清 require.cache 即可更新。

Fastls 的五个平台运行文件由其固定发布版本和收集脚本准备，附上游来源、许可证、产物摘要和 Linux 静态检查证据。交叉组装五个 ZIP 仅完成静态产物准备；不得因此跳过各目标机器执行。

## 6. 商店与安装流程补齐

### 6.1 已有协议继续使用

- v2 路径为 `plugins/<id>/<version>/artifacts/<artifactId>/package.zip`，同目录维护说明和内部元数据；唯一键含 kind/packageId/version/artifactId。
- 同版本不同平台共存；正式相同键保持不可变，修复发布新版本。suite 保留原有产品变体语义。
- 客户端优先 v2，仅明确不存在才回落 v1；无效目录、摘要错误、网络失败不得静默降级。缓存与 ETag 按端点隔离，产物缓存按内容摘要隔离。
- 预览显示实际 artifact 和安装计划，安装重新匹配并核对 `installPlanKey`；目录变化刷新预览，不擅自装另一产物。自动更新只提示当前机器可安装的版本。

### 6.2 共同事务边界与后续故障矩阵

1. **已实现互斥**：package/suite 归一化锁和 index 提交屏障覆盖提交、卸载、替换、外链切换与导出；状态及冲突在同步提交边界内复核。下载仍可在锁外进行。
2. **已实现候选优先**：全局 ZIP/外链候选失败不先删旧包或套件；会话外链、随附同步与开发热重载保留已加载模块。全局外链拒绝把宿主管理目录当作开发工程，避免混淆目录所有权；卸载外链只改 index，不删除源工程。
3. **已实现繁忙拒绝**：活跃插件执行、runtime 准备和排队均阻止受影响 package/suite 切换。新执行在权限等待返回后再次核对模块身份，防止旧批准执行已被替换的入口。尚未新增自动排空升级流程。
4. **已实现可重入恢复**：journal/schema/路径严格验证，index/journal 原子文件写及 fsync，不可变备份贯穿回滚；提交后清理失败不回滚成功安装。IO 故障保留事务供解除故障后重试，损坏 journal 隔离并保留诊断，阻止半安装加载。恢复界面及两项真实 Windows 文件故障已测；真实磁盘耗尽、完整文件锁/ACL 与断电矩阵仍待补齐。
5. **已取得局部证据**：旧版启用状态、套件同伴、链接来源、候选及迟发加载失败、JavaScript 执行繁忙、同步重入、Windows junction 和六处进程终止恢复通过。标准用户安装、所有 Windows 文件锁与故障清理格按后续报告填写，不能合并成整项通过。
6. **已统一 ZIP 预算**：压缩 200 MiB、展开 500 MiB、10,000 条目，本地导入与 SDK/商店保持较严格上限。目录穿越、符号链接、大小写冲突与超限拒绝；执行位只应用于已校验清单路径。真实合规产物需要扩容时统一评估所有入口，不单独放宽。

进程内原生插件未来必须走 pending + 重启切换；sidecar 则等待自有进程退出后替换。版本化目录/指针是否引入，在文件锁和硬中断用例暴露现有目录切换不足时实施；不把当前 journal 描述为已经采用版本指针。

## 7. 运行生命周期与权限边界

继续在当前 FcurlRuntimeManager 上补可靠性，不为本批先重写一个支持所有协议的通用管理器。

- 受控方法仍由适配器生成参数；插件不能提交任意 exe、argv、shell、环境变量或其他 chatId。每次调用绑定 plugin/artifact/chat/权限/AbortSignal。
- 状态与 profile 查询使用 compute.local，请求使用 network.request；安装可执行权限与每次网络调用权限分开。权限拒绝、白名单撤销、会话关闭、停用和应用退出要在所有目标平台验证。
- 已有全局 16/单 chat 4 个准备或执行预留及全局 32/单 chat 8 个等待项；request 输入验证后开始统一截止时间，覆盖排队、准备、子进程和清理。cancelAndWait/drain/dispose 等待 close 与清理，清理失败可见并允许重试；父死进程树回收另验。
- 已保留并固定宿主启动时 SSL_CERT_FILE/SSL_CERT_DIR 快照，校验绝对路径和文件/目录类型；结果标注 system/environment_custom，非法配置明确拒绝。仍待完整 TLS/代理及跨平台证书矩阵；不继承 NODE_OPTIONS/NODE_PATH、动态库注入变量或任意密钥，不关闭 TLS 验证。
- 包目录与临时运行目录分开；Unix 校验临时目录和敏感文件权限，Windows 验证实际用户目录访问控制。凭据、Cookie、完整认证头和响应敏感内容不进入诊断。
- 正常退出等待自有调用结束/回收，再完成应用退出。父进程被强杀另做 OS 级方案：Windows 验证 Job Object 的归属与 kill-on-close；Unix 验证进程组和独立监护/父死处理方案。先用测试辅助程序证明归属和回收，再接 fcurl；不按进程名称清理其他应用的进程。
- 验证取消、超时、直接崩溃、产生子进程、父进程强杀、启动尚未完成即取消、PID 重用和残留临时目录。仅有 fcurl 自身 timeout 不算通过父死回收。

[Node 子进程文档](https://nodejs.org/api/child_process.html#subprocesskillsignal)提醒信号发送与进程退出并非同一状态；[Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)提供按自有进程组管理的机制。以上是待实现方案依据，不是当前已具备的保障。

## 8. 目标平台准备与分发条件

### 8.1 Windows x64：保住现有可用链路

使用当前固定定制 Electron 和 fcurl 产物先补故障矩阵。测试安装版与便携版、标准用户、含中文/空格路径、外链和商店安装；验证应用升级后既有插件仍正确加载。SmartScreen/防病毒或组织策略拦截给出实际原因，不建议用户关闭系统保护。代码签名与内容摘要分别记录，不把没有安全提示作为内容完整性证据。

Windows arm64 虽能出现在通用 target 中，但 fcurl 0.2.0 当前清单无原生包；不默认借 x64 模拟扩展支持范围。

### 8.2 macOS x64 / arm64：先有真实宿主，再认证插件

- 获取具有本项目所需浏览器/自动化能力的对应定制 Electron，建立每平台固定版本、归档摘要、资源清单和 executable 路径验证；不能未经验证静默替换成普通 Electron。
- 将安装脚本、运行时验证、打包 electronDist 与 smoke runner 从 Windows 路径分支中拆出，保留现有 Windows pin 和完整性检查；在对应 Mac 上完成应用启动与核心浏览器用例。
- 分别验证 Intel 和 Apple Silicon 的原生宿主；Rosetta 如要支持，单列为 x64 宿主用例。先保持分架构包，universal 为后续独立工作。
- 验证下载后的应用与可执行插件的签名、quarantine/Gatekeeper、权限、安装位置、更新与回滚。下载型插件不因主应用已公证而自动获得同等分发认证。
- 正式外部分发完成签名、公证及实际下载链测试；不自动清除 quarantine、不要求关闭 Gatekeeper。[Electron 签名文档](https://www.electronjs.org/docs/latest/tutorial/code-signing)将 macOS 的签名与公证分为两个发布步骤。

### 8.3 Linux x64 / arm64：宿主依赖与插件依赖分别验收

- 同样先取得对应定制 Electron 与真实包，在已选发行版上运行。最低内核、glibc、图形/桌面依赖、证书包、沙箱要求以最终宿主产物和干净系统测试确定，本规划不编造通用最低版本。
- 第一批选择有目标 runner 的 glibc 桌面发行版，按最终声明的最低版本与一个较新版本验收 AppImage/deb。arm64 使用 arm64 环境；容器静态检查不能替代真实桌面宿主。
- fcurl 的 static 声明只说明该二进制经 ELF 检查无动态 libc 依赖；不说明整个 Electron 桌面可在 musl/Alpine 运行。musl 宿主支持另立条件，当前不承诺。
- 验证 noexec 数据目录、失去执行位、只读安装目录、缺证书、系统沙箱与用户目录权限。无法执行时给出可理解原因及受支持的目录选择，不自动绕过挂载/沙箱策略。

## 9. 界面和诊断

保留简洁流程：商店自动选平台，详情展示所选目标和运行时；不兼容版本说明“系统不支持 / 架构不支持 / 需更新 Navora / 无法确认系统条件”。五个平台产物的存在不作为五个平台已认证徽标。

安装前显示候选目标与替换对象；失败保留原状态。更新遇请求活跃可提示停止后重试，重启才能生效的原生更新明确显示“待重启”。诊断可复制，但默认不含凭据和私有请求内容。

已补 `install_recovery_required`、`install_rollback_failed`、`plugin_link_managed_path` 的中文处理提示。统一现有错误码语义及中文映射，不另造同义码：现有 `host_too_old` 继续用于宿主过旧；其余包括 unsupported_platform/unsupported_arch/unsupported_libc/platform_detection_failed、os/kernel/libc_version_too_low、runtime_*、plugin_busy、install_plan_changed、install_rollback_failed。新增 noexec/权限/签名/原生重启错误时，保持机器码稳定、中文处理动作明确，区分内容损坏与环境拒绝执行。

## 10. 实施顺序、交付物与门槛

### S0：冻结基线并落实目标环境

核对并记录运行时、SDK、商店与 Fastls 的实际版本/摘要；确认 macOS/Linux 定制宿主是否有可用产物与目标测试机。输出目标环境清单、宿主分发阻塞与本次可执行范围。缺少目标宿主时只推进通用可靠性与静态包检查，该平台保持 planned。

### S1：先补 Windows 可直接验证的基础可靠性

**首批已落地，S1 尚未整体验收。** 共同候选/回滚、package/suite 忙状态、journal 进程终止恢复、SDK 静态检查分层、runtime 排队/drain 已有首批证据，0.4.13 首批已打包验证。11-06 新增受限生产依赖 staging、可重试 IO 恢复、图形恢复入口、六类故障注入与两项真实 Windows 文件故障；本批源码/构建/界面通过，未重新发行。剩余门槛为真实磁盘耗尽/完整文件锁/ACL/断电矩阵、父死自有进程树、私有目录/硬配额、升级排空及各目标干净环境；不得以正常取消或注入测试填满真实故障与跨平台认证。

### S2：并行准备 macOS/Linux 宿主与平台探测

在 S0 已有真实环境的目标上适配 pin/安装/打包/runner，补 OS/libc/架构探测和平台错误。每个平台先完成宿主启动、浏览器/文件/对话基本用例，再验证插件，避免把宿主缺陷误归于 fcurl。各平台单独通过，不互相阻塞 Windows 维护。

### S3：目标平台插件闭环与正式分发

用同一套本地服务器夹具执行下一节全部必需格；检查安装版、实际下载链、签名/执行位/证书/noexec，生成每目标独立证据。只对通过的平台发布支持声明。商店多产物可以预备，但未认证目标保持计划状态或按明确测试渠道交付。

### S4：承接 Fastls 第二批功能

平台事务/进程边界稳定后，按[Fastls 专项规划](./fastls-plugin-plan.md)实施 Cookie context、逐跳自动跳转等能力；Windows 功能迭代可先行，其他系统通过各自回归后才扩大声明。平台工作不承诺持久 Session、浏览器 Cookie/连接复用、任意 sidecar、进程内原生 ABI 或 HTTP/3。

## 11. 验收矩阵与证据要求

矩阵的环境轴为 Windows x64、macOS x64、macOS arm64、Linux x64、Linux arm64；每个环境记录宿主 OS/版本/架构、Electron pin、插件 artifact/摘要、安装形式与权限。下面的用例轴逐项填“通过 / 失败 / 未执行 / 不适用”，未执行不能合并成通过。

- **E0 宿主前置**：固定产物完整性、打包启动、真实浏览器与文件标签、标准用户运行；没有对应宿主则后续运行格均未执行。
- **E1 静态选包**：legacy/portable/平台/套件、错误 OS/arch、未知 libc、最低版本、歧义、静态 ELF/PE/Mach-O、执行位与缺文件/错摘要；跨架构缓存不混用。
- **E2 商店协议**：同版本多产物、v1 隔离、v2 明确不存在才回落、错误目录不回落、安装计划变化拒绝、不兼容新版不误提示。
- **E3 安装入口**：商店、本地 ZIP、全局外链、会话试用、随附同步、开发热更新；正确目标可以加载，错误目标在加载前拒绝。外链不删除用户工程。
- **E4 恢复与并发**：下载/解压/健康检查/提交/写 index/提交标记/清理阶段注入失败或强杀；磁盘满、Windows 文件锁、同 package 与同 suite 竞争、取消和重启恢复。检查旧版本、启用状态、同套件成员、链接和 index 一致。
- **E5 权限与运行**：status/profiles/本地 HTTP(S)、重复头、错误码、权限拒绝、URL 白名单与撤销、中文/空格目录、离线安装、无系统 Node/npm。
- **E6 生命周期**：取消/超时/停用/卸载/更新准备/chat 结束/正常退出/父强杀/辅助子进程；检查实际进程退出、并发槽释放与敏感临时文件清理。
- **E7 系统差异**：macOS 产品版本、双架构及下载签名/quarantine；Linux libc/内核、noexec、执行位和证书；Windows 标准用户/文件锁/安全策略。不适用格需写理由。
- **E8 回归**：既有纯 JS 和套件插件、当前 SDK 三个命令、桌面内置打包、商店发布/重建/下架/快照恢复；不能为平台插件破坏旧生态。
- **E9 正式交付**：安装与更新后的成品实测，产物摘要/来源/许可证完整、目标支持标识准确，诊断脱敏，恢复步骤可执行。

现有快速入口保留：桌面 `npm run test:plugins:platform`、共享单测、商店 `node --test test/publish.test.js test/platform.test.js`。现有平台 smoke 可验证临时商店闭环，但单个 Windows 执行与生成五个平台 ZIP 都不能填满整个矩阵；新增 runner 必须去除 Windows 唯一假设。

每次结果保留结构化报告、必要截图/进程证据、命令与退出码、失败注入阶段、清理结果和真实平台信息。历史进展、当前源码检查和本次实机执行分栏记录。支持声明只有在 E0–E9 的目标必需项全通过后更新。

## 12. 改动范围与本轮实施边界

后续实施主要落点：

- 宿主分发：`package.json`、`scripts/install-cloudbypass-electron.mjs`、`electron-runtime-{manifest.json,release.mjs}`、目标 smoke runner。
- 契约/SDK：`shared/plugin-platform.ts`、`shared/plugins.ts`、`scripts/sync-plugin-contract.mjs`、SDK 的 lib/bin/类型/SPEC 与依赖 staging。
- 商店：共享 store 契约、`marketplace-client.ts`、navora-store 的 inspect/catalog/ingest/protocol 与发布脚本。
- 安装/运行：`plugin-package.ts`、`plugin-store.ts`、`plugin-install-transaction.ts`、`plugin-pack.ts`、`fcurl-runtime.ts`、全局及会话外链/随附入口和对应测试。
- 界面：商店兼容信息、插件导入/更新的忙状态与恢复反馈、开发检查结果分层和诊断映射。

本轮已进入 S1/F0 实施，具体代码、可重跑测试与未执行项见[实施记录](./plugin-foundation-progress-2026-11-05.md)。后续仍按 S0–S4 的剩余门槛逐批验收；源码、Windows 构建、插件发布和其他平台认证分别记录，不能以文档更新或 Windows 成品打包作为跨平台完成证据。
