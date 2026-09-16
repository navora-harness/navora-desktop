<template>
  <div class="docs-page" :class="{ 'is-embedded': embedded, 'is-mobile': mobile }">
    <header class="top">
      <div class="top-left">
        <v-btn
          v-if="embedded"
          variant="text"
          class="close-btn"
          aria-label="关闭"
          @click="emit('close')"
        >
          <font-awesome-icon icon="xmark" />
        </v-btn>
        <div class="top-titles">
          <h1>使用文档</h1>
          <p v-if="!mobile" class="top-sub">Navora 功能说明与常见用法</p>
        </div>
      </div>
      <span class="ver-badge">v{{ appVersion }}</span>
    </header>

    <div class="shell">
      <nav class="nav">
        <div class="nav-list">
          <button
            v-for="item in navItems"
            :key="item.value"
            type="button"
            class="nav-item"
            :class="{ active: tab === item.value }"
            @click="tab = item.value"
          >
            <span class="nav-label">{{ item.title }}</span>
            <span v-if="!mobile" class="nav-desc">{{ item.desc }}</span>
          </button>
        </div>
      </nav>

      <div class="panel">
        <div class="content">
          <section v-show="tab === 'start'" class="section">
            <header class="section-head">
              <h2>快速开始</h2>
              <p>配置模型后，用自然语言驱动浏览器与文件任务</p>
            </header>
            <div class="card">
              <h3 class="card-title">第一步：配置模型</h3>
              <ol class="doc-list">
                <li>打开右下角齿轮进入<strong>设置 → 模型</strong></li>
                <li>添加 OpenAI 兼容服务商（Base URL / 模型名）</li>
                <li>API Key 可选：先无密钥试用；若接口要求鉴权，再在设置或对话中补充</li>
              </ol>
            </div>
            <div class="card mt">
              <h3 class="card-title">第二步：开始对话</h3>
              <ol class="doc-list">
                <li>侧边栏新建对话，在输入框描述任务（如打开网页、提取内容、下载文件）</li>
                <li>Agent 会按需创建浏览器 Session / 窗口，并在需要时请求权限</li>
                <li>运行中可点停止；需要选择时会出现询问/决策卡片</li>
              </ol>
            </div>
            <div class="card mt">
              <h3 class="card-title">产品能力一览</h3>
              <ul class="doc-list">
                <li>多对话、消息流、工具卡片与运行日志</li>
                <li>按 Chat 隔离的浏览器资源树（Session / 窗口）</li>
                <li>工作区文件读写、下载、有限命令执行</li>
                <li>自定义技能（SKILL.md）、权限预设、远程访问</li>
              </ul>
            </div>
          </section>

          <section v-show="tab === 'chat'" class="section">
            <header class="section-head">
              <h2>对话与输入</h2>
              <p>草稿、字数限制与会话资源</p>
            </header>
            <div class="card">
              <h3 class="card-title">每对话独立草稿</h3>
              <p class="doc-p">
                切换会话时，未发送内容会按对话分别保存（类似 Telegram），并在本机与远程客户端之间同步。发送成功后草稿清空。
              </p>
            </div>
            <div class="card mt">
              <h3 class="card-title">字数上限</h3>
              <p class="doc-p">
                默认约 16000 字，可在<strong>设置 → 基本 → 输入框字数上限</strong>调整。接近上限时输入框会显示计数。
              </p>
            </div>
            <div class="card mt">
              <h3 class="card-title">上下文引用</h3>
              <p class="doc-p">
                可将侧边栏的 Session / 窗口拖入输入区，作为本次任务的浏览器上下文。同一对话默认复用已有窗口，避免重复打开。
              </p>
            </div>
            <div class="card mt">
              <h3 class="card-title">导出</h3>
              <p class="doc-p">侧边栏左下角「更多 → 导出对话」可将当前会话保存为 Markdown。</p>
            </div>
          </section>

          <section v-show="tab === 'browser'" class="section">
            <header class="section-head">
              <h2>浏览器与 Agent</h2>
              <p>Session、窗口、等待与页面流程</p>
            </header>
            <div class="card">
              <h3 class="card-title">资源模型</h3>
              <ul class="doc-list">
                <li><strong>Session</strong>：隔离的 Cookie / 代理 / UA 环境</li>
                <li><strong>窗口</strong>：挂在 Session 下的 BrowserWindow</li>
                <li>删对话会级联清理对应浏览器资源</li>
              </ul>
            </div>
            <div class="card mt">
              <h3 class="card-title">常用能力</h3>
              <ul class="doc-list">
                <li>导航、点击、输入、滚动、截图</li>
                <li>跨 iframe / closed Shadow 的定位与点击</li>
                <li><code>browser_wait</code> / <code>browser_flow</code>：条件等待与短流程编排</li>
                <li>
                  <code>browser_load_url_with_response</code>：在目标 URL 下加载自定义主文档（origin
                  不变）
                </li>
                <li>
                  网络观察日志、Session.fetch（默认模拟导航有序请求头）、Cookie / 代理 / UA
                </li>
                <li>主动下载 <code>file_download</code>：已知 URL，走 Session 网络；被动下载：点击页面触发，系统拦截确认（权限「被动文件下载」）</li>
              </ul>
            </div>
            <div class="card mt">
              <h3 class="card-title">产品与技能 / 插件边界</h3>
              <p class="doc-p">
                产品只提供通用工具（浏览器、文件、网络、技能管理等）。复杂站点步骤与编排写在<strong>技能</strong>里；需要额外一键工具时用<strong>插件</strong>（设置 → 插件启用）。不在系统提示中写死站点逻辑。
              </p>
            </div>
          </section>

          <section v-show="tab === 'skills'" class="section">
            <header class="section-head">
              <h2>技能</h2>
              <p>Cursor 兼容 SKILL.md，启用后注入系统提示</p>
            </header>
            <div class="card">
              <h3 class="card-title">管理方式</h3>
              <ul class="doc-list">
                <li>设置 → <strong>技能</strong>：新建、编辑、启用/关闭、导入、导出、删除</li>
                <li>支持导入文件夹（含 SKILL.md）或单个 .md；也可拖入导入；导入前可预览确认</li>
                <li>
                  对话中也可让 Agent 提交变更：新建 / 修改会弹出预览确认（可改稿、可稍后处理）；删除 /
                  导出需当场确认（不可搁置），Agent 仍可选是否等待结果
                </li>
              </ul>
            </div>
            <div class="card mt">
              <h3 class="card-title">稍后处理与待确认</h3>
              <p class="doc-p">
                仅<strong>新建 / 修改</strong>支持左侧<strong>稍后处理</strong>；未阻塞对话时关闭弹窗也会保留提案。之后在
                <strong>设置 → 技能 → 待确认</strong> 重新打开或丢弃。删除与导出只能当场确认或取消（可不等待 Agent
                回合结束）。
              </p>
            </div>
            <div class="card mt">
              <h3 class="card-title">何时生效</h3>
              <p class="doc-p">
                技能开关是全局的。开关之后，<strong>下一次发送消息</strong>起生效；正在运行中的一轮不会中途更换。
              </p>
            </div>
            <div class="card mt">
              <h3 class="card-title">格式要点</h3>
              <p class="doc-p">
                YAML frontmatter 需含 <code>name</code>、<code>description</code>；可选
                <code>version</code>（自由文本，如 <code>1.0.0</code>）、
                <code>disable-model-invocation</code>（开启后仅注入目录摘要，Agent 需先
                <code>skill_read</code> 再注入全文）。
              </p>
            </div>
          </section>

          <section v-show="tab === 'plugins'" class="section">
            <header class="section-head">
              <h2>插件</h2>
              <p>从本地加载的工具包；每个插件可注册多个接口</p>
            </header>
            <div class="card">
              <h3 class="card-title">与技能的区别</h3>
              <ul class="doc-list">
                <li><strong>技能</strong>：注入提示文案，教 Agent 用现有通用工具编排步骤</li>
                <li>
                  <strong>插件</strong>：磁盘加载 <code>plugin.json</code> + <code>main.cjs</code>，真正新增多个
                  tools / 接口，由插件代码执行
                </li>
              </ul>
            </div>
            <div class="card mt">
              <h3 class="card-title">包格式与契约</h3>
              <ul class="doc-list">
                <li>目录：<code>plugin.json</code>（id / name / version / main）+ 入口 <code>main.cjs</code></li>
                <li>
                  入口导出 <code>tools[]</code>、<code>planPermissions</code>（必填）、
                  <code>execute(toolName, args, api)</code>
                </li>
                <li>
                  只通过 <code>api.runTool</code> / <code>api.registry</code> 访问宿主；iframe 点击与主文档点击同属
                  <code>click</code> 能力
                </li>
                <li>作者用同级 <code>navora-plugin-sdk</code> 的 <code>navora-plugin</code> CLI 编译 / 打包</li>
              </ul>
            </div>
            <div class="card mt">
              <h3 class="card-title">管理</h3>
              <p class="doc-p">
                设置 → <strong>插件</strong>：外链文件夹（开发）、导入 zip（分发）、启用 / 关闭、卸载、重新加载。对<strong>下一次发送</strong>生效。
              </p>
            </div>
          </section>

          <section v-show="tab === 'settings'" class="section">
            <header class="section-head">
              <h2>设置与权限</h2>
              <p>偏好即时生效；权限控制 Agent 能力</p>
            </header>
            <div class="card">
              <h3 class="card-title">设置分区</h3>
              <ul class="doc-list">
                <li><strong>基本</strong>：托盘、展示、输入上限</li>
                <li><strong>模型</strong>：服务商、超时、工具轮次</li>
                <li><strong>浏览器</strong>：UA、超时、URL 白名单</li>
                <li><strong>工作区 / 技能 / 插件 / 远程 / 权限 / 询问/决策</strong></li>
              </ul>
              <p class="doc-p muted">开关会即时写入；文本与数字需点「应用」后生效。</p>
            </div>
            <div class="card mt">
              <h3 class="card-title">权限</h3>
              <p class="doc-p">
                可按会话选择权限预设。敏感操作（创建 Session、导航、点击、读写文件、网页获取位置等）会按模式自动允许、询问或拒绝。
              </p>
            </div>
          </section>

          <section v-show="tab === 'remote'" class="section">
            <header class="section-head">
              <h2>远程访问</h2>
              <p>默认关闭；启用后可通过浏览器控制本机 Navora</p>
            </header>
            <div class="card">
              <h3 class="card-title">启用</h3>
              <ol class="doc-list">
                <li>设置 → <strong>远程访问</strong> → 打开开关</li>
                <li>打开开关；建议修改默认密码后再对外暴露端口（默认 <code>8790</code>）</li>
                <li>本机或局域网用浏览器打开远程地址登录</li>
              </ol>
            </div>
            <div class="card mt">
              <h3 class="card-title">同步说明</h3>
              <p class="doc-p">
                对话消息、草稿、设置变更会经本机服务同步。部分操作（如本机文件选择器导入技能）需在桌面客户端完成。
              </p>
            </div>
          </section>

          <section v-show="tab === 'data'" class="section">
            <header class="section-head">
              <h2>数据与版本</h2>
              <p>配置、会话与密钥存放位置</p>
            </header>
            <div class="card">
              <h3 class="card-title">数据目录</h3>
              <ul class="doc-list">
                <li>开发：项目下 <code>portable/</code></li>
                <li>便携版：exe 同目录 <code>data/</code></li>
                <li>安装版：<code>%APPDATA%\Navora</code></li>
              </ul>
              <p class="doc-p muted">可用环境变量 <code>NAVORA_DATA_ROOT</code> 覆盖。API Key 等在 <code>secrets/</code>，勿提交到仓库。</p>
            </div>
            <div class="card mt">
              <h3 class="card-title">当前版本</h3>
              <p class="doc-p">Navora <strong>v{{ appVersion }}</strong></p>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

defineProps<{
  embedded?: boolean
  mobile?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const tab = ref('start')
const appVersion = ref('—')

const navItems = [
  { value: 'start', title: '快速开始', desc: '配置与上手' },
  { value: 'chat', title: '对话输入', desc: '草稿 · 上限' },
  { value: 'browser', title: '浏览器', desc: 'Session · 工具' },
  { value: 'skills', title: '技能', desc: '确认 · 待确认' },
  { value: 'plugins', title: '插件', desc: '可选工具包' },
  { value: 'settings', title: '设置权限', desc: '偏好 · 门闸' },
  { value: 'remote', title: '远程访问', desc: '端口 · 同步' },
  { value: 'data', title: '数据版本', desc: '目录 · 版本号' },
]

onMounted(async () => {
  try {
    const info = await window.navora?.app.info()
    if (info?.version) appVersion.value = info.version
  } catch {
    /* ignore */
  }
})
</script>

<style scoped>
.docs-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #eef2f5;
  color: #15202b;
}
.docs-page.is-embedded {
  height: min(82vh, 780px);
  max-height: calc(100vh - 48px);
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid #d5dee7;
  box-shadow: 0 18px 48px rgba(15, 30, 45, 0.18);
}
.docs-page.is-mobile.is-embedded {
  height: 100dvh;
  max-height: 100dvh;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 22px;
  border-bottom: 1px solid #d9e2ea;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
}
.top-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.close-btn {
  width: 40px;
  height: 40px;
  min-width: 40px !important;
  padding: 0 !important;
  color: #1b4f72 !important;
}
.close-btn :deep(svg) {
  width: 1.35rem;
  height: 1.35rem;
}
.top-titles h1 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
  color: #15202b;
  line-height: 1.2;
}
.top-sub {
  margin: 2px 0 0;
  font-size: 0.75rem;
  color: #7a8a99;
}
.ver-badge {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eaf3fa;
  color: #1b4f72;
  font-size: 0.75rem;
  font-weight: 600;
}

.shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  padding: 14px 22px 16px;
  gap: 14px;
  box-sizing: border-box;
}

.nav {
  display: flex;
  flex-direction: column;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid #d5dee7;
  background: #fff;
  align-self: stretch;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;
}
.nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(27, 79, 114, 0.28) transparent;
}
.nav-list::-webkit-scrollbar {
  width: 6px;
}
.nav-list::-webkit-scrollbar-thumb {
  background: rgba(27, 79, 114, 0.28);
  border-radius: 999px;
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: #3d4f5f;
}
.nav-item:hover {
  background: #f3f7fa;
}
.nav-item.active {
  background: #eaf3fa;
  color: #1b4f72;
}
.nav-label {
  font-size: 0.92rem;
  font-weight: 600;
}
.nav-desc {
  font-size: 0.72rem;
  color: #8a9aab;
}
.nav-item.active .nav-desc {
  color: #5d7f9a;
}

.panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}
.section-head {
  margin-bottom: 14px;
}
.section-head h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
}
.section-head p {
  margin: 4px 0 0;
  font-size: 0.84rem;
  color: #7a8a99;
}
.card {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid #d5dee7;
  background: #fff;
}
.card.mt {
  margin-top: 12px;
}
.card-title {
  margin: 0 0 8px;
  font-size: 0.95rem;
  font-weight: 700;
  color: #1b4f72;
}
.doc-p {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.55;
  color: #314556;
}
.doc-p.muted {
  margin-top: 8px;
  color: #7a8a99;
  font-size: 0.82rem;
}
.doc-list {
  margin: 0;
  padding-left: 1.2em;
  font-size: 0.88rem;
  line-height: 1.65;
  color: #314556;
}
.doc-list li + li {
  margin-top: 4px;
}
.doc-list code {
  font-size: 0.84em;
  padding: 1px 5px;
  border-radius: 4px;
  background: #eef3f7;
  color: #1b4f72;
}

.docs-page.is-mobile .shell {
  grid-template-columns: 1fr;
  padding: 12px 14px 18px;
}
.docs-page.is-mobile .nav {
  position: static;
}
.docs-page.is-mobile .nav-list {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 6px;
}
.docs-page.is-mobile .nav-item {
  width: auto;
  padding: 8px 10px;
}
.docs-page.is-mobile .nav-desc {
  display: none;
}
.docs-page.is-mobile .top {
  padding: 12px 14px;
}
</style>
