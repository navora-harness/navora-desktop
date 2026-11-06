<template>
  <div class="settings-page" :class="{ 'is-embedded': embedded, 'is-mobile': mobile, 'external-navigation': !!navigationTarget }" :aria-label="navigationTarget ? activeSettingsTitle : '设置'">
    <div v-if="embedded && !mobile && !navigationTarget" class="settings-titlebar-spacer" aria-hidden="true" />
    <header class="top">
      <div class="top-left">
        <button
          v-if="embedded"
          type="button"
          ref="backButtonEl"
          class="settings-close settings-back"
          aria-label="返回上一页"
          :title="returnLabel || '返回进入设置前的内容（Alt ←）'"
          :disabled="exitState.phase!=='idle'"
          @click="requestClose"
        ><AppIcon icon="arrow-left" /><span>返回上一页</span></button>
        <h1 v-if="navigationTarget" ref="headingEl" class="settings-current-title" tabindex="-1">{{ activeSettingsTitle }}</h1>
        <v-btn v-if="!embedded" variant="text" class="back-btn" @click="requestClose">
          <AppIcon icon="arrow-left" class="mr-2" />
          返回
        </v-btn>
      </div>
      <div class="top-actions"><span class="settings-save-status" role="status" aria-live="polite">{{ saving || savingInstant ? '保存中…' : instantError ? '有设置需要重试' : pendingGroupCount ? pendingGroupCount + ' 组未保存 · 返回后可继续' : '已保存' }}</span><button v-if="lastInstantUndo && !instantError" type="button" class="ui-button" :disabled="saving || savingInstant" title="仅撤销最近一批自动保存的选择；不会覆盖其它窗口后来对同一项的修改" @click="undoInstantPrefs">撤销本次修改</button></div>
    </header>

    <div v-if="exitState.phase!=='idle'" class="settings-exit-status" :class="{'needs-decision':exitState.phase==='decision'}" role="status" aria-live="polite"><span>{{ exitState.message }}</span><template v-if="exitState.phase==='decision'"><button type="button" class="ui-button" @click="exitGuard.decide('retry')">{{ exitState.reason==='failed'?'重试并返回':'继续等待' }}</button><button type="button" class="ui-button" @click="exitGuard.decide('leave')">保留草稿并返回</button><button type="button" class="ui-button" @click="exitGuard.decide('stay')">留在设置</button></template></div>
    <div v-if="cfg" class="shell" :inert="exitState.phase!=='idle'">
      <Teleport :to="navigationTarget || 'body'" :disabled="!navigationTarget">
      <nav class="nav settings-navigation" aria-label="设置分类">
        <div ref="navListEl" class="nav-list">
          <button
            v-for="item in navItems"
            :key="item.value"
            type="button"
            class="nav-item"
            :disabled="exitState.phase!=='idle'"
            :class="{ active: tab === item.value }"
            :aria-current="tab === item.value ? 'page' : undefined"
            :title="item.desc"
            aria-controls="settings-content"
            @click="selectTab(item.value)"
          >
            <AppIcon :icon="item.icon" class="settings-nav-icon" />
            <span class="nav-label">{{ item.title }}</span>
          </button>
        </div>
        <div class="nav-foot">
          <button type="button" class="nav-item nav-guide" title="模型、工作区、权限与远程连接" @click="openOnboarding">
            <AppIcon icon="circle-question" class="settings-nav-icon" />
            <span class="nav-label">开始引导</span>
          </button>
        </div>
      </nav>
      </Teleport>

      <div class="panel">
        <div id="settings-content" ref="contentEl" class="content" role="region" :aria-label="navigationTarget ? activeSettingsTitle : '设置'">
<div v-if="instantError" class="settings-save-error" role="alert"><span>{{ instantError }}</span><button type="button" class="ui-button" :disabled="savingInstant" @click="retryInstantPrefs">重试保存</button><button type="button" class="ui-button" @click="discardFailedInstant">放弃本次修改</button></div>
          <section v-if="tab === 'appearance'" class="section">
            <header class="section-head"><h2>外观</h2><p>设置显示模式和主题，所有窗口同步更新</p></header>
            <div class="card">
              <h3 class="card-title">模式</h3>
              <div class="appearance-options appearance-mode-options" role="group" aria-label="模式">
                <button v-for="mode in APPEARANCE_MODES" :key="mode.id" type="button" class="appearance-option" :data-appearance-mode="mode.id"
                  :aria-pressed="resolveAppearanceMode(cfg.app.appearance_mode) === mode.id" :disabled="saving"
                  @click="selectAppearanceMode(mode.id)">
                  <AppearancePreview :theme-id="resolveAppearanceTheme(cfg.app.appearance_theme).id" :mode="mode.id" split />
                  <span class="appearance-option-name">{{ mode.name }}<span v-if="resolveAppearanceMode(cfg.app.appearance_mode) === mode.id" class="appearance-selection-badge" aria-hidden="true">✓ 已选</span></span>
                  <span class="appearance-option-description">{{ mode.id === 'auto' ? '跟随系统自动切换' : mode.id === 'light' ? '明亮清爽的界面' : '柔和舒适的深色界面' }}</span>
                </button>
              </div>
              <p class="appearance-hint">自动模式跟随系统的亮色或暗色设置。</p>
            </div>
            <div class="card mt-3">
              <h3 class="card-title">主题</h3>
              <div class="appearance-options" role="group" aria-label="主题">
                <button v-for="theme in appearanceOptions" :key="theme.id" type="button"
                  class="appearance-option" :data-appearance-theme="theme.id"
                  :aria-pressed="resolveAppearanceTheme(cfg.app.appearance_theme).id === theme.id"
                  :disabled="saving" @click="selectAppearanceTheme(theme.id)">
                  <AppearancePreview :theme-id="theme.id" :mode="resolveAppearanceMode(cfg.app.appearance_mode)" :system-dark="appearanceUi.current.value.dark" />
                  <span class="appearance-option-name">{{ theme.name }}<span v-if="resolveAppearanceTheme(cfg.app.appearance_theme).id === theme.id" class="appearance-selection-badge" aria-hidden="true">✓ 已选</span></span>
                  <span class="appearance-option-description">{{ theme.description }}</span>
                </button>
              </div>
              <p class="appearance-hint">选择后自动保存，并同步到所有已打开的窗口。</p>
            </div>
            <div class="card mt-3 glyph-style-card">
              <h3 class="card-title">会话标识样式</h3>
              <div class="glyph-style-options" role="radiogroup" aria-label="会话标识样式">
                <button v-for="style in SUBCHAT_GLYPH_STYLES" :key="style.id" type="button" role="radio" class="glyph-style-option" :data-glyph-style="style.id" :aria-checked="resolveSubchatGlyphStyle(cfg.app.subchat_glyph_style)===style.id" :tabindex="resolveSubchatGlyphStyle(cfg.app.subchat_glyph_style)===style.id?0:-1" :disabled="saving" @click="selectGlyphStyle(style.id)" @keydown="onGlyphStyleKey($event,style.id)">
                  <span class="glyph-style-samples" aria-hidden="true"><img v-for="seed in glyphPreviewSeeds" :key="seed" :src="subchatGlyphUrl(seed,style.id)" alt="" /></span>
                  <span class="glyph-style-title">{{ style.name }}<span v-if="resolveSubchatGlyphStyle(cfg.app.subchat_glyph_style)===style.id" class="glyph-style-selected" aria-hidden="true"><AppIcon icon="check" /></span></span>
                  <span class="glyph-style-description">{{ style.description }}</span>
                </button>
              </div>
              <p class="appearance-hint">同一子对话的图案固定，切换样式后所有位置同步更新。</p>
            </div>
            <div class="card mt-3">
              <div class="switch-row">
                <div>
                  <div class="switch-title">窗口透明与模糊</div>
                  <div class="switch-hint">{{ windowMaterialHint }}</div>
                </div>
                <v-switch v-model="cfg.app.window_acrylic" hide-details color="primary" :disabled="saving || !windowMaterialSupported" aria-label="窗口透明与模糊" />
              </div>
            </div>
          </section>
          <!-- 基本 -->
          <section v-if="tab === 'basic'" class="section">
            <header class="section-head">
              <h2>基本</h2>
              <p>窗口、对话与消息展示</p>
            </header>

            <div class="card">
              <h3 class="card-title">窗口与托盘</h3>
              <div class="switch-row">
                <div>
                  <div class="switch-title">关闭主窗口时隐藏到托盘</div>
                  <div class="switch-hint">关闭窗口时不退出，最小化到托盘</div>
                </div>
                <v-switch aria-label="关闭主窗口时隐藏到托盘" v-model="cfg.app.close_to_tray" color="primary" hide-details density="compact" />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">启动后显示主界面</div>
                  <div class="switch-hint">关闭则启动后仅驻留托盘</div>
                </div>
                <v-switch aria-label="启动后显示主界面" v-model="cfg.app.show_main_on_start" color="primary" hide-details density="compact" />
              </div>
            </div>

            <div class="card mt-3">
              <h3 class="card-title">对话与标题</h3>
              <div class="switch-row">
                <div>
                  <div class="switch-title">回复后显示后续操作建议</div>
                  <div class="switch-hint">显示任务相关的快捷操作，不增加模型请求</div>
                </div>
                <v-switch aria-label="回复后显示后续操作建议"
                  v-model="cfg.app.show_followup_suggestions"
                  color="primary"
                  hide-details
                  density="compact"
                />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">AI 生成会话标题</div>
                  <div class="switch-hint">首条回复后生成一次短标题，之后不再改</div>
                </div>
                <v-switch aria-label="AI 生成会话标题"
                  v-model="cfg.app.ai_generate_chat_title"
                  color="primary"
                  hide-details
                  density="compact"
                />
              </div>
              <div class="field-row mt-2">
                <div>
                  <div class="switch-title">输入框字数上限</div>
                  <div class="switch-hint">默认 16000；使用下方按钮保存后生效</div>
                </div>
                <v-text-field
                  v-model.number="cfg.app.max_composer_chars"
                  type="number"
                  min="1000"
                  max="200000"
                  step="1000"
                  density="compact"
                  hide-details
                  variant="outlined"
                  class="composer-max-field"
                  style="max-width: 140px"
                />
              </div>
            <SettingsGroupActions v-bind="groupProps('composer')" @save="saveGroup('composer')" @cancel="cancelGroup('composer')" />
</div>

            <div class="card mt-3 message-display-card">
              <h3 class="card-title">消息展示</h3>
              <div class="switch-row">
                <div>
                  <div class="switch-title">显示已阅读网页</div>
                  <div class="switch-hint">在回答底部显示来源</div>
                </div>
                <v-switch aria-label="显示已阅读网页"
                  v-model="cfg.app.show_read_pages"
                  color="primary"
                  hide-details
                  density="compact"
                />
              </div>
              <div class="switch-row run-logs-setting">
                <div>
                  <div class="switch-title">显示运行日志</div>
                  <div class="switch-hint">在对话中显示系统与操作日志</div>
                </div>
                <v-switch
                  v-model="cfg.app.show_run_logs"
                  color="primary"
                  hide-details
                  density="compact"
                  aria-label="显示运行日志"
                />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">折叠工具调用</div>
                  <div class="switch-hint">将连续工具操作收成一条摘要</div>
                </div>
                <v-switch
                  v-model="cfg.app.collapse_tool_runs"
                  aria-label="折叠工具调用"
                  color="primary"
                  hide-details
                  density="compact"
                />
              </div>
              <DisclosureTransition>
              <div v-if="cfg.app.show_run_logs" class="log-fold-setting">
              <div class="switch-row log-fold-row">
                <div>
                  <div class="switch-title">日志折叠</div>
                </div>
                <span v-if="cfg.app.collapse_tool_runs" class="setting-status">已并入工具摘要</span>
                <v-switch
                  v-else
                  v-model="cfg.app.collapse_run_logs"
                  aria-label="日志折叠"
                  color="primary"
                  hide-details
                  density="compact"
                />
              </div>
              </div>
              </DisclosureTransition>
            </div>
          </section>

          <!-- 模型 -->
          <section v-if="tab === 'model'" class="section">
            <header class="section-head">
              <h2>模型</h2>
              <p>模型服务商与推理轮数</p>
            </header>
            <template v-if="cfg && provider">
              <div class="provider-layout">
                <div class="card provider-list-card">
                  <div class="provider-list-toolbar">
                    <h3 class="provider-list-title">服务商 <span>{{ cfg.ai.providers.length }}</span></h3>
                    <v-select
                      v-model="addPresetId"
                      :items="modelPresetItems"
                      item-title="title"
                      item-value="value"
                      label="从预设添加"
                      variant="outlined"
                      density="compact"
                      color="primary"
                      base-color="var(--appearance-composer-edge)"
                      class="navora-select provider-add-select"
                      :menu-props="selectMenuProps"
                      hide-details
                      @update:model-value="onAddFromPreset"
                    />
                    <button type="button" class="provider-tool-btn" @click="addCustomProvider">
                      自定义
                    </button>
                    <v-menu location="bottom end"><template #activator="{ props: menuProps }"><button v-bind="menuProps" type="button" class="provider-tool-btn provider-more" aria-label="服务商更多操作" title="更多操作"><AppIcon icon="ellipsis" /></button></template><div class="skill-more-panel" role="menu"><button type="button" role="menuitem" class="skill-more-item" @click="resetProviders">重置预设</button></div></v-menu>
                  </div>
                  <v-select v-if="mobile" :model-value="selectedProviderId" :items="cfg.ai.providers.map(p => ({title:p.label || p.id,value:p.id}))" label="当前服务商" class="mobile-provider-select" :menu-props="selectMenuProps" hide-details @update:model-value="selectProvider" />
                  <ul v-else class="provider-list" role="listbox" aria-label="模型服务商">
                    <li
                      v-for="p in cfg.ai.providers"
                      :key="p.id"
                      class="provider-list-item"
                      :class="{
                        active: p.id === selectedProviderId,
                        default: p.id === cfg.ai.default_provider,
                      }"
                      role="option"
                      :aria-selected="p.id === selectedProviderId"
                      tabindex="0"
                      @keydown.enter.prevent="selectProvider(p.id)"
                      @keydown.space.prevent="selectProvider(p.id)"
                      @click="selectProvider(p.id)"
                    >
                      <div class="provider-list-main">
                        <span class="provider-list-label" :title="p.label || p.id">{{ p.label || p.id }}</span>
                        <span class="provider-list-model">{{
                          (p.models && p.models.length > 1
                            ? `${p.model} 等 ${p.models.length} 个`
                            : p.model) || ''
                        }}</span>
                      </div>
                      <div class="provider-list-meta">
                        <span
                          v-if="p.id === cfg.ai.default_provider"
                          class="provider-badge default"
                          >默认</span
                        >
                        <span
                          class="provider-badge"
                          :class="keyConfigured[p.id] ? 'ok' : 'miss'"
                        >
                          {{ keyConfigured[p.id] ? '已配 Key' : '无 Key' }}
                        </span>
                      </div>
                    </li>
                  </ul>
                </div>

                <div class="card provider-edit-card">
                  <div class="provider-edit-head">
                    <h3 class="card-title">连接配置</h3>
                    <div class="provider-edit-actions">
                      <button
                        type="button"
                        class="provider-tool-btn"
                        :disabled="provider.id === cfg.ai.default_provider"
                        @click="setAsDefault"
                      >
                        设为默认
                      </button>
                      <button
                        type="button"
                        class="provider-tool-btn danger"
                        :disabled="cfg.ai.providers.length <= 1"
                        @click="removeSelectedProvider"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div class="form-grid connection-form">
                    <ProviderConnectionFields :provider="provider" v-model:key-draft="apiKeyDraft" :key-label="apiKeyLabel" :key-placeholder="apiKeyPreview ? '留空保留现有密钥' : '输入 API Key'">
                      <template #key-actions><button v-if="apiKeyPreview" type="button" class="provider-tool-btn danger" :disabled="clearingApiKey" @click.stop="clearApiKey">清除</button></template>
                    </ProviderConnectionFields>
                    <button type="button" class="advanced-toggle span-2" :aria-expanded="advancedModel" @click="advancedModel = !advancedModel"><AppIcon :icon="advancedModel ? 'chevron-down' : 'chevron-right'" />高级连接配置 <small>{{ modelAdvancedSummary }}</small></button>
                    <DisclosureTransition><div v-if="advancedModel" class="advanced-connection span-2 form-grid">
                      <v-select v-model="provider.protocol" :items="[{title:'OpenAI Chat Completions', value:'chat_completions'}]" label="API 协议" :menu-props="selectMenuProps" />
                      <v-select v-model="provider.output_token_param" :items="['max_tokens','max_completion_tokens']" label="输出上限参数" :menu-props="selectMenuProps" />
                      <v-text-field
                      v-model.number="provider.timeout_ms"
                      type="number"
                      label="超时 (ms)"
                      hint="建议本地模型 ≥ 300000"
                      persistent-hint
                      variant="outlined"
                      density="comfortable"
                      color="primary"
                      base-color="var(--appearance-composer-edge)"
                    />

                    </div></DisclosureTransition>
                    <ModelCatalogEditor :key="provider.id" :provider="provider" :pending-credentials="groupDirty('models')" />
                  </div>
                <SettingsGroupActions v-bind="groupProps('models')" @save="saveGroup('models')" @cancel="cancelGroup('models')" />
</div>
              </div>

              <div class="card mt-3">
                <h3 class="card-title">推理循环</h3>
                <p class="text-medium-emphasis mb-3" style="font-size: 0.82rem">
                  一轮 ≈ 一次模型调用；用尽后可选择继续。
                </p>
                <div class="form-grid">
                  <v-text-field
                    v-model.number="cfg.ai.max_tool_rounds"
                    type="number"
                    min="4"
                    max="80"
                    label="最大推理轮数"
                    variant="outlined"
                    density="comfortable"
                    color="primary"
                    base-color="var(--appearance-composer-edge)"
                    hint="单次任务上限（4～80）"
                    persistent-hint
                  />
                  <v-text-field
                    v-model.number="cfg.ai.continue_tool_rounds"
                    type="number"
                    min="4"
                    max="40"
                    label="续跑追加轮数"
                    variant="outlined"
                    density="comfortable"
                    color="primary"
                    base-color="var(--appearance-composer-edge)"
                    hint="继续时追加（4～40）"
                    persistent-hint
                  />
                </div>
              <SettingsGroupActions v-bind="groupProps('rounds')" @save="saveGroup('rounds')" @cancel="cancelGroup('rounds')" />
</div>
            </template>
          </section>

          <!-- 浏览器 -->
          <section v-if="tab === 'browser'" class="section">
            <header class="section-head">
              <h2>浏览器</h2>
              <p>AI 自动化、窗口行为与页面加载</p>
            </header>
            <div class="card browser-link-settings">
              <h3 class="card-title">打开网页链接</h3>
              <v-select :model-value="resolveBrowserLinkOpenMode(cfg.browser.link_open_mode)" :items="browserLinkOpenOptions" label="链接打开方式" aria-label="链接打开方式" variant="outlined" density="comfortable" hide-details :menu-props="selectMenuProps" @update:model-value="selectBrowserLinkOpenMode" />
              <p class="appearance-hint">用于聊天和文件中的网页链接，不改变 Agent 正在操作的页面。</p>
            </div>
            <div class="card browser-automation-settings">
              <h3 class="card-title">AI 自动化</h3>
              <p class="switch-hint">AI 使用这里的默认方式操作页面。你可以随时在浏览器工具栏暂停或接管。</p>
              <div class="switch-row" title="显示 AI 实际派发的光标位置，不移动系统鼠标">
                <div><div class="switch-title">显示虚拟光标</div><div class="switch-hint">显示 AI 实际派发的光标位置；隐藏光标仍保留输入保护</div></div>
                <v-switch aria-label="显示虚拟光标" v-model="cfg.browser.automation.show_virtual_cursor" color="primary" hide-details density="compact" />
              </div>
              <div class="switch-row">
                <div><div class="switch-title">平滑移动光标</div><div class="switch-hint">按距离自动安排移动轨迹与用时</div></div>
                <v-switch aria-label="平滑移动光标" v-model="cfg.browser.automation.smooth_pointer" color="primary" hide-details density="compact" />
              </div>
              <div class="switch-row">
                <div><div class="switch-title">显示 AI 操作反馈</div><div class="switch-hint">通过页面边框和状态栏显示操作进度；关闭后仍保留控制与异常提示</div></div>
                <v-switch aria-label="显示 AI 操作反馈" v-model="cfg.browser.automation.show_control_feedback" color="primary" hide-details density="compact" />
              </div>
              <div class="switch-row">
                <div><div class="switch-title">后台独立操作</div><div class="switch-hint automation-protection-hint">AI 控制页面期间始终隔离键鼠输入并保持后台运行，你可以继续使用其他软件；点击「接管」后交还页面</div></div>
                <span class="switch-title" data-automation-isolation-state>始终开启</span>
              </div>
              <div class="cursor-style-heading"><h3>虚拟光标样式</h3><p>{{ cfg.browser.automation.show_virtual_cursor?'显示 AI 的实际操作位置，不移动系统鼠标。':'开启显示后使用所选样式；现在也可以预选。' }}</p></div>
              <BrowserCursorSizeControl :model-value="cfg.browser.automation.cursor_scale" :cursor-style="cfg.browser.automation.cursor_style" @update:model-value="selectCursorScale" />
              <BrowserCursorCards :model-value="cfg.browser.automation.cursor_style" @update:model-value="selectCursorStyle" />
              <p v-if="cursorRuntimeIssue" class="cursor-runtime-note" role="status">{{ cursorRuntimeIssue }}<button type="button" class="ui-button" @click="refreshCursorRuntime">刷新状态</button></p>
<div class="automation-speed" :class="{'is-disabled':!cfg.browser.automation.smooth_pointer}">
                <div class="automation-speed-heading"><label for="automation-speed">移动速度 <small>默认 0.6×</small></label><output>{{ (speedPreview ?? cfg.browser.automation.speed_multiplier).toFixed(2) }}×</output></div>
                <input id="automation-speed" aria-label="移动速度" type="range" min="0.5" max="2" step="0.05" :disabled="!cfg.browser.automation.smooth_pointer"  :value="speedPreview ?? cfg.browser.automation.speed_multiplier" @input="speedPreview=Number(($event.target as HTMLInputElement).value)" @change="commitSpeed" />
                <div class="automation-speed-labels"><span>从容 0.5×</span><span>快速 2×</span></div>
              </div>
              <button type="button" class="advanced-toggle automation-advanced-toggle" :aria-expanded="advancedAutomation" @click="advancedAutomation=!advancedAutomation"><AppIcon :icon="advancedAutomation?'chevron-down':'chevron-right'" />高级：移动风格与采样</button>
              <DisclosureTransition><div v-if="advancedAutomation" class="automation-advanced-fields">
                <v-select v-model="cfg.browser.automation.pointer_profile" :items="[{title:'自然移动',value:'natural'},{title:'精确移动',value:'precise'}]" label="移动风格" :disabled="!cfg.browser.automation.smooth_pointer" variant="outlined" density="comfortable" hide-details :menu-props="selectMenuProps" />
                <label class="automation-number-field"><span>轨迹采样间隔（毫秒）</span><input aria-label="轨迹采样间隔（毫秒）" type="number" min="0.001" max="60000" step="0.25" :value="Number(cfg.browser.automation.interval_ms.toFixed(3))" :disabled="!cfg.browser.automation.smooth_pointer" @change="setAutomationInterval" /><small>控制输入点的密度，不改变总移动用时；默认约 8.333 毫秒</small></label>
                <v-select v-model="cfg.browser.automation.cursor_fps" :items="automationFrameRates" label="光标显示帧率" hint="只影响光标绘制，不影响输入采样；0 表示运行时默认" persistent-hint :disabled="!cfg.browser.automation.show_virtual_cursor" variant="outlined" density="comfortable" :menu-props="selectMenuProps" />
              <SettingsGroupActions v-bind="groupProps('movement')" @save="saveGroup('movement')" @cancel="cancelGroup('movement')" />
</div></DisclosureTransition>
            </div>
            <div class="card">
              <button type="button" class="advanced-toggle" :aria-expanded="advancedBrowser" @click="advancedBrowser = !advancedBrowser"><AppIcon :icon="advancedBrowser ? 'chevron-down' : 'chevron-right'" />高级：网站标识与语言</button>
              <DisclosureTransition><div v-if="advancedBrowser" class="ua-form">
                <v-select
                  :model-value="cfg.browser.default_ua_preset"
                  :items="uaPresetSelectItems"
                  item-title="label"
                  item-value="id"
                  label="预设"
                  variant="outlined"
                  density="comfortable"
                  color="primary"
                  base-color="var(--appearance-composer-edge)"
                  class="navora-select"
                  :menu-props="selectMenuProps"
                  hide-details
                  @update:model-value="onUaPresetChange"
                />
                <v-textarea
                  :model-value="displayBrowserUa"
                  label="User-Agent"
                  hint="修改内容后自动切换为「自定义」；选预设会填入对应 UA"
                  persistent-hint
                  rows="3"
                  auto-grow
                  variant="outlined"
                  density="comfortable"
                  color="primary"
                  base-color="var(--appearance-composer-edge)"
                  @update:model-value="onUaTextChange"
                />
                <v-text-field
                  v-model="cfg.browser.accept_language"
                  label="Accept-Language"
                  hint="语言列表或带 q 的完整头均可；setUserAgent 会自动去掉 q，由 Chromium 重新生成"
                  persistent-hint
                  placeholder="zh-CN,zh,en,en-GB,en-US"
                  variant="outlined"
                  density="comfortable"
                  color="primary"
                  base-color="var(--appearance-composer-edge)"
                />
              <SettingsGroupActions v-bind="groupProps('identity')" @save="saveGroup('identity')" @cancel="cancelGroup('identity')" />
</div></DisclosureTransition>
            </div>

            <div class="card">
              <h3 class="card-title">窗口行为</h3>
              <div class="switch-row">
                <div>
                  <div class="switch-title">新建 Agent 窗口默认显示</div>
                  <div class="switch-hint">关闭后在后台打开，可从浏览器资源中切换到页面</div>
                </div>
                <v-switch aria-label="新建 Agent 窗口默认显示" v-model="cfg.browser.show_agent_windows" color="primary" hide-details density="compact" />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">拦截网站弹出窗口</div>
                  <div class="switch-hint">关闭时，网站通过 window.open 打开的页面会作为新标签打开</div>
                </div>
                <v-switch aria-label="阻止 window.open" v-model="cfg.browser.block_window_open" color="primary" hide-details density="compact" />
              </div>
            </div>

            <div class="card">
              <h3 class="card-title">导航与加载</h3>
              <p class="switch-hint">超时只结束等待，不会自动关闭页面；可在浏览器工具栏停止或重新加载。</p>
              <div class="form-grid">
                <v-text-field
                  v-model.number="cfg.browser.navigation_timeout_ms"
                  type="number"
                  min="1000"
                  max="300000"
                  step="1000"
                  label="导航等待上限（毫秒）"
                  hint="1,000–300,000 毫秒；默认 30,000"
                  persistent-hint
                  variant="outlined"
                  density="comfortable"
                  color="primary"
                  base-color="var(--appearance-composer-edge)"
                />
                <v-text-field
                  v-model.number="cfg.browser.action_timeout_ms"
                  type="number"
                  min="1000"
                  max="120000"
                  step="1000"
                  label="页面操作等待上限（毫秒）"
                  hint="1,000–120,000 毫秒；默认 15,000"
                  persistent-hint
                  variant="outlined"
                  density="comfortable"
                  color="primary"
                  base-color="var(--appearance-composer-edge)"
                />
              </div>
              <div class="switch-block">
                <div class="switch-row">
                  <div>
                    <div class="switch-title">等待主页面加载完成</div>
                    <div class="switch-hint">Agent 导航后等待页面 load 事件；关闭后更快返回，但内容可能尚未就绪</div>
                  </div>
                  <v-switch aria-label="等待主页面加载完成" v-model="cfg.browser.wait.load" color="primary" hide-details density="compact" />
                </div>
                <div class="switch-row">
                  <div>
                    <div class="switch-title">继续等待网络短暂空闲</div>
                    <div class="switch-hint">适合加载较慢的页面；持续联网的网站可能要等到超时才继续</div>
                  </div>
                  <v-switch aria-label="继续等待网络短暂空闲" v-model="cfg.browser.wait.network_idle" color="primary" hide-details density="compact" />
                </div>
                <v-text-field
                  v-if="cfg.browser.wait.network_idle"
                  v-model.number="cfg.browser.wait.network_idle_ms"
                  type="number"
                  min="100"
                  max="5000"
                  step="100"
                  label="网络空闲判定时间（毫秒）"
                  hint="连续空闲达到此时间后继续；100–5,000 毫秒，默认 500"
                  persistent-hint
                  variant="outlined"
                  density="comfortable"
                  color="primary"
                  base-color="var(--appearance-composer-edge)"
                />
              </div>
            <SettingsGroupActions v-bind="groupProps('waits')" @save="saveGroup('waits')" @cancel="cancelGroup('waits')" />
</div>

            <div class="card">
              <h3 class="card-title">访问范围</h3>
              <v-textarea
                v-model="allowlistText"
                label="网址白名单（每行一条）"
                rows="5"
                variant="outlined"
                density="comfortable"
                color="primary"
                base-color="var(--appearance-composer-edge)"
                hint="留空表示不限制；支持域名、通配符或完整 URL"
                persistent-hint
              />
            <SettingsGroupActions v-bind="groupProps('access')" @save="saveGroup('access')" @cancel="cancelGroup('access')" />
</div>

            <div class="card">
              <h3 class="card-title">诊断</h3>
              <div class="switch-row">
                <div>
                  <div class="switch-title">记录 DataDome 上报</div>
                  <div class="switch-hint">仅用于排查验证码问题；请求内容会写入本机日志文件</div>
                </div>
                <v-switch aria-label="记录 DataDome 上报" v-model="cfg.browser.log_datadome_telemetry" color="primary" hide-details density="compact" />
              </div>
            </div>
          </section>

          <!-- 权限 -->
          <section v-if="tab === 'permissions'" class="section">
            <header class="section-head">
              <h2>权限</h2>
              <p>Agent 能力门闸；新 Chat 继承此处配置</p>
            </header>
            <div class="card perm-toolbar">
              <v-select
                :model-value="cfg.permissions.preset"
                :items="presetItems"
                label="权限预设"
                variant="outlined"
                density="comfortable"
                color="primary"
                base-color="var(--appearance-composer-edge)"
                class="navora-select perm-preset"
                :disabled="presetConfirming || saving"
                :menu-props="selectMenuProps"
                hide-details
                @update:model-value="onPresetChange"
              />
              <p class="perm-toolbar-hint">重选预设会覆盖全部能力档位</p>
            </div>
            <div class="permission-filters">
              <v-text-field v-model="permissionSearch" label="搜索能力" density="compact" hide-details clearable />
              <v-select v-model="permissionGroup" :items="permissionGroups" density="compact" hide-details label="能力分组" :menu-props="selectMenuProps" />
              <label class="filter-check"><input v-model="permissionModified" type="checkbox" />仅与均衡预设不同</label>
            </div>
            <div class="card perm-table">
              <div class="perm-table-head">
                <span>能力</span>
                <span>标识</span>
                <span>档位</span>
              </div>
              <div v-for="(mode, key) in visiblePermissions" :key="key" class="perm-row">
                <span class="perm-label">{{ permLabel(key) }}</span>
                <span class="perm-id">{{ key }}</span>
                <v-select
                  :model-value="mode"
                  :items="modeItemsFor(key)"
                  density="compact"
                  variant="outlined"
                  color="primary"
                  base-color="var(--appearance-composer-edge)"
                  hide-details
                  class="navora-select perm-select"
                  :menu-props="selectMenuProps"
                  @update:model-value="(v) => onModeChange(key, v)"
                />
              </div>
              <p v-if="!Object.keys(visiblePermissions).length" class="settings-empty">没有匹配的能力</p>
              <p class="perm-toolbar-hint mt-2">
                「添加/编辑技能」为拒绝时，Agent 不能发起技能弹窗。
              </p>
            </div>
          </section>

          <!-- 工作区 -->
          <section v-if="tab === 'workspace'" class="section">
            <header class="section-head">
              <h2>工作区</h2>
              <p>文件工具根目录；每个 Chat 独立子目录</p>
            </header>
            <div class="card">
              <div class="form-grid">
                <v-text-field
                  v-model="cfg.files.root_dirname"
                  label="内置相对目录名"
                  variant="outlined"
                  density="comfortable"
                  hide-details
                  hint="相对数据目录，默认 workspace"
                  persistent-hint
                  class="span-2"
                  :disabled="!!cfg.files.custom_root"
                />
                <v-text-field
                  v-model="cfg.files.custom_root"
                  label="自定义工作区根目录（绝对路径）"
                  variant="outlined"
                  density="comfortable"
                  hide-details
                  hint="留空则使用内置相对目录"
                  persistent-hint
                  class="span-2"
                />
              </div>
              <div class="mt-3 d-flex ga-2">
                <v-btn variant="outlined" color="primary" @click="pickCustomRoot">选择文件夹</v-btn>
                <v-btn variant="text" :disabled="!cfg.files.custom_root" @click="cfg.files.custom_root = ''">
                  清除自定义
                </v-btn>
              </div>
              <div class="switch-hint mt-3">
                也可由 Agent 为单个 Chat 指定覆盖路径。修改根目录不会搬迁旧文件，请先保留旧路径以便恢复。
              </div>
            <SettingsGroupActions v-bind="groupProps('workspace')" @save="saveGroup('workspace')" @cancel="cancelGroup('workspace')" />
</div>
          </section>

          <!-- 技能 -->
          <section v-if="tab === 'skills'" class="section">
            <header class="section-head">
              <h2>技能</h2>
              <p>启用后注入系统提示；可新建、导入或从商店安装</p>
            </header>
            <div
              class="card skill-dropzone"
              :class="{ 'skill-drop-active': skillDropActive && !skillBatchMode }"
              @dragenter.prevent="onSkillDragEnter"
              @dragover.prevent="onSkillDragOver"
              @dragleave.prevent="onSkillDragLeave"
              @drop.prevent="onSkillDrop"
            >
              <div class="d-flex flex-wrap ga-2 align-center">
                <template v-if="!skillBatchMode">
                  <v-btn color="primary" :disabled="!!skillsBusy" @click="openCreateSkill">
                    新建技能
                  </v-btn>
                  <v-btn variant="tonal" color="primary" :disabled="!!skillsBusy" class="launch-skill-creator" @click="emit('create', 'skill')">技能创建器</v-btn>
                  <v-btn
                    variant="outlined"
                    color="primary"
                    :loading="skillsBusy === 'dir'"
                    :disabled="!!skillsBusy"
                    @click="importSkill('directory')"
                  >
                    导入文件夹
                  </v-btn>
                  <v-btn
                    variant="outlined"
                    color="primary"
                    :loading="skillsBusy === 'file'"
                    :disabled="!!skillsBusy"
                    @click="importSkill('file')"
                  >
                    导入 SKILL.md
                  </v-btn>
                  <v-btn
                    variant="tonal"
                    color="primary"
                    :disabled="!!skillsBusy"
                    @click="openBrowse({ kind: 'skill' })"
                  >
                    技能商店
                  </v-btn>
                  <v-btn variant="text" :disabled="!!skillsBusy" @click="loadSkills">刷新</v-btn>
                </template>
                <template v-else>
                  <v-btn variant="tonal" :disabled="!!skillsBusy" @click="toggleSkillBatchSelectAll">
                    {{ skillBatchAllSelected ? '取消全选' : '全选' }}
                  </v-btn>
                  <v-btn
                    color="error"
                    variant="flat"
                    :disabled="!skillBatchSelectedCount || !!skillsBusy"
                    @click="askBatchRemoveSkills"
                  >
                    <AppIcon icon="trash" class="btn-ic-left" />
                    删除{{ skillBatchSelectedCount ? ` ${skillBatchSelectedCount}` : '' }}
                  </v-btn>
                  <span class="skill-batch-count" :class="{ ready: skillBatchSelectedCount > 0 }">
                    已选 {{ skillBatchSelectedCount }} / {{ skillsList.length }}
                  </span>
                </template>
              </div>
              <div v-if="!skillBatchMode" class="switch-hint mt-3">
                可导入含 SKILL.md 的文件夹 / 单文件，或拖入此区域；非 HTTPS 商店来源会提示风险。
              </div>
              <div v-else class="switch-hint mt-3">
                勾选后可批量删除。
              </div>
              <div v-if="skillDropActive && !skillBatchMode" class="skill-drop-hint">
                松开以导入技能
              </div>
            </div>

            <div v-if="!skillsList.length" class="card mt-3">
              <div class="settings-empty"><AppIcon icon="book" /><strong>暂无技能</strong><span>新建、导入或从商店添加</span></div>
            </div>

            <div v-if="proposals.length && !skillBatchMode" class="card mt-3">
              <h3 class="card-title">待确认</h3>
              <p class="switch-hint mb-2">
                Agent 或稍后处理的新建 / 修改可在此确认。
              </p>
              <div v-for="p in proposals" :key="p.id" class="proposal-row">
                <div class="proposal-meta">
                  <div class="skill-name">{{ proposalTitle(p) }}</div>
                  <div class="skill-id">{{ proposalActionLabel(p.action) }} · {{ formatProposalTime(p.updatedAt) }}</div>
                </div>
                <div class="skill-actions">
                  <v-btn
                    size="small"
                    color="primary"
                    variant="tonal"
                    :disabled="!!skillsBusy"
                    @click="openProposal(p.id)"
                  >
                    打开
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="text"
                    color="error"
                    :disabled="!!skillsBusy"
                    @click="discardProposal(p.id)"
                  >
                    丢弃
                  </v-btn>
                </div>
              </div>
            </div>

            <div v-if="skillsList.length" class="list-toolbar mt-3">
              <div class="list-toolbar-main">
                <h3 class="list-toolbar-title">技能列表</h3>
                <v-btn
                  v-if="skillBatchMode"
                  size="small"
                  variant="text"
                  class="list-batch-cancel"
                  :disabled="!!skillsBusy"
                  @click="exitSkillBatchMode"
                >
                  取消
                </v-btn>
                <v-btn
                  v-else
                  icon
                  variant="text"
                  size="small"
                  class="list-batch-btn"
                  aria-label="批量操作"
                  title="批量操作"
                  :disabled="!!skillsBusy"
                  @click="enterSkillBatchMode"
                >
                  <AppIcon icon="list-check" />
                </v-btn>
              </div>
            </div>

            <div
              v-for="s in skillsList"
              :key="s.id"
              class="card mt-2 skill-card"
              :class="{
                'skill-batch-mode': skillBatchMode,
                'skill-batch-selected': skillBatchMode && skillBatchSelectedIds.has(s.id),
              }"
              @click="skillBatchMode ? toggleSkillBatchSelect(s.id) : undefined"
            >
              <div class="skill-head">
                <div class="skill-meta-row">
                  <span
                    v-if="skillBatchMode"
                    class="skill-batch-check"
                    :class="{ on: skillBatchSelectedIds.has(s.id) }"
                    aria-hidden="true"
                  >
                    <AppIcon
                      :icon="skillBatchSelectedIds.has(s.id) ? 'circle-check' : 'circle'"
                    />
                  </span>
                  <div class="skill-meta">
                    <div class="skill-name">{{ s.name }}</div>
                    <div class="skill-id">{{ s.id }}</div>
                  </div>
                </div>
                <v-switch
                  v-if="!skillBatchMode"
                  class="skill-enable-switch"
                  :model-value="s.enabled"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="skillsBusy === s.id"
                  @update:model-value="(v) => toggleSkill(s.id, Boolean(v))"
                />
              </div>
              <div class="skill-body-row">
                <div class="skill-desc">{{ s.description }}</div>
                <v-menu
                  v-if="!skillBatchMode"
                  location="bottom end"
                  :close-on-content-click="true"
                  content-class="skill-more-menu"
                >
                  <template #activator="{ props: menuProps }">
                    <v-btn
                      icon
                      variant="text"
                      size="small"
                      class="skill-more-btn"
                      aria-label="更多操作"
                      :disabled="!!skillsBusy"
                      v-bind="menuProps"
                    >
                      <AppIcon icon="ellipsis-vertical" />
                    </v-btn>
                  </template>
                  <div class="skill-more-panel" role="menu">
                    <button
                      type="button"
                      class="skill-more-item"
                      role="menuitem"
                      @click="openEditSkill(s.id)"
                    >
                      <AppIcon icon="pen-to-square" />
                      <span>编辑</span>
                    </button>
                    <button
                      type="button"
                      class="skill-more-item"
                      role="menuitem"
                      @click="exportSkill(s.id)"
                    >
                      <AppIcon icon="file-export" />
                      <span>导出</span>
                    </button>
                    <button
                      type="button"
                      class="skill-more-item danger"
                      role="menuitem"
                      @click="askRemoveSkill(s)"
                    >
                      <AppIcon icon="trash" />
                      <span>删除</span>
                    </button>
                  </div>
                </v-menu>
              </div>
              <div v-if="s.disableModelInvocation" class="skill-flag">需 skill_read 再注入全文</div>
            </div>

            <SkillEditorDialog
              v-model="editorOpen"
              :skill-id="editorId"
              :draft="editorDraft"
              :saving="skillsBusy === 'save'"
              @confirm="onEditorConfirm"
              @cancel="editorOpen = false"
            />
            <SkillImportDialog
              v-model="importOpen"
              :preview="importPreview"
              :saving="skillsBusy === 'import'"
              @confirm="onImportConfirm"
            />
            <SkillBatchImportDialog
              v-model="batchOpen"
              :items="batchItems"
              :saving="skillsBusy === 'import'"
              @confirm="onBatchConfirm"
            />
            <SkillExportDialog
              v-model="exportOpen"
              :name="exportMeta?.name"
              :skill-id="exportMeta?.id"
              :markdown="exportMarkdown"
              :saving="skillsBusy === 'export'"
              @confirm="onExportConfirm"
              @cancel="exportOpen = false"
            />
            <SkillDeleteDialog
              v-model="deleteOpen"
              :skill-id="deleteTarget?.id"
              :name="deleteTarget?.name"
              :description="deleteTarget?.description"
              :items="deleteBatchItems"
              :saving="skillsBusy === 'delete'"
              @confirm="onDeleteConfirm"
              @cancel="onSkillDeleteCancel"
            />
          </section>

          <!-- 插件行为 -->
          <section v-if="tab === 'plugins'" class="section">
            <header class="section-head"><h2>插件</h2><p>插件运行与开发选项</p></header>
            <div class="card">
              <div class="switch-row">
                <div><div class="switch-title">插件开发模式</div><div class="switch-hint">提供 SDK 契约，自动重载外链产物</div></div>
                <v-switch aria-label="插件开发模式" v-model="cfg.plugins.dev_mode" color="primary" hide-details density="compact" />
              </div>
            </div>
          </section>

          <!-- 远程访问 -->
          <section v-if="tab === 'remote'" class="section">
            <header class="section-head">
              <h2>远程访问</h2>
              <p>在其他设备浏览器中远程使用本机 Navora</p>
            </header>
            <div class="card">
              <div class="switch-row">
                <div>
                  <div class="switch-title">启用远程访问</div>
                  <div class="switch-hint">开启后监听下方端口，需账号密码登录</div>
                </div>
                <v-switch aria-label="启用远程访问" :model-value="cfg.remote.enabled" @update:model-value="onRemoteEnabled" color="primary" hide-details density="compact" />
              </div>
              <div class="form-grid mt-2 remote-connection-form">
                <v-text-field
                  v-model="cfg.remote.host"
                  label="监听地址"
                  variant="outlined"
                  density="comfortable"
                  hide-details

                />
                <v-text-field
                  v-model.number="cfg.remote.port"
                  label="端口"
                  type="number"
                  variant="outlined"
                  density="comfortable"
                  hide-details

                />
                <v-text-field
                  v-model="cfg.remote.username"
                  label="用户名"
                  variant="outlined"
                  density="comfortable"
                  hide-details

                />
                <v-text-field
                  v-model="remotePasswordDraft"
                  label="新密码（留空不改）"
                  type="password"
                  variant="outlined"
                  density="comfortable"
                  hide-details

                  autocomplete="new-password"
                />
              <p v-if="remoteStatus?.error" class="settings-field-error" role="alert">已保存 · 监听启动失败：{{ remoteStatus.error }}</p><button v-if="cfg.remote.enabled && !remoteStatus?.running" type="button" class="ui-button" @click="retryRemote">重试启动</button><SettingsGroupActions v-bind="groupProps('remote')" @save="saveGroup('remote')" @cancel="cancelGroup('remote')" />
</div>
              <div v-if="cfg.remote.enabled" class="remote-url mt-3">
                <div class="switch-title">访问地址</div>
                <div class="switch-hint">
                  {{ remoteStatus?.url || `http://127.0.0.1:${cfg.remote.port}` }}
                  <span v-if="remoteStatus">
                    · {{ remoteStatus.running ? '运行中' : '未运行' }}
                  </span>
                </div>
                <div class="switch-hint mt-1">
                  首次启用请设置新密码；启用前先保存连接。配置已保存与监听成功分别显示。
                </div>
              </div>
            </div>
          </section>

          <!-- 询问/决策 -->
          <section v-if="tab === 'fork'" class="section">
            <header class="section-head">
              <h2>询问/决策</h2>
              <p>任务路径不明或需确认时，在对话里询问你如何继续</p>
            </header>
            <div class="card">
              <div class="switch-row">
                <div>
                  <div class="switch-title">启用询问/决策</div>
                  <div class="switch-hint">路径不明或需确认时在对话中给出选项</div>
                </div>
                <v-switch aria-label="启用询问/决策"
                  v-model="cfg.fork_decision.enabled"
                  color="primary"
                  hide-details
                  density="compact"
                />
              </div>
            </div>

            <div class="card mt-3" :class="{ muted: !cfg.fork_decision.enabled }">
              <h3 class="card-title">超时</h3>
              <div class="switch-row">
                <div>
                  <div class="switch-title">不限时等待</div>
                  <div class="switch-hint">一直等到你选择</div>
                </div>
                <v-switch aria-label="不限时等待"
                  v-model="askTimeoutUnlimited"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="!cfg.fork_decision.enabled"
                />
              </div>
              <div class="field-row mt-2" :class="{ muted: askTimeoutUnlimited }">
                <div>
                  <div class="switch-title">自定义时间</div>
                  <div class="switch-hint">超时未选将按超时处理；关闭「不限时」后默认 2 分钟；使用下方按钮保存后生效</div>
                </div>
                <v-text-field
                  v-model.number="askTimeoutSec"
                  type="number"
                  min="5"
                  max="600"
                  step="5"
                  suffix="秒"
                  density="compact"
                  hide-details
                  variant="outlined"
                  color="primary"
                  base-color="var(--appearance-composer-edge)"
                  class="ask-timeout-field"
                  style="max-width: 140px"
                  :disabled="!cfg.fork_decision.enabled || askTimeoutUnlimited"
                />
              </div>
            <SettingsGroupActions v-bind="groupProps('timeout')" @save="saveGroup('timeout')" @cancel="cancelGroup('timeout')" />
</div>

            <div class="card mt-3" :class="{ muted: !cfg.fork_decision.enabled }">
              <h3 class="card-title">决策体验</h3>
              <div class="switch-row">
                <div>
                  <div class="switch-title">允许自定义输入</div>
                  <div class="switch-hint">除预设选项外，可手写答案</div>
                </div>
                <v-switch aria-label="允许自定义输入"
                  v-model="cfg.fork_decision.allow_custom"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="!cfg.fork_decision.enabled"
                />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">选项后果说明</div>
                  <div class="switch-hint">显示选项后果说明</div>
                </div>
                <v-switch aria-label="选项后果说明"
                  v-model="cfg.fork_decision.option_hints"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="!cfg.fork_decision.enabled"
                />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">推荐选项</div>
                  <div class="switch-hint">高亮推荐选项</div>
                </div>
                <v-switch aria-label="推荐选项"
                  v-model="cfg.fork_decision.recommended"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="!cfg.fork_decision.enabled"
                />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">附带页面现场</div>
                  <div class="switch-hint">弹窗显示当前页标题与地址</div>
                </div>
                <v-switch aria-label="附带页面现场"
                  v-model="cfg.fork_decision.context_evidence"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="!cfg.fork_decision.enabled"
                />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">本会话记住选择</div>
                  <div class="switch-hint">相同问题自动沿用上次答案</div>
                </div>
                <v-switch aria-label="本会话记住选择"
                  v-model="cfg.fork_decision.remember_in_chat"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="!cfg.fork_decision.enabled"
                />
              </div>
            </div>

            <div class="card mt-3 muted">
              <h3 class="card-title">进阶（尚未实现）</h3>
              <p class="switch-hint" style="margin: 0 0 8px">
                尚未实现，开关已禁用。
              </p>
              <div class="switch-row">
                <div>
                  <div class="switch-title">低风险内联选择</div>
                  <div class="switch-hint">低风险询问以消息流呈现</div>
                </div>
                <v-switch aria-label="低风险内联选择"
                  :model-value="false"
                  color="primary"
                  hide-details
                  density="compact"
                  disabled
                />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">允许改口续跑</div>
                  <div class="switch-hint">回改历史决策并从该节点继续</div>
                </div>
                <v-switch aria-label="允许改口续跑"
                  :model-value="false"
                  color="primary"
                  hide-details
                  density="compact"
                  disabled
                />
              </div>
            </div>
          </section>

          <!-- 子对话 -->
          <section v-if="tab === 'subchat'" class="section">
            <header class="section-head">
              <h2>子对话</h2>
              <p>并行子任务与数量上限</p>
            </header>
            <div class="card">
              <div class="switch-row">
                <div>
                  <div class="switch-title">启用子对话</div>
                  <div class="switch-hint">允许 Agent 用并行子对话拆分调研等子任务</div>
                </div>
                <v-switch aria-label="启用子对话"
                  v-model="cfg.subchat.enabled"
                  color="primary"
                  hide-details
                  density="compact"
                />
              </div>
            </div>

            <div class="card mt-3" :class="{ muted: !cfg.subchat.enabled }">
              <h3 class="card-title">并行数量</h3>
              <div class="field-row">
                <div>
                  <div class="switch-title">最大并行子对话</div>
                  <div class="switch-hint">
                    同一父对话同时运行的子对话上限（不含父对话本身）；范围
                    {{ subchatMaxMin }}～{{ subchatMaxMax }}；使用下方按钮保存后生效
                  </div>
                </div>
                <v-text-field
                  v-model.number="cfg.subchat.max_parallel"
                  type="number"
                  :min="subchatMaxMin"
                  :max="subchatMaxMax"
                  step="1"
                  density="compact"
                  hide-details
                  variant="outlined"
                  color="primary"
                  base-color="var(--appearance-composer-edge)"
                  class="ask-timeout-field"
                  style="max-width: 120px"
                  :disabled="!cfg.subchat.enabled"
                />
              </div>
            <SettingsGroupActions v-bind="groupProps('subchat')" @save="saveGroup('subchat')" @cancel="cancelGroup('subchat')" />
</div>
          </section>

          <!-- 关于 -->
          <section v-if="tab === 'about'" class="section">
            <header class="section-head">
              <h2>关于</h2>
              <p>应用版本与浏览器内核</p>
            </header>
            <div class="card about-card">
              <div class="about-product"><img src="/app-icon.png" alt="" draggable="false"/><div><h3 class="about-name">{{ info?.name || 'Navora' }}</h3><p class="about-tag">AI Agent Browser</p></div></div>
              <div v-if="info" class="about-version"><span>应用版本</span><strong data-about-version>{{ info.version }}</strong><span v-if="info.portable" class="about-portable">便携版</span></div>
              <dl v-if="info" class="about-dl">
                <div>
                  <dt>Electron</dt>
                  <dd>{{ info.electron }}</dd>
                </div>
                <div>
                  <dt>Chromium</dt>
                  <dd>{{ info.chrome }}</dd>
                </div>
              </dl>
              <p v-else class="about-note" role="status">正在读取版本信息…</p>
            </div>
          </section>
        </div>
      </div>
    </div>

    <SettingsPermissionConfirm ref="permissionConfirm" :active="tab==='permissions' && exitState.phase==='idle'" />
    <v-snackbar
      v-model="toast.show"
      :color="toast.color"
      :timeout="2200"
      location="bottom end"
      :transition="false"
      variant="tonal"
      class="app-toast"
      :z-index="10000"
    >
      <button type="button" class="app-toast-dismiss" :aria-label="`${toast.text}，点击关闭提示`" @click="toast.show=false"><span>{{ toast.text }}</span><AppIcon icon="xmark" /></button>
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTheme } from 'vuetify'
import {useWindowMaterialState} from '@/composables/useWindowMaterialState'
import { useRouter } from 'vue-router'
import SettingsGroupActions from '@/components/SettingsGroupActions.vue'
import SettingsPermissionConfirm from '@/components/SettingsPermissionConfirm.vue'
import { SETTINGS_GROUPS, projectSettingsGroup, settingsGroupDirty, validateSettingsGroup, settingsPath, setSettingsPath, type SettingsGroup } from '@shared/settings-groups'
import { createSettingsCommit, type SettingsCommit } from '@shared/settings-commit'
import AppearancePreview from '@/components/AppearancePreview.vue'
import BrowserCursorCards from '@/components/BrowserCursorCards.vue'
import BrowserCursorSizeControl from '@/components/BrowserCursorSizeControl.vue'
import type {BrowserCursorStyle} from '@shared/browser-cursor'
import {createSettingsExitGuard,type SettingsExitState} from '@shared/settings-navigation'
import { rebaseSettingsDraft } from '@shared/settings-draft'
import { normalizeBrowserAutomation } from '@shared/browser-automation'
import { APPEARANCE_THEMES, APPEARANCE_MODES, resolveAppearanceTheme, resolveAppearanceMode, appearancePalette } from '@shared/appearance'
import {SUBCHAT_GLYPH_STYLES,resolveSubchatGlyphStyle,subchatGlyphUrl,type SubchatGlyphStyle} from '@shared/subchat-glyph'
import { settingsDraftSession, settingsCredentialDrafts } from '@/composables/settingsDraftSession'
import ProviderConnectionFields from '@/components/ProviderConnectionFields.vue'
import ModelCatalogEditor from '@/components/ModelCatalogEditor.vue'
import DisclosureTransition from '@/components/motion/DisclosureTransition'
import {
  createDefaultConfig,
  resolveBrowserLinkOpenMode,
  createDefaultForkDecision,
  FORK_ASK_TIMEOUT_DEFAULT_MS,
  FORK_ASK_TIMEOUT_LIMITED_MS,
  createDefaultSubchat,
  modesForPreset,
  detectPermissionPreset,
  resolveForkDecision,
  resolvePluginDevMode,
  resolveSubchat,
  SUBCHAT_MAX_PARALLEL_MIN,
  SUBCHAT_MAX_PARALLEL_MAX,
  syncBrowserUaFields,
  assertRemoteAccessConfig,
  type AppConfig,
} from '@shared/config'
import { MODEL_PRESETS } from '@shared/model-presets'
import { findUaPresetByUa, getUaPreset, UA_PRESETS } from '@shared/ua-presets'
import {
  addProviderFromPresetId,
  defaultProviderList,
  ensureDefaultProvider,
  newCustomProvider,
  normalizeProvider,
  pickDefaultProviderId,
} from '@shared/model-providers'
import type { AppInfo, PermissionMode, PermissionPreset } from '@shared/types'
import type { SkillImportPreview, SkillRecord } from '@shared/skills'
import { storeErrorText } from '@shared/store'
import type { SkillProposal, SkillReviewDraft } from '@shared/types'
import SkillEditorDialog from '../components/skills/SkillEditorDialog.vue'
import SkillImportDialog from '../components/skills/SkillImportDialog.vue'
import SkillBatchImportDialog from '../components/skills/SkillBatchImportDialog.vue'
import SkillExportDialog from '../components/skills/SkillExportDialog.vue'
import SkillDeleteDialog from '../components/skills/SkillDeleteDialog.vue'
import { useOnboarding } from '../composables/useOnboarding'
import { useStoreUi } from '../composables/useStoreUi'

const hostMaterial=useWindowMaterialState()
const windowMaterialSupported=computed(()=>hostMaterial.value?.supported===true)
const windowMaterialHint=computed(()=>{
  if(window.navora?.app.platform==='web')return '请在桌面端设置窗口透明与模糊。'
  const state=hostMaterial.value
  if(!state)return '暂时无法确认当前系统支持，已使用实色。'
  if(!state.supported)return state.supportReason==='system_unknown'?'暂时无法确认当前系统支持，已使用实色。':'当前系统不支持窗口透明与模糊，已使用实色。'
  if(['high_contrast','forced_colors','reduced_transparency','system_unknown'].includes(state.reason))return '系统当前限制透明效果，暂时使用实色；开关会保留你的偏好。'
  if(state.reason==='tone_mismatch')return '应用外观与系统不一致，暂时使用实色；开关会保留你的偏好。'
  if(state.reason==='native_error')return '当前使用实色；开关会保留你的透明效果偏好。'
  return '为标题栏和停靠侧栏显示系统半透明背景，配色跟随应用外观。'
})

const props = withDefaults(
  defineProps<{
    /** Render inside the application workspace. */
    embedded?: boolean
    mobile?: boolean
    navigationTarget?: string
    initialTab?: string
    /** Move keyboard focus into the settings destination after it mounts. */
    focusOnEntry?: boolean
    returnLabel?: string
  }>(),
  { embedded: false, mobile: false },
)

const emit = defineEmits<{
  close: []
  create: [kind: 'plugin' | 'skill']
  navigate: [tab: string]
  entryFocused: []
}>()

const router = useRouter()

const { show: showOnboarding } = useOnboarding()
const { openBrowse, onInstalled: onStoreUiInstalled } = useStoreUi()
let unsubStoreInstalled: (() => void) | undefined

function openOnboarding() {
  showOnboarding({ manual: true })
}

const tab = ref(props.initialTab || settingsDraftSession.section || 'basic')
const headingEl=ref<HTMLElement|null>(null),backButtonEl=ref<HTMLButtonElement|null>(null)
function focusEntry(){
  if(!props.focusOnEntry)return
  const target=headingEl.value||backButtonEl.value
  if(target?.checkVisibility()){target.focus({preventScroll:true});if(document.activeElement===target)emit('entryFocused')}
}
watch(()=>props.focusOnEntry,active=>{if(active)void nextTick(focusEntry)},{flush:'post'})
watch(()=>props.initialTab,value=>{if(value&&value!==tab.value)selectTab(value)})
const contentEl = ref<HTMLElement | null>(null)
const navListEl = ref<HTMLElement | null>(null)
const cfg = ref<AppConfig | null>(null)
const permissionConfirm=ref<InstanceType<typeof SettingsPermissionConfirm>|null>(null),presetConfirming=ref(false)
const appearanceUi = useTheme()
const appearanceOptions = computed(() => APPEARANCE_THEMES.map(theme =>
  appearancePalette(theme.id, cfg.value?.app.appearance_mode, appearanceUi.current.value.dark),
))
const info = ref<AppInfo | null>(null)
const cursorRuntimeIssue=ref('')
let cursorRuntimeRequest=0,offCursorRuntime:(()=>void)|undefined
async function refreshCursorRuntime(){
  const request=++cursorRuntimeRequest
  if(tab.value!=='browser'||!window.navora?.browser?.workspace?.state)return
  try{
    const state=await window.navora.browser.workspace.state()
    if(disposed||request!==cursorRuntimeRequest)return
    const states=state.pages.flatMap(session=>session.windows).flatMap(page=>page.automation?[page.automation]:[])
    cursorRuntimeIssue.value=states.some(state=>state.cursorAvailable===false||state.cursorImageAvailable===false)?'样式设置已保存；部分网页当前不支持自定义光标。':states.some(state=>state.error==='cursor_configuration_failed')?'设置已保存；部分网页的光标更新失败，请到该页面查看操作提示。':''
  }catch{if(!disposed&&request===cursorRuntimeRequest)cursorRuntimeIssue.value='设置选择已保留；暂时无法确认运行页面的光标状态。'}
}

function selectTab(value: string) {
  if(value===tab.value)return
  if(contentEl.value)settingsDraftSession.scroll[tab.value]=contentEl.value.scrollTop
  if (tab.value === 'skills' && value !== 'skills' && skillBatchMode.value) {
    exitSkillBatchMode()
  }
  tab.value = value
  settingsDraftSession.section=value
  emit('navigate', value)
  if (value === 'skills') void loadSkills()
  if (value === 'browser') void refreshCursorRuntime()
  if (value === 'subchat' && cfg.value) ensureSubchat()
  void nextTick(() => {
    contentEl.value?.scrollTo({ top: settingsDraftSession.scroll[value]||0 })
    const active = navListEl.value?.querySelector<HTMLElement>('.nav-item.active')
    active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  })
}

function ensureForkDecision(): NonNullable<AppConfig['fork_decision']> {
  if (!cfg.value) throw new Error('config_not_ready')
  if (!cfg.value.fork_decision) {
    cfg.value.fork_decision = createDefaultForkDecision()
  }
  return cfg.value.fork_decision
}

function ensureSubchat(): NonNullable<AppConfig['subchat']> {
  if (!cfg.value) throw new Error('config_not_ready')
  if (!cfg.value.subchat) {
    cfg.value.subchat = createDefaultSubchat()
  }
  return cfg.value.subchat
}

const subchatMaxMin = SUBCHAT_MAX_PARALLEL_MIN
const subchatMaxMax = SUBCHAT_MAX_PARALLEL_MAX

/** 0 = wait forever; otherwise seconds UI for fork_decision.ask_timeout_ms. */
const askTimeoutUnlimited = computed({
  get() {
    return (cfg.value?.fork_decision?.ask_timeout_ms ?? FORK_ASK_TIMEOUT_DEFAULT_MS) <= 0
  },
  set(on: boolean) {
    if (!cfg.value) return
    const fork = ensureForkDecision()
    if (on) {
      if (fork.ask_timeout_ms === 0) return
      fork.ask_timeout_ms = 0
      void nextTick(() => saveGroup('timeout'))
      return
    }
    if (fork.ask_timeout_ms > 0) return
    fork.ask_timeout_ms = FORK_ASK_TIMEOUT_LIMITED_MS
    void nextTick(() => saveGroup('timeout'))
  },
})

const askTimeoutSec = computed({
  get() {
    const ms = cfg.value?.fork_decision?.ask_timeout_ms
    const n =
      typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : FORK_ASK_TIMEOUT_LIMITED_MS
    return Math.round(n / 1000)
  },
  set(sec: number) {
    if (!cfg.value) return
    const fork = ensureForkDecision()
    if (fork.ask_timeout_ms <= 0) return
    const v = typeof sec === 'number' ? sec : Number(sec)
    const clamped = Number.isFinite(v)
      ? Math.min(600, Math.max(5, Math.floor(v)))
      : Math.round(FORK_ASK_TIMEOUT_LIMITED_MS / 1000)
    const nextMs = clamped * 1000
    if (fork.ask_timeout_ms === nextMs) return
    fork.ask_timeout_ms = nextMs
  },
})
const keyDrafts = settingsCredentialDrafts
const savedBaseline = ref<AppConfig | null>(null)
const apiKeyDraft = computed({ get: () => keyDrafts.value[selectedProviderId.value] || '', set: value => { keyDrafts.value[selectedProviderId.value] = value } })
const advancedModel = ref(false)
const advancedBrowser = ref(false)
const advancedAutomation = ref(false)
const automationFrameRates = computed(() => {
  const values = [0, 30, 60, 120]
  const current = cfg.value?.browser.automation.cursor_fps
  if (current !== undefined && !values.includes(current)) values.push(current)
  return values.sort((a,b)=>a-b).map(value=>({title:value===0?'运行时默认':`${value} 帧 / 秒`,value}))
})
function setAutomationInterval(event: Event) {
  const input = event.target as HTMLInputElement
  if (!cfg.value) return
  const value = Number(input.value)
  if (!input.value.trim() || !Number.isFinite(value) || value <= 0 || value > 60000) {
    input.value = String(Number(cfg.value.browser.automation.interval_ms.toFixed(3)))
    showToast('采样间隔需大于 0 且不超过 60,000 毫秒', 'error')
    return
  }
  cfg.value.browser.automation.interval_ms = value
}
const permissionSearch = ref('')
const permissionGroup = ref('all')
const permissionModified = ref(false)
const permissionGroups = [{ title: '全部能力', value: 'all' }, { title: '会话与网络', value: 'session' }, { title: '浏览器窗口', value: 'window' }, { title: '文件', value: 'file' }, { title: '其他能力', value: 'other' }]
const visiblePermissions = computed<Record<string, PermissionMode>>(() => {
  if (!cfg.value) return {}
  const baseline = modesForPreset('balanced')
  return Object.fromEntries(Object.entries(cfg.value.permissions.modes).filter(([key, mode]) => {
    const group = key.startsWith('session.') ? 'session' : key.startsWith('window.') ? 'window' : key.startsWith('file') ? 'file' : 'other'
    return (permissionGroup.value === 'all' || permissionGroup.value === group) && (!permissionModified.value || mode !== baseline[key as keyof typeof baseline]) && (permLabel(key) + ' ' + key).toLowerCase().includes(permissionSearch.value.trim().toLowerCase())
  }))
})
const apiKeyPreview = ref('')
const clearingApiKey = ref(false)
const keyConfigured = ref<Record<string, boolean>>({})
const selectedProviderId = ref('')
const addPresetId = ref<string | null>(null)
const allowlistText = ref('')
const saving = ref(false)
const savingGroup = ref<SettingsGroup | null>(null)
const groupErrors = ref<Partial<Record<SettingsGroup, string>>>({})
const instantError = ref('')
const lastInstantUndo = ref<SettingsCommit | null>(null)
let failedInstant: AppConfig | null = null
const speedPreview = ref<number | null>(null)
function commitSpeed(event: Event) { if (cfg.value) cfg.value.browser.automation.speed_multiplier = Number((event.target as HTMLInputElement).value); speedPreview.value = null }
const savingInstant = ref(false)
const hydrating = ref(false)
const toast = ref({ show: false, text: '', color: 'success' })
const uaPresetItems = ref<{ id: string; label: string; ua?: string }[]>([])
const uaPresetSelectItems = computed(() => {
  const list = uaPresetItems.value.length ? uaPresetItems.value : UA_PRESETS
  const hasCustom = list.some((p) => p.id === 'custom')
  return hasCustom ? list : [...list, { id: 'custom', label: '自定义', ua: '' }]
})
const displayBrowserUa = computed(() => cfg.value ? syncBrowserUaFields(cloneConfig(cfg.value)) : '')

function onUaPresetChange(id: string) {
  if (!cfg.value || hydrating.value) return
  const next = String(id || '').trim() || 'edge152'
  cfg.value.browser.default_ua_preset = next
  if (next === 'custom') return
  const preset = getUaPreset(next) || uaPresetSelectItems.value.find((p) => p.id === next)
  if (preset?.ua) cfg.value.browser.custom_ua = preset.ua
}

function onUaTextChange(raw: string) {
  if (!cfg.value || hydrating.value) return
  const text = String(raw ?? '')
  cfg.value.browser.custom_ua = text
  const trimmed = text.trim()
  if (!trimmed) {
    // Empty string while on a built-in preset keeps that preset; empty + custom stays custom.
    return
  }
  const matched = findUaPresetByUa(trimmed)
  if (matched) {
    cfg.value.browser.default_ua_preset = matched.id
    return
  }
  cfg.value.browser.default_ua_preset = 'custom'
}
const remotePasswordDraft = ref('')
const remoteStatus = ref<{
  enabled: boolean
  running: boolean
  host: string
  port: number
  url: string
  hasPassword: boolean
  username: string
  tokenTtlMs: number
  error?: string
} | null>(null)

const navItems = [
  { value: 'basic', title: '基本', icon: 'sliders', desc: '窗口 · 对话 · 展示' },
  { value: 'appearance', title: '外观', icon: 'palette', desc: '配色 · 窗口层次' },
  { value: 'model', title: '模型', icon: 'microchip', desc: 'LLM 接入' },
  { value: 'browser', title: '浏览器', icon: 'browser', desc: 'UA 与超时' },
  { value: 'workspace', title: '工作区', icon: 'folder-open', desc: '文件目录' },
  { value: 'skills', title: '技能', icon: 'book', desc: '创建 · 导入' },
  { value: 'plugins', title: '插件', icon: 'puzzle-piece', desc: '运行与开发选项' },
  { value: 'remote', title: '远程访问', icon: 'key', desc: '全功能控制' },
  { value: 'permissions', title: '权限', icon: 'shield-halved', desc: 'Agent 能力' },
  { value: 'fork', title: '询问/决策', icon: 'circle-question', desc: '选项确认' },
  { value: 'subchat', title: '子对话', icon: 'sitemap', desc: '并行子任务' },
  { value: 'about', title: '关于', icon: 'circle-exclamation', desc: '版本信息' },
]
const activeSettingsTitle = computed(() => navItems.find(item => item.value === tab.value)?.title || '设置')

const skillsList = ref<SkillRecord[]>([])
const proposals = ref<SkillProposal[]>([])
const skillsBusy = ref<string | false>(false)
let unsubProposals: (() => void) | undefined
const skillDropActive = ref(false)
let skillDragDepth = 0

const editorOpen = ref(false)
const editorId = ref<string | null>(null)
const editorDraft = ref<SkillReviewDraft>({
  name: '',
  description: '',
  body: '',
  enabled: true,
  disableModelInvocation: false,
})

const importOpen = ref(false)
const importPreview = ref<SkillImportPreview | null>(null)
const importPending = ref<{ kind: 'path' | 'markdown'; path?: string; markdown?: string } | null>(
  null,
)

const batchOpen = ref(false)
const batchItems = ref<SkillImportPreview[]>([])

const exportOpen = ref(false)
const exportMarkdown = ref('')
const exportMeta = ref<{ id: string; name: string } | null>(null)

const deleteOpen = ref(false)
const deleteTarget = ref<SkillRecord | null>(null)
const deleteBatchItems = ref<Array<{ id: string; name?: string }> | undefined>(undefined)

const skillBatchMode = ref(false)
const skillBatchSelectedIds = ref<Set<string>>(new Set())
const skillBatchSelectedCount = computed(() => skillBatchSelectedIds.value.size)
const skillBatchAllSelected = computed(() => {
  const n = skillsList.value.length
  return n > 0 && skillBatchSelectedIds.value.size >= n
})

const skillErrorHints: Record<string, string> = {
  path_not_found: '路径不存在',
  skill_md_missing: '文件夹内缺少 SKILL.md',
  not_markdown: '请选择 .md 文件',
  unsupported_path: '不支持的路径类型',
  skill_not_found: '技能不存在',
  skill_exists: '技能已存在',
  remote_unsupported: '远程端不支持文件选择，请在本机客户端操作',
  host_too_old: '当前桌面版本过低，无法安装该版本',
  invalid_catalog_path: '商店目录路径无效，已拒绝下载',
  size_mismatch: '下载体积与目录声明不符',
  download_timeout: '下载超时',
  checksum_mismatch: '校验和不匹配，已拒绝安装',
  skill_too_large: '技能包超过 200MB 上限',
  zip_unsafe_path: '压缩包含不安全路径',
  product_not_found: '商店中找不到该产品',
}

function skillErrorText(code?: string): string {
  if (!code) return '操作失败'
  return skillErrorHints[code] || storeErrorText(code)
}

function openCreateSkill() {
  editorId.value = null
  editorDraft.value = {
    name: '',
    description: '',
    body: '',
    enabled: true,
    disableModelInvocation: false,
  }
  editorOpen.value = true
}

async function openEditSkill(id: string) {
  if (!window.navora?.skills || skillsBusy.value) return
  skillsBusy.value = id
  try {
    const detail = await window.navora.skills.get(id)
    if (!detail) {
      showToast('技能不存在', 'error')
      return
    }
    editorId.value = detail.id
    editorDraft.value = {
      name: detail.name,
      description: detail.description === '（无描述）' ? '' : detail.description,
      body: detail.body || '',
      enabled: detail.enabled,
      disableModelInvocation: detail.disableModelInvocation,
    }
    editorOpen.value = true
  } catch (e) {
    showToast(e instanceof Error ? e.message : '加载技能失败', 'error')
  } finally {
    skillsBusy.value = false
  }
}

async function onEditorConfirm(draft: SkillReviewDraft) {
  if (!window.navora?.skills || skillsBusy.value) return
  const name = draft.name.trim()
  if (!name) {
    showToast('请填写技能名称', 'error')
    return
  }
  if (!draft.body.trim()) {
    showToast('请填写技能正文', 'error')
    return
  }
  skillsBusy.value = 'save'
  try {
    const input = {
      name,
      description: draft.description.trim(),
      body: draft.body,
      disableModelInvocation: Boolean(draft.disableModelInvocation),
      enabled: draft.enabled !== false,
    }
    const res = editorId.value
      ? await window.navora.skills.update(editorId.value, input)
      : await window.navora.skills.create(input)
    if (!res.ok) {
      showToast(skillErrorText(res.error), 'error')
      return
    }
    showToast(editorId.value ? '已保存' : `已创建 ${res.skill?.name || ''}`)
    editorOpen.value = false
    await loadSkills()
  } catch (e) {
    showToast(e instanceof Error ? e.message : '保存失败', 'error')
  } finally {
    skillsBusy.value = false
  }
}

async function loadSkills() {
  if (!window.navora?.skills) {
    skillsList.value = []
    proposals.value = []
    return
  }
  try {
    skillsList.value = await window.navora.skills.list()
    if (window.navora.skills.listProposals) {
      // 待确认仅展示可搁置的新建/修改；删除/导出不可进此列表
      proposals.value = (await window.navora.skills.listProposals()).filter(
        (p) => p.action === 'create' || p.action === 'update',
      )
    }
    pruneSkillBatchSelection()
  } catch (e) {
    showToast(e instanceof Error ? e.message : '加载技能失败', 'error')
  }
}

function pruneSkillBatchSelection() {
  if (!skillsList.value.length && skillBatchMode.value) {
    exitSkillBatchMode()
    return
  }
  if (!skillBatchMode.value || !skillBatchSelectedIds.value.size) return
  const alive = new Set(skillsList.value.map((s) => s.id))
  let changed = false
  const next = new Set<string>()
  for (const id of skillBatchSelectedIds.value) {
    if (alive.has(id)) next.add(id)
    else changed = true
  }
  if (changed) skillBatchSelectedIds.value = next
}


async function onStoreInstalled() {
  showToast('已从商店安装')
  await loadSkills()
}

function proposalActionLabel(action: string) {
  if (action === 'create') return '新建'
  if (action === 'update') return '更新'
  if (action === 'delete') return '删除'
  if (action === 'export') return '导出'
  return action
}

function proposalTitle(p: SkillProposal) {
  return p.draft?.name || p.skillId || p.id
}

function formatProposalTime(ms: number) {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return ''
  }
}

async function openProposal(id: string) {
  if (!window.navora?.skills?.openProposal || skillsBusy.value) return
  skillsBusy.value = id
  try {
    const res = await window.navora.skills.openProposal(id)
    if (!res.ok) showToast(skillErrorText(res.error), 'error')
  } catch (e) {
    showToast(e instanceof Error ? e.message : '打开失败', 'error')
  } finally {
    skillsBusy.value = false
  }
}

async function discardProposal(id: string) {
  if (!window.navora?.skills?.removeProposal || skillsBusy.value) return
  skillsBusy.value = id
  try {
    await window.navora.skills.removeProposal(id)
    showToast('已丢弃待确认项')
    await loadSkills()
  } catch (e) {
    showToast(e instanceof Error ? e.message : '丢弃失败', 'error')
  } finally {
    skillsBusy.value = false
  }
}

function openSkillImportPreviews(previews: SkillImportPreview[]) {
  if (!previews.length) return
  if (previews.length === 1) {
    const p = previews[0]
    importPreview.value = p
    importPending.value = p.sourcePath
      ? { kind: 'path', path: p.sourcePath }
      : { kind: 'markdown', markdown: p.markdown }
    importOpen.value = true
    return
  }
  batchItems.value = previews
  batchOpen.value = true
}

async function importSkill(mode: 'directory' | 'file') {
  if (!window.navora?.skills || skillsBusy.value) return
  skillsBusy.value = mode === 'directory' ? 'dir' : 'file'
  try {
    const res = await window.navora.skills.pickParse(mode)
    if (res.canceled) return
    const list =
      res.previews && res.previews.length
        ? res.previews
        : res.preview
          ? [res.preview]
          : []
    if (!res.ok || !list.length) {
      showToast(skillErrorText(res.error), 'error')
      return
    }
    openSkillImportPreviews(list)
  } catch (e) {
    showToast(e instanceof Error ? e.message : '导入失败', 'error')
  } finally {
    skillsBusy.value = false
  }
}

async function onImportConfirm(opts: { overwrite: boolean }) {
  if (!window.navora?.skills || !importPending.value) return
  skillsBusy.value = 'import'
  try {
    let res: { ok: boolean; skill?: { name?: string }; error?: string }
    if (importPending.value.kind === 'path' && importPending.value.path) {
      res = await window.navora.skills.import(importPending.value.path, {
        overwrite: opts.overwrite,
      })
    } else if (importPending.value.markdown != null) {
      res = await window.navora.skills.importMarkdown(importPending.value.markdown, {
        overwrite: opts.overwrite,
      })
    } else {
      showToast('缺少导入来源', 'error')
      return
    }
    if (!res.ok) {
      showToast(skillErrorText(res.error), 'error')
      return
    }
    showToast(`已导入技能 ${res.skill?.name || ''}`)
    importOpen.value = false
    importPreview.value = null
    importPending.value = null
    await loadSkills()
  } catch (e) {
    showToast(e instanceof Error ? e.message : '导入失败', 'error')
  } finally {
    skillsBusy.value = false
  }
}

async function onBatchConfirm(selected: SkillImportPreview[]) {
  if (!window.navora?.skills || !selected.length) return
  skillsBusy.value = 'import'
  try {
    let okCount = 0
    for (const item of selected) {
      let res: { ok: boolean; skill?: { name?: string }; error?: string }
      if (item.sourcePath) {
        res = await window.navora.skills.import(item.sourcePath, {
          overwrite: Boolean(item.existing),
        })
      } else {
        res = await window.navora.skills.importMarkdown(item.markdown, {
          overwrite: Boolean(item.existing),
        })
      }
      if (res.ok) okCount += 1
      else showToast(skillErrorText(res.error), 'error')
    }
    if (okCount) showToast(`已导入 ${okCount} 个技能`)
    batchOpen.value = false
    batchItems.value = []
    await loadSkills()
  } catch (e) {
    showToast(e instanceof Error ? e.message : '批量导入失败', 'error')
  } finally {
    skillsBusy.value = false
  }
}

function onSkillDragEnter(e: DragEvent) {
  if (skillsBusy.value || skillBatchMode.value) return
  skillDragDepth += 1
  skillDropActive.value = true
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onSkillDragOver(e: DragEvent) {
  if (skillsBusy.value || skillBatchMode.value) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  skillDropActive.value = true
}

function onSkillDragLeave() {
  skillDragDepth = Math.max(0, skillDragDepth - 1)
  if (skillDragDepth === 0) skillDropActive.value = false
}

async function onSkillDrop(e: DragEvent) {
  skillDragDepth = 0
  skillDropActive.value = false
  if (!window.navora?.skills || skillsBusy.value || skillBatchMode.value) return
  const files = Array.from(e.dataTransfer?.files || [])
  if (!files.length) return
  skillsBusy.value = 'import'
  try {
    const previews: SkillImportPreview[] = []
    for (const file of files) {
      const filePath = (file as File & { path?: string }).path
      if (filePath && window.navora.skills.parsePath) {
        const res = await window.navora.skills.parsePath(filePath)
        if (!res.ok) {
          showToast(skillErrorText(res.error) + `（${file.name}）`, 'error')
          continue
        }
        const list =
          res.previews && res.previews.length
            ? res.previews
            : res.preview
              ? [res.preview]
              : []
        if (!list.length) {
          showToast(skillErrorText(res.error) + `（${file.name}）`, 'error')
          continue
        }
        previews.push(...list)
        continue
      }
      if (!/\.md$/i.test(file.name)) {
        showToast(`无法导入「${file.name}」（远程或无路径时请拖入 .md）`, 'warning')
        continue
      }
      const textMd = await file.text()
      const res = await window.navora.skills.parseMarkdown(textMd, file.name)
      if (!res.ok || !res.preview) {
        showToast(skillErrorText(res.error), 'error')
        continue
      }
      previews.push({
        ...res.preview,
        markdown: res.preview.markdown || textMd,
      })
    }
    if (!previews.length) return
    openSkillImportPreviews(previews)
  } catch (err) {
    showToast(err instanceof Error ? err.message : '拖入导入失败', 'error')
  } finally {
    skillsBusy.value = false
  }
}

async function exportSkill(id: string) {
  if (!window.navora?.skills || skillsBusy.value) return
  skillsBusy.value = id
  try {
    const res = await window.navora.skills.getMarkdown(id)
    if (!res.ok || !res.markdown) {
      showToast(skillErrorText(res.error), 'error')
      return
    }
    exportMeta.value = res.skill
      ? { id: res.skill.id, name: res.skill.name }
      : { id, name: id }
    exportMarkdown.value = res.markdown
    exportOpen.value = true
  } catch (e) {
    showToast(e instanceof Error ? e.message : '导出失败', 'error')
  } finally {
    skillsBusy.value = false
  }
}

async function onExportConfirm() {
  if (!window.navora?.skills || !exportMeta.value) return
  const meta = exportMeta.value
  skillsBusy.value = 'export'
  // 先关预览层，再唤起系统另存为，避免叠在设置弹窗上导致「没反应」
  exportOpen.value = false
  await nextTick()
  try {
    const res = await window.navora.skills.export(meta.id)
    if (res.canceled) {
      showToast('已取消导出', 'warning')
      return
    }
    if (res.error === 'remote_unsupported') {
      showToast(skillErrorText(res.error), 'error')
      return
    }
    if (!res.ok) {
      showToast(skillErrorText(res.error), 'error')
      return
    }
    showToast(`已导出到 ${res.path || ''}`)
  } catch (e) {
    showToast(e instanceof Error ? e.message : '导出失败', 'error')
  } finally {
    skillsBusy.value = false
  }
}

async function toggleSkill(id: string, enabled: boolean) {
  if (!window.navora?.skills || skillsBusy.value) return
  skillsBusy.value = id
  try {
    const res = await window.navora.skills.setEnabled(id, enabled)
    if (!res.ok) {
      showToast(skillErrorText(res.error), 'error')
      return
    }
    await loadSkills()
  } catch (e) {
    showToast(e instanceof Error ? e.message : '更新失败', 'error')
  } finally {
    skillsBusy.value = false
  }
}

function askRemoveSkill(s: SkillRecord) {
  deleteBatchItems.value = undefined
  deleteTarget.value = s
  deleteOpen.value = true
}

function onSkillDeleteCancel() {
  deleteOpen.value = false
  deleteTarget.value = null
  deleteBatchItems.value = undefined
}

function enterSkillBatchMode() {
  skillBatchMode.value = true
  skillBatchSelectedIds.value = new Set()
}

function exitSkillBatchMode() {
  skillBatchMode.value = false
  skillBatchSelectedIds.value = new Set()
}

function toggleSkillBatchSelect(id: string) {
  const next = new Set(skillBatchSelectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  skillBatchSelectedIds.value = next
}

function toggleSkillBatchSelectAll() {
  if (skillBatchAllSelected.value) {
    skillBatchSelectedIds.value = new Set()
    return
  }
  skillBatchSelectedIds.value = new Set(skillsList.value.map((s) => s.id))
}

function selectedSkillItems(): Array<{ id: string; name?: string }> {
  const map = new Map(skillsList.value.map((s) => [s.id, s]))
  const items: Array<{ id: string; name?: string }> = []
  for (const id of skillBatchSelectedIds.value) {
    const s = map.get(id)
    if (!s) continue
    items.push({ id, name: s.name })
  }
  return items
}

function askBatchRemoveSkills() {
  const items = selectedSkillItems()
  if (!items.length || skillsBusy.value) return
  deleteTarget.value = null
  deleteBatchItems.value = items
  deleteOpen.value = true
}

async function onDeleteConfirm() {
  if (!window.navora?.skills) return
  const batch = deleteBatchItems.value
  if (batch?.length) {
    skillsBusy.value = 'delete'
    try {
      const ids = batch.map((it) => it.id)
      const res = window.navora.skills.removeMany
        ? await window.navora.skills.removeMany(ids)
        : await (async () => {
            const removed: string[] = []
            const failed: string[] = []
            for (const id of ids) {
              try {
                const r = await window.navora!.skills!.remove(id)
                if (r.ok !== false) removed.push(id)
                else failed.push(id)
              } catch {
                failed.push(id)
              }
            }
            return { ok: failed.length === 0 && removed.length > 0, removed, failed, error: undefined }
          })()
      const removed = res.removed?.length ?? 0
      const failed = res.failed?.length ?? 0
      if (removed && !failed) {
        showToast(`已删除 ${removed} 个技能`)
      } else if (removed && failed) {
        showToast(`已删除 ${removed} 个，失败 ${failed} 个`, 'warning')
      } else {
        showToast(skillErrorText(res.error) || '删除失败', 'error')
        return
      }
      deleteOpen.value = false
      deleteTarget.value = null
      deleteBatchItems.value = undefined
      skillBatchSelectedIds.value = new Set()
      await loadSkills()
      if (!skillsList.value.length) exitSkillBatchMode()
    } catch (e) {
      showToast(e instanceof Error ? e.message : '删除失败', 'error')
    } finally {
      skillsBusy.value = false
    }
    return
  }

  if (!deleteTarget.value) return
  skillsBusy.value = 'delete'
  try {
    await window.navora.skills.remove(deleteTarget.value.id)
    showToast('已删除')
    deleteOpen.value = false
    deleteTarget.value = null
    deleteBatchItems.value = undefined
    await loadSkills()
  } catch (e) {
    showToast(e instanceof Error ? e.message : '删除失败', 'error')
  } finally {
    skillsBusy.value = false
  }
}

function showToast(text: string, color = 'success') {
  toast.value = { show: true, text, color }
}

const provider = computed(() => {
  const list = cfg.value?.ai.providers || []
  if (!list.length) return undefined
  return list.find((p) => p.id === selectedProviderId.value) || list[0]
})

const apiKeyLabel = computed(() =>
  apiKeyPreview.value
    ? `API Key · ${apiKeyPreview.value}`
    : 'API Key',
)

const modelPresetItems = MODEL_PRESETS.map((p) => ({
  title: p.label,
  value: p.id,
}))

async function selectProvider(id: string) {
  if (!cfg.value) return
  selectedProviderId.value = id
  apiKeyPreview.value = ''
  await refreshApiKeyPreview()
}

async function onAddFromPreset(id: string | null) {
  if (!cfg.value || !id) return
  const next = addProviderFromPresetId(id, cfg.value.ai.providers)
  addPresetId.value = null
  if (!next) return
  cfg.value.ai.providers.push(next)
  ensureDefaultProvider(cfg.value.ai)
  await selectProvider(next.id)
  await refreshAllKeyFlags()
}

async function addCustomProvider() {
  if (!cfg.value) return
  const next = newCustomProvider(cfg.value.ai.providers.map((p) => p.id))
  cfg.value.ai.providers.push(next)
  ensureDefaultProvider(cfg.value.ai)
  await selectProvider(next.id)
  await refreshAllKeyFlags()
}

async function removeSelectedProvider() {
  if (!cfg.value || cfg.value.ai.providers.length <= 1 || !provider.value) return
  const id = provider.value.id
  delete keyDrafts.value[id]
  cfg.value.ai.providers = cfg.value.ai.providers.filter((p) => p.id !== id)
  ensureDefaultProvider(cfg.value.ai)
  await selectProvider(cfg.value.ai.default_provider || cfg.value.ai.providers[0].id)
  await refreshAllKeyFlags()
}

async function setAsDefault() {
  if (!cfg.value || !provider.value || !savedBaseline.value || !window.navora || saving.value || savingInstant.value) return
  if (!savedBaseline.value.ai.providers.some(p => p.id === provider.value!.id)) { showToast('先保存此服务商，再设为默认', 'error'); return }
  const base = cloneConfig(savedBaseline.value), submitted = cloneConfig(base)
  submitted.ai.default_provider = provider.value.id
  cfg.value.ai.default_provider = provider.value.id
  savingInstant.value = true
  try { await window.navora.config.commit(createSettingsCommit(base, submitted, crypto.randomUUID())); await acceptSaved(submitted, await window.navora.config.get()); showToast('默认服务商已保存 · 新对话使用') }
  catch (error) { cfg.value.ai.default_provider = base.ai.default_provider; showToast(errMessage(error, '默认服务商保存失败，请重试'), 'error') }
  finally { savingInstant.value = false; if (instantPrefsDirty) void persistInstantPrefs() }
}

async function resetProviders() {
  if (!cfg.value) return
  if (!window.confirm('将模型列表恢复为内置预设？已保存的 API Key 不会删除。')) return
  keyDrafts.value = {}
  cfg.value.ai.providers = defaultProviderList()
  cfg.value.ai.default_provider = pickDefaultProviderId(cfg.value.ai.providers)
  await selectProvider(cfg.value.ai.default_provider)
  await refreshAllKeyFlags()
}

let previewRequest = 0
async function refreshApiKeyPreview() {
  if (!cfg.value || !window.navora || !provider.value) {
    apiKeyPreview.value = ''
    return
  }
  const { id, api_key_ref: ref } = provider.value
  const request = ++previewRequest
  if (!ref) {
    apiKeyPreview.value = ''
    return
  }
  try {
    const st = await window.navora.secrets.getApiKey(ref)
    if (cfg.value?.ai.providers.find(p => p.id === id)?.api_key_ref !== ref) return
    keyConfigured.value = { ...keyConfigured.value, [id]: st.configured }
    if (request === previewRequest && provider.value?.id === id) apiKeyPreview.value = st.configured ? st.preview : ''
  } catch { if (request === previewRequest) apiKeyPreview.value = '' }
}

async function clearApiKey() {
  if (!cfg.value || !window.navora || !provider.value || clearingApiKey.value) return
  const { id, api_key_ref: ref } = provider.value
  if (!ref) {
    showToast('当前服务商没有密钥路径', 'error')
    return
  }
  if (!window.confirm('清除该服务商已保存的 API Key？')) return
  const draftBefore = keyDrafts.value[id]
  clearingApiKey.value = true
  try {
    const res = await window.navora.secrets.clearApiKey(ref)
    if (!res?.ok) {
      const err = (res as { error?: string } | undefined)?.error
      showToast(
        err === 'remote_forbidden'
          ? '远程端不能清除 API Key，请在本机客户端操作'
          : '清除失败',
        'error',
      )
      return
    }
    if (keyDrafts.value[id] === draftBefore) delete keyDrafts.value[id]
    await refreshAllKeyFlags()
    await refreshApiKeyPreview()
    showToast('已清除 API Key')
  } catch (e) {
    showToast(errMessage(e, '清除失败'), 'error')
  } finally {
    clearingApiKey.value = false
  }
}

let keyFlagsRequest = 0
async function refreshAllKeyFlags() {
  if (!cfg.value || !window.navora) return
  const request = ++keyFlagsRequest
  const providers = cfg.value.ai.providers.map(p => ({ id:p.id, ref:p.api_key_ref }))
  const flags = await Promise.all(providers.map(async p => {
    try { return { ...p, configured: p.ref ? (await window.navora!.secrets.getApiKey(p.ref)).configured : false } }
    catch { return { ...p, configured: keyConfigured.value[p.id] || false } }
  }))
  if (request !== keyFlagsRequest) return
  keyConfigured.value = Object.fromEntries(flags.filter(p => cfg.value?.ai.providers.some(current => current.id === p.id && current.api_key_ref === p.ref)).map(p => [p.id,p.configured]))
}

const selectMenuProps = {
  contentClass: 'navora-select-menu',
  offset: 4,
}
const presetItems = [
  { title: '保守', value: 'conservative' },
  { title: '均衡', value: 'balanced' },
  { title: '放手', value: 'open' },
  { title: '自定义', value: 'custom' },
]

const modeItems: { title: string; value: PermissionMode }[] = [
  { title: '拒绝', value: 'deny' },
  { title: '每次询问', value: 'ask' },
  { title: '本 Chat 询问一次', value: 'ask_chat' },
  { title: '自动（通知）', value: 'allow_notify' },
  { title: '完全自动', value: 'allow' },
]

/** skills.write: never silent allow — only deny / ask / ask_chat. */
const skillWriteModeItems: { title: string; value: PermissionMode }[] = [
  { title: '拒绝', value: 'deny' },
  { title: '每次询问', value: 'ask' },
  { title: '本 Chat 询问一次', value: 'ask_chat' },
]

function modeItemsFor(key: string) {
  return key === 'skills.write' ? skillWriteModeItems : modeItems
}

const PERM_LABELS: Record<string, string> = {
  'session.create': '创建 Session',
  'session.persist': '持久化 Session',
  'session.close': '关闭 Session',
  'session.clear': '清空 Session 数据',
  'session.set_proxy': '设置代理',
  'session.set_ua': '设置 UA',
  'session.cookies_read': '读取 Cookies',
  'session.cookies_write': '写入 Cookies',
  'session.fetch': 'Session 网络请求',
  'window.create': '创建窗口',
  'window.close': '关闭窗口',
  'window.set_visible': '显示/隐藏窗口',
  navigate: '页面导航',
  wait: '等待页面条件',
  click: '点击元素',
  type: '输入文本',
  get_page: '读取页面内容',
  evaluate: '执行页面脚本',
  screenshot: '页面截图',
  'desktop.screenshot': '桌面截图',
  'network.request': '独立网络请求',
  'network.observe': '观察网络请求',
  'network.modify': '修改网络请求',
  'network.block': '拦截网络请求',
  'file.read': '读取文件',
  'file.write': '写入/删除文件',
  'file.download': '主动文件下载',
  'file.download.passive': '被动文件下载',
  'shell.open': '打开文件/资源管理器',
  'shell.exec': '执行系统命令',
  'settings.read': '查看软件设置',
  'settings.write': '修改软件设置',
  'skills.write': '添加/编辑技能',
  'browser.geolocation': '获取位置',
  'compute.local': '本地计算',
}

function permLabel(key: string) {
  return PERM_LABELS[key] || key
}

async function onPresetChange(preset: PermissionPreset) {
  if (!cfg.value || presetConfirming.value || saving.value) return
  const target=cfg.value,previous=JSON.stringify(target.permissions)
  if(preset==='open'&&target.permissions.preset!=='open'){
    presetConfirming.value=true
    let confirmed=false
    try{confirmed=await permissionConfirm.value?.ask()||false}finally{presetConfirming.value=false}
    if(!confirmed)return
    // A refreshed draft or another window's settings must not be overwritten by an old choice.
    if(cfg.value!==target||JSON.stringify(target.permissions)!==previous){showToast('权限设置已变化，请重新选择预设。');return}
  }
  target.permissions.preset = preset
  if (preset !== 'custom') {
    target.permissions.modes = modesForPreset(preset)
  }
}

function onModeChange(key: string, value: PermissionMode) {
  if (!cfg.value) return
  let next = value
  if (key === 'skills.write' && (next === 'allow' || next === 'allow_notify')) {
    next = 'ask'
  }
  cfg.value.permissions.modes[key as keyof typeof cfg.value.permissions.modes] = next
  cfg.value.permissions.preset = detectPermissionPreset(cfg.value.permissions.modes)
}

/** Switch / boolean prefs that auto-save without the Apply button. */
function readInstantPrefs(c: AppConfig) {
  const fork = resolveForkDecision(c)
  return {
    appearance_theme: resolveAppearanceTheme(c.app.appearance_theme).id,
    appearance_mode: resolveAppearanceMode(c.app.appearance_mode),
    subchat_glyph_style: resolveSubchatGlyphStyle(c.app.subchat_glyph_style),
    window_acrylic: c.app.window_acrylic !== false,
    close_to_tray: c.app.close_to_tray,
    show_main_on_start: c.app.show_main_on_start !== false,
    running_message_mode: c.app.running_message_mode,
    permissions: JSON.parse(JSON.stringify(c.permissions)) as AppConfig['permissions'],
    show_followup_suggestions: c.app.show_followup_suggestions,
    ai_generate_chat_title: c.app.ai_generate_chat_title,
    show_read_pages: c.app.show_read_pages,
    show_run_logs: c.app.show_run_logs,
    collapse_tool_runs: c.app.collapse_tool_runs !== false,
    collapse_run_logs: c.app.collapse_run_logs !== false,
    show_agent_windows: c.browser.show_agent_windows,
    link_open_mode: resolveBrowserLinkOpenMode(c.browser.link_open_mode),
    block_window_open: c.browser.block_window_open,
    log_datadome_telemetry: c.browser.log_datadome_telemetry === true,
    wait_load: c.browser.wait.load,
    wait_network_idle: c.browser.wait.network_idle,
    browser_automation: { ...normalizeBrowserAutomation(c.browser.automation), interval_ms: createDefaultConfig().browser.automation.interval_ms },
    remote_enabled: c.remote?.enabled === true,
    fork_enabled: fork.enabled,
    fork_allow_custom: fork.allow_custom,
    fork_option_hints: fork.option_hints,
    fork_context_evidence: fork.context_evidence,
    fork_recommended: fork.recommended,
    fork_remember_in_chat: fork.remember_in_chat,
    subchat_enabled: resolveSubchat(c).enabled,
    plugins_dev_mode: resolvePluginDevMode(c),
  }
}

function applyInstantPrefs(target: AppConfig, source: AppConfig) {
  const s = readInstantPrefs(source)
  target.app.appearance_theme = s.appearance_theme
  target.app.appearance_mode = s.appearance_mode
  target.app.subchat_glyph_style = s.subchat_glyph_style
  target.app.window_acrylic = s.window_acrylic
  target.app.close_to_tray = s.close_to_tray
  target.app.show_main_on_start = s.show_main_on_start
  target.app.running_message_mode = s.running_message_mode
  target.permissions = s.permissions
  target.app.show_followup_suggestions = s.show_followup_suggestions
  target.app.ai_generate_chat_title = s.ai_generate_chat_title
  target.app.show_read_pages = s.show_read_pages
  target.app.show_run_logs = s.show_run_logs
  target.app.collapse_tool_runs = s.collapse_tool_runs
  target.app.collapse_run_logs = s.collapse_run_logs
  target.browser.show_agent_windows = s.show_agent_windows
  target.browser.link_open_mode = s.link_open_mode
  target.browser.block_window_open = s.block_window_open
  target.browser.log_datadome_telemetry = s.log_datadome_telemetry
  target.browser.wait.load = s.wait_load
  target.browser.wait.network_idle = s.wait_network_idle
  target.browser.automation = { ...s.browser_automation, interval_ms: target.browser.automation.interval_ms }
  if (!target.remote) {
    target.remote = {
      enabled: false,
      host: '0.0.0.0',
      port: 8790,
      username: 'admin',
      passwordHash: '',
    }
  }
  target.remote.enabled = s.remote_enabled
  if (!target.fork_decision) {
    target.fork_decision = createDefaultForkDecision()
  }
  target.fork_decision.enabled = s.fork_enabled
  target.fork_decision.allow_custom = s.fork_allow_custom
  target.fork_decision.option_hints = s.fork_option_hints
  target.fork_decision.context_evidence = s.fork_context_evidence
  target.fork_decision.recommended = s.fork_recommended
  target.fork_decision.remember_in_chat = s.fork_remember_in_chat
  // Keep experimental flags off until implemented
  target.fork_decision.inline_low_risk = false
  target.fork_decision.allow_revise = false
  if (!target.subchat) {
    target.subchat = createDefaultSubchat()
  }
  target.subchat.enabled = s.subchat_enabled
  if (!target.plugins) {
    target.plugins = { dev_mode: false }
  }
  target.plugins.dev_mode = s.plugins_dev_mode
}

const instantPrefsKey = computed(() => {
  if (!cfg.value) return ''
  return JSON.stringify(readInstantPrefs(cfg.value))
})

let instantPrefsTimer: ReturnType<typeof setTimeout> | undefined
let instantPrefsDirty = false

let instantWrite: Promise<void> | null = null
let disposed = false
function persistInstantPrefs(): Promise<void> {
  if (instantWrite) { instantPrefsDirty = true; return instantWrite }
  instantWrite = writeInstantPrefs().finally(() => { instantWrite = null; if (instantPrefsDirty && !saving.value) { instantPrefsDirty = false; void persistInstantPrefs() } })
  return instantWrite
}
async function writeInstantPrefs() {
  if (!cfg.value || !window.navora || hydrating.value) return
  if (saving.value) { instantPrefsDirty = true; return }
  if (savingInstant.value) {
    instantPrefsDirty = true
    return
  }
  savingInstant.value = true
  instantPrefsDirty = false
  const snapshotKey = instantPrefsKey.value
  const snapshot = JSON.parse(JSON.stringify(cfg.value)) as AppConfig
  try {
    const base = cloneConfig(savedBaseline.value || createDefaultConfig())
    const submitted = cloneConfig(base)
    applyInstantPrefs(submitted, snapshot)
    const request = createSettingsCommit(base, submitted, crypto.randomUUID())
    if (!Object.keys(request.patch).length) return
    await window.navora.config.commit(request)
    const saved = await window.navora.config.get()
    await acceptSaved(submitted, saved)
    lastInstantUndo.value = createSettingsCommit(submitted, base, crypto.randomUUID())
    instantError.value = ''
    failedInstant = null
    remoteStatus.value = await window.navora.remote.status().catch(() => null)
    void refreshCursorRuntime()
  } catch (e) {
    failedInstant = snapshot
    instantError.value = errMessage(e, '自动保存失败，已恢复最近保存值，可重试')
    try {
      const disk = await window.navora.config.get()
      hydrating.value = true
      if (cfg.value) applyInstantPrefs(cfg.value, disk)
      savedBaseline.value = cloneConfig(disk)
      await nextTick()
    } catch { /* preserve failed intent for retry */ }
    finally { hydrating.value = false }
    instantPrefsDirty = false
  } finally {
    savingInstant.value = false
    if (!instantError.value && (instantPrefsDirty || instantPrefsKey.value !== snapshotKey)) {
      instantPrefsDirty = true
    }
  }
}

function schedulePersistInstantPrefs() {
  if (hydrating.value) return
  if (saving.value) { instantPrefsDirty = true; return }
  clearTimeout(instantPrefsTimer)
  instantPrefsTimer = setTimeout(() => {
    instantPrefsTimer = undefined
    void persistInstantPrefs()
  }, 280)
}

function selectAppearanceTheme(id: typeof APPEARANCE_THEMES[number]['id']) {
  if (!cfg.value) return
  cfg.value.app.appearance_theme = id
  // Queue synchronously so closing settings in the same turn still flushes it.
  schedulePersistInstantPrefs()
}

const glyphPreviewSeeds=['identity-preview-fern','identity-preview-paper','identity-preview-tide','identity-preview-star','identity-preview-moss']
const browserLinkOpenOptions=[{title:'软件内新建窗口',value:'window'},{title:'软件内新建标签页',value:'tab'},{title:'系统默认浏览器',value:'external'}]
function selectGlyphStyle(style:SubchatGlyphStyle){if(!cfg.value)return;cfg.value.app.subchat_glyph_style=style;schedulePersistInstantPrefs()}
function onGlyphStyleKey(event:KeyboardEvent,style:SubchatGlyphStyle){
  if(event.isComposing||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return
  event.preventDefault();event.stopPropagation()
  const options=SUBCHAT_GLYPH_STYLES,index=options.findIndex(item=>item.id===style),next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+options.length)%options.length
  const selected=options[next]!.id;selectGlyphStyle(selected)
  void nextTick(()=>document.querySelector<HTMLButtonElement>(`[data-glyph-style="${selected}"]`)?.focus({preventScroll:true}))
}
function selectBrowserLinkOpenMode(value:unknown){if(!cfg.value)return;cfg.value.browser.link_open_mode=resolveBrowserLinkOpenMode(value);schedulePersistInstantPrefs()}

function selectAppearanceMode(mode: typeof APPEARANCE_MODES[number]['id']) {
  if (!cfg.value) return
  cfg.value.app.appearance_mode = mode
  schedulePersistInstantPrefs()
}
function selectCursorStyle(style:BrowserCursorStyle){if(!cfg.value)return;cfg.value.browser.automation.cursor_style=style;schedulePersistInstantPrefs()}
function selectCursorScale(scale:number){if(!cfg.value)return;cfg.value.browser.automation.cursor_scale=scale;schedulePersistInstantPrefs()}

watch(instantPrefsKey, (next, prev) => {
  if (hydrating.value || !prev || next === prev) return
  schedulePersistInstantPrefs()
})

function normalizeSettingsModels(config: AppConfig) {
  for (const p of config.ai.providers) {
    normalizeProvider(p)
    // Defaults are displayed by ModelCatalogEditor without writing overrides.
  }
}
async function load() {
  if (!window.navora) return
  hydrating.value = true
  try {
    cfg.value = await window.navora.config.get()
    normalizeSettingsModels(cfg.value)
    savedBaseline.value = JSON.parse(JSON.stringify(cfg.value))
    if (settingsDraftSession.base && settingsDraftSession.draft) cfg.value = rebaseSettingsDraft(settingsDraftSession.base, settingsDraftSession.draft, cfg.value)
    cfg.value.browser.automation = normalizeBrowserAutomation(cfg.value.browser.automation)
    info.value = await window.navora.app.info()
    uaPresetItems.value = await window.navora.config.uaPresets()
    allowlistText.value = (cfg.value.browser.url_allowlist || []).join('\n')
    ensureDefaultProvider(cfg.value.ai)
    for (const p of cfg.value.ai.providers) normalizeProvider(p)
    selectedProviderId.value =
      cfg.value.ai.default_provider || cfg.value.ai.providers[0]?.id || ''
    selectedProviderId.value = cfg.value.ai.providers.some(p => p.id === settingsDraftSession.selected) ? settingsDraftSession.selected : selectedProviderId.value
    remotePasswordDraft.value = settingsDraftSession.password
    failedInstant = settingsDraftSession.failedInstant ? cloneConfig(settingsDraftSession.failedInstant) : null
    instantError.value = settingsDraftSession.instantError
    if (settingsDraftSession.draft) allowlistText.value = settingsDraftSession.allowlist
    if (!cfg.value.remote) {
      cfg.value.remote = {
        enabled: false,
        host: '0.0.0.0',
        port: 8790,
        username: 'admin',
        passwordHash: '',
      }
    }
    if (!cfg.value.fork_decision) {
      cfg.value.fork_decision = createDefaultForkDecision()
    }
    cfg.value.fork_decision = resolveForkDecision(cfg.value)
    if (!cfg.value.subchat) {
      cfg.value.subchat = createDefaultSubchat()
    }
    cfg.value.subchat = resolveSubchat(cfg.value)
    if (!cfg.value.plugins) {
      cfg.value.plugins = { dev_mode: false }
    }
    cfg.value.plugins.dev_mode = resolvePluginDevMode(cfg.value)
    if (typeof cfg.value.app.show_main_on_start !== 'boolean') {
      const legacy = (cfg.value.app as { start_minimized?: boolean }).start_minimized
      cfg.value.app.show_main_on_start =
        typeof legacy === 'boolean' ? !legacy : true
    }
    if (typeof cfg.value.app.collapse_tool_runs !== 'boolean') {
      cfg.value.app.collapse_tool_runs = true
    }
    if (typeof cfg.value.app.collapse_run_logs !== 'boolean') {
      cfg.value.app.collapse_run_logs = true
    }
    {
      const n = Number(cfg.value.app.max_composer_chars)
      cfg.value.app.max_composer_chars =
        Number.isFinite(n) && n >= 1000 ? Math.min(200000, Math.floor(n)) : 16000
    }
    await refreshAllKeyFlags()
    await refreshApiKeyPreview()
    try {
      remoteStatus.value = await window.navora.remote.status()
    } catch {
      remoteStatus.value = null
    }
    if (tab.value === 'skills') await loadSkills()
    await nextTick()
    contentEl.value?.scrollTo({top:settingsDraftSession.scroll[tab.value]||0})
  } finally {
    hydrating.value = false
  }
}

async function pickCustomRoot() {
  if (!cfg.value || !window.navora?.workspace) return
  try {
    const res = await window.navora.workspace.pickDirectory()
    if (res.error === 'remote_unsupported') {
      showToast('远程端不支持选择文件夹，请在本机客户端操作', 'error')
      return
    }
    if (res.ok && res.path) cfg.value.files.custom_root = res.path
  } catch (e) {
    showToast(e instanceof Error ? e.message : '选择目录失败', 'error')
  }
}

function errMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.includes('remote_default_password')) {
    return '请设置新的远程访问密码，不能使用默认密码 admin'
  }
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'string' && e.trim()) return e
  if (e && typeof e === 'object') {
    const msg = (e as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  return fallback
}

function cloneConfig(config: AppConfig): AppConfig { return JSON.parse(JSON.stringify(config)) as AppConfig }
const groupNames = Object.keys(SETTINGS_GROUPS) as SettingsGroup[]
function groupDraft(): AppConfig | null {
  if (!cfg.value) return null
  const draft = cloneConfig(cfg.value)
  draft.browser.url_allowlist = [...new Set(allowlistText.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean))]
  return draft
}
function groupDirty(group: SettingsGroup): boolean {
  const draft = groupDraft(), base = savedBaseline.value
  if (!draft || !base) return false
  return settingsGroupDirty(base, draft, group) || (group === 'remote' && !!remotePasswordDraft.value) || (group === 'models' && Object.values(keyDrafts.value).some(Boolean))
}
const pendingGroupCount = computed(() => groupNames.filter(groupDirty).length)
const modelAdvancedSummary = computed(() => {
  if (!provider.value) return ''
  const preset = MODEL_PRESETS.find(item => item.id === provider.value?.source_preset)
  const custom = [provider.value.timeout_ms !== (preset?.timeout_ms ?? 120000), provider.value.output_token_param !== (preset?.id === 'openai' ? 'max_completion_tokens' : 'max_tokens')].filter(Boolean).length
  return (custom ? custom + ' 项自定义' : '使用内置默认值') + (groupDirty('models') ? ' · 未保存' : '')
})
function groupProps(group: SettingsGroup) {
  return { ...SETTINGS_GROUPS[group], dirty: groupDirty(group), saving: saving.value, error: groupErrors.value[group] }
}
async function acceptSaved(submitted: AppConfig, saved: AppConfig) {
  const submittedAccessText = submitted.browser.url_allowlist.join('\n')
  const acceptAccess = allowlistText.value === submittedAccessText
  hydrating.value = true
  try {
    if (!disposed && cfg.value) cfg.value = rebaseSettingsDraft(submitted, cloneConfig(cfg.value), saved)
    savedBaseline.value = cloneConfig(saved)
    if (acceptAccess && cfg.value) allowlistText.value = cfg.value.browser.url_allowlist.join('\n')
    await nextTick()
  } finally { hydrating.value = false }
}
function cancelGroup(group: SettingsGroup) {
  if (!cfg.value || !savedBaseline.value || saving.value) return
  for (const path of SETTINGS_GROUPS[group].paths) setSettingsPath(cfg.value, path, settingsPath(savedBaseline.value, path))
  if (group === 'access') allowlistText.value = savedBaseline.value.browser.url_allowlist.join('\n')
  if (group === 'remote') remotePasswordDraft.value = ''
  if (group === 'models') {
    keyDrafts.value = {}
    if (!cfg.value.ai.providers.some(p => p.id === selectedProviderId.value)) selectedProviderId.value = cfg.value.ai.default_provider
  }
  delete groupErrors.value[group]
}
async function saveGroup(group: SettingsGroup) {
  if (!cfg.value || !window.navora || saving.value || !savedBaseline.value) return
  clearTimeout(instantPrefsTimer)
  instantPrefsTimer = undefined
  if (instantWrite) await instantWrite
  await persistInstantPrefs()
  if (saving.value || !cfg.value || !savedBaseline.value) return
  const base = cloneConfig(savedBaseline.value), draft = groupDraft()!
  if (group === 'access') { cfg.value.browser.url_allowlist = [...draft.browser.url_allowlist]; allowlistText.value = draft.browser.url_allowlist.join('\n') }
  const submitted = projectSettingsGroup(base, draft, group)
  const validation = validateSettingsGroup(submitted, group)
  if (validation) { groupErrors.value[group] = validation; if (group === 'models') advancedModel.value = true; return }
  if (group === 'workspace' && !window.confirm('更新根目录不会迁移旧文件。现有默认工作区将改为从新目录读取，原文件仍留在旧目录。确认更新？')) return
  if (group === 'remote' && window.navora.app.platform === 'web' && base.remote.enabled && !window.confirm('保存远程连接可能断开当前页面。请记录新的地址与账号，保存后使用新地址重新登录。确认保存？')) return
  const password = remotePasswordDraft.value
  const pendingKeys = group === 'models' ? draft.ai.providers.flatMap(p => keyDrafts.value[p.id]?.trim() ? [{ id: p.id, ref: p.api_key_ref, draft: keyDrafts.value[p.id], value: keyDrafts.value[p.id].trim() }] : []) : []
  const request = createSettingsCommit(base, submitted, crypto.randomUUID())
  if (group === 'remote' && password.trim()) {
    (request.patch.remote ||= {}).password = password.trim()
    ;(request.expected.remote ||= {}).passwordHash = base.remote.passwordHash
  }
  saving.value = true
  savingGroup.value = group
  delete groupErrors.value[group]
  let configSaved = false
  try {
    await window.navora.config.commit(request)
    configSaved = true
    await acceptSaved(submitted, await window.navora.config.get())
    if (group === 'remote' && remotePasswordDraft.value === password) remotePasswordDraft.value = ''
    for (const pending of pendingKeys) {
      if (!pending.ref) throw new Error('连接已保存，密钥缺少保存路径')
      const result = await window.navora.secrets.setApiKey(pending.ref, pending.value)
      if (!result?.ok) throw new Error('连接已保存，密钥写入失败；请在本机重试保存密钥')
      if (keyDrafts.value[pending.id] === pending.draft) delete keyDrafts.value[pending.id]
    }
    await refreshAllKeyFlags()
    await refreshApiKeyPreview()
    remoteStatus.value = await window.navora.remote.status().catch(() => null)
    showToast(group === 'remote' && cfg.value.remote.enabled && !remoteStatus.value?.running ? '已保存 · 监听启动失败，可重试启动' : '已保存')
  } catch (error) {
    groupErrors.value[group] = group === 'remote' && window.navora.app.platform === 'web'
      ? '远程连接已断开，无法确认保存回执。配置可能已更新，请使用新地址重新登录后检查；本页输入仍已保留。'
      : (configSaved && pendingKeys.length ? '连接配置已保存；密钥仍需处理。' : '') + errMessage(error, '保存失败，修改已保留')
    if (String(error).includes('config_conflict:')) {
      groupErrors.value[group] = '此组设置已在其它窗口修改。取消修改可采用最新值，或检查后再次保存。'
      const latest = await window.navora.config.get().catch(() => null)
      if (latest) await acceptExternal(latest)
    }
  } finally {
    saving.value = false
    savingGroup.value = null
    if (instantPrefsDirty) { instantPrefsDirty = false; void persistInstantPrefs() }
  }
}
async function retryInstantPrefs() {
  if (!failedInstant || !cfg.value) return
  hydrating.value = true
  applyInstantPrefs(cfg.value, failedInstant)
  await nextTick()
  hydrating.value = false
  instantError.value = ''
  await persistInstantPrefs()
}
function discardFailedInstant() { failedInstant = null; instantError.value = '' }
async function undoInstantPrefs() {
  if (!lastInstantUndo.value || !window.navora || saving.value || savingInstant.value) return
  if (instantPrefsTimer) { showToast('请等待当前选择保存完成后再撤销', 'warning'); return }
  const request = lastInstantUndo.value
  savingInstant.value = true
  try {
    await window.navora.config.commit(JSON.parse(JSON.stringify(request)))
    await acceptExternal(await window.navora.config.get())
    lastInstantUndo.value = null
    showToast('已撤销最近一批选择')
  } catch (error) { showToast(String(error).includes('config_conflict:') ? '其它窗口已修改这些设置，未执行撤销' : errMessage(error, '撤销失败'), 'error') }
  finally { savingInstant.value = false }
}
async function acceptExternal(saved: AppConfig) {
  if (!cfg.value || !savedBaseline.value || disposed) return
  const before = cloneConfig(savedBaseline.value), local = cloneConfig(cfg.value)
  const acceptAccess = allowlistText.value === before.browser.url_allowlist.join('\n')
  for (const group of groupNames) {
    if (settingsGroupDirty(before, local, group) && settingsGroupDirty(before, saved, group)) groupErrors.value[group] = '此组有外部修改；草稿已保留，请检查后保存，或取消修改采用最新值。'
  }
  hydrating.value = true
  cfg.value = rebaseSettingsDraft(before, local, saved)
  savedBaseline.value = cloneConfig(saved)
  if (acceptAccess) allowlistText.value = saved.browser.url_allowlist.join('\n')
  await nextTick()
  hydrating.value = false
}
let unsubConfig: (() => void) | undefined
let incomingConfigRequest = 0
const exitState=ref<SettingsExitState>({phase:'idle'})
const exitGuard=createSettingsExitGuard({
  busy:()=>saving.value||hydrating.value,
  async flush(){clearTimeout(instantPrefsTimer);instantPrefsTimer=undefined;await persistInstantPrefs();while(instantWrite)await instantWrite},
  retry:()=>retryInstantPrefs(),error:()=>instantError.value,
  confirmDiscard:()=>!(remotePasswordDraft.value||Object.values(keyDrafts.value).some(Boolean))||window.confirm('连接中的密钥或密码尚未保存。离开将丢弃这些凭据，其它草稿保留在本窗口。'),
  discardCredentials:()=>{remotePasswordDraft.value='';keyDrafts.value={}},
  state:value=>exitState.value=value,
})
function canClose(){return exitGuard.request()}
let closeRequest:Promise<boolean>|undefined
async function requestClose() {
  if(closeRequest)return closeRequest
  closeRequest=(async()=>{if(!await canClose())return false;if(disposed)return false;if(props.embedded)emit('close');else await router.push('/');return true})().finally(()=>closeRequest=undefined)
  return closeRequest
}
function settingsBackKey(event:KeyboardEvent){
  if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.repeat||!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.key!=='ArrowLeft')return
  if(document.querySelector('.v-dialog.v-overlay--active,.v-menu.v-overlay--active,.sidebar-ctx-panel:not([data-browser-tab-preview])'))return
  event.preventDefault();event.stopPropagation();void requestClose()
}
async function retryRemote() {
  if (!window.navora || !savedBaseline.value) return
  try { await window.navora.config.save({ remote: { enabled: savedBaseline.value.remote.enabled } }); remoteStatus.value = await window.navora.remote.status() }
  catch (error) { showToast(errMessage(error, '监听启动失败'), 'error') }
}
function onRemoteEnabled(enabled: unknown) {
  if (!cfg.value || !savedBaseline.value) return
  if (!enabled && window.navora?.app.platform === 'web' && !window.confirm('关闭远程访问会断开当前连接。之后需要在本机重新启用，确认关闭？')) return
  if (enabled) {
    if (groupDirty('remote')) { showToast('请先保存远程连接，再启用访问', 'error'); return }
    try { assertRemoteAccessConfig({ ...savedBaseline.value.remote, enabled: true }) }
    catch (error) { showToast(errMessage(error, '请先保存有效的账号和新密码'), 'error'); return }
    if (!['127.0.0.1', 'localhost', '::1'].includes(savedBaseline.value.remote.host) && !window.confirm('这会向局域网开放远程访问，登录后可以控制本机 Navora。确认启用？')) return
  }
  cfg.value.remote.enabled = !!enabled
}

onMounted(() => {
  void nextTick(focusEntry)
  window.addEventListener('beforeunload', guardWindowExit)
  window.addEventListener('keydown',settingsBackKey)
  void load()
  offCursorRuntime=window.navora?.browser?.onTreeUpdated?.(()=>{if(tab.value==='browser')void refreshCursorRuntime()})
  void refreshCursorRuntime()
  unsubConfig = window.navora?.config.onChanged?.(() => {
    void refreshCursorRuntime()
    const request = ++incomingConfigRequest
    if (saving.value || savingInstant.value || hydrating.value) return
    void window.navora!.config.get().then(saved => {
      if (request === incomingConfigRequest && !disposed && !saving.value && !savingInstant.value) return acceptExternal(saved)
    }).catch(() => { /* next notification or explicit save refreshes the baseline */ })
  })
  unsubStoreInstalled = onStoreUiInstalled(() => {
    void onStoreInstalled()
  })
  unsubProposals = window.navora?.skills?.onProposalsChanged?.((payload) => {
    proposals.value = (payload.proposals || []).filter(
      (p) => p.action === 'create' || p.action === 'update',
    )
  })
})

onUnmounted(() => {
  exitGuard.dispose()
  window.removeEventListener('keydown',settingsBackKey)
  window.removeEventListener('beforeunload', guardWindowExit)
  if (cfg.value) {
    settingsDraftSession.base = savedBaseline.value ? JSON.parse(JSON.stringify(savedBaseline.value)) : null
    settingsDraftSession.draft = JSON.parse(JSON.stringify(cfg.value))
    settingsDraftSession.selected = selectedProviderId.value
    settingsDraftSession.password = ''
    keyDrafts.value = {}
    settingsDraftSession.allowlist = allowlistText.value
    settingsDraftSession.failedInstant = failedInstant ? cloneConfig(failedInstant) : null
    settingsDraftSession.instantError = instantError.value
    settingsDraftSession.section=tab.value
    if(contentEl.value)settingsDraftSession.scroll[tab.value]=contentEl.value.scrollTop
  }
  clearTimeout(instantPrefsTimer)
  if (instantPrefsTimer) void persistInstantPrefs()
  disposed = true
  unsubConfig?.()
  offCursorRuntime?.()
  cursorRuntimeRequest++
  unsubProposals?.()
  unsubStoreInstalled?.()
})
defineExpose({ requestClose, canClose, hasPendingChanges: pendingGroupCount })

function guardWindowExit(event: BeforeUnloadEvent) {
  if (!pendingGroupCount.value && !saving.value && !savingInstant.value) return
  if (window.confirm('设置仍有未保存修改或正在保存的内容。退出窗口会丢失未保存草稿，确认退出？')) return
  event.preventDefault()
  event.returnValue = ''
}
</script>

<style scoped>
.settings-page .cursor-style-heading h3{color:var(--appearance-ink,var(--navora-ink))}.settings-page .advanced-toggle{color:var(--appearance-muted,var(--navora-muted))}.settings-page .switch-row,.nav-foot{border-color:var(--appearance-stroke,var(--navora-stroke))}
.cursor-runtime-note{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12px;line-height:1.7;color:var(--navora-muted);margin-top:12px}.cursor-runtime-note button{margin-left:auto}
.settings-back{width:auto!important;min-width:110px;display:inline-flex!important;align-items:center;gap:7px;padding-inline:9px!important;white-space:nowrap;font-size:12px}.settings-back svg{width:16px;height:16px}.settings-exit-status{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 16px;border-bottom:1px solid var(--navora-stroke);background:var(--control-selected);font-size:12px;flex-shrink:0}.settings-exit-status>span{flex:1;min-width:180px}.settings-exit-status.needs-decision{border-color:var(--control-warning,var(--navora-stroke))}.cursor-style-heading{margin-top:22px}.cursor-style-heading h3{font-size:13px;font-weight:600}.cursor-style-heading p{font-size:12px;color:var(--navora-muted);margin:5px 0 0}
.settings-save-error{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px;padding:12px;border:1px solid var(--control-danger);border-radius:8px;font-size:12px}.settings-save-error>span{flex:1;min-width:150px}.settings-field-error{color:var(--control-danger);font-size:12px;overflow-wrap:anywhere}.remote-connection-form>.settings-field-error{grid-column:1/-1;margin:0}.remote-connection-form>.ui-button{justify-self:start}.advanced-toggle small{font-size:11px;color:var(--navora-muted);font-weight:400}
.settings-page {
  container-type:inline-size;
  min-width:0;
  height: 100vh;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(1200px 480px at 10% -10%, rgba(27, 79, 114, 0.08), transparent 60%),
    var(--navora-stroke, #eef2f5);
  user-select: none;
  -webkit-user-select: none;
}
.settings-page.is-embedded {
  height: min(88vh, 920px);
  max-height: calc(100vh - 48px);
  border-radius: 16px;
  border: 1px solid var(--navora-stroke);
  box-shadow:
    0 28px 72px rgba(8, 18, 28, 0.28),
    0 8px 24px rgba(8, 18, 28, 0.12);
}
.settings-page.is-embedded .shell {
  max-width: none;
  padding-inline: 24px;
}

.top {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 28px;
  border-bottom: 1px solid var(--navora-stroke, #d9e2ea);
  background: var(--navora-header);
  backdrop-filter: blur(8px);
}
.top-left {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.top-titles{min-width:0}
.top-titles h1{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.back-btn {
  color: var(--navora-accent, #1b4f72) !important;
}
.close-btn {
  width: 40px;
  height: 40px;
  min-width: 40px !important;
  padding: 0 !important;
  color: var(--navora-accent, #1b4f72) !important;
}
.close-btn :deep(svg) {
  width: 1.35rem;
  height: 1.35rem;
}
.top-titles h1 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--navora-ink, #15202b);
  line-height: 1.2;
}
.top-sub {
  margin: 2px 0 0;
  font-size: 0.75rem;
  color: var(--navora-muted, #7a8a99);
}
.save-btn {
  min-width: 68px;
  height: 32px;
  padding-inline: 14px !important;
  font-size: 0.82rem;
  letter-spacing: 0.02em;
}

.shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  padding: 20px 28px 24px;
  gap: 18px;
  box-sizing: border-box;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--navora-stroke, #d5dee7);
  background: var(--navora-sidebar, #f5f7f9);
  align-self: stretch;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;
}
.nav-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--navora-muted) 45%, transparent) transparent;
}
.nav-list::-webkit-scrollbar {
  width: 6px;
}
.nav-list::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--navora-muted) 45%, transparent);
  border-radius: 999px;
}
.nav-foot {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--navora-stroke, #e6edf3);
}
.nav-item {
  position: relative;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 11px;
  width: 100%;
  min-height: 38px;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--navora-muted, #627181);
  text-align: left;
  cursor: pointer;
  transition: background-color 130ms ease, color 130ms ease;
}
.nav-item:hover:not(:disabled) {
  background: var(--control-hover, #e9edf2);
}
.nav-item.active {
  background: var(--control-selected, #e8f1f7);
  color: var(--navora-accent, #1b4f72);
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 3px;
  height: 16px;
  border-radius: 999px;
  background: currentColor;
  transform: translateY(-50%);
}
.nav-item:focus-visible {
  outline: 2px solid var(--control-focus, #1b4f72);
  outline-offset: -2px;
}
.nav-item:disabled {
  cursor: default;
  opacity: .5;
}
.settings-nav-icon {
  display: block;
  width: 17px;
  height: 17px;
  justify-self: center;
  color: inherit;
}
.nav-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  color: inherit;
}
.nav-item.active .nav-label {
  color: inherit;
  font-weight: 600;
}

.panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid var(--navora-stroke, #d5dee7);
  background: var(--navora-surface, #fff);
  overflow: hidden;
}
.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 22px 26px 28px;
}

.section-head {
  margin-bottom: 16px;
}
.section-head h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--navora-ink, #15202b);
}
.section-head p {
  margin: 4px 0 0;
  font-size: 0.82rem;
  color: var(--navora-muted, #7a8a99);
}

.card {
  border: 1px solid var(--navora-stroke, #e4ebf1);
  border-radius: 10px;
  background: var(--appearance-well, #fafcfd);
  padding: 16px 18px;
  margin-bottom: 14px;
}
.card-title {
  margin: 0 0 12px;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--navora-muted, #5d6d7e);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.form-grid {
  display: grid;
  grid-template-columns: minmax(0,1fr) minmax(0,1fr);
  gap: 14px 16px;
  align-items: start;
}
.ua-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-grid.muted,
.field-row.muted,
.switch-row.muted,
.card.muted {
  opacity: 0.55;
  pointer-events: none;
}
.remote-url {
  padding-top: 8px;
  border-top: 1px solid var(--navora-stroke, #e6edf3);
}
.form-grid .span-2 {
  grid-column: 1 / -1;
}

.provider-layout {
  display: grid;
  grid-template-columns: minmax(240px, 0.9fr) minmax(280px, 1.2fr);
  gap: 14px;
  align-items: start;
}
.provider-list-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
.provider-add-select {
  flex: 1 1 160px;
  min-width: 140px;
}
.provider-tool-btn {
  border: 1px solid var(--navora-stroke, #c5d0db);
  background: var(--navora-surface, #fff);
  color: var(--navora-ink, #1b2834);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 0.78rem;
  cursor: pointer;
  white-space: nowrap;
}
.provider-tool-btn:hover:not(:disabled) {
  border-color: var(--navora-accent, #1b4f72);
  color: var(--navora-accent, #1b4f72);
}
.provider-tool-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.provider-tool-btn.danger {
  color: var(--control-danger, #a94442);
  border-color: var(--navora-stroke, #e0b4b4);
}
.provider-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--navora-stroke, #e2e8ee);
  border-radius: 10px;
}
.provider-list-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--navora-stroke, #eef2f5);
  cursor: pointer;
}
.provider-list-item:last-child {
  border-bottom: 0;
}
.provider-list-item:hover {
  background: var(--control-hover, #f5f8fb);
}
.provider-list-item.active {
  background: var(--control-selected, #eaf2f8);
  box-shadow: inset 3px 0 0 var(--navora-accent, #1b4f72);
}
.provider-list-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.provider-list-label {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--navora-ink, #1b2834);
}
.provider-list-model {
  font-size: 0.72rem;
  color: var(--navora-muted, #6a7a88);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.provider-list-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}
.provider-badge {
  font-size: 0.66rem;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--control-selected, #edf1f5);
  color: var(--navora-muted, #5d6d7e);
}
.provider-badge.default {
  background: var(--control-selected, #d6e6f2);
  color: var(--navora-accent, #1b4f72);
}
.provider-badge.ok {
  background: color-mix(in srgb, var(--control-success) 12%, var(--navora-surface));
  color: var(--control-success, #1e6b45);
}
.provider-badge.miss {
  background: color-mix(in srgb, var(--control-danger) 12%, var(--navora-surface));
  color: var(--control-danger, #a94442);
}
.provider-edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.provider-edit-head .card-title {
  margin: 0;
}
.provider-edit-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.switch-block {
  margin-top: 4px;
  border-top: 1px solid var(--navora-stroke, #e8eef4);
}
.switch-block .switch-row:first-child {
  padding-top: 12px;
}
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 10px 0;
  border-bottom: 1px solid var(--navora-stroke, #e8eef4);
}
.switch-row-nested {
  margin-left: 12px;
  padding-left: 12px;
  border-left: 2px solid var(--navora-stroke, #e2eaf1);
}
.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 10px 0;
}
.switch-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.switch-row:first-child {
  padding-top: 0;
}
.switch-title {
  font-size: 0.9rem;
  font-weight: 550;
  color: var(--navora-ink, #1b2834);
}
.switch-hint {
  margin-top: 2px;
  font-size: 0.75rem;
  color: var(--navora-muted, #8a97a5);
}

.perm-toolbar {
  display: flex;
  align-items: center;
  gap: 18px;
}
.perm-preset {
  width: 220px;
  flex-shrink: 0;
}
.perm-toolbar-hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--navora-muted, #8a97a5);
  line-height: 1.4;
}

.perm-table {
  padding: 8px 10px 10px;
}
.perm-table-head,
.perm-row {
  display: grid;
  grid-template-columns: minmax(140px, 1.1fr) minmax(160px, 1.2fr) 200px;
  gap: 12px;
  align-items: center;
}
.perm-table-head {
  padding: 8px 10px;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--navora-muted, #8a97a5);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--navora-stroke, #e4ebf1);
}
.perm-row {
  padding: 7px 10px;
  border-radius: 8px;
}
.perm-row:hover {
  background: var(--control-hover, #f3f7fa);
}
.perm-label {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--navora-ink, #1b2834);
}
.perm-id {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.72rem;
  color: var(--navora-muted, #8a97a5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.about-card {
  max-width: 640px;
}
.skill-card .skill-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.skill-enable-switch {
  flex-shrink: 0;
  margin-top: -2px;
}
.skill-body-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-top: 10px;
}
.skill-body-row .skill-desc {
  flex: 1;
  min-width: 0;
  margin-top: 0;
}
.skill-more-btn {
  flex-shrink: 0;
  margin-top: -4px;
  color: var(--navora-muted, #5d6d7e) !important;
}
.proposal-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--navora-stroke, #e4ebf1);
}
.proposal-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.proposal-meta {
  min-width: 0;
}
.skill-dropzone {
  position: relative;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.skill-dropzone.skill-drop-active {
  border-color: var(--navora-accent, #1b4f72);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--navora-accent) 14%, transparent);
  background: var(--control-selected, #f3f8fc);
}
.skill-drop-hint {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--navora-accent, #1b4f72);
  color: var(--appearance-on-accent, #fff);
  font-size: 0.86rem;
  text-align: center;
}
.skill-editor-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.skill-editor .skill-body-field :deep(textarea) {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.85rem;
  line-height: 1.45;
}
.skill-meta {
  min-width: 0;
  flex: 1;
}
.skill-name {
  font-size: 0.95rem;
  font-weight: 650;
  color: var(--navora-ink, #15202b);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
}
.skill-id {
  margin-top: 2px;
  font-size: 0.72rem;
  color: var(--navora-muted, #8a97a5);
  font-family: ui-monospace, Consolas, monospace;
}
.skill-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.skill-desc {
  font-size: 0.85rem;
  color: var(--navora-muted, #5d6d7e);
  line-height: 1.45;
  white-space: pre-wrap;
}
.skill-flag {
  margin-top: 8px;
  font-size: 0.75rem;
  color: var(--navora-accent, #1b4f72);
}
.about-name {
  margin:0;
  font-size: 22px;
  font-weight: 650;
  color: var(--navora-ink, #15202b);
}
.about-tag {
  margin:3px 0 0;
  font-size: 13px;
  color: var(--navora-muted, #5d6d7e);
}
.about-dl {
  margin: 0;
  padding-top:18px;
  border-top:1px solid var(--navora-stroke);
  display: grid;
  grid-template-columns: repeat(2,minmax(0,1fr));
  gap: 14px 18px;
}
.about-dl dt {
  font-size: 0.72rem;
  color: var(--navora-muted, #8a97a5);
  margin-bottom: 2px;
}
.about-dl dd {
  margin: 0;
  font-size: 12px;
  color: var(--navora-ink, #1b2834);
  font-weight: 450;
}
.about-dl .span-all {
  grid-column: 1 / -1;
}
.about-note {
  margin: 16px 0 0;
  font-size: 0.8rem;
  color: var(--navora-muted, #8a97a5);
}
.about-product{display:flex;align-items:center;gap:14px}
.about-product>img{width:48px;height:48px;flex:0 0 48px;object-fit:contain}
.about-version{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin:24px 0 20px}
.about-version>span:first-child{width:100%;color:var(--navora-muted);font-size:12px}
.about-version>strong{font-size:23px;line-height:1.3;font-weight:600;letter-spacing:-.3px;color:var(--navora-ink);overflow-wrap:anywhere}
.about-portable{padding:3px 8px;border:1px solid var(--navora-stroke);border-radius:6px;font-size:11px;color:var(--navora-muted)}
.path {
  word-break: break-all;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.8rem !important;
  font-weight: 400 !important;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.navora-select :deep(.v-field),
.content :deep(.v-field) {
  border-radius: 8px;
  font-size: 0.875rem;
  background: var(--navora-surface, #fff);
}
.content :deep(input),
.content :deep(textarea) {
  user-select: text;
  -webkit-user-select: text;
}
.perm-select :deep(.v-field) {
  background: var(--navora-surface, #fff);
}

.settings-page.is-mobile.is-embedded {
  height: 100dvh;
  max-height: 100dvh;
  border-radius: 0;
  border: none;
  box-shadow: none;
}
.settings-page.is-mobile .top {
  padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 10px;
  gap: 10px;
}
.settings-page.is-mobile .top-titles h1 {
  font-size: 1.05rem;
}
.settings-page.is-mobile .shell {
  grid-template-columns: 1fr;
  grid-template-rows: auto minmax(0, 1fr);
  padding: 0;
  gap: 0;
  max-width: none;
}
.settings-page.is-mobile .nav {
  flex-direction: row;
  align-items: stretch;
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 8px 10px 10px;
  border-radius: 0;
  border: none;
  border-bottom: 1px solid var(--navora-stroke, #d9e2ea);
  overflow: hidden;
}
.settings-page.is-mobile .nav-list {
  flex: 1;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.settings-page.is-mobile .nav-list::-webkit-scrollbar {
  display: none;
}
.settings-page.is-mobile .nav-foot {
  flex-shrink: 0;
  margin: 0;
  padding: 0 0 0 8px;
  border: none;
  border-left: 1px solid var(--navora-stroke, #e6edf3);
}
.settings-page.is-mobile .nav-item {
  display: flex;
  flex: 0 0 auto;
  width: auto;
  min-height: 36px;
  padding: 8px 12px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--navora-stroke, #d5dee7);
  border-radius: 999px;
  background: var(--appearance-well, #f7fafc);
}
.settings-page.is-mobile .nav-item.active::before {
  display: none;
}
.settings-page.is-mobile .settings-nav-icon {
  display: none;
}
.settings-page.is-mobile .nav-item.active {
  background: var(--navora-accent, #1b4f72);
}
.settings-page.is-mobile .nav-item.active .nav-label {
  color: var(--appearance-on-accent, #fff);
}
.settings-page.is-mobile .nav-guide {
  background: transparent;
}
.settings-page.is-mobile .panel {
  border: none;
  border-radius: 0;
  min-height: 0;
}
.settings-page.is-mobile .content {
  padding: 14px 14px calc(24px + env(safe-area-inset-bottom, 0px));
}
.settings-page.is-mobile .section-head {
  margin-bottom: 12px;
}
.settings-page.is-mobile .section-head h2 {
  font-size: 1.05rem;
}
.settings-page.is-mobile .card {
  padding: 14px 14px;
}
.settings-page.is-mobile .form-grid,
.settings-page.is-mobile .about-dl,
.settings-page.is-mobile .provider-layout {
  grid-template-columns: 1fr;
}
.settings-page.is-mobile .switch-row {
  gap: 12px;
  min-height: 48px;
  align-items: flex-start;
}
.settings-page.is-mobile .switch-row :deep(.v-switch) {
  flex-shrink: 0;
  margin-top: 2px;
}
.settings-page.is-mobile .perm-toolbar {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}
.settings-page.is-mobile .perm-preset {
  width: 100%;
}
.settings-page.is-mobile .perm-table-head {
  display: none;
}
.settings-page.is-mobile .perm-row {
  grid-template-columns: 1fr;
  gap: 6px;
  padding: 12px 8px;
  border-bottom: 1px solid var(--navora-stroke, #eef2f5);
  border-radius: 0;
}
.settings-page.is-mobile .perm-id {
  white-space: normal;
  word-break: break-all;
}
.settings-page.is-mobile .provider-list {
  max-height: none;
}
.settings-page.is-mobile .provider-list-item {
  min-height: 48px;
}


.skill-batch-check.on {
  color: var(--navora-accent, #1b4f72);
}
.skill-card.skill-batch-mode {
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.skill-card.skill-batch-mode:hover {
  border-color: var(--navora-stroke, #b7c9d8);
}
.skill-card.skill-batch-selected {
  border-color: var(--navora-accent, #1b4f72);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--navora-accent) 12%, transparent);
  background: var(--control-selected, #f3f8fc);
}
.skill-batch-count {
  margin-left: auto;
  font-size: 0.8rem;
  font-weight: 650;
  color: var(--navora-muted, #8a97a5);
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--control-selected, #eef3f7);
  white-space: nowrap;
}
.skill-batch-count.ready {
  color: var(--navora-accent, #1b4f72);
  background: var(--control-selected, #e3eef7);
}
.list-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 36px;
}
.list-toolbar-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
}
.list-toolbar-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 650;
  color: var(--navora-ink, #15202b);
  letter-spacing: 0.01em;
  flex: 1;
  min-width: 0;
}
.list-batch-btn {
  color: var(--navora-muted, #5d6d7e) !important;
  width: 34px !important;
  height: 34px !important;
}
.list-batch-btn :deep(svg) {
  width: 1.05em;
  height: 1.05em;
  font-size: 1.05rem;
}
.list-batch-cancel {
  flex-shrink: 0;
  min-width: 44px;
}
.btn-ic-left {
  margin-right: 8px;
}
.skill-meta-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.skill-batch-check {
  flex-shrink: 0;
  margin-top: 2px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--navora-muted, #9aa8b5);
  font-size: 1.05rem;
}
/* Adapt to the available pane, including a wide navigation rail. */
.section-head h2{font-size:16px;font-weight:600;line-height:1.5}.section-head p{font-size:12px;line-height:1.6}.card{border-color:var(--navora-stroke, #e0e6ee);border-radius:9px}.card-title{font-size:12px;font-weight:600;letter-spacing:0;text-transform:none}
.automation-speed{margin:16px 0 18px;padding:14px 0 0;border-top:1px solid var(--navora-stroke)}
.glyph-style-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}
.glyph-style-option{display:flex;flex-direction:column;gap:9px;min-width:0;padding:13px 12px;border:1px solid var(--appearance-stroke,var(--navora-stroke));border-radius:10px;background:var(--appearance-surface,var(--navora-surface));color:var(--navora-ink);text-align:left;cursor:pointer;transition:background-color 140ms ease,border-color 140ms ease}
.glyph-style-option:hover:not(:disabled){border-color:var(--appearance-composer-edge,var(--navora-accent));background:var(--appearance-well,var(--control-hover))}
.glyph-style-option[aria-checked=true]{border-color:var(--navora-accent);background:color-mix(in srgb,var(--control-selected) 50%,var(--navora-surface));box-shadow:inset 0 0 0 1px var(--navora-accent)}
.glyph-style-option:focus-visible{outline:2px solid var(--navora-accent);outline-offset:3px}.glyph-style-option:disabled{opacity:.6;cursor:default}
.glyph-style-samples{display:flex;align-items:center;gap:9px;min-height:32px}.glyph-style-samples img{display:block;width:27px;height:27px;flex:none}.glyph-style-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:600;line-height:20px}.glyph-style-selected{display:grid;place-items:center;width:18px;height:18px;border-radius:5px;background:var(--navora-accent);color:var(--navora-surface)}.glyph-style-selected svg{width:12px;height:12px}.glyph-style-description{font-size:11px;line-height:1.6;color:var(--navora-muted)}
.browser-link-settings .appearance-hint{margin-top:10px}
@container(max-width:700px){.glyph-style-options{grid-template-columns:repeat(2,minmax(0,1fr))}.glyph-style-samples{gap:7px}.glyph-style-samples img{width:25px;height:25px}}
@container(max-width:430px){.glyph-style-options{grid-template-columns:minmax(0,1fr)}}
@media(prefers-reduced-motion:reduce){.glyph-style-option{transition:none}}
.automation-speed-heading{display:flex;justify-content:space-between;gap:12px;color:var(--navora-ink);font-size:12px}
.automation-speed-heading output{font-variant-numeric:tabular-nums;color:var(--navora-accent);font-weight:600}
.automation-speed-heading small{margin-left:7px;font-size:10px;color:var(--navora-muted);font-weight:400}
.automation-speed input{display:block;width:100%;height:24px;margin:8px 0 3px;accent-color:var(--navora-accent);cursor:pointer}
.automation-speed-labels{position:relative;height:16px;color:var(--navora-muted);font-size:10px}
.automation-speed-labels>span:last-child{position:absolute;right:0}
.automation-speed.is-disabled{opacity:.5}.automation-speed.is-disabled input{cursor:default}
.automation-advanced-toggle{margin-top:8px}
.automation-protection-hint.is-required{display:block!important}
.automation-advanced-fields{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;margin-top:16px;max-width:480px}
.automation-number-field{display:grid;gap:7px;font-size:12px;color:var(--navora-ink)}
.automation-number-field input{width:100%;height:42px;padding:0 12px;border:1px solid var(--navora-stroke);border-radius:5px;background:var(--navora-surface);color:var(--navora-ink);font-size:13px;font-variant-numeric:tabular-nums}
.automation-number-field input:focus-visible,.automation-speed input:focus-visible{outline:2px solid var(--control-focus,var(--navora-accent));outline-offset:2px}
.automation-number-field small{font-size:11px;line-height:1.6;color:var(--navora-muted)}
@container(max-width:640px){
  .settings-page .content{padding:16px!important}
  .content{padding:16px}.form-grid,.about-dl,.provider-layout{grid-template-columns:minmax(0,1fr)}.card{padding:14px}.connection-form{grid-template-columns:minmax(0,1fr)}.perm-toolbar{flex-wrap:wrap}.perm-table-head{display:none}.perm-row{grid-template-columns:minmax(0,1fr);gap:6px}.perm-id{overflow-wrap:anywhere}.provider-edit-head{flex-wrap:wrap}.switch-row{gap:12px}.settings-save-status{font-size:10px}
}
@container(max-width:560px){
  .settings-page.external-navigation:not(.is-mobile)>.top{display:grid;grid-template-columns:minmax(0,1fr);height:auto!important;min-height:44px;padding:0!important;gap:0}
  .settings-page.external-navigation:not(.is-mobile)>.top>.top-left{min-height:44px;padding:4px var(--workspace-caption-reserve,12px) 4px 12px}
  .settings-page.external-navigation:not(.is-mobile)>.top>.top-actions{min-width:0;min-height:40px;justify-content:flex-end;padding:4px 12px;border-top:1px solid var(--navora-stroke, #edf0f5);background:var(--appearance-well, #fbfcfd)}
  .top-sub{display:none}.top-titles{flex:1}.top-titles h1{font-size:13px;line-height:20px}.settings-page.is-mobile .nav-item{border-radius:6px;padding:6px 10px;min-height:32px}.settings-page.is-mobile .nav-item.active{background:var(--control-selected);border-color:var(--navora-stroke, #cbd9e8)}.settings-page.is-mobile .nav-item.active .nav-label{color:var(--navora-accent, #42658e)}
}
</style>

<style>
.skill-more-menu {
  border-radius: 10px !important;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(21, 32, 43, 0.14) !important;
}
.skill-more-panel {
  min-width: 148px;
  padding: 6px;
  background: var(--navora-surface, #fff);
}
.skill-more-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--navora-ink, #314556);
  font-size: 0.88rem;
  text-align: left;
  cursor: pointer;
}
.skill-more-item:hover {
  background: var(--control-hover, #f3f7fa);
}
.skill-more-item:disabled,
.skill-more-item[disabled] {
  opacity: 0.42;
  cursor: not-allowed;
  pointer-events: none;
}
.skill-more-item:disabled:hover,
.skill-more-item[disabled]:hover {
  background: transparent;
}
.skill-more-item.danger {
  color: var(--control-danger, #c0392b);
}
.skill-more-item.danger:hover {
  background: color-mix(in srgb, var(--control-danger) 12%, var(--navora-surface));
}
.settings-titlebar-spacer{height:44px;min-height:44px;flex:0 0 44px}
:global(.navora-app .shell.frameless:not(.mobile-layout) .settings-titlebar-spacer){height:56px;min-height:56px;flex-basis:56px}</style>
