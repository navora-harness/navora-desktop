# navora-store 目录协议（schema v1）

> 2026-11-01 维护快照，来源：并列 navora-store/PROTOCOL.md。源协议调整后同步本页及桌面共享类型；快照不增加运行时支持。

核对日期：2026-11-01。适用于现有静态目录与桌面安装器；UI 操作见 [README](./README.md)，桌面入口见 [插件商店指南](../plugin-store-guide.md)。规划中的 index-v2.json 与 artifacts 结构尚未实现，不应添加到 v1 目录并假定旧客户端会执行平台选择。

桌面端 `MarketplaceClient` 与本仓静态目录的契约。客户端**忽略未知字段**；不要为加可选键升版本。

## 传输

静态文件，无鉴权。`store.base_url` 为 HTTP(S)、`file://` 或 catalog 目录绝对路径。

| 方法 | 路径 | 载荷 |
|------|------|------|
| GET | `/index.json` | `CatalogIndex` |
| GET | `/{downloadPath}` | zip 字节 |
| GET | `/{readmePath}` | Markdown |

`downloadPath` / `readmePath` **必须**是 catalog 相对路径，匹配：

```text
(plugins|skills)/<id>/<version>/(package.zip|README.md|SKILL.md)
```

禁止 `..`、绝对路径、带 scheme 的 URL。服务端须拒绝目录穿越。`index.json` 可带 `ETag`；客户端可用 `If-None-Match`。

## CatalogIndex

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-14T00:00:00.000Z",
  "products": []
}
```

- `schemaVersion` 缺失或 `< 1`：整表拒绝。
- `> 1`：若仍有 `products[]`，按 v1 字段读取（附加字段忽略）。
- 产品主键：`kind` + `productId`（插件与技能命名空间分离）。
- `displayMode`：`single`（一行一包）或 `suite`（同 `suite` 合并；本机同套件只留一包）。

产品包含 kind、productId、displayMode、name、description 与 packages。包包含 id、name、description 与 versions，可选 suite / minHostVersion。productId 标识聚合产品，packageId 标识实际安装的变体，不能混用。

桌面 list/get 可返回 installed（packageId、version、name），它来自当前本机安装清单，**不写入公共 index.json**。插件工作区收到安装变更后按实际包 ID 重新计算安装标记；卸载后不得复用旧的 installed 快照。

### Package / Version

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` / `name` / `description` | 是 | 包标识与展示 |
| `suite` | 否 | kebab-case，字母开头 |
| `versions[].version` | 是 | semver-ish |
| `versions[].sha256` | 是 | zip 小写 hex |
| `versions[].size` | 是 | 字节；下载后必须相等 |
| `versions[].downloadPath` | 是 | 见上 |
| `versions[].publishedAt` | 是 | ISO 时间 |
| `versions[].hasReadme` | 否 | 有说明则为 true |
| `versions[].readmePath` | 否 | 有说明时必填 |
| `versions[].minHostVersion` | 否 | 低于此桌面版本不可装 |
| `versions[].status` | 否 | `active`（默认）或 `yanked` |

`yanked` 表示下架，不删除历史包；显式选择时仍由安装预检决定能否安装。当前桌面的 latestPackageVersion 优先选未下架版本，但只有下架版本时会退回全列表；因此 v1 不是撤销分发机制，不能依靠 yanked 阻止所有安装或自动选择。

## 版本比较

semver 核心 `major.minor.patch`，再比预发布。`1.0.0-beta.1` < `1.0.0`；`1.10.0` > `1.9.0`。Build（`+`）忽略。

## 入库校验（须与桌面安装对齐）

插件 zip ≤ 200MB：

- 条目不得含 `..` / 绝对路径
- `plugin.json`：`id` `name` `version`；`main` 仅为 `.cjs` / `.js`，不得 `..`
- `suite` 与旧字段 `exclusivityGroup` 同一套 kebab 规则

技能：优先 `SKILL.md` frontmatter `id`（稳定 kebab）；无 `id` 时才从 `name` 派生（遗留）。

## 安装流水

`previewInstall` → 用户确认（`overwrite` / `replaceSuite`）→ 下载 → 复核 `size` + `sha256` → 交给 `PluginStore` / `SkillStore`。

进度阶段（客户端事件，按实际发生顺序）：`download`（可带字节）→ `verify` → `replace_suite`（仅换套件）→ `extract` → `import`。本地 zip 导入无 `download`。

阶段按后端实际回调显示，某些校验可能在导入器内再次发生，不把这组名称当作每次必然完整执行的固定序列。安装成功以 install 返回 ok 与本机加载结果为准，不能仅凭下载结束或进度达到某个阶段宣称安装成功。

Agent 仅 `store_search` 推荐，不代装。

## 明确不做

用户/组、远程鉴权、公共 CDN、签名吊销、分页检索。
