# Electron .8 自动化适配与 0.4.4 发行记录

日期：2026-11-05，北京时间。应用版本 `0.4.4`，Windows x64；定制运行时 `45.0.0-cloudbypass.8`。用户明确要求恢复后台焦点隔离，所有 Agent 页面租约期间固定启用；完整跨 frame 连续性继续搁置。当前工作基于已有未提交源码继续完成，未覆盖正在运行的旧程序或个人资料。

## 实现范围

- 原生点击迁移到单对象 `clickElement`，保留 `AgentDispatchResult` 的状态、阶段、目标、派发警告及失败原因。Flow 对部分、未知或取消派发立即停止，不自动重复已发生的点击。
- 原生鼠标、触摸点与鼠标序列分别使用主视口 `position` 或目标内 `offset`；公开 Agent 工具现有 `x/y/from` 保持兼容。几何结果和 `sendInputEvent` 参数不变。
- 跨文档几何查询保留 `.target`。旧 `agentInfo` 工具参数通过首个几何目标与无筛选快照组合实现，保留完整覆盖信息与首匹配语义，不再透传已删除的原生选项。
- 控制器迁移到 `setAutomationOptions`、`getAutomationState`、`resetAutomationOptions`。Agent 租约期间统一开启 `isolateInput`、`blockRealPointer`、`blockRealKeyboard`、`keepRendering`，包含模型思考与工具间等待；旧 `protect_input:false` 不会削弱隔离。
- 光标显示独立配置，隐藏使用 `virtualCursor.enabled:false`，移除透明图片才可隐藏的限制。设置页说明后台独立操作始终开启。
- 正常结束先结算已提交工作再重置；显式停止仅取消匹配 run 的页面，原生输入可提前重置，外部导航仍等待终止确认。旧 run 不得释放新 run；人工批注保持自身控制权。
- 成功重置后读取实际配置、渲染需求及 `inputActive`。持键清理始终结算本地账本，已被原生重置释放的输入不重复派发；`sendInputEvent` 后备路径保留自身释放。重置失败或输入残留继续显示未确认。
- `.8` 显式继承既有原生菜单、列表、多行输入和滚动条能力，防止只认 `.7` 的判断关闭批注及菜单缩放。

独立 `navora-flow-desktop` 使用自己的普通 Electron 和执行层，本轮未将主产品的支持状态扩写到该项目。原生系统输入法、硬件输入、多设备 DPI 与完整跨 frame 捕获/事件连续性不由本轮隐藏页测试外推。

## 运行时身份与安装

正式发布：[Electron v45.0.0-cloudbypass.8](https://github.com/ChengHoward/edist/releases/tag/v45.0.0-cloudbypass.8)。GitHub 资产摘要、本机正式发行镜像、npm 包内类型和已安装二进制已核对。

- ZIP：169161261 字节，SHA-256 `45dad07da346b67d1c16dd6b47e09f13405f11663b1e57ed9d76b7525efd85f8`。
- npm TGZ：SHA-256 `b9bc28ffeec55c641ad96c0399de891f6c6f48f8d5f8f29b29d9f12175780afa`。
- 公开类型：SHA-256 `e622d6eacb9b824210591a52b512bff3ba83e40a3cf66aa0d196914f46c1bf41`。
- 原始 exe：SHA-256 `6e0844ec5fd9bf77b0010c9c1aacfcfea93fb2b1539de2a4be9b1dd5cddf250d`；PE `.text` SHA-256 `147041bcf22d83814aad081a9bfc3948d0639cba3a12f38850a238336cf133e5`。
- 内部 Electron 仍为 `45.0.0-beta.5`，Chromium 为 `156.0.8078.36`；不以内部版本号区分 `.7/.8`。

新运行时放在 `node_modules/electron/dist/45.0.0-cloudbypass.8`，包入口和 `electronDist` 一致。先解压并验证，再原子切换入口；入口提交失败保留旧指针并恢复旧目录。运行中的旧 `dist/electron.exe` 保留，未停止用户程序。发行验证检查新自动化绑定与 `.text` 身份。

## 验证证据

证据根目录为工作区 [_planning/electron8-adaptation-2026-11-05](../../_planning/electron8-adaptation-2026-11-05)。发行方自己的验收不替代下列 Navora 检查。

- 完整生产构建、类型检查和 **668 项源码测试**通过：`build-release.log`；最终设置文案可见性调整后前端构建和类型检查再次通过：`frontend-release-final.log`、`typecheck-release-final.log`。
- 真实 `.8` 控制权专项 **13 项**通过：`ownership.log`，核对整轮隔离、隐藏光标、旧 run 与完整交还。
- 真实 `.8` 后台隔离专项通过：`isolation/result.json`，包含从未显示过且已挂载的 WebContentsView 在截图前推进动画、实际像素更新、中文仅写入目标、租约等待、原生重置后只释放一次鼠标、节流恢复与人工交还。系统输入采样单独记录，并发真实输入时不强行判定。
- 真实轨迹专项通过：`pointer-agent.log`，覆盖实际确认起点、定时中间事件、主文档/iframe 局部坐标、缩放、遮挡/旧目标拒绝、取消及持键清理。Flow 部分失败检查是在真实点击后注入宿主回执，证明无重复点击，不冒称自然发生的原生部分失败。
- 真实原生文本专项 **20 类**通过：`native-text.log`，包含 Unicode 边界、替换/追加、多行、shadow/frame、Enter 隐藏/移除、延迟结果与取消不重放。
- 实际应用原生浏览器界面 **12 项**、原生批注 **7 项**通过：`ui-native-chrome/completed.json`、`ui-native-annotations/completed.json`。原生菜单显示被测试夹具抑制，真实对象、回调和业务结果已核对；原生动作注入不代替物理 IME 验收。
- Agent 界面 **61 项**通过：`ui-automation/completed.json`、`ui-automation-final-visible.log`，覆盖始终开启的后台隔离说明、隐藏光标、整轮等待、交还／恢复、原生批注、下载及窄窗入口；已查看最终设置页截图，确认“始终开启”可见。`release_unconfirmed` 为预期故障注入。
- 成品文件、运行时资源与源构建核对通过：`release/v0.4.4/package-verification.json`。安装版和便携版内嵌应用的文件名、大小、CRC32及核心 SHA-256 核对通过：`payload-verification.json`。
- 成品独立启动通过：`release/v0.4.4/startup-report.json`，版本和 `.8` 原生能力正确，渲染错误为零，正常退出且移除临时资料；未执行安装器。

综合浏览器测试 **未通过**：36 类功能断言与 73 项权限检查完成，最终本地 HTTP 页面真实恢复、7 个 Session 的 Cookie 刷盘与连接关闭、3 个 HTTP 服务关闭以及全部窗口销毁均完成，日志已到 `app:quit(0)`，但进程未自然结束，60 秒截止后由父进程终止。最终证据：`browser-local-restore-cookie-final.log`。没有绕过退出断言或强制返回成功。8 组最小对照及成品独立启动均正常退出；目前证据不足以将综合夹具的原生收尾问题归因到某一接口，完整综合测试仍需后续定位，不能计作通过。

## 制品

安装版：[Navora-0.4.4-Setup.exe](../release/v0.4.4/Navora-0.4.4-Setup.exe)；便携版：[Navora-0.4.4-Portable.exe](../release/v0.4.4/Navora-0.4.4-Portable.exe)。摘要和文件清单：[SHA256SUMS.txt](../release/v0.4.4/SHA256SUMS.txt)、[release-manifest.json](../release/v0.4.4/release-manifest.json)。文件尚未提交或推送，未发布到外部服务。
