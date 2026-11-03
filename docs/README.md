# 文档导航

整理日期：2026-11-04。当前行为以 [当前功能与验证边界](./current-state.md) 为准；设计草案和历史验收记录保留原日期，不代表最新版本全部功能。

## 使用与开发

- [原生菜单与面板接入](./native-ui-integration-2026-11-04.md)：0.3.38 升级定制内核 `.5`，普通菜单和常用面板原生化，记录实时网页、输入连续性与兼容边界。
- [其余规划实施与发行检查](./remaining-plans-implementation-2026-11-03.md)：0.3.37 正式实现、459 项源码测试、真实窗口检查和发行包核验；原生接入后续见 0.3.38 记录。

- [项目首页](../README.md)：运行环境、开发、构建和数据目录。
- [当前功能与验证边界](./current-state.md)：侧栏、对话、资源、插件与待实现能力。
- [本轮界面实施与复查](./interface-implementation-check-2026-11-03.md)：正式源码改造、379 项源码测试、原生窗口及关联工程结果，明确发行包与物理输入验收边界。
- [0.3.36 后追加工作与检查](./next-iteration-check-2026-11-03.md)：聊天查找修复、快捷键弹窗/开关、仅 Agent 自动静音，以及后续子对话/输出的历史样板；最新实施与新包见 0.3.37 记录。
- [输入区控件与浮层规划](./composer-controls-plan-2026-11.md)：模型面板、回答方式／权限图标、发送状态、上下文预算及选区悬浮面板，含[离线示例](../../_planning/composer-attachment-example.html)。
- [当前聊天内查找规划](./conversation-find-plan-2026-11.md)：Ctrl/⌘ F、命中跳转／高亮、折叠内容及流式回复的阅读稳定性，细化路线 C03。
- [标题栏与导航细化](./window-chrome-polish-plan-2026-11.md)：品牌／菜单间距、导航留白与图标下移；早期[冷暖主题示例](../../_planning/window-chrome-example.html)保留细线开关，最终选择见实施记录。
- [项目与插件开发说明](./project-and-plugin-guide.md)：宿主、工具、插件 SDK、权限及关联仓库。
- [模块索引](./modules.md)：主进程、渲染界面和共享契约；早期章节与最新实现的差异见页首说明。
- [2026-11-03 项目检查报告](./project-inspection-2026-11-03.md)：本轮规划后运行的类型、测试、构建、原生界面与关联工程检查，含安装版自动化观察、控件根因、失败项与覆盖边界。
- [插件与技能创建器](./creator-plan.md)：草稿、校验、生成、试用、安装与导出。
- [插件商店使用与维护](./plugin-store-guide.md)：桌面入口、发布、安装和故障排查。

## 商店与插件契约

- [商店 README](./store/README.md)：本地目录仓与发布命令的维护快照。
- [商店协议 v1](./store/PROTOCOL.md)：产品、变体、版本、路径、大小与摘要的维护快照。
- [插件 SDK 规范](../../navora-plugin-sdk/SPEC.md)：插件运行时和打包契约。
- [官方插件](../../navora-plugins/README.md)：独立插件工程及产物。

SDK 与官方插件链接按关联仓库并列检出组织；仅检出桌面仓库时，可从项目首页访问关联仓库。商店工程当前位于本机并列目录，其 README/PROTOCOL 在本仓 docs/store 保留带日期的快照，以便单独检出桌面仓库也能查阅；维护商店源文档时应同步快照。商店 catalog 下的说明是各版本插件包的发布产物，由 publish/rebuild 同步，文档整理不直接改写这些版本文件。

## 后续设计

- [原生网页圆角与菜单面板](./native-overlay-webcontentsview-plan-2026-11.md)：采用系统菜单和专用 NativePanel 的替代路线，`.5` 发布后已恢复接入；不再新增顶层 WebContentsView。
- [子对话工作区新规划](./subchat-workspace-plan-2026-11.md)：移除左侧子树，聊天内名称进入单一汇总标签的列表/详情，保留父草稿和运行身份；含[可点击示例](../../_planning/subchat-workspace-example.html)。
- [工作区自适应与悬浮侧栏](./workspace-responsive-and-floating-sidebar-plan-2026-11.md)：分隔拖动/窗口变窄自动展开、比例恢复与迟滞、侧栏固定/悬浮两种展示和独立显隐。
- [标签图标、换位动效与地址工具行](./workspace-tab-label-and-icon-plan-2026-11.md)：混排标题/图标/音频原因、拖动让位和提交动效，以及整行高度、内距与原生视口的统一规划。
- [网页悬浮批注与专用光标](./browser-floating-annotation-plan-2026-11.md)：统一点击/拖选、目标旁评论条、临时目标与保存，以及独立于 AI 自动化的批注光标；含[离线样板](../../_planning/browser-floating-annotation-example.html)。
- [对话输出区重设计](./conversation-output-redesign-plan-2026-11.md)：参考扁平正文/工具/子对话活动排版，重新设计内容与状态，含[离线样板](../../_planning/conversation-output-example.html)。
- [原生浏览器左上角错位回归](./browser-view-origin-regression-plan-2026-11.md)：记录未提交默认边界被显示的 P0 根因；正式修复与 22 项原生专项结果见 0.3.37 实施记录。
- [侧栏外侧滚动槽规划](./sidebar-scrollbar-layout-plan-2026-11.md)：对话、文件、浏览器、插件与设置导航的滚动归属，原生轨道独立留白与嵌套滚动整理。
- [设置返回、关于与光标卡片](./settings-navigation-and-cursor-plan-2026-11.md)：光标复用主题选择形式、帮助关于统一入口、离开设置恢复来源；内容标签区域统一称工作区。
- [本轮界面重构统一规划](./interface-renovation-plan-2026-11.md)：汇总新增需求、文档、交互示例、依赖和实施顺序；第 7 节独立记录 0.3.36 后的追加目标及实际状态。
- [浏览器输入控制权与专属光标规划](./browser-input-ownership-and-cursor-plan-2026-11.md)：安装版错误与实现核对，整轮任务保护、显式人工接管及三款原生 SVG 光标设计；现已接入正式控制器，实机验证边界见实施复查。
- [设置生效与统一控件／模型配置规划](./settings-immediate-save-plan-2026-11.md)：移除全局“应用”，自动提交与局部手动提交分流，整理开关几何、双重焦点及高级模型参数。
- [浏览器资源界面重构规划](./browser-resource-redesign-plan-2026-11.md)：资源筛选、会话管理、五类空状态、菜单与危险操作拆分，含[离线资源示例](../../_planning/browser-resources-redesign-example.html)。
- [附加菜单、富文本与工作区展开新规划](./composer-attachment-plan-2026-11.md)：2026-11-03 新增，包含“添加 / 工具”菜单、句内引用、更多来源、展开后对话／文件／网页同栏，以及弹出层导致浏览器视图变白的回归方案；保留[离线交互示例](../../_planning/composer-attachment-example.html)，正式应用接入与验证见实施复查。
- [浏览器常用标签功能接入](./main-window-framework-v2-plan.md#24-浏览器常用标签功能接入2026-11-03)：共用标签与菜单、关闭恢复、固定／音频、多选移窗及空白页过滤已接入，含检查范围和剩余边界。
- [浏览器标签统一体验规划](./main-window-framework-v2-plan.md#23-浏览器标签统一体验规划2026-11-03)：设计依据，统一状态、菜单和操作规则；实际接入见第 24 节，分组／缩略图等仍待实施。
- [全界面图标接入记录](./main-window-framework-v2-plan.md#22-全界面图标接入记录2026-11-03)：96 个共享图形已接入，含 Fluent Regular、朝外／朝内折角、用途绑定与检查边界。
- [全界面图标对照评审](./main-window-framework-v2-plan.md#21-全界面图标对照评审2026-11-03)：保留 96 个共享图形的设计依据与组件内 SVG 覆盖边界，实际接入见第 22 节。
- [工作区控件接入记录](./main-window-framework-v2-plan.md#20-r2-与数量开关接入记录2026-11-03)：R2、细化后的方框数量图标、摘要右侧入口与标签后加号已接入；列明本批检查边界。
- [实施前整合规划与视觉细化](./main-window-framework-v2-plan.md#19-实施前整合规划与视觉细化2026-11-03)：设计依据，包含同位开关规则、菜单、编辑器与后续交付顺序。工作区控件接入见第 20 节，其余按各节状态推进。

- [主窗口框架重规划 V2](./main-window-framework-v2-plan.md)：2026-11-03 的整体规划，统一场景、区域职责、工作区状态、菜单归属、视觉规范与分批验收；第 1、2 批框架与入口已落地，后续场景整理及完整验收状态见第 15 节。
- [消息编辑器、附加上下文与菜单栏](./main-window-framework-v2-plan.md#1721-核心功能实施记录2026-11-03)：结构化编辑器、链接右键、可编辑来源、草稿／队列／提交快照与四菜单已接入；第 17.22 节明确 PDF／表格范围等后续能力与尚未执行的专项运行核对。
- [标签栏新建位置、工作区入口与移回图标](./main-window-framework-v2-plan.md#18-标签栏新建位置工作区入口与移回图标2026-11-03)：保留早期方案，最新 R2 与数量开关接入范围见第 20 节。
- [2026-11 产品路线图](./feature-roadmap-2026-11.md)：聊天、文件、插件、浏览器的下一阶段更新；含现状核对、任务编号、共享依赖、实施批次和发布门槛，第 9–15 节为 11 月 3 日增补。
- [文献检索加速方案](./literature-search-plan.md)：已落地首版多 API 并发查询与增量结果；记录来源级限流、去重、缓存和后续扩展计划。
- [应用窗口与内容区界面优化建议](./browser-ui-optimization-2026-11.md)：窗口层级、资源侧栏、内容区标题栏和浏览器工具栏的布局与配色建议。
- [浏览器 Agent 自动化](./browser-agent-automation.md)：原生快照、拟人轨迹、虚拟光标、页面接管与后台可信输入；运行时已升级 cloudbypass.5。
- [浏览器自动化控制规划](./browser-automation-control-plan.md)：设置、Agent 简化调用、控制权及异常恢复的实现约束与验收记录。
- [浏览器地址栏精简规划与交付](./browser-toolbar-compact-plan.md)：已完成 Agent 图标左键切换/右键面板、移除状态行、批注图标化及按需环形下载进度；适配新标签系统，隔离 `.4` 界面验证 53 项通过，含剩余验证边界。
- [2026-10 历史功能路线](./feature-roadmap-2026-10.md)：保留当时设计与验收记录；最新计划和状态以 2026-11 路线图及当前功能页为准。
- [跨平台插件安装与原生运行时](./plugin-platform-installation-plan.md)：通用机制和 Windows 闭环已实现；macOS/Linux 宿主运行与分发仍需逐平台验收。
- [Fastls 与 fastls-curl 集成](./fastls-plugin-plan.md)：三个基础工具及 Windows x64 闭环已实现；Cookie 上下文、自动逐跳和其他平台认证仍待完成。

## 历史设计与阶段记录

- [早期架构草案](./architecture-plan.md)：保留当时设计决策，现有界面和能力见当前功能页。
- [2026-10 重构方案](./renovation-plan-2026-10.md)：立项时基线及分阶段验收。
- [重构进展](./renovation-progress.md)：阶段性结果及当时测试数量。
- [2026-10-31 项目复核](./project-review-and-update-2026-10-31.md)：该轮实施依据、结果与后续增量。
- [JS 对话框内核方案](./electron-js-dialog-customization-plan.md) 与 [宿主对接方案](./js-dialog-electron-api-plan.md)：保留设计过程；现已优先使用可探测的原生 Handler，不可用时降级。

更新规则：功能变化先同步当前功能页和用户入口说明；协议变化同时更新宿主、SDK 与商店规范。规划明确标记待实施，测试数量绑定记录日期，构建截图、用户数据与凭据不作为源码文档提交。
