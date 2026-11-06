# 下载面板调整

后续状态：已升级到正式 cloudbypass.11，并使用正式原生能力及统一材质规则；以下本地编译与哈希为早先调试记录，当前适配以 [cloudbypass.11 适配记录](./nativepanel-cloudbypass11-adaptation-2026-11-06.md) 为准。

补充参考图调整：文件图标与文件名首行顶部对齐；按文件名长度预留一行或两行，避免单行文件名与状态之间出现固定第二行空白。行内按钮使用原生 iconButton 的 hoverOnly 布尔属性，行悬停或获得键盘焦点时绘制，保留命中区域、焦点与稳定控件 ID。HTML 兼容面板同步按悬停／聚焦显示，并在触屏环境常显操作按钮。该属性需要使用本次本地编译的 Electron；公开发行的 cloudbypass.10 尚不包含它。

日期：2026-11-06。

下载浮层标题及浏览器更多菜单入口统一为“下载”。参考提供的 Chrome 截图，使用大标题、文件夹／搜索／更多工具栏、两行文件名和圆角行高亮。文件夹入口定位最新已完成下载；搜索按文件名和相对路径筛选当前对话的记录。

每项支持右键、Shift+F10 和更多按钮。菜单按实时状态提供打开、显示文件夹、暂停、继续、取消、停止工具任务、复制 HTTP(S) 下载链接和移除记录。菜单返回后再次校验所属对话、记录和当前能力；移除记录保留已下载文件，活动项明确标为“取消下载并从列表中删除”。没有加入尚无后端支持的失败重试及不安全文件上报。

原生行的鼠标进入／退出通知覆盖子控件，背景绘制考虑行内悬停，保留子按钮独立操作。内核增加 item 的 contextMenu 事件及屏幕 DIP 锚点；应用桥将锚点转换到宿主内容坐标，避免重复缩放。NativeMenuShow 的 parentPanelId 仅允许关联同一发送者的有效、已显示面板，右键菜单显示时保留父面板和选中行。

本地 Electron 源文件：D:/electron/main/src/electron/shell/browser/ui/views/native_panel.cc。工作区补丁保存在 ../_planning/download-panel-chrome/native-panel-downloads.patch。已编译 out/Release/electron.exe 并接入当前 node_modules/electron 的运行时；未发布新版内核或制作安装包。当前本地 exe SHA256：3d176af08437156a219da427d4bc820b2735ea7e9ad13d03ef16097dc6d0f496。

验证：应用类型检查、35 项面板及桥接 schema 单元检查、原生内核编译和应用构建通过；隔离下载界面回归通过，覆盖搜索恢复、菜单后方父面板保留、记录操作、实时进度、浅色／深色／窄窗口及文件图标。界面测试注入原生 action 事件，不代表已完成物理鼠标右键或键盘操作验收。截图与报告保存在 ../_planning/download-card-2026-11-05/。

最终参考排版截图：../_planning/download-card-2026-11-05/10-reference-layout-light.png。单行项 60 DIP，两行文件名项 76 DIP，带进度条的单行项 68 DIP；相关单元检查、桥接检查、构建与隔离界面回归通过，已查看最终截图确认非悬停行不显示行内按钮。
