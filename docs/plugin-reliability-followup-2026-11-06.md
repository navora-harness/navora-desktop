# 插件可靠性第二批实施与规划核对

日期：2026-11-06。状态：**本批源码、构建及定向验证完成；完整 S1/F0 仍未验收**。衔接[跨平台安装规划](./plugin-platform-installation-plan.md)与[首批交付](./plugin-foundation-progress-2026-11-05.md)。源码版本仍为 0.4.13，SDK 仍为 0.2.0；本批未重新生成安装版/便携版，未发布 SDK、Fastls 或正式商店。

## 已完成的补齐

- **恢复 IO 故障可以重试。** 原实现将包括磁盘/权限故障在内的所有恢复失败移入隔离区，没有重试入口，隔离失败还可能中断启动。现在已验证的事务及可恢复的 IO 错误保留在 `.transactions`，不可变备份保持不变；目录枚举/隔离失败返回阻塞报告，避免加载半安装插件。部分复制失败清理本次临时恢复目录，原备份不消耗。
- **损坏记录继续保留证据。** 无效 schema、路径、JSON 与符号链接仍拒绝解释。显式重试也只处理重新通过严格校验的 journal；兼容旧版因临时错误而隔离的有效事务。没有新增丢弃备份、重置插件库或自动接受损坏记录的按钮。诊断仅包含路径、稳定错误码及故障类别，JSON 解析器的原文片段不进入界面或复制内容。
- **恢复界面接通实际宿主。** 插件工作区显示恢复阻塞、中文处理动作、重试与复制诊断。新增共享类型、main IPC、preload 和远程桥；重试检查忙状态/关闭屏障，安全恢复后才重新加载。运行中回滚失败也会通知界面，重新加载失败继续阻塞。窄窗关闭浮动侧栏后可正常操作。恢复期间列表显示“恢复后显示已安装插件”。
- **SDK 生产依赖 staging。** 作者显式 `build.stageDependencies: true` 后，在构建机独立临时目录按匹配的 npm package-lock v2/v3 执行生产/optional 安装，固定 `--ignore-scripts` 和 `--bin-links=false`；不使用工程 node_modules，不执行插件入口。保留传递依赖、资源、包元数据和许可证，省略 dev 依赖；v2 inventory 覆盖全部内容，并记录 lock SHA-256、Node/npm 和构建平台。安装失败移除不完整构建输出，不能继续打包半成品。

依赖 staging 支持有 integrity 的 HTTPS archive 与工程内 tarball，拒绝 workspace/link/git、目录依赖、越界、符号链接、原生 `.node` 和可执行二进制。portable 拒绝含 OS/CPU/libc 限制的依赖，平台依赖需对应 OS/架构 runner。需要安装脚本生成运行文件的包不在本批支持范围。桌面内置 pack 继续只检查/归档已构建产物，未加入 npm 安装步骤。实际 ZIP 安装与使用无需系统 Node/npm。

## 本次验证与证据

环境为 Windows x64，Node v24.18.0、当前固定 `.9 / replacement-714ba8c41bb5` Electron。测试仅使用临时插件库、合成插件和离线 tarball；未操作个人插件或真实账号。

- 桌面 `npm run test:plugins:unit`：**93/93**。其中新增六类 IO 错误 ENOSPC/EDQUOT/EACCES/EPERM/EBUSY/EIO 在六个提交点的注入、六类恢复失败保留/解除后重试，以及部分写入、fsync、提交后清理失败、目录拒绝、旧隔离事务重试和诊断脱敏。见[插件定向日志](../../_planning/plugin-s1-unit-tests-2026-11-06.log)。这些是确定性故障注入，不是物理磁盘耗尽认证。
- 最后一次全量 `npm test` 为 **957/958**：问卷模块 `drafts and conflicts survive restart while submissions are immutable and idempotent` 比较重启记录时，缺省 `description/source` 字段与显式 undefined 不一致。本批没有修改问卷模块，该文件在工作期间由并行改动更新。保留[全量失败日志](../../_planning/plugin-s1-tests-2026-11-06.log)，不宣称当前整个工作区回归全绿。更早一次并行构建期间的原生 UI 定时断言也出现过失败，后续完整运行未再出现该项。
- SDK `node --test test/static-check.test.mjs test/production-dependencies.test.mjs`：**15/15**。新增按锁准备传递/optional 闭包、dev 排除、许可证/资源保留、禁用安装脚本；ZIP 解包并移走源码后独立 Node 离线调用成功；缺锁、锁漂移、integrity 篡改、外平台 runner、路径越界、.node/二进制与 portable 平台依赖拒绝。见[完整日志](../../_planning/plugin-sdk-s1-tests-2026-11-06.log)。离线 Node 调用不代替其他平台的真实 Electron 认证。
- `npm run test:plugins:faults`：**两项真实 Windows 故障通过**。另一个 PowerShell/.NET 进程持有拒绝写入/删除共享的 index 句柄，以及 Windows 只读文件属性；安装/回滚受阻时备份保留，解除后恢复旧插件、套件成员与索引，再次恢复幂等。见[结构化报告](../../_planning/plugin-s1-real-faults-2026-11-06.json)。文件只读属性不等于真实 ACL 变化。
- `npm run test:plugins:interruption`：原有**六处直接进程退出、四处恢复再中断**全部回归通过。见[日志](../../_planning/plugin-s1-interruption-2026-11-06.log)。不代表物理断电。
- `node scripts/ui-plugin-recovery.mjs`：真实 Electron main/preload/插件工作区，**普通及减少动画两种模式各八项检查通过**，含阻塞时入口零执行、实际恢复 IPC、复制诊断脱敏、有效隔离事务恢复、损坏记录保留、390px 布局、夹具修复后重试加载，以及已打开工作区在真实只读故障导致卸载回退失败后自动显示恢复入口、解除故障后恢复旧插件。见[普通报告](../../_planning/plugin-s1-recovery-ui-2026-11-06/completed.json)、[减少动画报告](../../_planning/plugin-s1-recovery-ui-2026-11-06/reduced-motion/completed.json)、[宽窗截图](../../_planning/plugin-s1-recovery-ui-2026-11-06/plugin-recovery-required.png)、[窄窗截图](../../_planning/plugin-s1-recovery-ui-2026-11-06/plugin-recovery-narrow.png)。夹具只修复其自身临时损坏 journal；产品没有自动修复未知记录的能力。隐藏窗口夹具模拟 show 通知以释放启动屏障，不能用作真实启动呈现认证。
- `npm run typecheck`、Vite renderer 构建、`scripts/build-electron.mjs` 均通过。本批构建与旧发行包分别记录，未将旧 0.4.13 制品报告当成本批验包结果。

首次界面测试受沙箱账户的 Electron AppContainer ACL 限制，随后在正常本机权限、同样隔离 profile 下验证通过，没有修改安装目录 ACL。测试清理自己的临时 profile、锁持有进程和依赖 staging。

## 仍有效的剩余规划

1. **故障矩阵继续补齐。** 真实磁盘耗尽/配额、完整文件锁和 ACL 变化、物理断电、设备 IO 故障、标准用户安装/便携版矩阵仍待实测。本批注入覆盖与两项真实文件故障不能合并成整项通过。
2. **父进程强杀回收仍未实现。** Windows Job Object kill-on-close、自有进程树归属及强杀证据；Unix 进程组/监护策略仍待实现。当前 `parentDeathCleanup: false` 保持真实，不用直接子进程正常取消替代。
3. **私有目录 ACL、严格临时磁盘配额与升级排空交互未完成。** 损坏记录的人工支持流程需要保留备份；不得建议直接删 journal/隔离目录绕过阻塞。
4. **依赖交付认证尚未扩大。** 已完成 SDK 的受限生产闭包，不支持原生 ABI、需安装脚本的依赖、跨 OS/架构复制或任意动态加载认证；各目标 runner 与干净 Electron 环境仍各自验收。
5. **macOS/Linux 仍为 planned。** 当前 `scripts/electron-runtime-manifest.json` 仅 win32-x64，安装脚本明确拒绝其他 OS/架构。缺少等能力定制 Electron pin、对应目标 runner、实机运行和签名/公证/quarantine/noexec/正式下载链证据，不能只增加配置后宣布支持。

下一批先落实 Windows 自有进程树强杀回收，再扩展真实磁盘/ACL/用户矩阵；只有取得对应宿主和实机条件后，才进入各非 Windows 目标的运行与分发认证。
