# 文档导航

整理日期：2026-11-01。当前行为以 [当前功能与验证边界](./current-state.md) 为准；设计草案和历史验收记录保留原日期，不代表最新版本全部功能。

## 使用与开发

- [项目首页](../README.md)：运行环境、开发、构建和数据目录。
- [当前功能与验证边界](./current-state.md)：侧栏、对话、资源、插件与待实现能力。
- [项目与插件开发说明](./project-and-plugin-guide.md)：宿主、工具、插件 SDK、权限及关联仓库。
- [模块索引](./modules.md)：主进程、渲染界面和共享契约；早期章节与最新实现的差异见页首说明。
- [插件与技能创建器](./creator-plan.md)：草稿、校验、生成、试用、安装与导出。
- [插件商店使用与维护](./plugin-store-guide.md)：桌面入口、发布、安装和故障排查。

## 商店与插件契约

- [商店 README](./store/README.md)：本地目录仓与发布命令的维护快照。
- [商店协议 v1](./store/PROTOCOL.md)：产品、变体、版本、路径、大小与摘要的维护快照。
- [插件 SDK 规范](../../navora-plugin-sdk/SPEC.md)：插件运行时和打包契约。
- [官方插件](../../navora-plugins/README.md)：独立插件工程及产物。

SDK 与官方插件链接按关联仓库并列检出组织；仅检出桌面仓库时，可从项目首页访问关联仓库。商店工程当前位于本机并列目录，其 README/PROTOCOL 在本仓 docs/store 保留带日期的快照，以便单独检出桌面仓库也能查阅；维护商店源文档时应同步快照。商店 catalog 下的说明是各版本插件包的发布产物，由 publish/rebuild 同步，文档整理不直接改写这些版本文件。

## 后续设计

- [功能路线](./feature-roadmap-2026-10.md)：已交付项及接管、编辑、运行恢复等后续验收。
- [跨平台插件安装与原生运行时](./plugin-platform-installation-plan.md)：待实施，平台产物和协议 v2 不属于当前安装能力。
- [Fastls 与 fastls-curl 集成](./fastls-plugin-plan.md)：待对接发布物和调用契约，不代表已经接入。

## 历史设计与阶段记录

- [早期架构草案](./architecture-plan.md)：保留当时设计决策，现有界面和能力见当前功能页。
- [2026-10 重构方案](./renovation-plan-2026-10.md)：立项时基线及分阶段验收。
- [重构进展](./renovation-progress.md)：阶段性结果及当时测试数量。
- [2026-10-31 项目复核](./project-review-and-update-2026-10-31.md)：该轮实施依据、结果与后续增量。
- [JS 对话框内核方案](./electron-js-dialog-customization-plan.md) 与 [宿主对接方案](./js-dialog-electron-api-plan.md)：保留设计过程；现已优先使用可探测的原生 Handler，不可用时降级。

更新规则：功能变化先同步当前功能页和用户入口说明；协议变化同时更新宿主、SDK 与商店规范。规划明确标记待实施，测试数量绑定记录日期，构建截图、用户数据与凭据不作为源码文档提交。
