# navora-desktop

**Navora** — 桌面端 AI Agent Harness：对接外部模型 API，用对话驱动可控浏览器、工作区与权限门闸。

| | |
|---|---|
| 组织 | [navora-harness](https://github.com/navora-harness) |
| 插件契约 / CLI | [navora-plugin-sdk](https://github.com/navora-harness/navora-plugin-sdk) |
| 官方插件 | [navora-plugins](https://github.com/navora-harness/navora-plugins) |

架构说明：[`docs/modules.md`](docs/modules.md) · 规划草案：[`docs/architecture-plan.md`](docs/architecture-plan.md) · 对外摘要：[`docs/project-and-plugin-guide.md`](docs/project-and-plugin-guide.md)

## 技术栈

- 运行时：定制 Electron
- 前端：Vite + Vue 3 + Vuetify + TypeScript
- LLM：OpenAI 兼容 API（流式 + tool calling）

## 本地仓库布局

三个仓库建议并列 checkout：

```text
navora-harness/
├── navora-desktop/         # 本仓库：宿主（加载插件，不负责编译）
├── navora-plugin-sdk/      # 类型 + SPEC + navora-plugin CLI
└── navora-plugins/         # 官方插件源码
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

```bash
cd navora-desktop
cp .npmrc.example .npmrc   # electron_mirror → http://127.0.0.1:8787/
# 先启动仓库旁 mirror/（serve:local），再：
npm install
npm run electron:install   # 如需重下 Electron 二进制
npm run electron:dev
```

开发数据目录：`<项目>/portable/`（配置、会话、密钥、工作区、插件）。

| 命令 | 说明 |
|------|------|
| `npm run typecheck` | Vue / TS 类型检查 |
| `npm run build` | 构建渲染进程 + 主进程 |
| `npm start` | 启动已构建产物 |
| `npm run dist` / `dist:nsis` / `dist:all` | Windows 打包 |

产物输出到 `release/`。

## 插件（运行时）

1. **设置 → 插件 → 外链文件夹**：指向 `navora-plugins/<id>`（开发热更：build 后「重新加载」）
2. **导入压缩包**：使用 `navora-plugins/dist/*-plugin.zip`
3. 插件必须实现 `planPermissions`；执行只允许 `api.registry` / `api.runTool` 等
4. iframe 点击与主文档点击同属 `click` 能力（经核心 `browser_click` / `browser_flow`）

可选：`NAVORA_BUNDLE_PLUGINS=1` 时打包宿主仓 `electron/plugins/` 种子（默认不带任何插件）。

## 子对话

- 设置 → **子对话**：可开关；默认开启。关闭后 Agent 无法 spawn / await。
- `max_parallel`（默认 4，范围 1～8）：同一父对话**同时运行**的子对话上限，**不含**父对话本身。
- `agent_spawn_subchat` 子对话**看不到**父对话全文；请把 URL / sitekey 等写入 `context`
- 宿主会尝试从父对话近期消息（含 tool 结果）补全缺失的 http(s) 链接与 Turnstile sitekey
- 子对话结束会清理其创建的浏览器 Session / 窗口；用户终止时侧栏显示停止图标

## 数据目录

| 运行方式 | 路径 |
|----------|------|
| 开发 | `<项目>/portable/` |
| 便携版 | `<exe 同目录>/data/` |
| NSIS | `%APPDATA%\Navora` |

可用 `NAVORA_DATA_ROOT` 覆盖。首次运行由 `config.example.yml` 生成 `config.yml`；API Key 写入 `secrets/`。

## 安全须知（提交前）

- **勿提交** `portable/`、`secrets/`、`config.yml`、`.env`、本机 `.npmrc`
- 远程访问默认密码为 `admin`（仅用于本机门闩检测）；启用远程前必须修改
- 定制 Electron 默认走本机 mirror `http://127.0.0.1:8787/`（需先启动仓库旁 `mirror/`）

## 品牌

**Navora** = Navigate + Aura/Ora。本仓库是 Agent Harness 的桌面宿主：模型在外部，工具与执行在这里。
