# 浏览器资源打开后原生视图错位：复现与修复规划

> 实施更新：用户已要求实现其余规划，正式源码与本轮验收以[实施记录](./remaining-plans-implementation-2026-11-03.md)为准；本文下方保留原规划基线及历史证据。

日期：2026-11-03。优先级：P0。状态：已在隔离原生窗口复现生命周期缺陷，正式修复待实施。本轮没有修改 browser-host 或重新发布浏览器修复包。

## 1. 用户现象与证据范围

从浏览器资源列表打开已有页面后，白色区域先覆盖窗口左上角；页面加载后仍在同一矩形内显示，越过标题栏和导航栏，预期工作区保持空白。这属于原生视图呈现边界错误，不能用网页 CSS 的 z-index 修正。

用户两张截图中的形状与默认 800×600 逻辑像素原生区域高度吻合。下面的独立探针证实当前源码存在足以造成该现象的缺陷；探针未挂载完整资源列表、未访问截图中的网站，不能断言现场只受这一触发条件影响。

证据：[8 项原生观测](../../_planning/browser-view-origin-probe-results/report.json)、[探针入口](../../_planning/browser-view-origin-probe-entry.ts)、[运行脚本](../../_planning/browser-view-origin-probe.mjs)。脚本仅加载当前源码的独立 bundle，不依赖或重建应用 dist。

## 2. 已确认的链路

1. `src/components/sidebar/BrowserResourcesPanel.vue:310` 的资源点击请求 setVisible；`electron/modules/browser-registry.ts` 随后 show/focus/present。
2. `electron/modules/browser-workspace-ipc.ts:20` 的 onPresent 之后才通知渲染界面；`src/pages/ChatPage.vue` 的 onPresent 仍需异步选择所属会话、读取资源并打开工作区。此段等待期间，不能假定网页容器已就绪。
3. `electron/modules/browser-host.ts:73` 的默认宿主几何为 x=0、y=0、width=800、height=600。
4. 同文件 setLayout 先更新请求边界并将 ready=true、suspended=false，再 activate；layout 遇到 activeOperations>0 或 automation.isBusy() 会直接跳过原生几何写入，activate 仍执行 setVisible(true)。因此“请求了有效边界”被当成“原生已应用有效边界”。
5. `src/components/BrowserTabPanel.vue:266` 附近在 await layout 之前缓存 lastLayout，相同边界不再提交；IPC 返回 void，界面无法分辨 applied 与 deferred。
6. 原生控制器自行从忙变闲只通知状态变化，没有统一 flush。`browser-tool-coordination.ts:137` 的包装器 finally 会 flush，但不是所有忙碌出口都经过此包装器；一次未应用的布局可以一直停留在默认区域。

现有 layoutOwner 能拒绝部分旧实例请求，但只有页面级 owner，不能替代页面、宿主、展示代次及已应用几何共同构成的显示资格。导航、转移及容器变化时应根据实际几何有效性更新代次，而非把任意状态广播视为新布局。

## 3. 独立真实 Electron 复现

使用当前定制 Electron，操作系统窗口 show:false，页面为 about:blank。未读取安装版数据、未请求网站或模型、未操作真实用户页面。实际观测 surface.getBounds/getVisible，而非只断言 JavaScript 状态字段。

1. 首次 present、尚无有效布局：原生区域默认 800×600，保持隐藏，已有保护有效。
2. 空闲时提交有效边界：显示在正确位置。
3. activeOperations>0 时提交有效边界 `{440,160,700,480}`：view 已显示，实际仍为 `{0,0,800,600}`，复现错误。
4. 操作计数释放并显式 flush：恢复正确。
5. 真实 automation.run(readOnly) 忙碌时：同样显示默认区域。
6. 控制器自行变闲、未显式 flush：错误边界继续存在。
7. 显式 flush：恢复正确。
8. 提交 null 布局后再次 present：保持隐藏，原有暂停保护有效。

8 项观测均得到预期证据；这是一份**缺陷复现报告**，不是“修复后通过”报告。Electron 已退出、临时 profile 已清理。保留的脚本、独立 bundle 和报告仅在 _planning 内。

## 4. 正式修复方案

### 4.1 请求与应用分离

每宿主保留 requestedBounds、最新 pending 请求及 committedBounds/committedGeneration。默认矩形不构成已提交布局。layout 返回 applied、deferred 或 stale，并包含请求代次；实际设置 surface 与 page 几何成功后才能更新 committed 状态和显示资格。

主进程再次验证 pageId、hostId、layoutOwner、展示代次和当前活动项，防止旧标签、旧容器或跨窗口转移后的迟到请求覆盖新位置。边界使用宿主内容区的逻辑坐标；继续核对现有 CSS→DIP 计算，不为解释本次复现而盲目乘系统 DPI。

### 4.2 显示必须等待有效几何

首次呈现、重新挂载、容器位置变化或转移宿主后，在对应代次的正确几何提交前保持原生 view 隐藏。不能提前 setVisible(true)，也不能只依赖 ready=true。

同一宿主已有有效几何且无需调整时，可以保持网页；需要跨容器移动且当前忙碌时，保留宿主内容区的加载/等待反馈，待安全更新后呈现。不能为了立即显示而中断自动化、取消可信输入或强行修改正在使用的 guest viewport。

### 4.3 延迟布局必须最终收敛

所有 activeOperations 和 automation busy→idle 出口统一触发最新 pending 的一次提交；同宿主只保留最新请求。重复 flush 合并，提交过程不能递归广播或无限排队。原生几何设置失败保留未提交状态并提供可读恢复，不能把失败确认为成功。

前端只有收到 applied 确认才更新 lastLayout 去重状态。deferred 由主进程可靠持有与提交，不依赖用户再拖一下窗口、重复点击页面或持续轮询。失效/销毁/转移时取消旧 pending，结果回执不能重新显示隐藏页。

### 4.4 与弹出层、设置和新标签协同

当前未迁移路径沿用既有弹出层画面保留与原生暂停契约，两者共享同一显示资格判断。后续[实时浮层方案](./native-overlay-webcontentsview-plan-2026-11.md)的普通菜单开关只调整 overlay，不将网页 layout 置空；不能让它借此绕过本 P0 的有效几何门槛。设置、子对话或文件真正切换内容时，旧原生请求仍不得重新覆盖当前 UI；关闭隐藏场景只恢复当前页及当前有效几何，不恢复旧宿主的矩形。

关联实时浮层方案现已按用户要求搁置，等待替代方案；上段相关内容仅保留设计约束，不据此推进浮层实现，本 P0 的独立状态不变。

状态日志只记录 page/host/owner/代次、请求与已提交边界、busy 原因、可见性和结果；不记录网页正文、键入内容或秘密。

## 5. 修复顺序与验收

1. 保留上述失败探针，先补请求/提交/显示资格的纯状态回归，再调整宿主与 IPC 返回契约。
2. 补所有忙→闲出口、迟到请求与前端去重；确认不改变任务输入保护、页面身份或会话 Cookie。
3. 接入完整资源点击链，验证展开/分栏、侧栏调整与独立窗口往返。
4. 最后运行既有浏览器、工作区、弹层和输入保护整链；通过后再生成新版本，不能沿用旧包验收结果代替。

核心断言是：**每个可见原生视图的实际 bounds 必须属于当前宿主、当前页和当前有效容器**。默认区域或上一容器的区域在转换期间不得出现。

必须覆盖首次资源打开、操作计数忙、控制器忙、仅控制器自行空闲、连续切页、关闭最后页、布局 null、容器销毁、旧 owner/旧代次乱序、移窗、窗口最小化/还原、侧栏拖宽、125%–200% 缩放、工作区展开与收回、设置/子详情/文件和菜单互切。错误不能通过停止任务、重载页面或丢弃表单来规避。

关联：[子对话工作区](./subchat-workspace-plan-2026-11.md)、[浏览器资源规划](./browser-resource-redesign-plan-2026-11.md)、[既有弹出层回归方案](./composer-attachment-plan-2026-11.md)、[输入控制权](./browser-input-ownership-and-cursor-plan-2026-11.md)。
