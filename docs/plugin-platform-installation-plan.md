# 插件跨平台安装与原生运行时规划

日期：2026-11-01。状态：首批平台安装与 fcurl 一次性调用已实现并在 Windows 验证；其余阶段按验收推进。实施结果见 [集成进展](./fastls-integration-progress.md)。Fastls 实施依赖见 [Fastls 插件规划](./fastls-plugin-plan.md)。

目标是让同一个插件 ID、同一个版本能交付多种平台产物，安装时自动选择当前宿主能够运行的包，失败时保留已安装的可用版本。用户无需准备 Node、npm 或编译工具。现有纯 JavaScript 插件、套件变体和文件夹开发外链继续可用。

## 1. 当前实现与需要补齐的环节

- `shared/plugins.ts` 的 `PluginManifest` 没有平台和运行时约束；`electron/modules/plugin-store.ts` 解压后直接 `require(main)`，不安装 npm 依赖。
- `shared/store.ts`、`navora-store/src/types.js` 的版本只有一组 ZIP 路径、大小和摘要；`navora-store/src/ingest.js` 固定写入 `<id>/<version>/package.zip`，相同版本不能独立存储不同平台包。
- `navora-plugin-sdk/bin/navora-plugin.mjs` 默认 bundle 依赖，仅 external `electron`；打包带依赖时复制开发机的 `node_modules`。桌面内置 `plugin-pack.ts` 有另一套复制和压包实现，需要同步升级。
- `marketplace-client.ts` 在预览、安装、更新发现和缓存中均按现有版本结构工作；只改下载入口会导致预览、更新提示、缓存命中与实际安装不一致。
- 插件当前位于 Electron 主进程。进程内原生模块与独立可执行文件必须分别建模。Fastls 集成已发布的 `FastTLS/fastls-curl v0.2.0`，实际可执行文件名为 `fcurl` / `fcurl.exe`，不再使用 npm SDK 路线。

## 2. 核心决定

1. **发布平台包，安装时选包。** 用户安装阶段只下载并校验已构建产物，不运行 npm、安装脚本或本地编译。
2. **平台与产品变体分离。** `suite` / `packageId` 仍表示能力变体；`artifactId` 表示同一变体版本的平台产物。不得把 win32、darwin 放进 suite 供用户手选。
3. **使用实际执行架构。** 第一版以宿主 `process.arch` 选择产物；Rosetta 中运行的 x64 宿主选择 x64 包，不因硬件为 arm64 自动跨架构启动。以后再增加显式模拟执行策略。
4. **纯 JS 保持简单。** 无平台声明的旧包按 legacy 处理，保留安装能力；不把它自动认证为跨平台兼容。新包显式声明 portable 或平台目标。
5. **独立可执行文件为通用运行方式。** Fastls 使用正式发布的 `fcurl v0.2.0`，按单次调用启动并由宿主管理其进程；进程内原生模块只有在声明兼容且经过真实 Electron 验证后才允许启用。
6. **静态校验先于执行。** 浏览商店、预览 ZIP、选平台和检查文件完整性都不执行插件入口；安装健康检查在授权安装后运行。

## 3. 平台与运行时契约

新增共享的目标解析、校验和匹配模块，桌面端与 SDK/商店使用一致规则及同一组契约样例。

目标由 `os`、`arch`、可选 `linkage/libc` 和最低系统、内核及 libc 版本组成。第一批平台键包含 `win32-x64`、`darwin-x64`、`darwin-arm64`、静态 `linux-x64/linux-arm64` 及动态 `linux-x64-glibc/linux-arm64-glibc`。通用机制可以识别 win32-arm64、musl 等目标，识别不等于某个插件存在对应产物。

`libc` 只允许 Linux 使用。最低系统版本取实际二进制及其动态依赖与本项目要求的交集；如包内另带语言运行时，再叠加其要求。检测不到已声明的必要条件时返回 `platform_detection_failed`，不得把未知 libc 当成 glibc。平台检测在主进程完成，结果可供预览 UI 读取，不信任渲染端上报值。

建议新增以下字段；名称在实现阶段统一进入 SDK 类型，不在两端分别发明：

```ts
type ArtifactTarget =
  | { kind: 'portable' }
  | { kind: 'platform'; os: string; arch: string; libc?: 'glibc' | 'musl';
      minOsVersion?: string; minKernelVersion?: string; minLibcVersion?: string;
      linkage?: 'static' | 'dynamic' }

type PluginRuntime =
  | { kind: 'electron-main'; nodeRange?: string;
      native?: { binding: 'napi'; minNapi: number }
             | { binding: 'node-abi'; modules: string; electronRange: string } }
  | { kind: 'executable-sidecar'; executable: string; binaryVersion: string;
      invocation: 'oneshot' | 'persistent'; adapter: string; protocolVersion: string }
```

`PluginManifest` 新增 `packageFormatVersion: 2`、`artifactId`、`target`、`runtime`、`minHostVersion`；构建产物含 `runtime-files.json`，逐项记录相对路径、字节数、SHA-256 和必要执行位。新格式所有运行文件必须被清单覆盖，清单自身除外，ZIP 总摘要覆盖整个清单。

进程内模块匹配使用 Electron 实际 `process.versions.node/modules/napi/electron`。N-API 的数值匹配仅为必要条件，不能代替平台实测。sidecar 校验实际二进制版本、架构、系统依赖和调用协议，不套用 Electron/Node ABI。只有明确携带 Node 的其他插件才校验其 Node 版本。

Fastls 的目标清单为 `win32-x64`、`darwin-x64`、`darwin-arm64`、`linux-x64`、`linux-arm64`。上游归档使用 windows/amd64 等命名，SDK 显式映射到宿主目标。其发布脚本采用 CGO_ENABLED=0；Linux 产物需核对 ELF interpreter/dynamic segment 后才能声明 linkage=static、无 libc 约束，不能机械复用此前 npm 路线的 glibc 后缀。静态二进制仍要求兼容内核、系统证书和可执行挂载；目标中没有 libc 字段表示该产物不依赖 libc，不表示 Linux 环境全部已认证。Windows arm64 不在该版本发布清单。

Linux 可执行产物声明 static 时不得再声明 libc，发布检查需有 ELF 证据；dynamic 目标必须明确实际 libc 需求，不能用省略字段表达“尚未检查”。同版本同架构存在 static 与已匹配的 libc 专属包时，专属约束优先，static 作为明确兼容的备选；同优先级重复声明仍拒绝。

平台包不能声明 portable；依赖 OS 动态库、可执行文件或原生扩展的包必须使用具体目标。新格式缺失目标、非法组合、重复 artifactId、同等优先级重叠目标在发布时拒绝。

## 4. 商店协议与旧客户端隔离

保留现有 `index.json` 和 v1 路径协议，新增 `index-v2.json`。v1 目录只包含真正按旧格式交付的包；平台专属 v2 包不投影进 v1，避免旧客户端忽略新增字段后下载错误产物。已有协议允许高版本按 v1 解释，因此仅把原 index 的 schemaVersion 改为 2 不足以隔离旧客户端。

新客户端优先读取 v2；仅在 v2 不存在（明确 404 或本地文件不存在）时读取 v1。v2 无效、摘要错误或网络失败不静默降级。v2 schema 严格校验，缓存与 ETag 按端点隔离。技能保留现有产物语义，可以在 v2 目录共存，不强制引入平台字段。

v2 插件结构为 `product → packages → versions → artifacts`。产品和 package 元信息维持现有语义；版本保存版本号、发布时间、状态；每个 artifact 独立保存 `artifactId/target/runtime/minHostVersion/downloadPath/sha256/size`。说明文件优先版本共享，也可有 artifact 覆盖。

新产物路径：`plugins/<id>/<version>/artifacts/<artifactId>/package.zip`，旁边保存该产物 `meta.json`。路径校验器显式增加这一种形式，ID、版本、产物 ID 逐段验证；不能通过放宽成任意路径实现兼容。旧路径原样支持。

入库唯一键为 `(kind, packageId, version, artifactId)`；不同平台不互相覆盖。默认禁止替换相同键，显式 force 仅用于开发目录；正式发布使用新版本。目录重建先聚合同版本 artifacts，再对版本排序，避免同版本出现多条假版本。

## 5. 自动选择与更新规则

1. 获取主进程探测结果，检查 host API 版本和 minHostVersion。
2. 用户指定版本时，只在该版本中匹配；不跨版本静默替换。自动选择时，选择最新 active 且存在兼容 artifact 的版本。
3. 同版本先选精确平台包，再选声明可运行于当前宿主的 portable 包。约束更严格且全部满足者优先；同优先级多候选视为目录错误，不依赖数组顺序。
4. legacy 单 ZIP 在 v1 分支走旧流程，UI 标为“未声明平台”；新原生插件不能借 legacy 路径规避校验。
5. 预览返回选中的 artifactId、目标摘要、大小及目录内容指纹；安装重新匹配并核对预览结果。目录变化返回 `install_plan_changed`，由现有安装界面刷新预览，不擅自装不同产物。
6. 缓存键包含 packageId、version、artifactId、sha256，避免多平台或 force 后污染缓存。
7. 自动更新只提示当前平台能安装的新版；更高版本不支持当前平台时显示原因。已安装信息记录目标、摘要和运行时，迁移数据目录到其他系统后必须重新匹配，不能直接加载旧二进制。

## 6. SDK 与产物构建

作者清单增加 `build.external`、`build.runtimeDependencies`、`build.runtime` 和允许的 targets；产物清单由 SDK 生成，不能直接把作者清单全部透传。

提议命令形态：`navora-plugin build <id> --target <target>`、`check <id> --target <target>`、`pack <id> --target <target>`。未指定目标时，纯 JS 项目输出 portable；需要平台的项目默认本机目标并明确展示，CI 发布要求显式目标。

构建使用独立 staging，按固定 lockfile 安装生产依赖并保留 optional dependencies，仅在构建环境运行允许的安装步骤。复制完整生产依赖闭包及合法包元数据，外置需要保留目录的运行时依赖，不合并原生组件到单个 JS 文件。`fastls-curl` 按发布版本、目标和摘要收集二进制及必要配套文件，不为它安装 Node/Koffi。不得复制 monorepo 开发依赖或借父级 node_modules 才能运行。

跨平台参数不等于跨平台构建支持。第一版在相同 OS/arch/libc 的 runner 构建及测试；不得在 Windows 复制一份 node_modules 后改名成 Linux 包。后续如支持交叉组装，仍需目标平台执行验证才可发布。

`--include-node-modules` 作为旧选项保留，新平台格式由 runtimeDependencies 决定依赖闭包。`plugin-pack.ts` 与 SDK 共用产物检查契约；桌面内置打包只压已完成的目标 staging，不负责下载依赖。

静态 `check` 检查路径、清单、依赖闭包、执行位、版本一致和文件摘要；运行检查使用正确运行时，并区分“未执行”和“执行通过”。不能在非目标平台直接 require 平台包来校验导出。

## 7. 安装、回滚与原生更新

商店安装、本地 ZIP、开发外链、会话试用、随附插件同步全部进入同一兼容性校验器。外链发现目标不匹配时报告原因；无需复制，但不能跳过运行时检查。

安装事务顺序：预览兼容性 → 下载 → 校验 ZIP 大小/摘要 → 在插件根同卷 staging 解压 → 校验清单、目标、依赖与模式 → 健康检查 → 暂停相关调用并准备替换 → 备份旧目录与相关 index → 提交新目录/index → 加载验证 → 标记完成 → 清理备份。

Windows 不能假设带锁目录可直接覆盖；使用版本化目录和可恢复指针/index 切换。多文件操作不是天然原子事务，记录事务 journal，启动时恢复未完成切换。失败恢复旧目录、启用状态、外链和套件成员信息；套件冲突成员直到候选通过检查才停用/替换，不能先删掉旧插件。

按 packageId / suite 加锁，串行化安装、卸载、更新、导出及相关调用。正式数据只在提交阶段变更；磁盘不足、断电、取消和解压失败都不能破坏旧版本。

原生 sidecar 在更新前 drain、关闭会话、退出；超时终止后再切换。进程内原生库可能已被系统加载且不能安全卸载，更新标记 pending、重启后切换，禁止仅清 require.cache 当作卸载。

ZIP 延续压缩大小 200 MiB 限制；增加解压大小 1 GiB、文件数 50,000 的初始上限，实际构建体积验证后可统一调整。拒绝目录穿越、符号链接、大小写冲突路径和超限条目。Unix 仅对清单内明确允许的可执行路径恢复执行位，不给整个目录递归 chmod。Windows 检查 PE 架构；Unix 检查对应 ELF/Mach-O 架构。

macOS 验证包内可执行文件、动态库的签名、公证与 quarantine 行为；不能用自动清除 quarantine 或提示关闭系统保护来代替可分发性。Linux noexec、系统/运行库版本不足和 Windows 执行策略拦截均需可理解的错误。

## 8. 宿主管理的可执行文件

新增 `plugin-runtime-manager.ts`，仅启动 manifest 中受约束的包内可执行路径；绝对解析、禁止 shell 拼接、Windows 隐藏窗口。插件桥接层通过 `PluginHostApi` 的 runtime 服务调用。`fastls-curl` 使用包内的实际二进制，不依赖系统 PATH，也不通过 Electron 或 Node 模拟执行。

运行时兼容一次调用一个进程与持久进程两种方式，由二进制实际契约确定。优先通过 stdin/stdout 交换机器可读数据，stderr 输出有界脱敏日志；不预先要求 fastls-curl 实现专用帧协议或 HTTP 服务。持久协议若采用帧，需定义版本、请求 ID、调用、取消和关闭语义，并在读入阶段限制帧大小；一次性 CLI 则定义输入、退出码、stdout/stderr 和终止行为。宿主适配器统一向插件暴露结果。

针对已发布的 fcurl，适配器采用 stdout 正文流、stderr 诊断、私有目录内 `-D` 头文件，以及 stdin 请求体或头文件输入；不等待结构化 metadata。头文件/临时输入的路径只由宿主分配。`call` 结果包含 exitCode、signal、宿主取消原因、解析元数据和有界正文；一次性命令不伪造握手或原生会话。宿主生成 requestId 用于调用跟踪，而不是假设 CLI 具有该参数。

`PluginHostApi` 增加可选 `runtime` 服务，建议提供 `call(method, payload, options?)` 和 `status()`；启动和关闭由宿主生命周期管理。服务实例绑定当前 pluginId、artifactId、chatId、approvedCapabilities 与 AbortSignal，插件不传可执行路径或其他 chatId。call 仅能调用该插件 manifest/SDK 契约声明的方法；返回结构化结果。缺少该 API 的旧宿主由 minHostVersion 在安装前阻止，不在首次执行时才报错。Fastls 适配器固定为 `fcurl-cli-v0.2`，使用一次性进程，首批映射 status/profiles/request；允许的 CLI 参数由宿主适配器生成，不接受插件传入任意 argv。Cookie 状态上下文在插件层管理，不声明为原生 Session。

通过实际支持的版本/能力查询核对二进制版本与协议，结合平台、架构、目标 artifact 和包摘要验证。环境只透传必要系统变量，不继承 NODE_OPTIONS、NODE_PATH、FASTLS_LIBRARY、用户 API 密钥或自定义动态库注入变量；CA/代理等能力通过结构化配置明确下发。

宿主负责启动超时、请求超时、AbortSignal、崩溃检测和进程回收。持久进程按契约处理空闲退出及父进程 EOF；一次性进程按调用结束或取消清理。插件停用/卸载/更新、会话结束、应用退出均触发生命周期清理；给现有插件模块增加可选 lifecycle，旧插件无需实现。持久模式优先每 chat 独立进程；一次性模式按调用创建进程。Fastls v0.2.0 固定为一次性模式，不创建常驻 worker 或本地 HTTP 服务。

增加 `plugin-runtime` 本地受控状态目录，安装文件保持只读；不把 cookie、临时响应或日志写回插件版本目录。独立进程隔离原生崩溃，不代表操作系统沙箱，现有插件高信任属性仍成立。

## 9. 界面与错误

商店显示“可安装”“不支持当前系统”“需更新 Navora”和已选择平台；平台选择由宿主完成，保留现有能力变体选择。详情可展示受支持平台、运行时版本和原生健康状态。

结构化错误至少覆盖 `unsupported_platform`、`unsupported_arch`、`unsupported_libc`、`os_version_too_low`、`host_version_too_low`、`runtime_version_mismatch`、`runtime_file_missing`、`runtime_hash_mismatch`、`native_load_failed`、`runtime_start_failed`、`runtime_crashed`、`restart_required`、`install_plan_changed` 和 `install_rollback_failed`。用户界面使用中文说明和明确处理动作，技术原因留在可复制诊断中，不包含凭据。

## 10. 改动位置

- SDK：`navora-plugin-sdk/navora-plugin.d.ts`、`SPEC.md`、`README.md`、`bin/navora-plugin.mjs`；新增目标匹配、依赖 staging 和文件清单支持模块。
- 商店：`src/types.js`、`protocol.js`、`paths.js`、`inspect.js`、`ingest.js`、`catalog.js`、`docs.js`、静态 serve 路径处理及 `PROTOCOL.md`；同步发布脚本 `navora-plugins/scripts/store-publish.mjs` 的命名匹配和入库逻辑。
- 宿主：`shared/plugins.ts`、`shared/store.ts`、`shared/store-catalog-view.ts`、`electron/modules/marketplace-client.ts`、`plugin-store.ts`、`plugin-pack.ts`、`plugin-dev-cli.ts`、`plugin-dev-watcher.ts`、`plugin-host.ts`；新增平台检测、运行时管理、事务恢复模块。
- 界面：`src/components/store/*`、`src/components/plugins/PluginImportDialog.vue`、`PluginLibraryList.vue` 及 `src/composables/useStoreUi.ts`。
- 同步开发提示 `shared/plugin-dev-prompt.md`、插件开发文档、创建器/会话试用入口和 IPC/RPC 类型；原生项目通过标准 SDK 工程创建，现有三文件创建器不强行扩展成二进制编辑器。

## 11. 实施批次与验收门槛

P0 契约：冻结 target/runtime/artifact 结构、v2 隔离策略、匹配算法和错误码，补齐双方一致的契约样例。通过 legacy、portable、平台包、suite 组合与未知平台的匹配测试后进入下一步。

P1 构建与商店：SDK 能在目标 runner 产出自包含 ZIP；同 ID 同版本五种 artifacts 可共存，Linux 静态目标和动态 glibc/musl 目标可分别声明。v1 老客户端仍能安装现有纯 JS 插件；不会看见 v2 平台包；v2 目录损坏不会静默回落。

P2 安装与恢复：预览/本地导入/外链/试用/随附同步一致校验。用下载失败、缺文件、错误摘要、磁盘不足、并发更新及提交中断验证旧版本和 suite 状态完整恢复；验证跨架构缓存隔离。

P3 sidecar：用独立测试可执行文件验证启动、版本查询、取消、崩溃、EOF、停用/卸载/退出清理和更新 drain；按一次性/持久模式分别验收。带空格/中文安装路径及标准用户权限下运行；全程无系统 Node/npm 依赖。

P4 Fastls 试点：基线固定 fcurl v0.2.0，先完成 Windows x64 插件闭环，再验证已发布的 macOS x64/arm64、Linux x64/arm64 产物。二进制及本地 CLI 冒烟已具备，插件/安装机制仍待实施。每个平台只有在真实目标环境完成安装、调用、升级、失败回滚和分发验证后才标为支持。

通用机制完成不等于所有候选平台已发布。目标二进制存在、宿主能在该平台分发、依赖能加载、核心用例通过是四个独立发布条件。未通过目标留为 planned，不发布“已兼容”标识。

第一版不提供用户机器在线 npm 安装、自动本地编译、自动跨架构模拟、共享全局 Node 缓存或 Fastls 的 Electron 内嵌执行；不开发 fastls-curl 本身；结构化 metadata、持久 Session、HTTP/3 等尚未交付的上游接口不作为首期依赖。上述功能不是首期交付的前置条件。
