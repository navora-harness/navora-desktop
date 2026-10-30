# Navora Desktop 重构进展

日期：2026-10-30。完整范围与阶段验收见 [renovation-plan-2026-10.md](renovation-plan-2026-10.md)。本记录区分已验证的首批实现和后续工作，不表示整体重构已完成。

## 源码基线

开始重构前的源码已推送 `origin/main`，提交 `11b62cc`。后续实现位于 `codex/harness-renovation`，保留该基线作为回退点。探针、运行数据和真实凭据没有进入提交。

## 浏览器和 Agent

- `browserCapabilities` 检查运行时方法，不把包版本或类型声明当成实际可用证据。
- `browser_get(snapshot)` 在隔离世界采集可见元素、语义名称、链接、正文与覆盖范围。ref 不写入页面属性；导航、节点移除和语义变化后失效。
- 缓存复用在渲染进程内完成；查询排序和结果预算也在渲染进程执行，避免每次将完整索引传回主进程。词法检索支持中英文分词、精确名称优先和通用词结果过滤。
- 默认快照为标题、控件、frame 与链接保留配额，避免大量导航链接挤掉正文里的操作控件。
- 普通模型压缩保留链接、控件和 ref；超大结果始终输出有效 JSON，不返回被截断的半个对象。
- 提示词移至 `shared/agent-prompt.ts`，旧 `shared/agent-tools.ts` 导出继续兼容。保留插件、技能、权限、下载和用户决策约定，移除站点特例和仅按 URL 是否变化就重复提交的规则。
- 原生跨 frame 定位和点击已覆盖不同端口的跨域页面。不存在指定控件时明确失败，不再点击猜测的 iframe 坐标。
- 修复 frame 枚举时 `framesInSubtree` 含当前节点导致的重复递归，并增加回归。

当前索引覆盖主文档和开放 Shadow DOM。闭合 Shadow DOM 可以原生深查询，frame 可以原生跨文档查询；这两者仍不是完整内容索引。

## 插件兼容

实际 Electron 回归创建旧契约的 CJS 插件，经过 `PluginStore` 发现并加载工具，经 `planPermissions` 和 `execute` 调用 `api.runTool` 获取新快照，并验证旧 `api.ctx` 入口仍存在。未声明的 click 能力继续被 Host API 拒绝。

尚未用真实账号和外部模型跑完所有官方插件的联网任务，不能用契约测试代替这些业务验收。

## 定制 Electron 文件输入修复

原 `45.0.0-cloudbypass.2` 包可以设置 input 的文件列表，但没有为渲染进程登记对应文件读权限。之后导航会触发 `RFH_CAN_ACCESS_FILES_OF_PAGE_STATE`，Chromium 终止渲染进程。本轮使用临时文件和本机页面复现。

修复在 `WebContents::SetFileInputFiles` 中校验绝对路径，并向实际目标渲染进程授予这些文件的读权限。补丁位于 `patches/electron/file-input-read-grants.patch`，已应用到旁边的 Electron 源码并完成 Windows 增量编译。

本机已通过 `npm run electron:use-build -- <out/Release>` 将修复后的可执行文件安装到本项目，并保存 `node_modules/electron/dist/navora-build.json` 校验记录。此次没有修改 Postpile 的分发目录，也没有发布新的内核版本。

源码包仍固定为 `45.0.0-cloudbypass.2`，因此新检出或重新安装原始内核后需要应用补丁和本机构建。发布准备阶段应把修复纳入正式内核分发包。当前 `dist` 命令先执行原生浏览器回归，并使用本项目的 `electronDist`，避免重新下载未经此回归验证的内核。

## 界面和动效

通过仓库内的 `vendor/postpile-ui-0.1.2.tgz` 安装 `@postpile/ui`。复用玻璃材质、按钮加载状态、从来源按钮展开的菜单和弹窗；在 Vue 适配层处理快速中断、离场及卸载清理。设置关闭按钮移到右上角，保留原有保存、取消和插件管理行为。

真实应用的 preload、IPC、配置和渲染页面使用临时数据目录进行 UI 回归。测试以离屏合成器保持动画帧更新，不打开可见窗口；覆盖桌面、窄屏、菜单文字对比度、快速开关后的来源按钮恢复和设置弹窗。减少动态效果使用 Chromium 原生启动开关单独运行。

截图输出在 `release/ui-smoke/`，减少动态效果版本位于其 `reduced-motion/` 子目录。这批只建立界面基础，尚未完成聊天、运行证据、浏览器资源与设置的整体布局重组。

## 验证

- `npm run typecheck`：包含业务代码和 Electron 集成测试入口。
- `npm test`：本轮 21 项测试通过；部分既有测试文件内部包含多条断言。
- `npm run test:browser`：实际内核检查快照与缓存、可信点击、输入、开放 Shadow DOM、闭合 Shadow DOM 查询、跨域 frame、失效 ref、文件输入后导航、原生 prompt、自定义文档响应、插件契约，并确认 debugger 未附加。
- `npm run test:ui`：完整构建后执行桌面/窄屏与动效回归，并独立执行减少动态效果模式。

本机 HTML 夹具包含 250 个商品块。一次记录中，10 次强制采集的宿主工具往返 p50 为 9.31ms，p95 为 17.29ms；20 次缓存查询 p50 为 0.80ms，p95 为 1.14ms，缓存命中 20/20，结果 5703 字符。这是本机页面采集与检索基线，不含外部网站、模型网络或推理耗时，不能推导真实站点的端到端提速比例。

## 后续优先顺序

1. 继续拆分 Agent 运行状态、模型请求和工具路由，补取消、重试副作用与恢复回归。
2. 扩展 frame 和闭合 Shadow DOM 的结构观察，并建立实际站点访问矩阵。
3. 完成插件范围的业务回归，同时推进聊天和浏览器工作界面的整体重组。
4. 完成迁移、远程、安装包启动和正式内核分发更新后，再做发布验收。
