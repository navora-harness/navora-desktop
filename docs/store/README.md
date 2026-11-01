# navora-store

> 2026-11-01 维护快照，来源：并列 navora-store/README.md。源文档调整后同步本页；下文 CLI 命令在商店工程内执行。

更新日期：2026-11-01。本文是商店维护入口；桌面使用说明见 [插件商店指南](../plugin-store-guide.md)，项目全部文档见 [文档导航](../README.md)。协议字段以 [PROTOCOL.md](./PROTOCOL.md) 为准，跨平台产物和原生运行时仍属设计阶段，不是当前目录能力。

本地 / 可切换源的 **插件与技能目录仓**（当前以本机测试为主：无用户、无鉴权、无公共发布）。

目录契约见 [PROTOCOL.md](./PROTOCOL.md)。Desktop 通过配置 `store.base_url`（默认 `http://127.0.0.1:8791`）查询目录、拉取说明、下载并安装。

## 能力概览

| 能力 | 说明 |
|------|------|
| 目录聚合 | 单包按产品展示；同 `suite`（如 crypto-suite）合并为一行 |
| 说明文件 | **发布时自动入库**：从 zip 抽出 `README.md`（技能为 `SKILL.md`）；也可旁路 `<zip名>.README.md`。`rebuild` 会强制重抽 |
| 安装流 | 选产品及版本/变体 → `previewInstall` → 确认 → 校验字节数和 SHA-256 → 本地安装 |
| 更新 / 更改 / 卸载 | 有新版本时更新，已安装套件可更换变体，卸载需确认；安装后原位刷新状态 |
| 信任提示 | 非 HTTPS 源在标题旁黄叹号：「未知第三方来源（当前商店连接未加密）」 |

## 布局

```text
incoming/          # 投放区：丢入 plugin zip 或技能目录后 rebuild
catalog/
  index.json       # Product 聚合目录（生成物）
  plugins/<id>/<ver>/
    package.zip
    meta.json
    README.md      # 有则抽出
  skills/<id>/<ver>/
    package.zip
    meta.json
    SKILL.md / README.md
```

- **single**：一行一个产品，安装时选版本。
- **suite**：多变体合并；同 suite 本机只保留一个包（`replaceSuite`）。

## CLI

```bash
cd navora-store
npm install

# 单包发布（也可 --force 覆盖同版本）
npx navora-store publish path/to/foo-1.0.0-plugin.zip
npx navora-store publish path/to/my-skill-dir

# 扫描 incoming/ 入库 + 全量重建 index（并回填缺省说明文件）
npx navora-store rebuild
npx navora-store rebuild --force

npx navora-store list
npx navora-store serve            # 默认 127.0.0.1:8791
npx navora-store serve --port 8791
```

静态入口示例：

- `GET /index.json`
- `GET /plugins/<id>/<ver>/package.zip`
- `GET /plugins/<id>/<ver>/README.md`

## 与官方插件仓

```bash
cd ../navora-plugins
npm run pack             # 打包前会同步项目根 README.md 进 zip
npm run store:publish    # 复制 dist/*-plugin.zip → incoming/ 并 rebuild（说明自动抽出）
```

说明入库规则：

1. `navora-plugin pack` 会把项目根目录的 `README.md` / `docs.md` 写入各包 dist 再打 zip（改说明不必先 `build`）。
2. `navora-store publish` / `rebuild` 入库时自动抽出说明到 `catalog/.../README.md`，并写入 `meta.hasReadme`。
3. 可选旁路：与 zip 同目录放置 `<zip文件名不含.zip>.README.md`（优先于 zip 内说明）。

```bash
cd ../navora-store
npx navora-store serve
```

然后在 Desktop：左侧 **插件** → **插件商店**。侧栏还提供搜索插件与已安装插件，右侧显示介绍、说明、工具、版本和管理操作。设置 → 插件仅保留开发模式开关，批量管理位于插件工作区；**技能商店**仍在设置 → 技能。旧的商店浏览窗口继续供设置和对话推荐使用。

已安装分类不依赖商店连接。搜索同时检索本机名称、用途、工具与商店产品和变体，避免重复展示同一已安装包；商店离线后可继续管理本机插件。右侧启停不等于给予无限权限，后续执行仍由宿主权限计划约束。

## Desktop 对接

| 配置 | 默认 |
|------|------|
| `store.base_url` | `http://127.0.0.1:8791`（也可填 catalog 目录绝对路径 / `file://`） |

主要 IPC（`window.navora.store`）：

- `status` / `list` / `get(productId, kind?)` — 同名插件与技能须带 `kind`
- `previewInstall` / `install`
- `onProgress` — 下载字节及实际发生的 download / verify / replace_suite / extract / import 阶段；本地包无网络下载阶段
- `readDocs` — 拉取产品说明 Markdown
- `checkUpdates`

安装最终仍走现有 `PluginStore` / `SkillStore` 的 zip/路径导入，含 suite 互斥与覆盖确认。

Agent 可用 `store_search` 查目录；Chat 会把结果和「推荐安装」追问画成与设置页相同的列表卡片，点安装仍走上述确认窗。

## 边界（当前不做）

用户 / 组、远程鉴权、公共 CDN 发布、签名吊销、完整在线市场后台。目录协议已按「可换 HTTPS 源」预留。

## 维护与验证

- 优先发布新版本；`publish --force` 或 `rebuild --force` 会覆盖同版本，仅在明确需要替换发布物时使用。
- incoming 中已处理内容移至 incoming/.processed；catalog 是发布产物，勿手工修改 ZIP、size、sha256 或版本说明来修正 UI。
- 调整说明应先更新插件源码/旁路说明并重新发布，确保已发布包、元数据和展示说明可对应；文档整理无需重新入库现有 catalog。
- 当前桌面目录读取有约 15 秒缓存。刚发布的版本若未立即显示，等待缓存到期再刷新；故障时检查源地址与 index.json，保留已有安装内容。
- `store.base_url` 指向 HTTP 根或包含 index.json 的 catalog 目录；不是包含 incoming/catalog 的商店工程根。
- 桌面 `npm run test:ui:plugins` 使用隔离本地目录和真实 PluginStore 验证安装、更新、卸载、查询去重、失败恢复、窄屏与减少动效，不修改这里的现有 catalog。

相关后续设计：[跨平台安装与原生运行时](../plugin-platform-installation-plan.md)、[Fastls 集成](../fastls-plugin-plan.md)。schema v1 当前仍只有每个版本一份 package.zip，不具备按平台自动选产物的实现。
