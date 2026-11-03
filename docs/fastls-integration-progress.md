# 平台插件与 Fastls 集成进展

日期：2026-11-01。当前交付是 Navora 0.3.33 的基础平台插件支持，以及 Fastls 0.1.0 的三个工具；底层固定使用 fcurl 0.2.0。

## 已实现

- 共享平台契约：legacy、portable、OS/架构、Linux 静态/动态 libc、最低宿主条件；SDK 与商店匹配模块由同一源文件生成。
- SDK 0.2：按 target 构建、检查和打包，收集受控运行文件并生成完整摘要清单；桌面 plugin_build/check/pack 同样支持 target。
- 商店 v2：相同包版本的多个平台产物共存，v1 不显示平台版本；发布、重建、下架和快照恢复保留现有事务保障。
- 安装：预览和加载前检查兼容性，校验 ZIP 与运行文件，恢复 Unix 执行位，检查二进制架构，安装时不联网编译。候选加载失败不替换旧包，目录和 index 有恢复 journal。
- 受控进程：绑定插件/chat/权限，限制方法、输入和输出，处理超时/取消，私有头文件传递认证信息，屏蔽敏感诊断；停用、移除和退出路径接入回收。
- `fastls_status`、`fastls_profiles`、`fastls_request`：支持独立 HTTP/HTTPS、重复请求头、JSON/文本/base64/表单正文、无凭据代理及显式指纹。新增“独立网络请求”权限，使用严格 URL 白名单。
- 商店界面显示目标与不兼容版本；安装前复核 installPlanKey，按内容摘要隔离缓存，目录错误不复用缓存完成安装。

## 已验证

- Windows 原始二进制及实际插件运行：版本、profile、GET/POST、重复响应头、404、手动重定向、权限拒绝、HTTP CONNECT 代理、超时、取消、白名单变更中止、压缩字节保留、输出展示预算、超限响应和临时文件清理。
- 真实 Electron：五平台临时商店聚合、自动选 Windows 包、安装预览变化拒绝、安装、请求、拒绝错误平台、拒绝无效替换并保留原包、桌面内置压包及卸载。
- 桌面类型检查、116 项单元/集成测试、前端与主进程构建；19 项商店发布与平台回归；SDK npm 包内容检查。
- 五个平台均已生成插件 ZIP。两个 Linux 原始发布物的 ELF 静态依赖已检查。此项不等于 Linux/macOS 上的 Navora 实际运行认证。

## 可复现入口

- 桌面：`npm run build`；`npm run test:plugins:platform`。后者需要先生成五个平台插件包，使用临时数据目录。
- 商店：`node --test test/publish.test.js test/platform.test.js`。
- 收集二进制：在 navora-plugins/fastls 中运行 `node scripts/collect-fcurl.mjs --all`。
- 构建/检查/打包：`navora-plugin build/check/pack fastls --target win32-x64`，在 navora-plugins 根目录执行；其他目标为 darwin-x64、darwin-arm64、linux-x64、linux-arm64。
- 契约分发同步：在桌面目录运行 `node scripts/sync-plugin-contract.mjs`。

## 本机商店发布验收

2026-11-01 已将 Fastls 0.1.0 的 win32-x64、darwin-x64、darwin-arm64、linux-x64、linux-arm64 五个产物按同一批次发布到 navora-store。ZIP 与 dist/fastls-0.1.0-artifacts.json 中的大小和 SHA-256 一致，最低宿主为 0.3.33。新索引为 index-v2.json，旧 index.json 保留原有插件且不投影 Fastls 平台包。

本机只读商店在 http://127.0.0.1:8791 启动；这是当前会话的后台进程，未注册开机启动，也未部署公网。重新启动可在 navora-store 运行 `npm run serve`。

已通过商店 19 项回归、桌面商店 6 项集成测试；线上读取本机服务的检查器验证了全部 26 个有效产物的下载大小、摘要与说明文件。真实 Electron 使用隔离数据目录从该 HTTP 服务自动选择 Windows 包并完成预览、下载、安装、请求及卸载。

复验已启动的服务：在 navora-store 运行 `node scripts/check-store.mjs http://127.0.0.1:8791`；在桌面目录设置环境变量 `NAVORA_SMOKE_CATALOG_URL=http://127.0.0.1:8791` 后运行 `npm run test:plugins:platform`。省略该变量时仍使用临时商店。

平台包保存在 navora-plugins/dist，名称为 fastls-0.1.0-<target>-plugin.zip。宿主源代码已构建到 dist/dist-electron，但没有覆盖用户安装目录或自动把插件装入用户数据。

## 后续阶段与当前边界

Cookie 上下文与逐跳自动跳转仍按第二批规划实施，当前工具只返回 3xx，不自动跟随；不复用浏览器 Cookie 或 TCP/TLS 连接。当前压缩响应保留编码并以 base64 返回，不声称完成可配置解压内存预算。

macOS 的真实运行、签名/公证分发与 Linux 宿主执行仍待相应环境验收；生成的 ZIP 尚不能据此标为这些系统已认证。Windows 正常取消/退出已验证，宿主被强制杀死时的 Job Object 进程归属和进程树回收还需专门补齐，当前 CLI 自身超时不等同于该保障。

安装事务已覆盖候选拒绝、提交失败恢复与启动恢复入口；进一步的断电注入、多套件并发压力、Unix noexec 等故障矩阵仍按通用规划验证。进程内原生 Node 插件 ABI、持久协议和其他可执行适配器未对外承诺支持。
