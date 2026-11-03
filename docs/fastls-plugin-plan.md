# Fastls 插件与 fcurl v0.2.0 集成规划

日期：2026-11-01。状态：基础三个工具、SDK 平台打包与商店安装已实现；Windows 闭环通过，后续状态功能及其他平台运行验收待完成。见 [集成进展](./fastls-integration-progress.md)。本文替代此前“等待 fastls-curl 开发”的规划，不要求新增上游接口才能开始。通用机制见 [插件跨平台安装规划](./plugin-platform-installation-plan.md)。

## 1. 固定基线与方案

插件 ID 为 `fastls`，显示名为 Navora Fastls，首版计划版本 `0.1.0`；集成 `FastTLS/fastls-curl v0.2.0`，可执行文件名为 `fcurl` / `fcurl.exe`。版本独立管理，升级二进制需要重新验证和发布插件，不跟随 latest 自动换字节。

调用关系固定为 `Agent → 插件纯 JS 入口 → 宿主 runtime 适配器 → 单次 fcurl 进程`。无需 Node/Koffi、常驻服务、RPC 端口或自建 Go worker。请求之间没有 TCP/TLS 连接池复用；Cookie 可以通过文件跨调用延续，但不是原生长期 Session。

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

打包脚本使用 CGO_ENABLED=0。本次已检查两个 Linux 正式二进制：ELF 机器类型分别为 x86-64/AArch64，均无 PT_INTERP / PT_DYNAMIC；因此目标声明 linkage=static，不附 glibc 下限。该检查不等于 Linux/musl 实际运行认证；最低内核、系统证书和宿主分发条件仍列入平台验收。Windows arm64 不在该版本正式产物中。

产物在各目标宿主验证后才上架。macOS 需要实际签名、公证与 quarantine 验证，不能因上游提供 tar.gz 就视为完成桌面分发认证。Windows 普通用户、中文/空格路径和 Linux noexec 均有专门用例；不得自动清除系统保护。

## 3. 能力范围与首期交付

第一批交付 `fastls_status`、`fastls_profiles`、`fastls_request`，覆盖一次性 HTTP/HTTPS 请求、profile、无凭据代理、请求正文、响应解析、超时与取消。可选 JA3/TCP JA4R 在同一请求工具通过互斥指纹字段接入；profile 不传时保持 CLI 原生默认行为，不暗中选择某个浏览器。

第二批增加按 chat 隔离的 Cookie 上下文和宿主逐跳重定向。这不需要上游常驻会话。浏览器 Cookie、UA、代理和网络规则不自动继承。

首期不开放任意 CLI 字符串、任意输出/输入文件路径、-k、自动 -L、含凭据代理 URL、任意 CA/profile 文件或环境代理。后续可按明确权限接入受控文件和认证代理。Header 文件已足以传 Basic/Bearer Authorization，不要求命令行出现凭据。

当前版本没有可依赖的 metadata JSON/write-out、HTTP/3、多 URL/批处理、multipart、重试、断点续传或持久进程接口。SSE/WebSocket 和原生 session_* 工具不属于本插件首版承诺。

## 4. 工程与包结构

新增源码项目 `navora-plugins/fastls/`，包含 plugin.json、package.json/lock、main.ts、src/tools.ts、src/validation.ts、src/result.ts、src/cookie-context.ts、scripts/collect-fcurl.mjs、README.md 和针对适配行为的 tests。网络进程由宿主管理，不在插件中另写全局 ChildProcess 管理器。

平台 ZIP 根目录包含纯 JS `main.cjs`、plugin.json、README、runtime-files.json、`bin/fcurl[.exe]`，以及 `vendor/fcurl/` 下的 BUILD.json、发布来源记录、LICENSE/NOTICE 和 third-party 许可树。保留二进制原始字节；不附带用户机器需要运行的 npm 安装步骤。

manifest 的 runtime 为 `executable-sidecar`，executable 指向 bin/fcurl，binaryVersion 为 0.2.0，invocation 为 oneshot，adapter 为 `fcurl-cli-v0.2`，protocolVersion 为 Navora 适配契约 1；该版本号不是虚构的上游 RPC 版本。Windows executable 使用 .exe。目标 OS/arch/linkage 来自固定产物映射。

构建脚本只拉取固定清单中的归档，在 staging 校验后压包。原始归档不进入用户插件包，许可和来源材料需要保留。跨平台可组装包，但发布前必须在真实目标环境调用已封装的二进制。

## 5. 工具输入与 CLI 映射

### fastls_status 与 fastls_profiles

status 调用包内 `--version` 并核对预期版本、平台及运行文件完整性；返回插件版本、fcurl 版本和已接入功能。profiles 调用 `--list-profiles`，按行解析，按二进制摘要缓存，支持关键词/分页，默认 50、最大 200 条；不在工具 schema 中塞入全部 profile。两者使用 compute.local，不联网。

### fastls_request

参数包含 URL、method、headers、query、互斥的 bodyText/bodyBase64/json/form、可选 profile/ja3/ja4r、proxy、timeoutMs、responseMode。method 默认为 GET；携带正文时无显式 method 默认 POST。HEAD 拒绝正文。headers 采用有序键值列表而非单值对象，保留重复值；另以显式字段表示删除默认头或发送空值，不让模型手写 curl 特殊语法。

- method → `--request`；HEAD 使用 `--request HEAD`，不用会把响应头写到正文通道的 `-I`。
- 普通/空/抑制请求头 → 宿主生成的私有头文件，参数固定 `--header @<file>`。校验头名及 CR/LF/NUL，拒绝传输层保留字段。工具不得传入 @路径作为头部展开指令。
- bodyText/bodyBase64/form → 精确字节经 stdin，使用 `--data-binary @-`；form 由适配层编码并设置 Content-Type。json 在适配层校验并序列化，经 `--json @-`，不依赖 CLI 校验 JSON。
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

stderr 只保存有界、脱敏后的摘要，不直接向模型回显原始诊断；上游超时信息可能包含完整目标 URL。Authorization、Cookie、Set-Cookie、代理密码及 URL 敏感查询项均按展示/日志策略处理，Cookie 显式读取功能另受凭据读取权限约束。

## 7. 请求预算与进程生命周期

第一批每 chat 最多 4 个请求进程，全局最多 16 个；队列可取消。默认总超时 30 秒，允许 1–120 秒，连接超时默认不超过 10 秒及剩余总预算。宿主从排队开始计时，将剩余预算传 CLI；CLI 结束时仍要等待 stdio 关闭才能提交结果。

输入正文限制 1 MiB；stdout 传输正文限制 8 MiB；返回模型的正文限制 64 KiB；stderr 32 KiB；响应头解析预算 64 KiB。stdout 超限立即停止并终止进程，不先缓存完整响应；并发缓冲计入总内存预算。头文件大小监控用于尽早终止，但轮询存在瞬时超额，不能宣称为严格磁盘配额；临时目录另有总量、数量和过期清理。

第一批不传 --compressed，默认补 `Accept-Encoding: identity`（用户显式头优先）。如果服务器仍返回编码正文，保留编码并以 base64 返回；不能把压缩字节直接当 JSON/text。后续解压通过宿主有界流实现，并单独限定解压后字节数；zstd 等仅在实际运行时支持并通过测试后开放。CLI 核心默认解码预算不能冒充插件可配置的 8 MiB 硬内存限制。

64 KiB 为工具展示上限，完整传输在 8 MiB 内可以成功并标记 truncated；UTF-8 截断保证字符边界。json 模式只有完整、未截断、无未处理 Content-Encoding 时才解析为 JSON，否则返回片段/编码信息而不声称得到完整对象。

停止 Agent、删除 chat、停用/卸载/更新插件和退出应用均取消对应请求，等待进程回收及文件关闭后清理。POSIX 先发送可处理的终止信号，最多 2 秒后强制结束；Windows 使用受管理进程组/Job Object 或已验证的进程树回收，不依赖 SIGTERM 一定被 CLI 处理。父进程异常退出清理由宿主运行时保证。失败后不自动重放已发出的请求。

## 8. Cookie 上下文与逐跳重定向

Cookie 文件能力已在 0.2.0 交付，插件可以第二批接入，不再等待上游提供。新增 `fastls_context_create/list/close`：contextId 由宿主生成并绑定 chatId，包含固定指纹/代理配置和私有 Cookie jar 路径；不向模型暴露任意文件路径，不把它命名为长期连接 Session。

首次请求 jar 尚不存在时仅 `-c <staged-jar>`；后续将当前 jar 复制到调用 staging，再传 `-b <staged-jar> -c <staged-jar>`。按 contextId 串行更新；传输成功后原子提交 jar，失败或取消默认丢弃该次 staging 修改。上游可能在失败时保存已收到 Cookie，因此必须由宿主控制事务边界，不能直接写当前正式 jar。

调用 cwd 固定为宿主创建的该次私有 staging；Cookie 参数使用内部固定相对名 `state.cookies`，不含 `=`。CLI 会把包含 `=` 的 -b 值解释为原始 Cookie，因此不能把可能含该字符的用户目录绝对路径直接当作 jar 参数。可执行路径仍使用校验后的绝对路径。

跨 chat 的 Cookie 状态不共享；删除/关闭上下文或停用插件清理状态。上下文请求需 network.request 及 session.cookies_read/write，创建/关闭使用 compute.local。读取/清空 Cookie 可在后续通过独立工具及对应权限提供。文件只存宿主管理目录，Unix 0600，Windows 显式校验当前用户目录 ACL；不能把 Unix 模式直接当作 Windows 隔离保证。

首批仅 manual 重定向，返回 3xx。第二批 follow 由宿主逐跳启动 fcurl，绝不传 -L：每跳先校验 URL 白名单；使用同一总超时、最多 10 跳；拒绝循环和非法 Location。303（HEAD 除外）以及 POST 的 301/302 转 GET 并移除正文，307/308 保留正文。该规则是插件定义的适配语义，不声称复现 CLI 显式 -X 保留方法的全部行为。

跨 origin 持续删除显式 Authorization/Cookie/Host，回跳也不恢复；CookieJar 按域和路径生成目标 Cookie。其他自定义凭据头按敏感头策略处理。中间响应不需要完整下载；若因此主动结束进程，不能自动把此类非零退出当普通成功，Cookie 提交需明确保证已完整写入；第一版 follow 可先在预算内完整消费中间正文，超限直接停止整个调用。需要“提前终止又可靠提取 Cookie”时另行验证上游接口，不作假设。

## 9. 权限与本地文件边界

新增通用 capability `network.request`，同步 shared/types.ts、默认预设、配置迁移、SDK 类型与权限界面；旧配置缺键用预设默认值补齐。status/profiles 使用 compute.local。调用受控二进制不以 shell.exec 代替网络授权。

URL 仅 HTTP/HTTPS，拒绝用户信息和非法控制字符。新增严格网络白名单匹配器处理 scheme/origin/端口/路径段/域通配，不能直接沿用允许 about/data 和较宽路径匹配的旧 helper。空列表维持当前产品不限目标的含义，不额外改变内网访问政策；域名白名单不是 IP 层沙箱。

runtime 服务绑定当前插件、chat、approvedCapabilities 和 AbortSignal；受控适配器只接收结构化请求，不暴露通用 executable/argv。内置临时文件不算用户工作区文件读写；未来导入 CA/Spec/Cookie 或下载至工作区时分别请求相应文件权限，并校验允许路径。

请求私有目录包含 header-input.txt、header-output.txt 及必要状态副本；创建于宿主管理的 runtime 数据根。输入文件使用独占创建，关闭后再启动 CLI，清理覆盖所有错误分支；每次启动清除已确认无活动进程引用的过期目录。环境不继承 NODE_OPTIONS、动态库注入变量或无关密钥，不拼接 shell 命令。

## 10. 已完成的规划验证与剩余证据

本次已下载正式 Windows amd64 归档，核对 SHA256SUMS，并执行其原始 fcurl.exe：版本查询、152 条 profile、GET 与重复响应头、404 不使用 fail 时退出 0、默认不跟随 302、JSON stdin、Cookie 保存/重新加载、超时退出 28 共 9 项用例通过。两个 Linux 正式归档通过摘要和 ELF 静态依赖检查。

验证记录见 [本地 CLI 与 Linux 二进制检查](./fastls-curl-v0.2.0-planning-validation.json)。该证据没有实现 Navora 插件，未覆盖 TLS/代理、完整资源上限、Windows 进程树回收、macOS 分发或 Linux 实际执行，不能把上游五平台验证或本次检查当成 Navora 跨平台验收。

## 11. 实施批次与发布门槛

P0 通用契约：按另一份规划冻结 artifact/target/linkage/runtime、商店 v2、兼容选择、错误码和事务回滚；使用独立测试 CLI 验证受控调用和取消，不要求 fcurl 增加协议。

P1 SDK/商店：实现 collect-fcurl 固定清单、来源/摘要核验、许可收集和五目标压包；平台 artifact 不进入旧 v1 商店索引，legacy 纯 JS 包仍可安装。产物缓存按版本、目标和摘要隔离。

P2 最小插件：实现宿主 fcurl 适配器、status/profiles/request、network.request、头解析和有界正文；Windows x64 干净机器无 Node/npm/Go 也能安装并完成一次本地 HTTP/HTTPS 请求。

P3 行为验收：可控本地 HTTP/TLS/CONNECT/SOCKS 夹具验证重复头、HEAD、JSON/二进制正文、证书拒绝、各种代理、超时/取消、慢响应、大响应、乱码/压缩体、中文路径和无控制台闪窗。检测到被拒目标未收到任何请求，日志中不出现测试凭据。

P4 状态功能：实现 Cookie context 隔离、串行事务、失败不提交、关闭清理和逐跳白名单；并发与停止请求不丢旧 jar、不跨 chat 泄漏，重定向方法转换和敏感头剥离用接收端断言验证。

P5 平台与升级：五个目标分别验证已封装 ZIP 的安装、自检、核心请求、更新失败回滚、卸载及异常退出无残留。Linux x64/arm64 实际执行，macOS x64/arm64 完成分发验证；其他架构不展示为可安装。旧纯 JS 与 crypto-suite 回归通过。

交付物为上述 SDK/宿主/商店变更、插件源码、五平台经验证的 ZIP/摘要、中文说明、许可与来源记录、逐平台验收结果。首批 P2/P3 可先发布 Windows x64，其他平台和 P4 分别在通过验收后补齐；状态清楚标记计划/已验证/已发布，不把未完成的能力列为可调用工具。
