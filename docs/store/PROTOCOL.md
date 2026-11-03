# navora-store 目录协议（v1 兼容与 v2 隔离）

> 2026-11-01 协议快照，来源：并列 navora-store/PROTOCOL.md。命令在商店工程内执行。

核对日期：2026-11-01。UI 操作见 [README](./README.md)，桌面入口见 [插件商店指南](../plugin-store-guide.md)。v1 保留旧包，v2 隔离新格式产物，避免旧客户端忽略平台约束后安装错误文件。

桌面端 `MarketplaceClient` 与本仓静态目录的契约。客户端**忽略未知字段**；不要为加可选键升版本。

## 传输

公开只读文件，无下载鉴权；发布权限由部署侧账号管理。`store.base_url` 为 HTTP(S)、`file://` 或 catalog 目录绝对路径。

| 方法 | 路径 | 载荷 |
|------|------|------|
| GET | `/index.json` | `CatalogIndex` |
| GET | `/{downloadPath}` | zip 字节 |
| GET | `/{readmePath}` | Markdown |

`downloadPath` / `readmePath` **必须**是 catalog 相对路径，匹配：

```text
(plugins|skills)/<id>/<version>/(package.zip|README.md|SKILL.md)
plugins/<id>/<version>/artifacts/<artifactId>/(package.zip|README.md)
```

禁止 `..`、绝对路径、带 scheme 的 URL。服务端须拒绝目录穿越。`index.json` 可带 `ETag`；客户端可用 `If-None-Match`。

源服务仅允许 GET/HEAD，提供 `/healthz`，其它方法 405；不公开 meta、incoming 或维护记录。`/index-v2.json` 不存在时返回 404，下架 ZIP 返回 410。两种 index 响应均从同一份内存快照生成正文、Content-Length 和 ETag，避免原子替换时混用两份索引。

## CatalogIndex

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-14T00:00:00.000Z",
  "products": []
}
```

- `schemaVersion` 缺失或 `< 1`：整表拒绝。
- 旧客户端可能把高版本按 v1 字段解释，不能只靠提升 schemaVersion 保护平台包；新桌面仅接受已支持的 v1/v2。
- 产品主键：`kind` + `productId`（插件与技能命名空间分离）。
- `displayMode`：`single`（一行一包）或 `suite`（同 `suite` 合并；本机同套件只留一包）。

产品包含 kind、productId、displayMode、name、description 与 packages。包包含 id、name、description 与 versions，可选 suite / minHostVersion。productId 标识聚合产品，packageId 标识实际安装的变体，不能混用。

桌面 list/get 可返回 installed（packageId、version、name），它来自当前本机安装清单，**不写入公共 index.json**。插件工作区收到安装变更后按实际包 ID 重新计算安装标记；卸载后不得复用旧的 installed 快照。

### Package / Version

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` / `name` / `description` | 是 | 包标识与展示 |
| `suite` | 否 | kebab-case，字母开头 |
| `versions[].version` | 是 | 新发布必须为严格 SemVer，且可安全作为路径段 |
| `versions[].sha256` | 是 | zip 小写 hex |
| `versions[].size` | 是 | 字节；下载后必须相等 |
| `versions[].downloadPath` | 是 | 见上 |
| `versions[].publishedAt` | 是 | ISO 时间 |
| `versions[].hasReadme` | 否 | 有说明则为 true |
| `versions[].readmePath` | 否 | 有说明时必填 |
| `versions[].minHostVersion` | 否 | 低于此桌面版本不可装 |
| `versions[].status` | 否 | `active`（默认）或 `yanked` |

`yanked` 保留历史包和目录记录，源服务拒绝下载，新桌面不默认选择也不允许显式安装。安装预检重新验证目录；全部版本下架时不推荐更新。旧客户端的已下载缓存、手动本地导入和已安装副本无法由源站下架撤回，当前没有远程停用机制。脱离本源服务、直接静态托管 ZIP 时也没有 410 检查，不能宣称已实现相同的下架保证。

默认版本选择排除预发布，并在主进程预览、更新检查时按宿主兼容性过滤。显式选择未下架的预发布版本仍可安装。新目录仅在版本上记录 minHostVersion，避免最高版本的要求误伤旧版本；桌面保留纯包级声明的旧目录兼容。

## 版本比较

semver 核心 `major.minor.patch`，再比预发布。`1.0.0-beta.1` < `1.0.0`；`1.10.0` > `1.9.0`。Build（`+`）忽略。

## 入库校验（须与桌面安装对齐）

插件 zip ≤ 200MB：

- 条目不得含 `..`、绝对路径、Windows 特殊路径、符号链接或特殊文件；拒绝大小写冲突/重复条目
- 最多 10,000 条目；声明解压总量 ≤500MiB，单条目 ≤200MiB，manifest/说明 ≤2MiB
- `plugin.json`：`id` `name` `version`；版本与最小宿主版本须为严格 SemVer；`main` 仅为 `.cjs` / `.js`，按 manifest 所在目录检查完整路径，不回退搜索同名文件
- `suite` 与旧字段 `exclusivityGroup` 同一套 kebab 规则

技能：优先 `SKILL.md` frontmatter `id`（稳定 kebab）；无 `id` 时才从 `name` 派生（遗留）。

发布使用私有 staging 和独占写锁；整批准备完成，先移动完整的不可变版本目录，最后原子提交索引。失败保留上一索引，既有元数据损坏不静默忽略。相同 ZIP 和说明幂等，同版本不同内容拒绝，禁止 --force。旁路说明首次发布后保持不变；重建仅验证既有产物并生成索引，不重抽说明。崩溃恢复、回滚范围和备份见 [部署说明](../../../navora-store/deploy/README.md)。

## 新格式产物隔离

`packageFormatVersion: 2` 的插件需要 artifactId、target、runtime 和完整 runtime-files.json；入库验证文件清单的大小和 SHA-256。`index-v2.json` 中同包同版本包含 `artifacts[]`，每个产物有自己的下载路径、摘要、大小和运行时约束。v2 同时可以包含旧格式版本；同一包的同一版本不能混用旧格式 ZIP 与新格式产物。新格式版本不进入 `index.json`，旧版本仍保留。

两份索引分别原子替换，v2 为主目录，再更新只含旧版本的 v1 投影；不宣称它们可以跨文件同时切换。v1 投影失败明确报告 warning，后续 rebuild 即使主目录未变化也会修复。回滚旧 v1 快照时，若已有 v2 端点，也更新它以防新桌面继续看到未回滚的版本。下架按包版本作用于全部产物，回滚保留当前下架状态。

## 安装流水

`previewInstall` → 用户确认（`overwrite` / `replaceSuite`）→ 下载 → 复核 `size` + `sha256` → 交给 `PluginStore` / `SkillStore`。

进度阶段（客户端事件，按实际发生顺序）：`download`（可带字节）→ `verify` → `replace_suite`（仅换套件）→ `extract` → `import`。本地 zip 导入无 `download`。

阶段按后端实际回调显示，某些校验可能在导入器内再次发生，不把这组名称当作每次必然完整执行的固定序列。安装成功以 install 返回 ok 与本机加载结果为准，不能仅凭下载结束或进度达到某个阶段宣称安装成功。

Agent 仅 `store_search` 推荐，不代装。

## 明确不做

公众账号、HTTP 管理接口、第三方上传、公共 CDN、签名吊销、分页检索。
