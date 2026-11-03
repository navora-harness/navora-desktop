# navora-store

> 2026-11-01 维护快照，来源：并列 navora-store/README.md。命令在商店工程内执行。

更新日期：2026-11-01。本文是商店维护入口；桌面使用说明见 [插件商店指南](../plugin-store-guide.md)，项目全部文档见 [文档导航](../README.md)。协议字段以 [PROTOCOL.md](./PROTOCOL.md) 为准。兼容旧版 v1，同时为新格式平台包生成隔离的 v2 目录。

官方手动发布的 **插件与技能目录仓**：私有上传与 CLI 发布、不可变版本、独占写锁、整批校验、索引原子提交、发布记录与下架管理，对外提供只读 HTTP。生产通过 HTTPS 网关接入，见 [部署与维护](../../../navora-store/deploy/README.md)。尚未部署公网服务，没有网页管理员后台或公众上传接口。

目录契约见 [PROTOCOL.md](./PROTOCOL.md)。Desktop 通过配置 `store.base_url`（默认 `http://127.0.0.1:8791`）查询目录、拉取说明、下载并安装。

## 能力概览

| 能力 | 说明 |
|------|------|
| 目录聚合 | 单包按产品展示；同 `suite`（如 crypto-suite）合并为一行 |
| 说明文件 | 发布时从 ZIP 或绑定旁路提取；后续 rebuild 保留已发布说明，改说明须发新版本 |
| 安装流 | 选产品及版本/变体 → `previewInstall` → 确认 → 校验字节数和 SHA-256 → 本地安装 |
| 更新 / 更改 / 卸载 | 有新版本时更新，已安装套件可更换变体，卸载需确认；安装后原位刷新状态 |
| 信任提示 | 非 HTTPS 源在标题旁黄叹号：「未知第三方来源（当前商店连接未加密）」 |

## 布局

```text
incoming/          # 投放区：丢入 plugin zip 或技能目录后 rebuild
.staging/          # 私有暂存，全部校验通过后才提交
.releases/         # 发布意图、已提交记录及索引快照
.publish.lock      # 独占写锁；不能在活跃发布中删除
catalog/
  index.json       # Product 聚合目录（生成物）
  index-v2.json    # 有新格式产物时生成，平台版本不投影到 v1
  plugins/<id>/<ver>/
    package.zip
    meta.json
    README.md      # 有则抽出
  plugins/<id>/<ver>/artifacts/<artifactId>/
    package.zip / meta.json / README.md
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
npm ci

# 单包发布；相同内容幂等，不同内容不得覆盖同版本
npx navora-store publish path/to/foo-1.0.0-plugin.zip
npx navora-store publish path/to/my-skill-dir

# incoming 整批校验后发布，任一失败则非零退出且保留原索引
npx navora-store rebuild

npx navora-store yank plugin foo 1.0.0
npx navora-store restore plugin foo 1.0.0
npx navora-store history
npx navora-store rollback <已提交的release-id>

npx navora-store list
npx navora-store serve            # 默认 127.0.0.1:8791
npx navora-store serve --port 8791
```

静态入口示例：

- `GET /index.json`
- `GET /plugins/<id>/<ver>/package.zip`
- `GET /plugins/<id>/<ver>/README.md`
- `GET /healthz`；文件读取也支持 HEAD，其它方法拒绝

新桌面优先读取 `/index-v2.json`，不存在时返回 404 并回退到 v1。平台包按 `artifacts/<artifactId>/` 隔离存储，使用同样的读取白名单和下架检查。下架 ZIP 返回 410；incoming、meta、历史和暂存文件不对外开放。

## 与官方插件仓

```bash
cd ../navora-plugins
npm run pack             # 打包前会同步项目根 README.md 进 zip
npm run store:publish    # 复制 dist/*-plugin.zip → incoming/ 并 rebuild（说明自动抽出）
```

说明入库规则：

1. `navora-plugin pack` 会把项目根目录的 `README.md` / `docs.md` 写入各包 dist 再打 zip（改说明不必先 `build`）。
2. `navora-store publish` / `rebuild` 首次入库时抽出说明到 `catalog/.../README.md`，并写入 `meta.hasReadme`；扫描既有版本不再重新抽取。
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

公众账号、HTTP 管理接口、第三方上传、公共 CDN、签名吊销、完整在线市场后台。维护者身份和写权限通过部署侧 SSH/文件系统账号管理；下载无需登录。

## 维护与验证

- 同版本相同 ZIP 和说明为幂等操作，不改发布时间；不同内容拒绝，`--force` 已禁用，必须发新版本。
- incoming 中已处理内容移至 incoming/.processed；catalog 是发布产物，勿手工修改 ZIP、size、sha256 或版本说明来修正 UI。
- 调整说明应先更新插件源码/旁路说明并重新发布，确保已发布包、元数据和展示说明可对应；文档整理无需重新入库现有 catalog。
- 当前桌面列表有约 15 秒缓存；安装预检重新验证目录，切源清除缓存。仅下架版本不会成为默认更新，显式选择下架版本也拒绝。默认推荐稳定且宿主兼容的版本。
- `store.base_url` 指向 HTTP 根或包含 index.json 的 catalog 目录；不是包含 incoming/catalog 的商店工程根。
- 桌面 `npm run test:ui:plugins` 使用隔离本地目录和真实 PluginStore 验证安装、更新、卸载、查询去重、失败恢复、窄屏与减少动效，不修改这里的现有 catalog。
- 本工程 `npm test` 验证发布、批次失败、锁、中断恢复和只读服务；桌面 `npm run test:store` 验证实际源服务与 MarketplaceClient 联调。`node scripts/check-store.mjs <源地址>` 下载并校验全部 active 版本及说明，可接入监测。
- 回滚只恢复选定发布记录的 after 索引快照，保留下架状态和全部历史文件；后续重建会重新纳入全部版本。持续阻止问题版本应先 yank，不能依靠索引回滚或删除文件撤回已安装副本。

跨平台链路见 [跨平台安装与原生运行时](../plugin-platform-installation-plan.md)、[Fastls 集成](../fastls-plugin-plan.md)。旧版每版本仍只有一份 package.zip；新格式包必须声明目标、运行时和 artifactId，并提供经过校验的 runtime-files.json。v2 中同版本的多个产物独立存储；不可变限制以包 ID、版本和产物 ID 为边界。
