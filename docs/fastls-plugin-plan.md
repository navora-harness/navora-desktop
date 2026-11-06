# Fastls 插件与 fcurl v0.2.0 集成规划

<!-- planning-completion-review:2026-11-06 -->
## 完成情况复核（2026-11-06）

**当前状态：部分完成；F0 首批已交付，完整 F0／F1／F2／F3 未验收。** 本节依据现有源码、实施记录和报告复核；下文旧日期状态保留历史含义，当前完成范围以本节为准。

- [x] **已完成**｜2026-11-05—06：三个现有工具及 F0 首批可信调用身份／回执、受阻任务准入、有界队列、统一预算、正常取消与退出 drain 已纳入 0.4.13；未重发插件或 SDK。
- [ ] **保留事项**｜Cookie context／串行 jar、安全逐跳、TLS／代理／DNS／证书完整负例、休眠／网络切换、父死进程树回收与其他平台实机认证仍保留。

证据：[plugin-foundation-progress-2026-11-05.md](./plugin-foundation-progress-2026-11-05.md)；[fastls-integration-progress.md](./fastls-integration-progress.md)；[fcurl-runtime.ts](./../electron/modules/fcurl-runtime.ts)。
<!-- /planning-completion-review:2026-11-06 -->


> 2026-11-05–06 实施更新（11-05 开始，11-06 完成本轮交付）：**F0 基础可靠性首批已落地，Cookie context、逐跳 follow、完整 F0 验收及其他平台认证仍待完成**。当前工具仍只有 `fastls_status`、`fastls_profiles`、`fastls_request`。本轮补可信请求身份/回执、受阻任务准入、有界队列与统一预算、异步 drain/关闭、明确证书来源及固定来源链检查；未实现 Cookie 状态或父进程强杀后的进程树回收。证据见[本轮实施记录](./plugin-foundation-progress-2026-11-05.md)。

原规划日期为 2026-11-01，本轮于 2026-11-05 开始、2026-11-06 完成交付。SDK 0.2.0、Fastls 插件 0.1.0、fcurl 0.2.0 的发布版本不变，未重新发布插件或商店产物；宿主源码版本为 0.4.13。历史基础闭环见[集成进展](./fastls-integration-progress.md)，通用机制见[插件跨平台安装规划](./plugin-platform-installation-plan.md)。

下文区分现有接口、当前实现和后续设计。带有“计划”“后续”的 context/follow 描述不属于现有工具；第 10 节记录本轮事实及剩余边界，第 11–15 节规定后续契约与验收门槛。上游保持固定 v0.2.0，不切换 latest。

## 1. 固定基线与方案

插件 ID 为 `fastls`，显示名为 Navora Fastls，首版计划版本 `0.1.0`；集成 `FastTLS/fastls-curl v0.2.0`，可执行文件名为 `fcurl` / `fcurl.exe`。版本独立管理，升级二进制需要重新验证和发布插件，不跟随 latest 自动换字节。

调用关系固定为 `Agent → 插件纯 JS 入口 → 宿主 runtime 适配器 → 单次 fcurl 进程`。无需 Node/Koffi、常驻服务、RPC 端口或自建 Go worker。请求之间没有 TCP/TLS 连接池复用；上游 CLI 可以通过文件延续 Cookie，Navora 的受控 Cookie context 仍待 F1 接入，不能据此宣称已有长期 Session。

上游标签提交为 `64311a379d38fb57f0f700ea1256e0769afdb93e`。Windows 发布包实测版本输出为 `fcurl 0.2.0 (fastls 0.2.1; imitate 0.1.2)`，因此不能把 CLI 版本号当作其底层核心版本号。

资料以固定标签为准：[正式 Release](https://github.com/FastTLS/fastls-curl/releases/tag/v0.2.0)、[CLI 兼容契约](https://raw.githubusercontent.com/FastTLS/fastls-curl/v0.2.0/COMPATIBILITY.md)、[选项实现](https://raw.githubusercontent.com/FastTLS/fastls-curl/v0.2.0/internal/cli/options.go)、[执行实现](https://raw.githubusercontent.com/FastTLS/fastls-curl/v0.2.0/internal/cli/run.go)、[0.2 功能说明](https://raw.githubusercontent.com/FastTLS/fastls-curl/v0.2.0/DEVELOPMENT_V0.2.md)、[打包实现](https://raw.githubusercontent.com/FastTLS/fastls-curl/v0.2.0/scripts/package.py)。[上游调用规划](https://raw.githubusercontent.com/FastTLS/fastls-curl/v0.2.0/INVOCATION_PLAN.md)中的未来接口不当作现成功能。

## 2. 发布物与平台映射

固定下载前缀为 `https://github.com/FastTLS/fastls-curl/releases/download/v0.2.0/`。发布包与 Navora 目标映射如下：

- `fcurl-0.2.0-windows-amd64.zip` → `win32-x64`；归档摘要 `4d7572d8412685f0f05735232be308288c7c1973c429c866337c940083071e9f`。
- `fcurl-0.2.0-darwin-amd64.tar.gz` → `darwin-x64`；归档摘要 `573e7df8f5fed4785f3b339b561fb6091a3541d9524b2067463eeed3ac0c7b9b`。
- `fcurl-0.2.0-darwin-arm64.tar.gz` → `darwin-arm64`；归档摘要 `a7bfba1beef5d5876d5043fa7272f847043ef8a381bacd1f6a9638bcb68789b3`。
- `fcurl-0.2.0-linux-amd64.tar.gz` → `linux-x64`；归档摘要 `594fd42028340d5a66efda6d674c94c7c48994a552ea1591a5f33050b35a5de1`。
- `fcurl-0.2.0-linux-arm64.tar.gz` → `linux-arm64`；归档摘要 `03f02bc87ec198efae41d875d30d0129f89ae3b6ee4cac0f688cee690b68c501`。

构建阶段核对 `SHA256SUMS`、归档内部 `BUILD.json` 中 binary_sha256、source_commit、target 与版本，并保存 RELEASE.json / SOURCE_VERIFICATION.json 来源记录。归档摘要、二进制摘要和重新封装后的插件 ZIP 摘要分别记录，不能混用。同一版本下载到不同摘要立即失败，不自动覆盖固定清单。

打包脚本使用 CGO_ENABLED=0。历史验证已检查两个 Linux 正式二进制：ELF 机器类型分别为 x86-64/AArch64，均无 PT_INTERP / PT_DYNAMIC；因此目标声明 linkage=static，不附 glibc 下限。该检查不等于 Linux/musl 实际运行认证；最低内核、系统证书和宿主分发条件仍列入平台验收。Windows arm64 不在该版本正式产物中。

面向用户的正式可用声明必须等各目标宿主验证通过。现有本机商店已保留五个目标的历史发布包，这只证明能组织和下载这些产物；不能据此追认 macOS/Linux 已认证。后续正式渠道须区分已验证目标与测试产物，未通过验收的目标不展示成“本机可用”。macOS 需要实际签名、公证与 quarantine 验证，不能因上游提供 tar.gz 就视为完成桌面分发认证。Windows 普通用户、中文/空格路径和 Linux noexec 均有专门用例；不得自动清除系统保护。

还有宿主前置条件：当前 Navora 自定义 Electron 安装脚本只接收 Windows x64。`dist:mac` / `dist:linux` 脚本和五平台插件声明不代表已经存在等能力的对应桌面运行时。其他目标先通过通用规划的宿主运行时与分发门槛，再进行 Fastls 安装和工具验收；不能用单独运行 fcurl 代替 Navora 实机验证。

## 3. 能力范围与首期交付

第一批交付 `fastls_status`、`fastls_profiles`、`fastls_request`，覆盖一次性 HTTP/HTTPS 请求、profile、无凭据代理、请求正文、响应解析、超时与取消。可选 JA3/TCP JA4R 在同一请求工具通过互斥指纹字段接入；profile 不传时保持 CLI 原生默认行为，不暗中选择某个浏览器。

第二批增加按 chat 隔离的 Cookie 上下文和宿主逐跳重定向。这不需要上游常驻会话。浏览器 Cookie、UA、代理和网络规则不自动继承。

首期不开放任意 CLI 字符串、任意输出/输入文件路径、-k、自动 -L、含凭据代理 URL、任意 CA/profile 文件或环境代理。后续可按明确权限接入受控文件和认证代理。Header 文件已足以传 Basic/Bearer Authorization，不要求命令行出现凭据。

当前版本没有可依赖的 metadata JSON/write-out、HTTP/3、多 URL/批处理、multipart、重试、断点续传或持久进程接口。SSE/WebSocket 和原生 session_* 工具不属于本插件首版承诺。

## 4. 工程与包结构

现有源码项目为 `navora-plugins/fastls/`，入口和工具 schema 集中在 `main.ts`，另有 plugin.json、package.json、README.md 与 scripts/collect-fcurl.mjs；当前没有 src/tools.ts、src/validation.ts、src/result.ts 或 src/cookie-context.ts。结构化校验、输出解析与进程生命周期实际位于宿主 `electron/modules/fcurl-runtime.ts`，安装完整性检查位于 `plugin-package.ts`。后续可拆分这些宿主模块，并新增宿主管理的 Cookie context 服务；不让纯 JS 插件掌握 jar 路径，也不在插件中另写全局 ChildProcess 管理器。

平台 ZIP 根目录包含纯 JS `main.cjs`、plugin.json、README、runtime-files.json、`bin/fcurl[.exe]`，以及 `vendor/fcurl/` 下的 BUILD.json、发布来源记录、LICENSE/NOTICE 和 third-party 许可树。保留二进制原始字节；不附带用户机器需要运行的 npm 安装步骤。

manifest 的 runtime 为 `executable-sidecar`，executable 指向 bin/fcurl，binaryVersion 为 0.2.0，invocation 为 oneshot，adapter 为 `fcurl-cli-v0.2`，protocolVersion 为 Navora 适配契约 1；该版本号不是虚构的上游 RPC 版本。Windows executable 使用 .exe。目标 OS/arch/linkage 来自固定产物映射。

构建脚本只拉取固定清单中的归档，在 staging 校验后压包。原始归档不进入用户插件包，许可和来源材料需要保留。跨平台可组装包，但发布前必须在真实目标环境调用已封装的二进制。

## 5. 工具输入与 CLI 映射

### fastls_status 与 fastls_profiles

status 调用包内 `--version` 并核对预期版本、平台及运行文件完整性；当前返回 version、artifactId、capabilities、trustSource/trustConfiguration，以及 processCleanup=direct_child_close、parentDeathCleanup=false。计划仍需补全插件版本和二进制摘要，不能从版本猜测支持 context。profiles 调用 `--list-profiles`，按行解析，支持关键词/分页，默认 50、最大 200 条；当前每次都会启动进程，“按二进制摘要缓存”尚未实现。缓存键计划包含运行文件摘要，更新/重新启用时失效，不把全部 profile 塞入工具 schema。两者使用 compute.local，不联网。

### fastls_request

参数包含 URL、method、headers、query、互斥的 bodyText/bodyBase64/json/form、可选 profile/ja3/ja4r、proxy、timeoutMs、responseMode。method 默认为 GET；携带正文时无显式 method 默认 POST。HEAD 拒绝正文。headers 采用有序键值列表而非单值对象，保留重复值；另以显式字段表示删除默认头或发送空值，不让模型手写 curl 特殊语法。

- method → `--request`；HEAD 使用 `--request HEAD`，不用会把响应头写到正文通道的 `-I`。
- 普通/空/抑制请求头 → 宿主生成的私有头文件，参数固定 `--header @<file>`。校验头名及 CR/LF/NUL，拒绝传输层保留字段。工具不得传入 @路径作为头部展开指令。
- bodyText/bodyBase64/form → 精确字节经 stdin，使用 `--data-binary @-`；form 由适配层编码并设置 Content-Type。json 在适配层序列化并设置 JSON Content-Type/默认 Accept；当前同样使用 `--data-binary @-`，不是 `--json`。对 JSON 值进行输入预算、序列化失败与 schema 校验，不依赖 CLI 校验 JSON。
- query → 适配层编码后合入最终 URL，保留原有查询及重复键；不再用 -G 改写请求方法。最终 URL 必须在合并后再校验。
- 指纹 → `--profile` / `--ja3` / `--ja4r` 三选一；拒绝 H3 q 前缀。自定义文件型 Spec 留给有文件权限的后续版本。
- 无凭据代理 → `--proxy`；timeoutMs 转为十进制秒 `--max-time`，另设 `--connect-timeout`，不传 0 表示无限等待。

固定使用 `-sS --dump-header <private-header-output>`，stdout 只收正文，stderr 单独有界消费。未使用的 stdin 立即关闭。有正文时 stdin 归正文所有；头文件读取独立私有文件，不同时使用 `-H @-`。认证头在头文件中传递，不用 -u/--oauth2-bearer 暴露到 argv。

不使用 --fail 或 --fail-with-body，由适配层依据 HTTP 状态给出 httpOk，避免把正常 404 混同传输失败。URL 查询仍会进入进程参数，因此不能承诺对本机进程检查完全隐藏 URL；诊断与界面中的参数必须脱敏。

## 6. 输出解析与错误归一

stdout 作为 Buffer 增量读取，不能直接按 UTF-8 无条件转成字符串。头文件在进程关闭、写入完成后解析；识别状态行与 CRLF/LF、1xx 及多个头块，选择最终非 1xx 响应，重复字段保留数组。头部是 CLI 重建结果，不能标为原始线上大小写或顺序。

没有 metadata 接口时，manual 模式 finalUrl 就是该次实际请求 URL；将来逐跳模式由宿主维护 URL 链。协议来自状态行，耗时只记录本地总耗时；不解析 stderr 的 -v 来伪造 DNS/TLS 分段或完整机器元数据。

返回结构为 `ok`（执行完整）、`httpOk`（200–299）、status、finalUrl、httpVersion、headers、body、bodyEncoding、bodyBytes、truncated、elapsedMs、exitCode；失败时增加结构化 error 与可选 partialResponse。响应未完整读取时 ok=false，不能把半截正文作为成功 JSON。

宿主自身终止原因优先：cancel/timeout/response_limit/output_error；然后结合原始退出码区分 CLI 参数、URL、DNS、连接、写出、输入、TLS、接收和取消错误。保留原始 exitCode/signal 供诊断，Windows 强制终止不强求等于上游的 130。HTTP 状态与进程码分别判断；无法解析必要状态行时返回 response_parse_failed。

映射基线为：1/2/3 → 不支持协议、参数错误、无效 URL；5/6 → 代理/目标 DNS；7 → 连接；23/26 → 输出/输入；28 → 超时；35/60/77 → TLS 握手、证书验证、CA；47/56/130 → 跳转上限、接收、取消。22 仅在使用 fail 策略时出现，当前适配器不主动启用该策略；未知码统一 cli_failed 并保留原始值。代理认证或隧道拒绝可能归入 7，不能仅凭该码断言密码错误。

当前 stderr 仅计数并有界消费，不保存或回显原始诊断；未来诊断若保留摘要，必须先脱敏。上游超时信息可能包含完整目标 URL。当前响应头中的 Set-Cookie/Authorization/Proxy-Authorization 已遮蔽，但 finalUrl 及工具参数仍可能包含 URL 查询项，不应宣称所有层已完成敏感 URL 脱敏。后续统一工具展示、运行记录、异常和可复制诊断的脱敏；Authorization、Cookie、Set-Cookie、代理密码及 URL 敏感查询项均不得进入普通诊断。Cookie 显式读取功能另受凭据读取权限约束。

## 7. 请求预算与进程生命周期

当前每 chat 最多 4 个、全局最多 16 个准备或执行预留，status/profiles 同样占额度；增加全局最多 32、单 chat 最多 8 个等待项，队列溢出返回 resource_limit。已实现可取消调度与基于 performance.now 的截止时间：request 输入校验后、入队前起算，排队、运行文件校验/建目录、进程和清理使用同一预算；request 默认 30000、范围 1–120000 毫秒，status/profiles 使用 10000 毫秒。CLI max-time/connect-timeout 只得到剩余预算，连接时间不超过 10 秒。将来的 Cookie 锁等待和多跳仍需接入同一预算，不算作当前已支持。结果等待 stdio close 及 staging 清理后才产生可信回执。

输入正文限制 1 MiB；stdout 传输正文限制 8 MiB；返回模型的正文限制 64 KiB；stderr 32 KiB；响应头解析预算 64 KiB。stdout 超限立即停止并终止进程，不先缓存完整响应；并发缓冲计入总内存预算。头文件大小监控用于尽早终止，但轮询存在瞬时超额，不能宣称为严格磁盘配额；临时目录总量/数量与严格磁盘配额仍需独立实现；启动只清理已核实无活动所有者的目录，不能用过期时间代替所有权判断。

第一批不传 --compressed，默认补 `Accept-Encoding: identity`（用户显式头优先）。如果服务器仍返回编码正文，保留编码并以 base64 返回；不能把压缩字节直接当 JSON/text。后续解压通过宿主有界流实现，并单独限定解压后字节数；zstd 等仅在实际运行时支持并通过测试后开放。CLI 核心默认解码预算不能冒充插件可配置的 8 MiB 硬内存限制。

64 KiB 为工具展示上限，完整传输在 8 MiB 内可以成功并标记 truncated；UTF-8 截断保证字符边界。json 模式只有完整、未截断、无未处理 Content-Encoding 时才解析为 JSON，否则返回片段/编码信息而不声称得到完整对象。

停止 Agent/停用按所属调用取消；更新/卸载仍在活跃时返回 plugin_busy，不自动强停升级。已提供 cancelAndWait/drain/dispose：关闭屏障拒绝新调用，等待直接子进程 close、文件释放及清理；清理失败可见、可重试，关闭屏障不会因失败重新开放。删除 chat 可使用按 chat 等待接口，正常退出接入宿主退出等待，并先关闭 Agent 新任务准入、暂停已有待发队列，避免取消完成后自动启动下一条。当前二次强制结束只覆盖受管直接子进程，**没有 Job Object/Unix 父死进程树回收保障**；相关机制仍需实现与父进程强杀实测。失败后不自动重放请求。

## 8. Cookie 上下文与逐跳重定向

Cookie 文件能力已在 0.2.0 交付，插件可以第二批接入，不再等待上游提供。新增 `fastls_context_create/list/close`：contextId 由宿主生成并绑定 chatId，包含固定指纹/代理配置和私有 Cookie jar 路径；不向模型暴露任意文件路径，不把它命名为长期连接 Session。

首次请求 jar 尚不存在时仅 `-c <staged-jar>`；后续将当前 jar 复制到调用 staging，再传 `-b <staged-jar> -c <staged-jar>`。按 contextId 串行更新；传输成功后原子提交 jar，失败或取消默认丢弃该次 staging 修改。上游可能在失败时保存已收到 Cookie，因此必须由宿主控制事务边界，不能直接写当前正式 jar。

调用 cwd 固定为宿主创建的该次私有 staging；Cookie 参数使用内部固定相对名 `state.cookies`，不含 `=`。CLI 会把包含 `=` 的 -b 值解释为原始 Cookie，因此不能把可能含该字符的用户目录绝对路径直接当作 jar 参数。可执行路径仍使用校验后的绝对路径。

跨 chat 的 Cookie 状态不共享；删除/关闭上下文或停用插件清理状态。上下文请求需 network.request 及 session.cookies_read/write，创建/关闭使用 compute.local。读取/清空 Cookie 可在后续通过独立工具及对应权限提供。文件只存宿主管理目录，Unix 0600，Windows 显式校验当前用户目录 ACL；不能把 Unix 模式直接当作 Windows 隔离保证。

首批仅 manual 重定向，返回 3xx。第二批 follow 由宿主逐跳启动 fcurl，绝不传 -L：每跳先校验 URL 白名单；使用同一总超时、最多 10 跳；拒绝循环和非法 Location。303（HEAD 除外）以及 POST 的 301/302 转 GET 并移除正文，307/308 保留正文。该规则是插件定义的适配语义，不声称复现 CLI 显式 -X 保留方法的全部行为。

跨 origin 持续删除显式 Authorization/Cookie/Host，回跳也不恢复；CookieJar 按域和路径生成目标 Cookie。其他自定义凭据头按敏感头策略处理。第一版 follow 在累计预算内完整消费中间正文，超限直接停止整个调用；后续若为减少下载而主动结束进程，不能把非零退出直接当普通成功，Cookie 提交需证明已完整写入。需要“提前终止又可靠提取 Cookie”时另行验证上游接口，不作假设。

## 9. 权限与本地文件边界

通用 capability `network.request`、预设默认值、配置读取及 SDK 类型已接入；status/profiles 使用 compute.local。下一阶段检查 context 权限和升级迁移，旧配置缺键仍按预设补齐，不能因升级把用户明确 deny 改成 allow。调用受控二进制不以 shell.exec 代替网络授权。

URL 仅 HTTP/HTTPS，拒绝用户信息和非法控制字符。严格网络白名单匹配器已在 `shared/network-url-policy.ts` 独立实现，处理 scheme/origin/端口/路径段/域通配，不沿用浏览器导航 helper。空列表维持当前产品不限目标的含义，不额外改变内网访问政策；域名白名单不是 IP 层沙箱，也不能约束已允许代理的实际路由或消除 DNS 重绑定风险。

runtime 服务绑定当前插件、chat、approvedCapabilities 和 AbortSignal；受控适配器只接收结构化请求，不暴露通用 executable/argv。内置临时文件不算用户工作区文件读写；未来导入 CA/Spec/Cookie 或下载至工作区时分别请求相应文件权限，并校验允许路径。

请求私有目录包含 header-input.txt、header-output.txt 及必要状态副本；创建于宿主管理的 runtime 数据根。输入文件使用独占创建，关闭后再启动 CLI，清理覆盖所有错误分支；每次启动清除已确认无活动进程引用的过期目录。环境不继承 NODE_OPTIONS、动态库注入变量或无关密钥，不拼接 shell 命令。

## 10. 已完成的规划验证与剩余证据

历史规划验证已下载正式 Windows amd64 归档，核对 SHA256SUMS，并执行其原始 fcurl.exe：版本查询、152 条 profile、GET 与重复响应头、404 不使用 fail 时退出 0、默认不跟随 302、JSON stdin、Cookie 保存/重新加载、超时退出 28 共 9 项用例通过。两个 Linux 正式归档通过摘要和 ELF 静态依赖检查。

验证记录见 [本地 CLI 与 Linux 二进制检查](./fastls-curl-v0.2.0-planning-validation.json)。该证据没有实现 Navora 插件，未覆盖 TLS/代理、完整资源上限、Windows 进程树回收、macOS 分发或 Linux 实际执行，不能把上游五平台验证或本次检查当成 Navora 跨平台验收。

### 10.1 本轮源码核对与缺口清单

本轮修改 [宿主适配器](../electron/modules/fcurl-runtime.ts)、[插件调用边界](../electron/modules/plugin-store.ts)、AgentRuntime、SDK 静态验证与固定来源收集；不是一轮只读规划。发布版插件入口/工具和既有商店 ZIP 未更新。详细版本、测试入口和未执行项见[本轮实施记录](./plugin-foundation-progress-2026-11-05.md)。

- **本轮已实现**：含准备阶段的并发预留、有界可取消排队、统一截止时间、异步 drain/dispose、归属明确的清理失败重试；可信 requestId/attemptId/runId/toolCallId 回执；运行代次复核和当前/显式续跑 checkpoint 的请求派发准入；宿主环境证书来源快照与显式诊断；固定来源链和 SDK 非执行式静态检查。
- **本轮已验证**：最终完整构建及全套桌面单测 897/897 通过、0 跳过，类型检查通过；Windows 原始 fcurl + localhost 的运行时定向 15 项；真实 PluginStore/文件系统 39 项；事务/平台解释器 16 项；六处进程退出恢复（四处再中断恢复）；SDK 静态检查 9 项、Fastls 来源检查 9 项。各组有交叉覆盖，不能简单相加当独立能力总数。最终真实主窗口两阶段 Agent/fcurl 退出夹具 21 项检查通过；桌面 pack 另有 8 项单测及真实主窗口工具夹具通过。最终双包内容和隔离成品启动验证通过，具体范围见实施记录。
- **已有基础与历史证据**：三个工具、五目标 manifest/ZIP、完整性与平台检查、网络权限/URL 白名单、重复头/正文、manual 3xx；Windows x64 真实 Electron 安装闭环见 2026-11-01 历史记录。历史五平台产物和 Linux ELF 检查不代表本轮五平台运行通过。
- **桌面 pack 已补齐并独立验证**：移除 require 入口和 pack 重写 inventory/刷新资产；纯 JavaScript parser 随 main 交付，检查可见字面依赖及传递引用，无外置 SDK/Node 进程。它采用同等静态规则，不是复用 SDK helper，也不是任意动态加载认证或沙箱；桌面 build/check 后的受信候选外链加载不在 pack 零执行承诺内。
- **尚未实现**：Cookie context 工具及 jar 事务锁、context 关联、逐跳 follow、profile 摘要缓存、可恢复持久 context、Windows Job Object/Unix 父进程死亡回收。请求/run/tool-call 身份与基础等待队列已实现，不再列为缺口。
- **仍需补证**：完整 TLS 正负例、HTTPS 代理独立 CA、SOCKS5/SOCKS5H DNS、Windows 私有目录 ACL、全部中文/空格/等号路径格、Linux noexec、macOS 签名/公证/quarantine、休眠/网络切换、进程树父死、磁盘硬配额与事务设备故障矩阵。未执行格不计通过。
- **来源链已补强但未重发包**：collect-fcurl 将固定归档/三份元数据摘要与 BUILD.target、机器头、源码树/模块 hash、toolchain、RELEASE/SOURCE_VERIFICATION/SHA256SUMS 关联核对；五目标缓存校验通过。`--verify-cache` 明确没有重新下载归档，源码/缓存检查不等于重新发布 dist 或真实目标认证。

## 11. 后续工具契约：上下文、请求与关联

### 11.1 三种身份分开

浏览器 Agent Session、Fastls context、一次 Fastls request 是三种对象。浏览器 Session 仍由浏览器注册表持有；Fastls context 只保存指纹/代理配置与 Cookie 状态；request 是一次逻辑请求，可能包含多个 fcurl 进程。它们不能靠相同 URL 或 profile 自动绑定，也不承诺共享 TCP/TLS 连接。

已实现：宿主 runtime 每次 call 生成 requestId，从可信执行上下文注入 chatId、pluginId 和可用的 runId/toolCallId，不能由模型参数覆盖；一次插件 execute 可含多次 call，各有 requestId。仅实际 spawn 生成 attemptId，status/profiles 同样有可信回执。后续 context/follow 需扩展 contextId/hopIndex，并在同一逻辑请求内保持 requestId 的多跳关联，不能把尚无多跳的本轮实现写成已支持 hop。

子对话使用实际执行的 ctx.chatId 隔离上下文；插件可见范围 pluginScopeChatId 不等于 Cookie 所有者。切换 chat、复制/分叉对话、恢复历史文字都不复制登录状态。停止本次运行只取消该运行持有的活动/排队请求，不能因为旧结果回调停止较新的运行。宿主本轮已保留最小回执：身份、状态、是否派发、起止时间、HTTP 状态、错误类别及字节数；不含 Cookie、认证头、正文或 URL。tool meta 只保存最近最多 256 条克隆回执。跳数及 Cookie 提交状态待对应功能实现后扩展。

### 11.2 拟新增的最小接口

以下均为计划接口，现有工具列表暂不增加它们：

- fastls_context_create：输入可选名称、互斥指纹字段及无凭据代理；返回不透明 contextId、配置摘要、createdAt 和 ephemeral=true。默认没有 Cookie，不接受浏览器 sessionId、jar 路径或模型自定义 contextId。
- fastls_context_list：只列出本插件、本实际 chat 的可用上下文、状态及最近使用时间；不返回 jar 路径或 Cookie 名值。跨 chat 的 ID 按不存在处理。
- fastls_context_close：只关闭本 chat 拥有的上下文。进入 closing 后拒绝新请求，取消该上下文的排队及执行调用，等待进程退出和锁释放，再删除 jar；重复关闭返回稳定的已关闭结果。
- fastls_request：新增可选 contextId、redirectMode（manual/follow，默认 manual）和 maxRedirects（follow 默认 10、范围 0–10）；未传 contextId 保持当前无状态行为。使用 context 后指纹/代理由 context 固定，同一请求传冲突字段直接拒绝，不悄悄覆盖配置或把 Cookie 带到另一个代理/身份。

首期 context 只在应用运行期间有效，文件在宿主私有目录内落盘供 CLI 使用；不因落盘就承诺跨重启恢复。关闭上下文、删除所属 chat、停用/卸载插件及正常退出均回收。异常退出后的遗留目录经所有者与存活进程校验后清理；历史 contextId 重启后返回 context_unavailable。可持久化 context、Cookie 检查/清空/导入导出放到独立后续阶段，需要迁移、保留策略和明确授权，不能默认把登录状态写入对话草稿或普通备份。

### 11.3 Cookie 事务与同上下文串行

每个 context 有独立 FIFO 锁，锁键为 pluginId + 实际 chatId + contextId。不同 context 可在全局/每 chat 额度内并行；同 context 的整个逻辑请求（包括重定向）串行。锁等待占总超时，上下文锁等待队列首期拟与 F0 的单 chat 8/全局 32 个等待项对齐；队列超限、等待超时及取消都在未发送前返回。等待某 context 的调用不长期占住全局进程槽，避免一个慢上下文阻塞其他上下文；截止时间使用单调时钟。关闭/停用先设置拒绝新调用的屏障，不能清理后又被旧回调重建 jar。

开始请求时记录 context generation 与 jar revision，复制正式 jar 到该请求 staging。新 context 不传 -b，后续传 -b state.cookies；所有调用都 -c state.cookies，cwd 为专用 staging。相对固定名避免用户目录中“=”被 CLI 解释为 Cookie 文本。首期建议单 jar 上限 1 MiB、每 chat 最多 16 个 context、全局最多 64 个；这些是待实现的宿主预算，不是现有能力或上游 4 MiB 上限的改名。

follow 的各跳共用同一 staging jar。最终进程成功关闭、头/正文完整且必要解析成功、权限和 generation 仍有效、jar 大小/格式/权限校验通过后，才提交一次正式 jar 并增加 revision。有效 HTTP 4xx/5xx 仍是完成的 HTTP 响应，按同一规则提交；不能用 httpOk=false 丢弃登录失败响应设置的 Cookie。传输失败、取消、超时、输出超限、响应/JSON 必要解析失败、某跳被拒、提交失败均保留旧 jar，返回 cookieCommitted=false；成功返回明确的 cookieCommitted/revision。只回滚本地 Cookie，不声称撤销服务器已发生的操作。

jar 提交使用同文件系统 staging、临时新文件和替换，失败不得截断旧 jar；Windows 文件占用、写满、权限变化、替换前后异常和进程被杀都要注入测试。涉及持久恢复时，必须增加同步落盘、事务记录和启动恢复，不能仅凭 rename 宣称断电安全。上下文关闭期间删除失败记录为 cleanup_pending，不返回已彻底清除；下次启动在无活动所有者时重试。

### 11.4 Cookie 语义和权限

优先使用 fcurl 已有 Netscape jar 引擎处理 domain/path/Secure/HttpOnly/过期/删除及公共后缀规则，不手写不完整的浏览器 Cookie 模拟器。Netscape 格式不完整表达 SameSite、Partitioned 等浏览器状态，因此本阶段不做浏览器 Cookie 的自动导入/导出，不宣称能复用全部浏览器登录。

上下文元数据 create/list/close 使用 compute.local；带 contextId 的请求在发送前同时获得 network.request、session.cookies_read、session.cookies_write。这里的 Cookie 权限仅授权 Fastls context 操作，不包含任意浏览器 Session；界面文案要写清作用域。一次请求不能以创建 context 时曾获授权代替当次权限检查。已有 deny 保持 deny；中途撤销权限取消调用并禁止提交。凭据读取/导出、持久化或与浏览器显式交换状态要另行设计权限，不随 context 工具一并开放。

带 contextId 时拒绝显式 Cookie 头，避免原始 Cookie 优先级绕过 jar 的域隔离；无 context 的显式 Cookie 延续当前仅属于该请求的用法。Cookie 和 Set-Cookie 值不出现在 list、默认结果、日志和可复制诊断。Unix 限制目录/文件模式；Windows 核验实际私有目录继承 ACL，不能把 mode:0600 当作已保证当前用户隔离。

### 11.5 与现有执行证据和人工验证衔接

沿用 [执行证据协议](../shared/agent-execution-evidence.ts) 的可信事实边界：工具返回 ok、HTTP 200、Cookie 已提交只能分别证明该工具/传输/本地状态的事实，不能提升成“浏览器验证已通过”“原页面已恢复”或“用户业务已完成”。请求回执由宿主提供 requestId 与 run/tool-call 关联，不采信插件自报的 businessResultVerified 或 pageBlocker。本轮已由受控 runtime 通过宿主独立 onReceipt 路径收集 PluginRuntimeReceipt，再写入工具 metadata；不从插件返回 JSON 提取可信事实。回执只证明派发/传输事实，HTTP 200 不提升 businessResultVerified，不解除页面 blocker。

本轮已将 [运行时阻断准入](../electron/modules/agent-runtime.ts) 接入受控 runtime 的 network request，不只按 fastls_request 工具名字筛选：插件在排队后和派发前再次调用宿主准入回调。若当前运行或显式续跑正在等待原浏览器任务的本人验证/人工接管/权限阻挡，不允许用独立 HTTP 请求替代原任务。新任务没有继承的 pending checkpoint 时仍按正常网络权限执行；不因为历史页面受阻而把整个 chat 永久禁网。准入使用可信运行对象及既有 checkpoint，不采信模型 windowId/相同 URL 的自报归属。

确属另一项独立、已授权的接口请求时，仍按该任务及网络权限正常准入，不把某个页面受阻扩大为整个 chat 一律禁网。当前运行/显式续跑仍带 waiting checkpoint 时返回既有需人工处理状态，保留原页面和 waiting_for_user；独立新授权任务不继承这一网络阻断。人工完成验证后，要在新的有效运行中重新观察原页面与控制权，通过既有复查门槛才能继续；Fastls 的成功响应及 jar 变化不清除原 checkpoint。本阶段不增加验证码求解、自动迁移浏览器敏感 Session 或批量导入全部 Cookie。

## 12. 逐跳跳转契约与凭据边界

manual 始终不传 -L，按原有方式返回 3xx。follow 由宿主对 301/302/303/307/308 逐跳执行，最多 10 次跳转（最多 11 次网络请求）；其他 3xx 或缺少 Location 时作为最终响应返回。相对 Location 按当前 URL 解析，删除 fragment，拒绝多个冲突 Location、非法字符、用户信息及非 HTTP/HTTPS。记录已访问的规范化 URL，发现循环或超上限返回明确错误，不继续联网。

每一跳在发送前重新检查最终 URL 白名单、权限、context generation 和剩余预算。默认拒绝 HTTPS→HTTP 降级；不把首跳允许当作所有目标均允许。现有白名单为空仍表示不限目标，不顺带改变产品内网访问策略；若未来限制私网/环回或要求 DNS/IP 绑定，应独立设计连接层策略，也必须覆盖代理 DNS，不能仅检查 hostname 后声称隔离了网络。

方法规则固定：303 除 HEAD 外转 GET；301/302 的 POST 转 GET；307/308 保留方法和精确正文。转 GET 时移除正文及仅用于原正文的 Content-Type、Content-Encoding 等字段。当前正文受 1 MiB 上限且驻留可重放字节，因此 307/308 不新增文件重读或重新生成表单；未来流式正文若不可重放必须明确拒绝。跨 origin 的 307/308 可能发送敏感正文，首期默认拒绝携带正文跨源重放，不能仅剥离 Authorization 就当作无凭据。

origin 包括 scheme、host 和有效端口。跨 origin 后显式 Authorization、Cookie 及宿主判定的敏感自定义头永久移除，回跳也不恢复；Host 本来就不允许模型设置。敏感自定义头至少覆盖 api-key、x-api-key、x-auth-token 等已登记字段，并允许宿主配置额外名单；不把未列出的自定义头宣传为自动安全。Referer、Origin、其他包含源信息的显式头在跨源时移除，不自动合成原完整 URL。HTTPS 代理凭据若后续开放，只用于代理握手，不能混入目标请求头。

context jar 依据目标域/path/Secure 自行选择服务端 Cookie，不把首跳 Cookie 字符串拼接到下个 URL。没有 context 时不因多跳自动创建可长期使用的身份；若需要链内临时 Cookie，也应作为显式扩展能力另测，首期 follow 无 context 保持无跨调用 Cookie。

第一版 follow 完整消费每个中间响应，所有跳的正文传输累计不得超过 8 MiB，头部累计不超过 64 KiB，stderr 和跳转记录另有有界预算；总时间含排队、锁等待和全部子进程。中间正文不返回给模型，只保留有限脱敏跳转记录（索引、状态、方法、目标 origin/脱敏路径、耗时）。需要“提前结束中间正文但仍可靠写入 Cookie”的优化时先验证上游退出与 jar 完整性，不能把主动杀掉的进程当正常成功。

最终结果保留 requestId、contextId（如有）、redirectMode、redirectCount、redirects、finalUrl、状态和 Cookie 提交标志。错误结果区分 failedHop、lastCompletedHop 和请求是否可能已送达；部分响应只能作诊断，不伪装成成功，也不自动重试 POST/付款等有副作用请求。

## 13. 证书、代理、依赖和失败恢复

### 13.1 确定的环境与信任来源

当前默认验证证书，不提供 -k。本轮保留 SSL_CERT_FILE/SSL_CERT_DIR 的宿主启动快照，并校验绝对路径及文件/目录类型；非法配置返回 certificate_environment_invalid，不静默退回其他信任源。所有 runtime 结果标记 trustSource=system/environment_custom，status 另标 trustConfiguration=system_default/host_environment。模型不能任意指定 CA 路径，宿主运行期间环境变化不悄悄改变本管理器信任来源。跨平台系统根和完整 TLS 负例仍需补证。

自定义 CA 留给独立增量：受控文件选择/读取权限、大小上限、解析、来源摘要、撤销和生命周期齐全后才开放。目标 CA 与 HTTPS 代理 CA 是两个独立配置；目标 CA 授权不等于允许信任代理 CA。macOS/Windows 系统信任和 Linux 根证书缺失/最小镜像均需要实际验证。静态 Go 二进制不等于不需要 OS 证书、DNS、系统调用或可执行挂载。

代理当前只接受无凭据 http/https/socks5/socks5h URL，不读取 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY，不继承浏览器代理，也不默默退回直连。按协议分别测试目标 DNS 和代理 DNS 发生位置、CONNECT 拒绝、TLS 代理证书失败、不可达和超时。认证代理后续通过宿主管理的 secret 引用设计，拒绝把账号密码放进 argv、工具参数、URL 或普通日志；没有可靠凭据通道前不新增“已支持认证代理”的声明。

### 13.2 平台与二进制门槛

Windows x64 继续使用原始 PE amd64。darwin-x64/arm64 分开验收 Mach-O、宿主签名/公证与插件二进制分发；不得为通过测试静默清除 quarantine。Linux x64/arm64 验收 ELF 静态属性、实际最低内核、系统根、普通用户权限和 noexec。Windows arm64、32 位和未经验证的模拟架构不新增目标；选择依据宿主进程架构，不能根据“CPU 可能能模拟”强装另一种包。

打包来源链分三层保存：上游归档 SHA、原始二进制 SHA、Navora ZIP SHA。逐一验证版本、source_commit、BUILD.target 与机器头架构、许可证清单，防止“正确版本、错误目标”。只在构建机收集/组包，用户安装不执行 npm/Go 编译。新增支持目标先满足通用宿主平台前置，再生成该目标的安装、工具、TLS/代理、取消、升级/回滚及卸载报告。

### 13.3 终止与恢复

本轮已增加异步 drain/cancelAndWait/dispose：dispose 同步拒绝新调用、取消等待和执行项，等待直接子进程 close 及目录清理；清理失败记录所属 plugin/chat，可重试且不重新开放。正常退出等待 runtime dispose，按 chat 等待接口已提供；更新/卸载继续明确繁忙拒绝。Cookie jar 尚未接入，后续才能增加提交/丢弃状态和上下文锁释放；不能声称本轮已覆盖 jar。

待实现：Windows 使用经过目标机器测试的 Job Object 或等价进程归属；POSIX 使用进程组与父进程死亡策略。当前仅直接子进程取消后最多 2 秒升级强制结束，不保证整棵子进程树。验证必须包括宿主被强杀，不能仅验证 AbortSignal 正常取消或 CLI max-time 自行结束。启动清理只触及本服务命名空间、确认无存活进程引用的目录；PID 复用/无法判定所有者时保守保留并记录，不递归删除任意用户路径。

失败按阶段报告：输入/权限拒绝（未发送）、等待/锁超时（未发送）、连接/传输失败（送达可能未知）、HTTP 完成、状态提交失败。取消/网络切换/休眠恢复后不自动重放原请求；用户或 Agent 显式重试生成新的 requestId，并可引用 priorRequestId 供诊断，不能将引用解释为服务器幂等保证。插件更新迁移失败保留旧包和可用配置，context 不跨版本静默复用；持久 context 阶段另有格式迁移与回滚门槛。

## 14. 验证流程与可复现证据

所有集成测试使用隔离数据根、临时插件目录、可控本地 HTTP/TLS/代理服务和虚拟凭据；不读取真实浏览器 Cookie、不请求真实账户、不替换用户已安装插件。跨平台执行脚本必须真正运行已封装 ZIP 内的二进制，报告实际 OS、CPU/进程架构、宿主版本、插件版本、运行文件摘要、系统证书来源、通过/失败/跳过及清理结果。跳过不能计为通过。

1. 契约与输入：新增字段/工具只在实现后注册；拒绝伪造 owner/context、跨 chat/subchat、路径穿越、任意 CLI、过长头、控制字符、正文冲突；status 精确声明可用功能。旧三个工具与旧配置 deny 回归。插件 planPermissions 与宿主 runtime 均核对本次批准的能力，直接 runtime.call 不能绕过同样的字段和范围校验。
2. Context：同 context A/B 并发按队列顺序，B 看到 A 已提交 Cookie；跨 context/chat 不互见。domain/path/Secure/HttpOnly/过期/删除/公共后缀以接收端断言；显式 Cookie 冲突拒绝且目标零请求。首次/后续 jar、含中文空格等号的目录、权限不足、磁盘写满、锁等待取消、关闭竞态、进程失败和提交失败保留旧 revision。
3. 请求身份与人工验证：一次 follow 的多个 attempt 属于同 requestId；双运行、停止旧运行、切换 chat、关闭窗口和插件重载后，旧结果不能写入新运行或已关闭 context。已受阻原任务不能改用 Fastls 继续，明确独立的授权任务不被误伤；HTTP 200 不清除页面 checkpoint、不增加业务已验证计数。审计中能定位失败 hop，搜不到测试 Cookie、认证值或敏感 URL 查询。
4. Redirect：301/302/303/307/308、HEAD、相对 Location、循环、冲突 Location、最大次数、无 Location 和非 HTTP 目标；跨源凭据与 Referer 清除、回跳不恢复、Secure 不降级发送；跨源有正文重放拒绝。每跳白名单拒绝均由被拒服务零接收断言；中途规则撤销后不继续下一跳、不提交 jar。
5. 网络与资源：本地可信/不可信 TLS、过期与名称不符、系统根缺失、自定义证书来源；HTTP/HTTPS CONNECT、SOCKS5/H、代理拒绝和禁止意外直连。重复头、1xx、HEAD、JSON/二进制/乱码/压缩、慢速/超大响应、诊断上限、并发额度、有界队列、各跳累计预算、排队/运行取消、磁盘占用监测和无窗口闪烁。
6. 生命周期与平台：停止 Agent、删除 chat、停用/更新/卸载、正常退出、宿主强杀、休眠/断网恢复、失败重启；所有活动进程和私有文件最终可归属/可回收。macOS 的签名/公证/quarantine 和 Linux noexec/普通用户分开保留报告；只有对应 Navora 宿主能实际运行后才计平台通过。
7. 分发事务：从本机测试商店安装正确包，错误架构/篡改摘要/失效预览均拒绝且旧包仍可调用；发布/更新/提交故障回滚与启动恢复；旧 pure-JS、crypto-suite 及商店 v1/v2 回归。通用安装锁、断电和套件并发矩阵由跨平台规划负责，本插件补带运行状态和 Cookie 文件的交叉场景。

既有复验入口保持不变：桌面 `npm run test:plugins:platform`，适配器 `electron/modules/fcurl-runtime.test.ts`，SDK `navora-plugin build/check/pack fastls --target <target>`，商店 `node --test test/publish.test.js test/platform.test.js`。后续 Cookie/redirect 测试应新增独立套件与报告，不覆盖 2026-11-01 证据，也不沿用旧测试数量冒充本轮结果。

## 15. 分阶段交付与正式发布门槛

当前基础阶段已完成工具、SDK/商店 v2 和 Windows 历史闭环，本轮 F0 已落地部分通用可靠性；不从零重复实施，不把未完成项混入现有 Fastls 0.1.0。宿主修复与插件版本独立管理，接口/工具增加时同时提高正确的 minHostVersion，并保留旧包回滚条件。

- **F0，首批已实施、完整验收待补**：来源交叉校验、证书环境、可信身份/回执、当前/续跑阻断准入、异步 drain、有界排队和统一预算已实现并有定向证据。剩余是父死/整树回收、Windows ACL/磁盘资源/完整 TLS 代理与故障矩阵。最终真实主窗口退出、桌面 pack 工具与双包内容/成品启动证据已取得，范围见实施记录。完整门槛通过后再开放状态功能。
- **F1，Cookie context 最小版**：create/list/close、request.contextId、运行期生命周期、权限、串行锁、jar staging/提交和关闭屏障。单独以接收端验证隔离和失败保留旧 jar；无浏览器导入、无跨重启长期登录承诺。
- **F2，宿主逐跳 follow**：明确方法转换、跨源敏感头/正文策略、每跳重新授权、累计预算与链路结果。manual 默认值和旧工具行为回归；所有被拒目标零请求，失败链不提交正式 jar。
- **F3，其他平台认证**：依赖通用规划先取得等能力 Navora macOS/Linux 宿主；各 OS/arch 逐一验证封装 ZIP、证书/代理、状态、退出回收、安装更新/回滚及卸载。只给通过目标正式支持标记，失败/未测目标保留测试身份；不预先承诺四个目标一次全部发布。
- **F4，可选持久状态与高级网络**：在用户确有需求后再规划持久 context、显式浏览器状态交换、Cookie 查看/清空、认证代理、受控 CA 和有界解压。各项有独立权限、迁移/撤销和验收，不作为 F1/F2 顺便附送的能力。

实施顺序为 Windows F0 → F1 → F2；F3 的宿主准备、测试机和分发条件可并行，但发布结论独立。每阶段交付可审查的接口/权限变更、实现、自动化与实际集成报告、中文使用说明、兼容/回滚说明；源代码存在、ZIP 已生成、测试商店已发布、目标实机已验证、正式渠道已发布分别记录，缺少任一层都不互相代替。

与通用规划对齐：其 S0/S2 提供目标宿主和探测前提，S1 与本页 F0 共用生命周期/可靠性验收，S3 对应本页 F3 逐平台证据；其 S4 承接本页 F1/F2 的功能扩展。Windows 范围可以先推进，无需等待四个其他目标全部完成。

下一步先补齐 F0 剩余进程归属、TLS/代理、资源/故障矩阵，再推进 F1 Cookie context；本轮最终构建、真实主窗口退出/pack 与双包内容/成品启动已通过，不能替代这些剩余门槛。F3 缺少 macOS/Linux 等能力宿主或目标机器的目标保持等待环境，继续推进 Windows 范围；架构声明或上游 CI 不替代真实宿主与目标实机验证。
