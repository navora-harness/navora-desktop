# 已完成规划

整理日期：2026-11-05。共归档 29 份已有正式实施记录的规划文档。归档对应各专题已实施的范围；原文中的历史状态、版本和设备验证边界保留，不代表后续新增目标或全部平台已经验收。

最新功能以[当前状态](../current-state.md)为准，未完成与搁置事项见[待办总清单](../planning-status-and-next-work-2026-11-04.md)。实施与检查记录继续保留在上级目录。

## 基础与界面

- [早期架构与实现](./architecture-plan.md)：初期架构及评审清单已实现，后续产品能力以当前功能页为准。
- [插件与技能创建器](./creator-plan.md)：创建、校验、安装、试用和导出已实现。
- [界面重构统一规划](./interface-renovation-plan-2026-11.md)：本轮界面及追加规划已实施；后续原生浮层迁移另由未完成专题跟踪。
- [标题栏与导航细化](./window-chrome-polish-plan-2026-11.md)：正式窗口已接入，后续视觉调整保留各自日期。
- [设置即时保存与控件整理](./settings-immediate-save-plan-2026-11.md)：核心设置流程已实施，追加导航与光标卡片已由后续实施记录完成。
- [设置返回、关于与光标卡片](./settings-navigation-and-cursor-plan-2026-11.md)：正式源码、统一构建与对应窗口检查已有完成记录。
- [侧栏外侧滚动槽](./sidebar-scrollbar-layout-plan-2026-11.md)：原规划的列表滚动归属与独立留白已实施；复杂原生悬浮侧栏仍由其专题跟踪。

## 输入与对话

- [附加菜单与富文本编辑器](./composer-attachment-plan-2026-11.md)：附加、富文本和工作区接入已实施，输入浮层后续更新另有实施记录。
- [输入区控件与浮层](./composer-controls-plan-2026-11.md)：模型、权限、发送及用量控件已接入正式源码。
- [附加任务声明](./composer-task-declarations-plan-2026-11-04.md)：声明、草稿和队列快照及计划阶段门禁已实现。
- [当前聊天内查找](./conversation-find-plan-2026-11.md)：功能及后续无反应修复已实施，并有正式构建专项记录。
- [对话输出区重设计](./conversation-output-redesign-plan-2026-11.md)：正式输出组件、过程收束及刻度导航已实施，版本和验收范围保留原记录。
- [子对话工作区](./subchat-workspace-plan-2026-11.md)：正式接入、独立运行身份及资源归属已有实施和构建检查记录。
- [标签标题、图标、换位动效与工具行](./workspace-tab-label-and-icon-plan-2026-11.md)：标签展示、排序反馈与地址工具行已实施并完成对应检查。

## 浏览器与批注

- [浏览器自动化控制](./browser-automation-control-plan.md)：控制流程与精简后的地址栏入口已实现。
- [浏览器地址栏精简](./browser-toolbar-compact-plan.md)：Agent 图标、批注入口和按需下载显示已交付。
- [浏览器资源与会话管理](./browser-resource-redesign-plan-2026-11.md)：资源及会话管理核心、公共会话两层侧栏已实施；后续原生浮层迁移由独立专题继续跟踪。
- [公共默认会话与资源侧栏](./browser-public-default-session-plan-2026-11-04.md)：公共默认会话、两层侧栏及独立窗口移回和置顶已实现。
- [原生浏览器左上角错位修复](./browser-view-origin-regression-plan-2026-11.md)：生命周期和布局归属修复已实施，并有真实原生窗口专项记录。
- [点击、框选与悬浮批注](./browser-floating-annotation-plan-2026-11.md)：原版批注已实施，现行输入与列表已完成 NativePanel 接入；旧样板保留历史用途。
- [轻量批注 V2](./browser-annotation-lightweight-plan-2026-11-04.md)：模式开关、数量入口和原生评论输入及列表已实施，旧底栏与背景占位已移除。
- [原生多行批注面板](./native-annotation-multiline-panel-plan-2026-11-04.md)：原生多行及下方按钮已接入，高度由应用测量协调；不声明内核新增自动增高接口。

## 继续保留的规划

- [原生浮层与截图退出](../native-panels-followup-plan-2026-11-04.md)及[原生侧栏迁移](../workspace-responsive-and-floating-sidebar-plan-2026-11.md)仍有未完成目标。
- [窗口 Acrylic 材质](../window-acrylic-material-plan-2026-11-04.md)仍保留首次显示与设备验收问题。
- [插件跨平台安装](../plugin-platform-installation-plan.md)、[Fastls](../fastls-plugin-plan.md)、[统一混合独立窗口](./workspace-unification-plan.md)和产品路线图继续跟踪后续阶段。
- [联网检索](../literature-search-plan.md)与[桌面自动化接口](../desktop-automation-codex-reference-plan-2026-11-05.md)按原决定搁置；被替代但未实施的方案不归入已完成。

## 2026-11-05 本轮补充归档

- [回复文件集与完整悬停反馈](./reply-file-collections-plan-2026-11-05.md)：限定首版源码与 24 项组件检查完成，尚未打包；现有 0.4.9 制品不含此更新。批量 ZIP/移动不在首版范围。

## 2026-11-05 再次复核补充归档（5 份）

- [历史事实与网页阻断修复](./agent-evidence-and-page-blocker-repair-plan-2026-11-05.md)：限定范围已于 2026-11-05 完成，纳入 0.4.10；原验证边界保留。
- [历史执行与验证漏报原诊断](./agent-history-and-page-blocker-diagnosis-2026-11-05.md)：限定范围已于 2026-11-05 完成，纳入 0.4.10；原验证边界保留。
- [普通浮层实时网页与确认框兼容](./browser-live-view-overlay-cleanup-plan-2026-11-05.md)：限定范围已于 2026-11-05 完成，纳入 0.4.10；原验证边界保留。
- [菜单补齐与三项修复总规划](./menu-audit-and-followup-plan-2026-11-05.md)：限定范围已于 2026-11-05 完成，纳入 0.4.10；原验证边界保留。
- [文件与网页混合工作区统一](./workspace-unification-plan.md)：限定范围已于 2026-11-05 完成，纳入 0.4.11；原验证边界保留。

## 2026-11-05 搜索范围调整后归档

- [顶部搜索与窗口全屏](./search-np-and-fullscreen-plan-2026-11-05.md)：主体与局部查找已交付，NP 持焦快捷键转发按用户要求取消；跨屏和物理输入等验证边界保留。
