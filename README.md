# navora-desktop

**Navora** — 桌面端 AI Agent Harness：对接外部模型 API，用对话驱动可控浏览器、工作区与权限门闸。

| | |
|---|---|
| 组织 | [navora-harness](https://github.com/navora-harness) |
| 插件契约 / CLI | [navora-plugin-sdk](https://github.com/navora-harness/navora-plugin-sdk) |
| 官方插件 | [navora-plugins](https://github.com/navora-harness/navora-plugins) |

文档入口：[`docs/README.md`](docs/README.md) · 当前功能：[`docs/current-state.md`](docs/current-state.md) · 开发说明：[`docs/project-and-plugin-guide.md`](docs/project-and-plugin-guide.md) · [插件商店](docs/plugin-store-guide.md)

整体重构规划与阶段验收：[`docs/renovation-plan-2026-10.md`](docs/renovation-plan-2026-10.md)。

License: [MIT](./LICENSE)

## 技术栈

- 运行时：unofficial Electron
- 前端：Vite + Vue 3 + Vuetify + TypeScript
- LLM：OpenAI 兼容 API（流式 + tool calling）

## 本地仓库布局

宿主、SDK、官方插件与商店建议并列 checkout：

```text
navora-harness/
├── navora-desktop/         # 本仓库：宿主（加载插件，不负责编译）
├── navora-plugin-sdk/      # 类型 + SPEC + navora-plugin CLI
├── navora-plugins/         # 官方插件源码
└── navora-store/           # 插件与技能静态目录仓
```

插件编译：

```bash
cd ../navora-plugin-sdk && npm install
cd ../navora-plugins && npm install
npm run build:plugins
# 或：npm run plugin -- build <plugin-id>
```

本仓库**没有** `build:plugins` / `plugin` 脚本。

## 开发

重构分支已对齐 `45.0.0-cloudbypass.2`。原发布包的原生文件输入存在文件读权限遗漏：选择文件后导航可能导致渲染进程被 Chromium 终止。本仓库保留修复补丁 [`patches/electron/file-input-read-grants.patch`](patches/electron/file-input-read-grants.patch)。当前本机已编译、安装并验证修复后的内核；外部分发包尚未重新发布。

在匹配的 Electron 源码中应用补丁并增量编译后，可安装本机产物：

```bash
npm run electron:use-build -- <Electron-out/Release目录>
npm run test:browser
```

此命令只将同主版本的可执行文件复制进当前项目的 Electron 分发目录，并保存校验信息，不修改 Postpile 或其它项目的内核。安装新的原始 Electron 包后，应重新应用此步骤。打包会先运行浏览器回归，并通过 `electronDist` 使用当前项目实际验证的分发目录。

```bash
cd navora-desktop
cp .npmrc.example .npmrc   # electron_mirror → http://127.0.0.1:8787/electron/
# 先启动仓库旁 mirror/（serve:local），再：
npm install
npm run electron:install   # 如需重下 Electron 二进制
npm run electron:dev
```

开发数据目录：`<项目>/portable/`（配置、会话、密钥、工作区、插件）。

| 命令 | 说明 |
|------|------|
| `npm run typecheck` | Vue / TS 类型检查 |
| `npm test` | 单元与契约回归 |
| `npm run test:browser` | 实际定制 Electron 的浏览器、插件与文件输入回归 |
| `npm run test:ui` | 完整构建及隔离的桌面/窄屏 UI 回归，包含减少动态效果模式 |
| `npm run test:ui:plugins` | 插件工作区、安装与更新、搜索及失败恢复 |
| `npm run test:ui:creators` | 插件/技能创建器与插件工作区的管理列表 |
| `npm run test:ui:renovation` | 对话、资源、文件管理与输入体验 |
| `npm run build` | 构建渲染进程 + 主进程 |
| `npm start` | 启动已构建产物 |
| `npm run dist` / `dist:nsis` / `dist:all` | Windows 打包 |

产物输出到 `release/`。

UI 使用仓库内版本化的 `@postpile/ui` 包，复用 Postpile 的材质和动效；不依赖外部项目的绝对路径。界面回归截图位于 `release/ui-smoke/`。页面结构索引使用 `browser_get(what=snapshot)`，可附 `query` 检索；返回的 `ref` 可用于 `browser_click` 和 `browser_type`。完整闭合 Shadow DOM 与 frame 内容索引仍未实现；原生跨 frame 定位通过 `browser_query_deep(acrossDocuments=true)` 提供。

## 插件（运行时）

1. **左侧插件图标**：搜索插件、已安装插件、插件商店及右侧详情。设置 → 插件仅保留开发模式开关，批量管理位于插件工作区。
2. **导入 → 外链文件夹**：指向含 plugin.json 和 main.cjs 的构建目录，通常为 `navora-plugins/<id>/dist/<packageId>`；build 后重新加载。
3. **导入压缩包**：使用标准插件 ZIP；商店复用版本选择、预检与安装确认。
4. 插件必须实现 `planPermissions`；执行只允许 `api.registry` / `api.runTool` 等
5. iframe 点击与主文档点击同属 `click` 能力（经核心 `browser_click` / `browser_flow`）

可选：`NAVORA_BUNDLE_PLUGINS=1` 时打包宿主仓 `electron/plugins/` 种子（默认不带任何插件）。

## 询问/决策

- 设置 → **询问/决策**：路径不明或需确认时，在对话里点选选项（含权限授权卡片）。技能增删改等仍弹窗。
- 默认 **不限时等待**。无超时时询问会写入该对话，重启后可继续选；点「拒绝回答」、停止或删除对话会清除。
- 配置键仍为 `fork_decision`（`ask_timeout_ms: 0` 表示不限时）。

## 子对话

- 设置 → **子对话**：可开关；默认开启。关闭后 Agent 无法 spawn / await。
- `max_parallel`（默认 4，范围 1～8）：同一父对话**同时运行**的子对话上限，**不含**父对话本身。
- `agent_spawn_subchat` 子对话**看不到**父对话全文；请把 URL / sitekey 等写入 `context`
- 宿主会尝试从父对话近期消息（含 tool 结果）补全缺失的 http(s) 链接与 Turnstile sitekey
- 浏览器关闭和会话释放由 Agent 按任务判断，子对话结束不自动销毁登录态；用户也可显式关闭或释放。

## 数据目录

| 运行方式 | 路径 |
|----------|------|
| 开发 | `<项目>/portable/` |
| 便携版 | `<exe 同目录>/data/` |
| NSIS | `%APPDATA%\Navora` |

可用 `NAVORA_DATA_ROOT` 覆盖。首次运行由 `config.example.yml` 生成 `config.yml`；API Key 写入 `secrets/`。

## 免责声明

本软件按「现状」提供，不提供任何明示或默示担保。作者及版权持有人对使用本软件导致的数据丢失、账号封禁、服务中断、站点违规使用或其它损失不承担责任。

- Agent 可按你配置的权限操作本机浏览器会话、工作区文件与受限 shell；加载的插件在主进程运行，视为你信任的代码。
- 仅用于你有权操作的目标；请遵守目标站点条款与当地法律。
- 使用 unofficial Electron、第三方模型 API 以及自行安装的插件所产生的风险由使用者承担。

法律条款以 [MIT License](./LICENSE) 为准。

## 安全须知（提交前）

- **勿提交** `portable/`、`secrets/`、`config.yml`、`.env`、本机 `.npmrc`
- 远程访问默认密码为 `admin`（仅用于本机门闩检测）；启用远程前必须修改
- unofficial Electron 默认走本机 mirror `http://127.0.0.1:8787/electron/`（需先启动仓库旁 `mirror/`）

## 品牌

**Navora** = Navigate + Aura/Ora。本仓库是 Agent Harness 的桌面宿主：模型在外部，工具与执行在这里。


## 开发命名约定

代码与文档使用产品名称或通用技术术语；分支、提交说明不添加开发工具名称或生成来源署名。实际服务商、协议与模型标识保留真实名称，确保模型接入兼容。
