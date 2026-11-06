# 下载卡片与同号运行时更新（2026-11-05）

本轮完成源码与工作区运行时更新，应用版本仍为 0.4.5，未重新打包。既有 `release/v0.4.5` 制品保留原二进制与交付范围。

## 下载卡片

参考定制 Electron `test/native-panels/native-ui-preview.cjs` 的 `downloads()` 示例：360 CSS px、平铺文件行、左侧文件图标、中间名称和状态、右侧独立图标操作。标题与“清除记录”同一行；没有已结束项时不显示清理按钮，空态改为简短提示。文件名省略并保留完整名称／路径提示，进度、暂停、继续、取消、打开、定位和记录清理继续使用当前聊天的原协议。完成文件通过文件行打开；移除记录不删除已保存文件。DOM 兼容界面同步收紧。

原生窗口边距改为 8、圆角 14；文件图标块按 32×32 布局居中。NativePanel 的八位颜色为 `#AARRGGBB`，图标底色使用低透明中性灰，避免将 CSS RGBA 顺序误传为 SkColor。

截图位于工作区 `_planning/download-card-2026-11-05/`：

- `01-downloads-empty-light.png`：空列表。
- `02-downloads-list-light.png`：进行中、完成、暂停与失败。
- `03-downloads-list-dark.png`：暗色。
- `04-downloads-list-narrow-dark.png`：窄窗口暗色。

这些是 PID／所属窗口校验后的实际 NativePanel PrintWindow 截图。使用临时资料、合成下载项与本地动态网页；没有读取个人下载记录或调用模型。下载 IPC 结果和原生按钮事件由夹具控制，未用系统鼠标操作或启动下载文件，不能将该验证扩写为物理鼠标命中／实际网络下载验收。

## 同版本 .9 的修订

采用发布端明确命名的 `replacement-714ba8c41bb5-*` 资产；同一发行页的无前缀旧资产仍存在，不能只凭版本号选择。完整摘要与本地镜像文件核对后，安装到 `node_modules/electron/dist/45.0.0-cloudbypass.9-d5fe9d7d380e/`。旧运行目录及进程保留，最后原子切换 `path.txt`。npm 顶层支撑文件、两份锁文件和 `electronDist` 已同步。

- ZIP SHA-256：`d5fe9d7d380e629fe08c0831f8d854d0d202d8838c85df3217547bdd25b9a619`。
- electron.exe SHA-256：`714ba8c41bb56f1ae05257d8170b41dc3c5869d9694c5ebf49c74e13b8e5cc19`。
- PE .text SHA-256：`a4e536e4e1862eed3125af8b20c981e9832e9675a890891e2f5766e6f0b23683`。
- 类型 SHA-256：`e622d6eacb9b824210591a52b512bff3ba83e40a3cf66aa0d196914f46c1bf41`，未变。

发布说明新增证书查看器自身标题栏拖动修复，未新增公共 API。安装器、运行时检查与发布校验共用 `scripts/electron-runtime-manifest.json`，同时核 revision、压缩包摘要、二进制摘要及代码摘要；旧 `.9` 与旧标记不能通过当前检查，发布清单也比较压缩包摘要。证据在 `_planning/electron9-refresh-2026-11-05/`。发行方证书验收与旧核心／跨 frame 记录保留各自范围，项目完整跨 frame 专项继续搁置。

## 截图替代与隐藏 View 检查

下载、Agent、地址建议、网站信息和批注的正常原生路径使用 NativePanel，不为浮层请求网页预览或隐藏原网页。下载实测 7 项、既有浏览器原生面板回归 14 项通过；原网页 WebContents 身份、View 可见性和尺寸保持，RAF 持续增长，无新增渲染进程。下载专项实际预览请求和网页隐藏调用均为 0。

仍有通用 DOM 覆盖路径，当前定制 `.9` 也会触发：

- `BrowserTabPanel.vue` 的 `overlayCoversPage()` 发现相交 DOM 浮层后，请求 `workspace.preview()`，展示 `browser-frozen-frame`，再提交 `layout(null)`。
- `browser-workspace-ipc.ts` 的 preview 会调用网页 `capturePage()`；`browser-host.ts` 的布局失效最终调用网页 View 的 `setVisible(false)`。
- 触发包括覆盖网页的浮动侧栏、附加／上下文／选区编辑器浮层，以及删除聊天、关闭 Session、退出确认框。是否触发以实际矩形相交为准。
- `SidebarContextMenu.vue` 原生菜单异常后的 DOM 回退，以及旧环境的 DOM 兼容界面，也可能进入上述路径。

本轮按要求检查并列明这些残留，未迁移全部 DOM 浮层。直接移除隐藏逻辑会导致 HTML 浮层被网页 View 遮住。切换标签、转移窗口、显式隐藏和无效布局等正常 View 生命周期保留；用户主动截图、批注证据、远程画面及本次截图验收也保留。

## 验证

类型检查、前端／主进程构建、原生面板模型 16 项检查、下载真实界面 7 项、原生浏览器浮层回归 14 项通过。新二进制上自然轨迹专项 22 项、后台隔离专项 11 项通过并正常退出。完整摘要、重复安装、错误 ZIP 和旧 runtime override 拒绝检查通过。未重跑全量单测、全新联网 npm 安装或成品启动；现有 npm 安装仍有本机 mirror/postinstall 前置配置。

原生浏览器回归首次遇到旧夹具要求 Agent 摘要显示速度的断言；紧凑面板已将速度放在设置中，因此改为验证配置更新不重新创建原生面板，随后 14 项通过。原失败记录保留为 `native-regression-initial-failure.json` 和 `native-regression-initial.log`。独立代码审查未发现本轮确定的功能回归，未调用专用 Bugbot 服务。
