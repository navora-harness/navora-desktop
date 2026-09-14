<template>
  <div class="settings-page" :class="{ 'is-embedded': embedded, 'is-mobile': mobile }">
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
        <v-btn v-else variant="text" class="back-btn" @click="$router.push('/')">
          <font-awesome-icon icon="arrow-left" class="mr-2" />
          返回
        </v-btn>
        <div class="top-titles">
          <h1>设置</h1>
          <p v-if="!mobile" class="top-sub">Navora 应用与 Agent 偏好</p>
        </div>
      </div>
      <div class="top-actions">
        <v-btn
          color="primary"
          class="save-btn"
          size="small"
          :loading="saving && !savingAndExit"
          :disabled="!cfg || saving"
          @click="save(false)"
        >
          应用
        </v-btn>
        <v-btn
          v-if="!mobile"
          color="primary"
          variant="tonal"
          class="save-btn"
          size="small"
          :loading="saving && savingAndExit"
          :disabled="!cfg || saving"
          @click="save(true)"
        >
          应用并退出
        </v-btn>
      </div>
    </header>

    <div v-if="cfg" class="shell">
      <nav class="nav">
        <div ref="navListEl" class="nav-list">
          <button
            v-for="item in navItems"
            :key="item.value"
            type="button"
            class="nav-item"
            :class="{ active: tab === item.value }"
            @click="selectTab(item.value)"
          >
            <span class="nav-label">{{ item.title }}</span>
            <span v-if="!mobile" class="nav-desc">{{ item.desc }}</span>
          </button>
        </div>
        <div class="nav-foot">
          <button type="button" class="nav-item nav-guide" @click="openOnboarding">
            <span class="nav-label">开始引导</span>
            <span v-if="!mobile" class="nav-desc">模型 · 工作区 · 权限 · 远程</span>
          </button>
        </div>
      </nav>

      <div class="panel">
        <div ref="contentEl" class="content">
          <!-- 基本 -->
          <section v-show="tab === 'basic'" class="section">
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
                <v-switch v-model="cfg.app.close_to_tray" color="primary" hide-details density="compact" />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">启动后显示主界面</div>
                  <div class="switch-hint">关闭则启动后仅驻留托盘</div>
                </div>
                <v-switch v-model="cfg.app.show_main_on_start" color="primary" hide-details density="compact" />
              </div>
            </div>

            <div class="card mt-3">
              <h3 class="card-title">对话与标题</h3>
              <div class="switch-row">
                <div>
                  <div class="switch-title">回复后显示相关追问</div>
                  <div class="switch-hint">回复结束后生成推荐追问</div>
                </div>
                <v-switch
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
                <v-switch
                  v-model="cfg.app.ai_generate_chat_title"
                  color="primary"
                  hide-details
                  density="compact"
                />
              </div>
              <div class="field-row mt-2">
                <div>
                  <div class="switch-title">输入框字数上限</div>
                  <div class="switch-hint">默认 16000；需点「应用」后生效</div>
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
            </div>

            <div class="card mt-3">
              <h3 class="card-title">消息展示</h3>
              <div class="switch-row">
                <div>
                  <div class="switch-title">显示已阅读网页</div>
                  <div class="switch-hint">在回答顶部显示已阅读网页摘要</div>
                </div>
                <v-switch
                  v-model="cfg.app.show_read_pages"
                  color="primary"
                  hide-details
                  density="compact"
                />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">显示运行日志</div>
                  <div class="switch-hint">在对话中显示系统与操作日志</div>
                </div>
                <v-switch
                  v-model="cfg.app.show_run_logs"
                  color="primary"
                  hide-details
                  density="compact"
                />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">折叠工具调用</div>
                  <div class="switch-hint">将连续工具操作收成一条摘要</div>
                </div>
                <v-switch
                  v-model="cfg.app.collapse_tool_runs"
                  color="primary"
                  hide-details
                  density="compact"
                />
              </div>
              <div
                class="switch-row switch-row-nested"
                :class="{ muted: cfg.app.collapse_tool_runs || !cfg.app.show_run_logs }"
              >
                <div>
                  <div class="switch-title">折叠日志显示</div>
                  <div class="switch-hint">
                    将连续运行日志收成一条摘要；关闭后每条日志单独显示。开启「折叠工具调用」时日志会并入工具摘要，此项不可用
                  </div>
                </div>
                <v-switch
                  v-model="cfg.app.collapse_run_logs"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="cfg.app.collapse_tool_runs || !cfg.app.show_run_logs"
                />
              </div>
            </div>
          </section>

          <!-- 模型 -->
          <section v-show="tab === 'model'" class="section">
            <header class="section-head">
              <h2>模型</h2>
              <p>模型服务商与推理轮数</p>
            </header>
            <template v-if="cfg && provider">
              <div class="provider-layout">
                <div class="card provider-list-card">
                  <div class="provider-list-toolbar">
                    <v-select
                      v-model="addPresetId"
                      :items="modelPresetItems"
                      item-title="title"
                      item-value="value"
                      label="从预设添加"
                      variant="outlined"
                      density="compact"
                      color="primary"
                      base-color="#c5d0db"
                      class="navora-select provider-add-select"
                      :menu-props="selectMenuProps"
                      hide-details
                      @update:model-value="onAddFromPreset"
                    />
                    <button type="button" class="provider-tool-btn" @click="addCustomProvider">
                      自定义
                    </button>
                    <button
                      type="button"
                      class="provider-tool-btn danger"
                      title="恢复为内置预设列表（不删除已保存的 Key）"
                      @click="resetProviders"
                    >
                      重置预设
                    </button>
                  </div>
                  <ul class="provider-list" role="listbox">
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
                      @click="selectProvider(p.id)"
                    >
                      <div class="provider-list-main">
                        <span class="provider-list-label">{{ p.label || p.id }}</span>
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
                    <h3 class="card-title">编辑模型</h3>
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
                  <div class="form-grid">
                    <v-text-field
                      v-model="provider.label"
                      label="显示名称"
                      variant="outlined"
                      density="comfortable"
                      color="primary"
                      base-color="#c5d0db"
                    />
                    <v-text-field
                      v-model.number="provider.timeout_ms"
                      type="number"
                      label="超时 (ms)"
                      hint="建议本地模型 ≥ 300000"
                      persistent-hint
                      variant="outlined"
                      density="comfortable"
                      color="primary"
                      base-color="#c5d0db"
                    />
                    <v-text-field
                      v-model="provider.base_url"
                      label="Base URL"
                      variant="outlined"
                      density="comfortable"
                      color="primary"
                      base-color="#c5d0db"
                      class="span-2"
                    />
                    <v-textarea
                      v-model="modelsText"
                      label="可用模型（每行一个）"
                      rows="4"
                      auto-grow
                      variant="outlined"
                      density="comfortable"
                      color="primary"
                      base-color="#c5d0db"
                      class="span-2"
                      :hint="presetHint || '每行一个模型名'"
                      persistent-hint
                    />
                    <v-select
                      v-model="provider.model"
                      :items="provider.models"
                      label="默认模型"
                      variant="outlined"
                      density="comfortable"
                      color="primary"
                      base-color="#c5d0db"
                      class="navora-select span-2"
                      :menu-props="selectMenuProps"
                      hint="未单独指定时使用"
                      persistent-hint
                    />
                    <v-text-field
                      v-model="apiKeyDraft"
                      :label="apiKeyLabel"
                      type="password"
                      variant="outlined"
                      density="comfortable"
                      color="primary"
                      base-color="#c5d0db"
                      class="span-2"
                      hint="仅保存在本地，不写入配置文件；留空点应用不会改动已保存的 Key"
                      persistent-hint
                    >
                      <template v-if="apiKeyPreview" #append-inner>
                        <button
                          type="button"
                          class="provider-tool-btn danger"
                          style="margin-right: 2px"
                          :disabled="clearingApiKey"
                          @click.stop="clearApiKey"
                        >
                          清除
                        </button>
                      </template>
                    </v-text-field>
                  </div>
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
                    base-color="#c5d0db"
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
                    base-color="#c5d0db"
                    hint="继续时追加（4～40）"
                    persistent-hint
                  />
                </div>
              </div>
            </template>
          </section>

          <!-- 浏览器 -->
          <section v-show="tab === 'browser'" class="section">
            <header class="section-head">
              <h2>浏览器</h2>
              <p>Agent 窗口与访问限制</p>
            </header>
            <div class="card">
              <h3 class="card-title">UA 配置</h3>
              <div class="ua-form">
                <v-select
                  :model-value="cfg.browser.default_ua_preset"
                  :items="uaPresetSelectItems"
                  item-title="label"
                  item-value="id"
                  label="预设"
                  variant="outlined"
                  density="comfortable"
                  color="primary"
                  base-color="#c5d0db"
                  class="navora-select"
                  :menu-props="selectMenuProps"
                  hide-details
                  @update:model-value="onUaPresetChange"
                />
                <v-textarea
                  :model-value="cfg.browser.custom_ua"
                  label="User-Agent"
                  hint="修改内容后自动切换为「自定义」；选预设会填入对应 UA"
                  persistent-hint
                  rows="3"
                  auto-grow
                  variant="outlined"
                  density="comfortable"
                  color="primary"
                  base-color="#c5d0db"
                  @update:model-value="onUaTextChange"
                />
              </div>
            </div>

            <div class="card">
              <h3 class="card-title">窗口</h3>
              <div class="switch-row">
                <div>
                  <div class="switch-title">新建 Agent 窗口默认显示</div>
                  <div class="switch-hint">关闭后窗口在后台运行，可在侧栏切换显示</div>
                </div>
                <v-switch v-model="cfg.browser.show_agent_windows" color="primary" hide-details density="compact" />
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-title">阻止 window.open</div>
                  <div class="switch-hint">拦截页面弹出的新窗口</div>
                </div>
                <v-switch v-model="cfg.browser.block_window_open" color="primary" hide-details density="compact" />
              </div>
            </div>

            <div class="card">
              <h3 class="card-title">超时与等待</h3>
              <div class="form-grid">
                <v-text-field
                  v-model.number="cfg.browser.navigation_timeout_ms"
                  type="number"
                  label="导航超时 (ms)"
                  variant="outlined"
                  density="comfortable"
                  color="primary"
                  base-color="#c5d0db"
                />
                <v-text-field
                  v-model.number="cfg.browser.action_timeout_ms"
                  type="number"
                  label="动作超时 (ms)"
                  variant="outlined"
                  density="comfortable"
                  color="primary"
                  base-color="#c5d0db"
                />
              </div>
              <div class="switch-block">
                <div class="switch-row">
                  <div>
                    <div class="switch-title">等待页面 load</div>
                    <div class="switch-hint">导航后等待页面加载完成</div>
                  </div>
                  <v-switch v-model="cfg.browser.wait.load" color="primary" hide-details density="compact" />
                </div>
                <div class="switch-row">
                  <div>
                    <div class="switch-title">等待 network idle</div>
                    <div class="switch-hint">网络短暂空闲后再继续</div>
                  </div>
                  <v-switch v-model="cfg.browser.wait.network_idle" color="primary" hide-details density="compact" />
                </div>
              </div>
            </div>

            <div class="card">
              <h3 class="card-title">URL 白名单</h3>
              <v-textarea
                v-model="allowlistText"
                label="每行一条；空 = 不限制"
                rows="6"
                variant="outlined"
                density="comfortable"
                color="primary"
                base-color="#c5d0db"
                hint="支持域名、通配符或完整 URL"
                persistent-hint
              />
            </div>
          </section>

          <!-- 权限 -->
          <section v-show="tab === 'permissions'" class="section">
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
                base-color="#c5d0db"
                class="navora-select perm-preset"
                :menu-props="selectMenuProps"
                hide-details
                @update:model-value="onPresetChange"
              />
              <p class="perm-toolbar-hint">重选预设会覆盖全部能力档位</p>
            </div>
            <div class="card perm-table">
              <div class="perm-table-head">
                <span>能力</span>
                <span>标识</span>
                <span>档位</span>
              </div>
              <div v-for="(mode, key) in cfg.permissions.modes" :key="key" class="perm-row">
                <span class="perm-label">{{ permLabel(key) }}</span>
                <span class="perm-id">{{ key }}</span>
                <v-select
                  :model-value="mode"
                  :items="modeItemsFor(key)"
                  density="compact"
                  variant="outlined"
                  color="primary"
                  base-color="#c5d0db"
                  hide-details
                  class="navora-select perm-select"
                  :menu-props="selectMenuProps"
                  @update:model-value="(v) => onModeChange(key, v)"
                />
              </div>
              <p class="perm-toolbar-hint mt-2">
                「添加/编辑技能」为拒绝时，Agent 不能发起技能弹窗。
              </p>
            </div>
          </section>

          <!-- 工作区 -->
          <section v-show="tab === 'workspace'" class="section">
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
                也可由 Agent 为单个 Chat 指定覆盖路径。
              </div>
            </div>
          </section>

          <!-- 技能 -->
          <section v-show="tab === 'skills'" class="section">
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
                    <font-awesome-icon icon="trash" class="btn-ic-left" />
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
              <div class="switch-hint">尚无技能，可新建或导入。</div>
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
                  <font-awesome-icon icon="list-check" />
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
                    <font-awesome-icon
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
                      <font-awesome-icon icon="ellipsis-vertical" />
                    </v-btn>
                  </template>
                  <div class="skill-more-panel" role="menu">
                    <button
                      type="button"
                      class="skill-more-item"
                      role="menuitem"
                      @click="openEditSkill(s.id)"
                    >
                      <font-awesome-icon icon="pen-to-square" />
                      <span>编辑</span>
                    </button>
                    <button
                      type="button"
                      class="skill-more-item"
                      role="menuitem"
                      @click="exportSkill(s.id)"
                    >
                      <font-awesome-icon icon="file-export" />
                      <span>导出</span>
                    </button>
                    <button
                      type="button"
                      class="skill-more-item danger"
                      role="menuitem"
                      @click="askRemoveSkill(s)"
                    >
                      <font-awesome-icon icon="trash" />
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

          <!-- 插件 -->
          <section v-show="tab === 'plugins'" class="section">
            <header class="section-head">
              <h2>插件</h2>
              <p>启用后向 Agent 注册工具；对外链、压缩包或商店安装，下次发消息生效</p>
            </header>
            <div class="card mb-3">
              <div class="switch-row">
                <div>
                  <div class="switch-title">插件开发模式</div>
                  <div class="switch-hint">
                    开启后向 Agent 注入插件 SDK 契约；外链插件在 dist 变更后自动重新加载（下次发消息生效）
                  </div>
                </div>
                <v-switch
                  v-model="cfg.plugins.dev_mode"
                  color="primary"
                  hide-details
                  density="compact"
                />
              </div>
            </div>
            <div
              class="card skill-dropzone"
              :class="{ 'skill-drop-active': pluginDropActive }"
              @dragenter.prevent="onPluginDragEnter"
              @dragover.prevent="onPluginDragOver"
              @dragleave.prevent="onPluginDragLeave"
              @drop.prevent="onPluginDrop"
            >
              <div class="d-flex flex-wrap ga-2 align-center">
                <template v-if="!pluginBatchMode">
                  <v-btn
                    variant="outlined"
                    color="primary"
                    :loading="pluginsBusy === 'dir'"
                    :disabled="!!pluginsBusy"
                    @click="importPlugin('directory')"
                  >
                    外链文件夹
                  </v-btn>
                  <v-btn
                    variant="outlined"
                    color="primary"
                    :loading="pluginsBusy === 'zip'"
                    :disabled="!!pluginsBusy"
                    @click="importPlugin('zip')"
                  >
                    导入压缩包
                  </v-btn>
                  <v-btn
                    variant="tonal"
                    color="primary"
                    :disabled="!!pluginsBusy"
                    @click="openBrowse({ kind: 'plugin' })"
                  >
                    插件商店
                  </v-btn>
                  <v-btn variant="text" :disabled="!!pluginsBusy" @click="reloadPlugins">
                    重新加载
                  </v-btn>
                </template>
                <template v-else>
                  <v-btn variant="tonal" :disabled="!!pluginsBusy" @click="togglePluginBatchSelectAll">
                    {{ pluginBatchAllSelected ? '取消全选' : '全选' }}
                  </v-btn>
                  <v-btn
                    color="error"
                    variant="flat"
                    :disabled="!pluginBatchSelectedCount || !!pluginsBusy"
                    @click="askBatchRemovePlugins"
                  >
                    <font-awesome-icon icon="trash" class="btn-ic-left" />
                    卸载{{ pluginBatchSelectedCount ? ` ${pluginBatchSelectedCount}` : '' }}
                  </v-btn>
                  <span class="skill-batch-count" :class="{ ready: pluginBatchSelectedCount > 0 }">
                    已选 {{ pluginBatchSelectedCount }} / {{ removablePlugins.length }}
                  </span>
                </template>
              </div>
              <div v-if="!pluginBatchMode" class="switch-hint mt-3">
                外链不复制源目录；压缩包 ≤ 200MB，须含 plugin.json + main.cjs；随附插件不可卸载；非 HTTPS 商店来源会提示风险。
              </div>
              <div v-else class="switch-hint mt-3">
                勾选后可批量卸载（不含随附插件）。
              </div>
              <div v-if="pluginDropActive && !pluginChecking" class="skill-drop-hint">
                松开以导入插件
              </div>
              <div
                v-if="pluginChecking"
                class="plugin-check-overlay"
                role="status"
                aria-live="polite"
              >
                <div class="plugin-check-card">
                  <div class="plugin-check-spinner" aria-hidden="true" />
                  <div class="plugin-check-text">
                    <div class="plugin-check-title">{{ pluginBusyTitle }}</div>
                    <div class="plugin-check-sub">{{ pluginBusySub }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="list-toolbar mt-3">
              <div class="list-toolbar-main">
                <h3 class="list-toolbar-title">插件列表</h3>
                <v-btn
                  v-if="pluginBatchMode"
                  size="small"
                  variant="text"
                  class="list-batch-cancel"
                  :disabled="!!pluginsBusy"
                  @click="exitPluginBatchMode"
                >
                  取消
                </v-btn>
                <v-btn
                  v-else-if="removablePlugins.length"
                  icon
                  variant="text"
                  size="small"
                  class="list-batch-btn"
                  aria-label="批量操作"
                  title="批量操作"
                  :disabled="!!pluginsBusy"
                  @click="enterPluginBatchMode"
                >
                  <font-awesome-icon icon="list-check" />
                </v-btn>
              </div>
            </div>

            <div v-if="!pluginsList.length" class="card mt-2">
              <div class="switch-hint">暂无插件。可导入插件文件夹，或等待 bundled 同步。</div>
            </div>

            <div
              v-for="p in pluginsList"
              :key="p.id"
              class="card mt-2 skill-card"
              :class="{
                'skill-batch-mode': pluginBatchMode,
                'skill-batch-selected': pluginBatchMode && pluginBatchSelectedIds.has(p.id),
                'plugin-suite-warn': pluginSuiteConflictIds.has(p.id),
              }"
              @click="
                pluginBatchMode && !p.bundled && p.kind !== 'bundled'
                  ? togglePluginBatchSelect(p.id)
                  : undefined
              "
            >
              <div class="skill-head">
                <div class="skill-meta-row">
                  <span
                    v-if="pluginBatchMode && !p.bundled && p.kind !== 'bundled'"
                    class="skill-batch-check"
                    :class="{ on: pluginBatchSelectedIds.has(p.id) }"
                    aria-hidden="true"
                  >
                    <font-awesome-icon
                      :icon="pluginBatchSelectedIds.has(p.id) ? 'circle-check' : 'circle'"
                    />
                  </span>
                  <div class="skill-meta">
                    <div class="skill-name">
                      {{ p.name }}
                      <span
                        v-if="pluginSuiteConflictIds.has(p.id)"
                        class="plugin-tag warn"
                        :title="pluginSuiteConflictHint(p)"
                      >
                        套件冲突
                      </span>
                    </div>
                    <div class="skill-id">
                      {{ p.id }}<template v-if="p.version"> · v{{ p.version }}</template>
                    </div>
                    <div class="plugin-source" :title="p.sourceDetail || undefined">
                      来源：{{ p.source || '未知'
                      }}<template v-if="p.sourceDetail"> · {{ p.sourceDetail }}</template
                      ><template v-if="p.suite"> · 套件 {{ p.suite }}</template>
                    </div>
                  </div>
                </div>
                <v-switch
                  v-if="!pluginBatchMode"
                  class="skill-enable-switch"
                  :model-value="p.enabled"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="!!pluginsBusy || !!p.error"
                  @update:model-value="(v: boolean | null) => togglePlugin(p.id, Boolean(v))"
                />
              </div>
              <div class="skill-body-row">
                <div class="skill-desc">
                  {{ p.description }}
                  <template v-if="p.tools?.length">
                    <br />
                    接口：
                    <code v-for="(t, i) in p.tools" :key="t"
                      >{{ t }}<template v-if="i < p.tools.length - 1">, </template></code
                    >
                  </template>
                  <template v-if="p.error">
                    <br />
                    <span style="color: rgb(var(--v-theme-error))">加载失败：{{ p.error }}</span>
                  </template>
                </div>
                <v-menu
                  v-if="!pluginBatchMode"
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
                      :disabled="!!pluginsBusy"
                      v-bind="menuProps"
                    >
                      <font-awesome-icon icon="ellipsis-vertical" />
                    </v-btn>
                  </template>
                  <div class="skill-more-panel" role="menu">
                    <button
                      type="button"
                      class="skill-more-item"
                      role="menuitem"
                      :disabled="!p.hasReadme || !!pluginsBusy"
                      :title="p.hasReadme ? '查看插件说明' : '该插件未提供说明文件'"
                      @click="viewPluginDocs(p)"
                    >
                      <font-awesome-icon icon="book" />
                      <span>查看说明</span>
                    </button>
                    <button
                      type="button"
                      class="skill-more-item"
                      role="menuitem"
                      @click="exportPlugin(p.id)"
                    >
                      <font-awesome-icon icon="file-export" />
                      <span>导出压缩包</span>
                    </button>
                    <button
                      type="button"
                      class="skill-more-item danger"
                      role="menuitem"
                      :disabled="p.bundled || p.kind === 'bundled'"
                      @click="askRemovePlugin(p)"
                    >
                      <font-awesome-icon icon="trash" />
                      <span>{{
                        p.bundled || p.kind === 'bundled'
                          ? '随附不可卸载'
                          : p.kind === 'linked'
                            ? '取消外链'
                            : '卸载'
                      }}</span>
                    </button>
                  </div>
                </v-menu>
              </div>
            </div>

            <PluginImportDialog
              v-model="pluginImportOpen"
              :preview="pluginImportPreview"
              :saving="pluginsBusy === 'import'"
              @confirm="onPluginImportConfirm"
            />
            <PluginDocsDialog
              v-model="pluginDocsOpen"
              :plugin-id="pluginDocsTarget?.id"
              :name="pluginDocsTarget?.name"
              :markdown="pluginDocsMarkdown"
              :file-name="pluginDocsFileName"
              :loading="pluginDocsLoading"
              :error="pluginDocsError"
            />
            <SkillDeleteDialog
              v-model="pluginDeleteOpen"
              kicker="插件"
              entity-label="插件"
              action-verb="卸载"
              subtitle="卸载后将从本机移除该插件，请确认目标无误"
              :skill-id="pluginDeleteTarget?.id"
              :name="pluginDeleteTarget?.name"
              :description="pluginDeleteTarget?.description"
              :items="pluginDeleteBatchItems"
              :saving="pluginsBusy === 'delete'"
              @confirm="onPluginDeleteConfirm"
              @cancel="onPluginDeleteCancel"
            />
          </section>

          <!-- 远程访问 -->
          <section v-show="tab === 'remote'" class="section">
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
                <v-switch v-model="cfg.remote.enabled" color="primary" hide-details density="compact" />
              </div>
              <div class="form-grid mt-2" :class="{ muted: !cfg.remote.enabled }">
                <v-text-field
                  v-model="cfg.remote.host"
                  label="监听地址"
                  variant="outlined"
                  density="comfortable"
                  hide-details
                  :disabled="!cfg.remote.enabled"
                />
                <v-text-field
                  v-model.number="cfg.remote.port"
                  label="端口"
                  type="number"
                  variant="outlined"
                  density="comfortable"
                  hide-details
                  :disabled="!cfg.remote.enabled"
                />
                <v-text-field
                  v-model="cfg.remote.username"
                  label="用户名"
                  variant="outlined"
                  density="comfortable"
                  hide-details
                  :disabled="!cfg.remote.enabled"
                />
                <v-text-field
                  v-model="remotePasswordDraft"
                  label="新密码（留空不改）"
                  type="password"
                  variant="outlined"
                  density="comfortable"
                  hide-details
                  :disabled="!cfg.remote.enabled"
                  autocomplete="new-password"
                />
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
                  默认账号 admin / admin；账号端口等需点「应用」。
                </div>
              </div>
            </div>
          </section>

          <!-- 分叉决策 -->
          <section v-show="tab === 'fork'" class="section">
            <header class="section-head">
              <h2>分叉决策</h2>
              <p>任务路径不明时询问你如何继续</p>
            </header>
            <div class="card">
              <div class="switch-row">
                <div>
                  <div class="switch-title">启用分叉决策</div>
                  <div class="switch-hint">路径不明时询问你如何继续</div>
                </div>
                <v-switch
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
                <v-switch
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
                  <div class="switch-hint">超时未选将按超时处理；默认 60 秒；需点「应用」后生效</div>
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
                  base-color="#c5d0db"
                  class="ask-timeout-field"
                  style="max-width: 140px"
                  :disabled="!cfg.fork_decision.enabled || askTimeoutUnlimited"
                />
              </div>
            </div>

            <div class="card mt-3" :class="{ muted: !cfg.fork_decision.enabled }">
              <h3 class="card-title">决策体验</h3>
              <div class="switch-row">
                <div>
                  <div class="switch-title">允许自定义输入</div>
                  <div class="switch-hint">除预设选项外，可手写答案</div>
                </div>
                <v-switch
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
                <v-switch
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
                <v-switch
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
                <v-switch
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
                <v-switch
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
                  <div class="switch-hint">低风险分叉以消息流呈现</div>
                </div>
                <v-switch
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
                <v-switch
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
          <section v-show="tab === 'subchat'" class="section">
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
                <v-switch
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
                    {{ subchatMaxMin }}～{{ subchatMaxMax }}；需点「应用」后生效
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
                  base-color="#c5d0db"
                  class="ask-timeout-field"
                  style="max-width: 120px"
                  :disabled="!cfg.subchat.enabled"
                />
              </div>
            </div>
          </section>

          <!-- 关于 -->
          <section v-show="tab === 'about'" class="section">
            <header class="section-head">
              <h2>关于</h2>
              <p>版本与运行环境</p>
            </header>
            <div class="card about-card">
              <div class="about-name">Navora</div>
              <div class="about-tag">AI Agent Browser</div>
              <dl v-if="info" class="about-dl">
                <div>
                  <dt>版本</dt>
                  <dd>{{ info.version }}</dd>
                </div>
                <div>
                  <dt>浏览器内核</dt>
                  <dd>{{ info.chrome }}</dd>
                </div>
                <div class="span-all">
                  <dt>数据目录</dt>
                  <dd class="path">{{ info.dataRoot }}</dd>
                </div>
                <div v-if="typeof info.portable === 'boolean'">
                  <dt>运行模式</dt>
                  <dd>{{ info.portable ? '便携版' : '安装版' }}</dd>
                </div>
              </dl>
              <p class="about-note">架构说明见 docs/architecture-plan.md</p>
            </div>
          </section>
        </div>
      </div>
    </div>

    <v-snackbar
      v-model="toast.show"
      :color="toast.color"
      :timeout="2200"
      location="top"
      :z-index="10000"
      multi-line
    >
      {{ toast.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  createDefaultForkDecision,
  createDefaultSubchat,
  modesForPreset,
  detectPermissionPreset,
  resolveForkDecision,
  resolvePluginDevMode,
  resolveSubchat,
  SUBCHAT_MAX_PARALLEL_MIN,
  SUBCHAT_MAX_PARALLEL_MAX,
  syncBrowserUaFields,
  type AppConfig,
} from '@shared/config'
import { MODEL_PRESETS, findModelPreset } from '@shared/model-presets'
import { findUaPresetByUa, getUaPreset, UA_PRESETS } from '@shared/ua-presets'
import {
  addProviderFromPresetId,
  defaultProviderList,
  ensureDefaultProvider,
  newCustomProvider,
  normalizeModelList,
  normalizeProvider,
  pickDefaultProviderId,
} from '@shared/model-providers'
import type { AppInfo, PermissionMode, PermissionPreset } from '@shared/types'
import type { PluginImportPreview, PluginRecord } from '@shared/plugins'
import type { SkillImportPreview, SkillRecord } from '@shared/skills'
import { storeErrorText } from '@shared/store'
import type { SkillProposal, SkillReviewDraft } from '@shared/types'
import SkillEditorDialog from '../components/skills/SkillEditorDialog.vue'
import SkillImportDialog from '../components/skills/SkillImportDialog.vue'
import SkillBatchImportDialog from '../components/skills/SkillBatchImportDialog.vue'
import SkillExportDialog from '../components/skills/SkillExportDialog.vue'
import SkillDeleteDialog from '../components/skills/SkillDeleteDialog.vue'
import PluginImportDialog from '../components/plugins/PluginImportDialog.vue'
import PluginDocsDialog from '../components/plugins/PluginDocsDialog.vue'
import { useOnboarding } from '../composables/useOnboarding'
import { useStoreUi } from '../composables/useStoreUi'

const props = withDefaults(
  defineProps<{
    /** Render inside a large modal instead of a full page. */
    embedded?: boolean
    mobile?: boolean
  }>(),
  { embedded: false, mobile: false },
)

const emit = defineEmits<{
  close: []
}>()

const router = useRouter()

const { show: showOnboarding } = useOnboarding()
const { openBrowse, onInstalled: onStoreUiInstalled } = useStoreUi()
let unsubStoreInstalled: (() => void) | undefined

function openOnboarding() {
  showOnboarding({ manual: true })
}

const tab = ref('basic')
const contentEl = ref<HTMLElement | null>(null)
const navListEl = ref<HTMLElement | null>(null)
const cfg = ref<AppConfig | null>(null)
const info = ref<AppInfo | null>(null)

function selectTab(value: string) {
  if (tab.value === 'plugins' && value !== 'plugins' && pluginBatchMode.value) {
    exitPluginBatchMode()
  }
  if (tab.value === 'skills' && value !== 'skills' && skillBatchMode.value) {
    exitSkillBatchMode()
  }
  tab.value = value
  if (value === 'skills') void loadSkills()
  if (value === 'plugins') void loadPlugins()
  if (value === 'subchat' && cfg.value) ensureSubchat()
  void nextTick(() => {
    contentEl.value?.scrollTo({ top: 0 })
    const active = navListEl.value?.querySelector<HTMLElement>('.nav-item.active')
    active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
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
    return (cfg.value?.fork_decision?.ask_timeout_ms ?? 60000) <= 0
  },
  set(on: boolean) {
    if (!cfg.value) return
    const fork = ensureForkDecision()
    if (on) {
      if (fork.ask_timeout_ms === 0) return
      fork.ask_timeout_ms = 0
      return
    }
    if (fork.ask_timeout_ms > 0) return
    fork.ask_timeout_ms = 60000
  },
})

const askTimeoutSec = computed({
  get() {
    const ms = cfg.value?.fork_decision?.ask_timeout_ms
    const n = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 60000
    return Math.round(n / 1000)
  },
  set(sec: number) {
    if (!cfg.value) return
    const fork = ensureForkDecision()
    if (fork.ask_timeout_ms <= 0) return
    const v = typeof sec === 'number' ? sec : Number(sec)
    const clamped = Number.isFinite(v) ? Math.min(600, Math.max(5, Math.floor(v))) : 60
    const nextMs = clamped * 1000
    if (fork.ask_timeout_ms === nextMs) return
    fork.ask_timeout_ms = nextMs
  },
})
const apiKeyDraft = ref('')
const apiKeyPreview = ref('')
const clearingApiKey = ref(false)
const keyConfigured = ref<Record<string, boolean>>({})
const selectedProviderId = ref('')
const addPresetId = ref<string | null>(null)
const allowlistText = ref('')
const saving = ref(false)
const savingAndExit = ref(false)
const savingInstant = ref(false)
const hydrating = ref(false)
const toast = ref({ show: false, text: '', color: 'success' })
const uaPresetItems = ref<{ id: string; label: string; ua?: string }[]>([])
const uaPresetSelectItems = computed(() => {
  const list = uaPresetItems.value.length ? uaPresetItems.value : UA_PRESETS
  const hasCustom = list.some((p) => p.id === 'custom')
  return hasCustom ? list : [...list, { id: 'custom', label: '自定义', ua: '' }]
})

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
} | null>(null)

const navItems = [
  { value: 'basic', title: '基本', desc: '窗口 · 对话 · 展示' },
  { value: 'model', title: '模型', desc: 'LLM 接入' },
  { value: 'browser', title: '浏览器', desc: 'UA 与超时' },
  { value: 'workspace', title: '工作区', desc: '文件目录' },
  { value: 'skills', title: '技能', desc: '创建 · 导入' },
  { value: 'plugins', title: '插件', desc: '可选工具包' },
  { value: 'remote', title: '远程访问', desc: '全功能控制' },
  { value: 'permissions', title: '权限', desc: 'Agent 能力' },
  { value: 'fork', title: '分叉决策', desc: '路径选择' },
  { value: 'subchat', title: '子对话', desc: '并行子任务' },
  { value: 'about', title: '关于', desc: '版本信息' },
]

const skillsList = ref<SkillRecord[]>([])
const proposals = ref<SkillProposal[]>([])
const skillsBusy = ref<string | false>(false)
let unsubProposals: (() => void) | undefined
const skillDropActive = ref(false)
let skillDragDepth = 0

const pluginsList = ref<PluginRecord[]>([])
const pluginsBusy = ref<string | false>(false)
const pluginChecking = computed(() => pluginsBusy.value === 'parse')
const pluginBusyTitle = computed(() => {
  if (pluginsBusy.value === 'parse') return '正在检查插件…'
  return '请稍候…'
})
const pluginBusySub = computed(() => {
  if (pluginsBusy.value === 'parse') return '校验 plugin.json、入口文件与包结构'
  return ''
})
let unsubPlugins: (() => void) | undefined
const pluginDropActive = ref(false)
let pluginDragDepth = 0

const pluginImportOpen = ref(false)
const pluginImportPreview = ref<PluginImportPreview | null>(null)
const pluginImportPendingPath = ref<string | null>(null)

const pluginDocsOpen = ref(false)
const pluginDocsTarget = ref<PluginRecord | null>(null)
const pluginDocsMarkdown = ref('')
const pluginDocsFileName = ref('')
const pluginDocsLoading = ref(false)
const pluginDocsError = ref('')

const pluginDeleteOpen = ref(false)
const pluginDeleteTarget = ref<PluginRecord | null>(null)
const pluginDeleteBatchItems = ref<Array<{ id: string; name?: string }> | undefined>(undefined)

const pluginBatchMode = ref(false)
const pluginBatchSelectedIds = ref<Set<string>>(new Set())
const removablePlugins = computed(() =>
  pluginsList.value.filter((p) => !p.bundled && p.kind !== 'bundled'),
)
const pluginBatchSelectedCount = computed(() => pluginBatchSelectedIds.value.size)
const pluginBatchAllSelected = computed(() => {
  const n = removablePlugins.value.length
  return n > 0 && pluginBatchSelectedIds.value.size >= n
})

/** Same suite already co-installed (legacy / edge cases). */
const pluginSuiteConflictIds = computed(() => {
  const bySuite = new Map<string, string[]>()
  for (const p of pluginsList.value) {
    const g = String(p.suite || '')
      .trim()
      .toLowerCase()
    if (!g) continue
    const list = bySuite.get(g) || []
    list.push(p.id)
    bySuite.set(g, list)
  }
  const ids = new Set<string>()
  for (const suiteIds of bySuite.values()) {
    if (suiteIds.length < 2) continue
    for (const id of suiteIds) ids.add(id)
  }
  return ids
})

function pluginSuiteConflictHint(p: PluginRecord): string {
  const g = String(p.suite || '')
    .trim()
    .toLowerCase()
  if (!g) return '同套件已安装多个包，请只保留一个'
  const others = pluginsList.value
    .filter(
      (x) =>
        x.id !== p.id &&
        String(x.suite || '')
          .trim()
          .toLowerCase() === g,
    )
    .map((x) => x.name || x.id)
  if (!others.length) return `套件「${g}」冲突`
  return `套件「${g}」已同时安装：${others.join('、')}。同套件只能保留一个，请卸载多余包。`
}

const pluginErrorHints: Record<string, string> = {
  path_not_found: '路径不存在',
  plugin_json_missing: '缺少 plugin.json',
  invalid_manifest: 'plugin.json 无效',
  invalid_main_path: 'main 路径非法',
  invalid_main_ext: 'main 仅支持 .cjs / .js',
  plugin_not_found: '插件不存在',
  readme_not_found: '该插件未提供说明文件',
  plugin_exists: '插件已存在',
  plugin_bundled_cannot_remove: '随附插件不可卸载',
  plugin_bundled_cannot_overwrite: '不可覆盖随附插件',
  plugin_suite_conflict: '同套件已安装其它包，请先卸载或确认更换',
  plugin_suite_bundled_conflict: '同套件存在随附插件，无法导入替换',
  plugin_exclusivity_conflict: '同套件已安装其它包，请先卸载或确认更换',
  plugin_exclusivity_bundled_conflict: '同套件存在随附插件，无法导入替换',
  plugin_too_large: '压缩包超过 200MB 上限',
  zip_empty: '压缩包为空',
  zip_unsafe_path: '压缩包含不安全路径',
  invalid_suite_manifest: '套件清单 suite.json 无效',
  suite_packages_empty: '套件压缩包未包含任何变体',
  package_not_found: '套件中找不到所选变体',
  link_path_missing: '外链目录不存在',
  plugin_path_must_be_dir_or_zip: '请选择插件文件夹或 .zip 压缩包',
  plugin_permissions_undeclared: '插件未声明权限计划',
  plugin_permissions_empty: '插件权限计划为空',
  import_load_failed: '导入后加载失败',
  invalid_module_exports: '插件入口未导出 tools / execute',
  remote_unsupported: '远程端不支持文件选择，请在本机客户端操作',
  remote_forbidden: '远程端禁止此操作',
  id_required: '缺少插件 id',
  host_too_old: '当前桌面版本过低，无法安装该版本',
  invalid_catalog_path: '商店目录路径无效，已拒绝下载',
  size_mismatch: '下载体积与目录声明不符',
  download_timeout: '下载超时',
  checksum_mismatch: '校验和不匹配，已拒绝安装',
  product_kind_required: '插件与技能同名，请指定类型',
  product_not_found: '商店中找不到该产品',
}

function pluginErrorText(code?: string): string {
  if (!code) return '操作失败'
  return pluginErrorHints[code] || storeErrorText(code)
}

function droppedLocalPath(file: File): string {
  try {
    const via = window.navora?.pathForFile?.(file)
    if (via) return via
  } catch {
    /* ignore */
  }
  return String((file as File & { path?: string }).path || '')
}

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


async function loadPlugins() {
  if (!window.navora?.plugins) {
    pluginsList.value = []
    return
  }
  try {
    pluginsList.value = await window.navora.plugins.list()
    prunePluginBatchSelection()
  } catch (e) {
    showToast(e instanceof Error ? e.message : '加载插件失败', 'error')
  }
}

async function onStoreInstalled() {
  showToast('已从商店安装')
  await Promise.all([loadPlugins(), loadSkills()])
}

function prunePluginBatchSelection() {
  if (!removablePlugins.value.length && pluginBatchMode.value) {
    exitPluginBatchMode()
    return
  }
  if (!pluginBatchMode.value || !pluginBatchSelectedIds.value.size) return
  const alive = new Set(removablePlugins.value.map((p) => p.id))
  let changed = false
  const next = new Set<string>()
  for (const id of pluginBatchSelectedIds.value) {
    if (alive.has(id)) next.add(id)
    else changed = true
  }
  if (changed) pluginBatchSelectedIds.value = next
}

async function reloadPlugins() {
  if (!window.navora?.plugins?.reload) return
  pluginsBusy.value = 'reload'
  try {
    const res = await window.navora.plugins.reload()
    pluginsList.value = res.plugins || (await window.navora.plugins.list())
    prunePluginBatchSelection()
    showToast('已重新加载插件')
  } catch (e) {
    showToast(e instanceof Error ? e.message : '重新加载失败', 'error')
  } finally {
    pluginsBusy.value = false
  }
}

async function importPlugin(kind: 'directory' | 'zip' = 'directory') {
  if (!window.navora?.plugins?.pickParse) {
    showToast('当前环境不支持导入插件', 'error')
    return
  }
  pluginsBusy.value = kind === 'zip' ? 'zip' : 'dir'
  try {
    const res = await window.navora.plugins.pickParse(kind)
    if (res.canceled) return
    if (!res.ok || !res.preview) {
      showToast(pluginErrorText(res.error), 'error')
      return
    }
    pluginImportPreview.value = res.preview
    pluginImportPendingPath.value = res.path || res.preview.sourcePath
    pluginImportOpen.value = true
  } catch (e) {
    showToast(e instanceof Error ? e.message : '导入失败', 'error')
  } finally {
    pluginsBusy.value = false
  }
}

async function exportPlugin(id: string) {
  if (!window.navora?.plugins?.export) {
    showToast('当前环境不支持导出插件', 'error')
    return
  }
  pluginsBusy.value = 'export'
  try {
    const res = await window.navora.plugins.export(id)
    if (res.canceled) return
    if (!res.ok) {
      showToast(pluginErrorText(res.error), 'error')
      return
    }
    showToast(`已导出到 ${res.path || ''}`)
  } catch (e) {
    showToast(e instanceof Error ? e.message : '导出失败', 'error')
  } finally {
    pluginsBusy.value = false
  }
}

async function viewPluginDocs(p: PluginRecord) {
  if (!p.hasReadme) return
  if (!window.navora?.plugins?.readReadme) {
    showToast('当前环境不支持查看插件说明', 'error')
    return
  }
  pluginDocsTarget.value = p
  pluginDocsMarkdown.value = ''
  pluginDocsFileName.value = ''
  pluginDocsError.value = ''
  pluginDocsLoading.value = true
  pluginDocsOpen.value = true
  try {
    const res = await window.navora.plugins.readReadme(p.id)
    if (!res.ok) {
      pluginDocsError.value = pluginErrorText(res.error)
      return
    }
    pluginDocsMarkdown.value = res.markdown || ''
    pluginDocsFileName.value = res.fileName || 'README.md'
  } catch (e) {
    pluginDocsError.value = e instanceof Error ? e.message : '读取说明失败'
  } finally {
    pluginDocsLoading.value = false
  }
}

async function onPluginImportConfirm(opts: {
  overwrite: boolean
  replaceSuite?: boolean
  replaceExclusivity?: boolean
  packageId?: string
}) {
  if (!window.navora?.plugins || !pluginImportPendingPath.value) return
  pluginsBusy.value = 'import'
  try {
    const res = await window.navora.plugins.import(pluginImportPendingPath.value, {
      overwrite: opts.overwrite,
      replaceSuite: opts.replaceSuite ?? opts.replaceExclusivity,
      packageId: opts.packageId,
    })
    if (!res.ok) {
      showToast(pluginErrorText(res.error), 'error')
      return
    }
    const kind = res.plugin?.kind
    const label =
      kind === 'linked' ? '已外链' : kind === 'installed' ? '已安装' : '已导入'
    showToast(`${label}插件 ${res.plugin?.name || ''}`)
    pluginImportOpen.value = false
    pluginImportPreview.value = null
    pluginImportPendingPath.value = null
    await loadPlugins()
  } catch (e) {
    showToast(e instanceof Error ? e.message : '导入失败', 'error')
  } finally {
    pluginsBusy.value = false
  }
}

function onPluginDragEnter(e: DragEvent) {
  if (pluginsBusy.value || pluginBatchMode.value) return
  pluginDragDepth += 1
  pluginDropActive.value = true
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onPluginDragOver(e: DragEvent) {
  if (pluginsBusy.value || pluginBatchMode.value) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  pluginDropActive.value = true
}

function onPluginDragLeave() {
  pluginDragDepth = Math.max(0, pluginDragDepth - 1)
  if (pluginDragDepth === 0) pluginDropActive.value = false
}

async function onPluginDrop(e: DragEvent) {
  pluginDragDepth = 0
  pluginDropActive.value = false
  if (!window.navora?.plugins || pluginsBusy.value || pluginBatchMode.value) return
  const files = Array.from(e.dataTransfer?.files || [])
  if (!files.length) return
  pluginsBusy.value = 'parse'
  try {
    const file = files[0]
    const filePath = droppedLocalPath(file)
    if (!filePath || !window.navora.plugins.parsePath) {
      showToast('请拖入本机插件文件夹或 .zip（需可读取路径）', 'warning')
      return
    }
    const res = await window.navora.plugins.parsePath(filePath)
    if (!res.ok || !res.preview) {
      showToast(pluginErrorText(res.error), 'error')
      return
    }
    pluginImportPreview.value = res.preview
    pluginImportPendingPath.value = res.preview.sourcePath || filePath
    pluginImportOpen.value = true
  } catch (err) {
    showToast(err instanceof Error ? err.message : '导入失败', 'error')
  } finally {
    pluginsBusy.value = false
  }
}

function askRemovePlugin(p: PluginRecord) {
  if (p.bundled || p.kind === 'bundled') {
    showToast('随附插件不可卸载', 'warning')
    return
  }
  pluginDeleteTarget.value = p
  pluginDeleteBatchItems.value = undefined
  pluginDeleteOpen.value = true
}

function onPluginDeleteCancel() {
  pluginDeleteOpen.value = false
  pluginDeleteTarget.value = null
  pluginDeleteBatchItems.value = undefined
}

async function onPluginDeleteConfirm() {
  if (!window.navora?.plugins) return
  const batch = pluginDeleteBatchItems.value
  if (batch?.length) {
    pluginsBusy.value = 'delete'
    try {
      const ids = batch.map((it) => it.id)
      const res = window.navora.plugins.removeMany
        ? await window.navora.plugins.removeMany(ids)
        : await (async () => {
            const removed: string[] = []
            const failed: string[] = []
            for (const id of ids) {
              const r = await window.navora!.plugins!.remove(id)
              if (r.ok) removed.push(id)
              else failed.push(id)
            }
            return { ok: failed.length === 0 && removed.length > 0, removed, failed }
          })()
      const removed = res.removed?.length ?? 0
      const failed = res.failed?.length ?? 0
      if (removed && !failed) {
        showToast(`已卸载 ${removed} 个插件`)
      } else if (removed && failed) {
        showToast(`已卸载 ${removed} 个，失败 ${failed} 个`, 'warning')
      } else {
        showToast(pluginErrorText(res.error) || '卸载失败', 'error')
        return
      }
      pluginDeleteOpen.value = false
      pluginDeleteTarget.value = null
      pluginDeleteBatchItems.value = undefined
      pluginBatchSelectedIds.value = new Set()
      await loadPlugins()
      if (!removablePlugins.value.length) exitPluginBatchMode()
    } catch (e) {
      showToast(e instanceof Error ? e.message : '卸载失败', 'error')
    } finally {
      pluginsBusy.value = false
    }
    return
  }

  if (!pluginDeleteTarget.value) return
  pluginsBusy.value = 'delete'
  try {
    const res = await window.navora.plugins.remove(pluginDeleteTarget.value.id)
    if (!res.ok) {
      showToast(pluginErrorText(res.error), 'error')
      return
    }
    showToast('已卸载')
    pluginDeleteOpen.value = false
    pluginDeleteTarget.value = null
    pluginDeleteBatchItems.value = undefined
    await loadPlugins()
  } catch (e) {
    showToast(e instanceof Error ? e.message : '卸载失败', 'error')
  } finally {
    pluginsBusy.value = false
  }
}

function enterPluginBatchMode() {
  pluginBatchMode.value = true
  pluginBatchSelectedIds.value = new Set()
}

function exitPluginBatchMode() {
  pluginBatchMode.value = false
  pluginBatchSelectedIds.value = new Set()
}

function togglePluginBatchSelect(id: string) {
  const next = new Set(pluginBatchSelectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  pluginBatchSelectedIds.value = next
}

function togglePluginBatchSelectAll() {
  if (pluginBatchAllSelected.value) {
    pluginBatchSelectedIds.value = new Set()
    return
  }
  pluginBatchSelectedIds.value = new Set(removablePlugins.value.map((p) => p.id))
}

function selectedPluginItems(): Array<{ id: string; name?: string }> {
  const map = new Map(pluginsList.value.map((p) => [p.id, p]))
  const items: Array<{ id: string; name?: string }> = []
  for (const id of pluginBatchSelectedIds.value) {
    const p = map.get(id)
    if (p?.bundled || p?.kind === 'bundled') continue
    items.push({ id, name: p?.name })
  }
  return items
}

function askBatchRemovePlugins() {
  const items = selectedPluginItems()
  if (!items.length || pluginsBusy.value) return
  pluginDeleteTarget.value = null
  pluginDeleteBatchItems.value = items
  pluginDeleteOpen.value = true
}

async function togglePlugin(id: string, enabled: boolean) {
  if (!window.navora?.plugins || pluginsBusy.value) return
  pluginsBusy.value = id
  try {
    const res = await window.navora.plugins.setEnabled(id, enabled)
    if (!res.ok) {
      showToast(pluginErrorText(res.error), 'error')
      await loadPlugins()
      return
    }
    const disabled = (
      res as {
        disabledConflicts?: Array<{ id: string; name: string }>
      }
    ).disabledConflicts
    if (enabled && disabled?.length) {
      const names = disabled.map((c) => c.name || c.id).join('、')
      showToast(`已启用；同套件已自动禁用：${names}`, 'warning')
    }
    await loadPlugins()
  } catch (e) {
    showToast(e instanceof Error ? e.message : '更新失败', 'error')
    await loadPlugins()
  } finally {
    pluginsBusy.value = false
  }
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
            return { ok: failed.length === 0 && removed.length > 0, removed, failed }
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

const modelsText = computed({
  get() {
    return (provider.value?.models || []).join('\n')
  },
  set(v: string) {
    if (!provider.value) return
    // Textarea is source of truth — do not re-inject the previous default model.
    const models = normalizeModelList(
      String(v || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      '',
    )
    const prev = String(provider.value.model || '').trim()
    const nextModel = prev && models.includes(prev) ? prev : models[0]
    const same =
      provider.value.model === nextModel &&
      provider.value.models?.length === models.length &&
      provider.value.models.every((m, i) => m === models[i])
    if (same) return
    provider.value.models = models
    provider.value.model = nextModel
  },
})

const apiKeyLabel = computed(() =>
  apiKeyPreview.value
    ? `API Key（已配置 ${apiKeyPreview.value}，留空不改）`
    : 'API Key',
)

const modelPresetItems = MODEL_PRESETS.map((p) => ({
  title: p.label,
  value: p.id,
}))

const presetHint = computed(() => {
  const src = provider.value?.source_preset
  if (src) return findModelPreset(src)?.hint || ''
  return findModelPreset(matchPresetForProvider(provider.value))?.hint || ''
})

function matchPresetForProvider(p: { base_url?: string; source_preset?: string } | undefined) {
  if (!p) return 'custom'
  if (p.source_preset) return p.source_preset
  const raw = String(p.base_url || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '')
  for (const preset of MODEL_PRESETS) {
    if (preset.id === 'custom') continue
    const u = preset.base_url.toLowerCase().replace(/\/+$/, '')
    if (raw === u || raw.startsWith(u) || u.startsWith(raw)) return preset.id
  }
  return 'custom'
}

async function selectProvider(id: string) {
  if (!cfg.value) return
  selectedProviderId.value = id
  apiKeyDraft.value = ''
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
  cfg.value.ai.providers = cfg.value.ai.providers.filter((p) => p.id !== id)
  ensureDefaultProvider(cfg.value.ai)
  await selectProvider(cfg.value.ai.default_provider || cfg.value.ai.providers[0].id)
  await refreshAllKeyFlags()
}

function setAsDefault() {
  if (!cfg.value || !provider.value) return
  cfg.value.ai.default_provider = provider.value.id
}

async function resetProviders() {
  if (!cfg.value) return
  if (!window.confirm('将模型列表恢复为内置预设？已保存的 API Key 不会删除。')) return
  cfg.value.ai.providers = defaultProviderList()
  cfg.value.ai.default_provider = pickDefaultProviderId(cfg.value.ai.providers)
  await selectProvider(cfg.value.ai.default_provider)
  await refreshAllKeyFlags()
}

async function refreshApiKeyPreview() {
  if (!cfg.value || !window.navora || !provider.value) {
    apiKeyPreview.value = ''
    return
  }
  const ref = provider.value.api_key_ref
  if (!ref) {
    apiKeyPreview.value = ''
    return
  }
  const st = await window.navora.secrets.getApiKey(ref)
  apiKeyPreview.value = st.configured ? st.preview : ''
  keyConfigured.value = { ...keyConfigured.value, [provider.value.id]: st.configured }
}

async function clearApiKey() {
  if (!cfg.value || !window.navora || !provider.value || clearingApiKey.value) return
  const ref = provider.value.api_key_ref
  if (!ref) {
    showToast('当前服务商没有密钥路径', 'error')
    return
  }
  if (!window.confirm('清除该服务商已保存的 API Key？')) return
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
    apiKeyDraft.value = ''
    await refreshAllKeyFlags()
    await refreshApiKeyPreview()
    showToast('已清除 API Key')
  } catch (e) {
    showToast(errMessage(e, '清除失败'), 'error')
  } finally {
    clearingApiKey.value = false
  }
}

async function refreshAllKeyFlags() {
  if (!cfg.value || !window.navora) return
  const next: Record<string, boolean> = {}
  await Promise.all(
    cfg.value.ai.providers.map(async (p) => {
      if (!p.api_key_ref) {
        next[p.id] = false
        return
      }
      const st = await window.navora!.secrets.getApiKey(p.api_key_ref)
      next[p.id] = st.configured
    }),
  )
  keyConfigured.value = next
}

const selectMenuProps = {
  contentClass: 'navora-select-menu',
  offset: 4,
  transition: 'fade-transition',
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

function onPresetChange(preset: PermissionPreset) {
  if (!cfg.value) return
  cfg.value.permissions.preset = preset
  if (preset !== 'custom') {
    cfg.value.permissions.modes = modesForPreset(preset)
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
    close_to_tray: c.app.close_to_tray,
    show_main_on_start: c.app.show_main_on_start !== false,
    show_followup_suggestions: c.app.show_followup_suggestions,
    ai_generate_chat_title: c.app.ai_generate_chat_title,
    show_read_pages: c.app.show_read_pages,
    show_run_logs: c.app.show_run_logs,
    collapse_tool_runs: c.app.collapse_tool_runs !== false,
    collapse_run_logs: c.app.collapse_run_logs !== false,
    show_agent_windows: c.browser.show_agent_windows,
    block_window_open: c.browser.block_window_open,
    wait_load: c.browser.wait.load,
    wait_network_idle: c.browser.wait.network_idle,
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
  target.app.close_to_tray = s.close_to_tray
  target.app.show_main_on_start = s.show_main_on_start
  target.app.show_followup_suggestions = s.show_followup_suggestions
  target.app.ai_generate_chat_title = s.ai_generate_chat_title
  target.app.show_read_pages = s.show_read_pages
  target.app.show_run_logs = s.show_run_logs
  target.app.collapse_tool_runs = s.collapse_tool_runs
  target.app.collapse_run_logs = s.collapse_run_logs
  target.browser.show_agent_windows = s.show_agent_windows
  target.browser.block_window_open = s.block_window_open
  target.browser.wait.load = s.wait_load
  target.browser.wait.network_idle = s.wait_network_idle
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

async function persistInstantPrefs() {
  if (!cfg.value || !window.navora || hydrating.value || saving.value) return
  if (savingInstant.value) {
    instantPrefsDirty = true
    return
  }
  savingInstant.value = true
  instantPrefsDirty = false
  const snapshotKey = instantPrefsKey.value
  try {
    const disk = await window.navora.config.get()
    applyInstantPrefs(disk, cfg.value)
    const saved = await window.navora.config.save(disk)
    // Only sync fields we own; avoid clobbering in-flight edits that landed after snapshot.
    if (instantPrefsKey.value === snapshotKey) {
      applyInstantPrefs(cfg.value, saved)
    }
    try {
      remoteStatus.value = await window.navora.remote.status()
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.error(e)
    showToast(errMessage(e, '开关保存失败'), 'error')
    try {
      const disk = await window.navora.config.get()
      applyInstantPrefs(cfg.value, disk)
    } catch {
      /* ignore */
    }
  } finally {
    savingInstant.value = false
    if (instantPrefsDirty || instantPrefsKey.value !== snapshotKey) {
      instantPrefsDirty = false
      void persistInstantPrefs()
    }
  }
}

function schedulePersistInstantPrefs() {
  if (hydrating.value) return
  clearTimeout(instantPrefsTimer)
  instantPrefsTimer = setTimeout(() => {
    void persistInstantPrefs()
  }, 280)
}

watch(instantPrefsKey, (next, prev) => {
  if (hydrating.value || !prev || next === prev) return
  schedulePersistInstantPrefs()
})

watch(
  () => cfg.value?.browser.url_allowlist,
  (list) => {
    if (!list) return
    allowlistText.value = list.join('\n')
  },
)

async function load() {
  if (!window.navora) return
  hydrating.value = true
  try {
    cfg.value = await window.navora.config.get()
    info.value = await window.navora.app.info()
    uaPresetItems.value = await window.navora.config.uaPresets()
    allowlistText.value = (cfg.value.browser.url_allowlist || []).join('\n')
    syncBrowserUaFields(cfg.value)
    ensureDefaultProvider(cfg.value.ai)
    for (const p of cfg.value.ai.providers) normalizeProvider(p)
    selectedProviderId.value =
      cfg.value.ai.default_provider || cfg.value.ai.providers[0]?.id || ''
    remotePasswordDraft.value = ''
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
    apiKeyDraft.value = ''
    try {
      remoteStatus.value = await window.navora.remote.status()
    } catch {
      remoteStatus.value = null
    }
    await loadSkills()
    await nextTick()
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
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'string' && e.trim()) return e
  if (e && typeof e === 'object') {
    const msg = (e as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  return fallback
}

async function save(exitAfter = false) {
  if (!cfg.value || !window.navora || saving.value) return
  saving.value = true
  savingAndExit.value = exitAfter
  try {
    cfg.value.browser.url_allowlist = allowlistText.value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    const clamp = (n: unknown, min: number, max: number, fb: number) => {
      const v = typeof n === 'number' ? n : Number(n)
      if (!Number.isFinite(v)) return fb
      return Math.min(max, Math.max(min, Math.floor(v)))
    }
    cfg.value.ai.max_tool_rounds = clamp(cfg.value.ai.max_tool_rounds, 4, 80, 24)
    cfg.value.ai.continue_tool_rounds = clamp(cfg.value.ai.continue_tool_rounds, 4, 40, 12)
    cfg.value.app.max_composer_chars = clamp(cfg.value.app.max_composer_chars, 1000, 200000, 16000)
    if (!cfg.value.fork_decision) {
      cfg.value.fork_decision = createDefaultForkDecision()
    }
    cfg.value.fork_decision = resolveForkDecision(cfg.value)
    // Force unimplemented flags off
    cfg.value.fork_decision.inline_low_risk = false
    cfg.value.fork_decision.allow_revise = false
    if (!cfg.value.subchat) {
      cfg.value.subchat = createDefaultSubchat()
    }
    cfg.value.subchat = resolveSubchat(cfg.value)
    if (!cfg.value.plugins) {
      cfg.value.plugins = { dev_mode: false }
    }
    cfg.value.plugins.dev_mode = resolvePluginDevMode(cfg.value)
    syncBrowserUaFields(cfg.value)
    if (!cfg.value.remote) {
      cfg.value.remote = {
        enabled: false,
        host: '0.0.0.0',
        port: 8790,
        username: 'admin',
        passwordHash: '',
      }
    }
    cfg.value.remote.port = clamp(cfg.value.remote.port, 1, 65535, 8790)
    for (const p of cfg.value.ai.providers) {
      p.timeout_ms = clamp(p.timeout_ms, 1000, 900000, 120000)
      normalizeProvider(p)
    }
    ensureDefaultProvider(cfg.value.ai)
    const payload = JSON.parse(JSON.stringify(cfg.value)) as AppConfig & {
      remote: AppConfig['remote'] & { password?: string }
    }
    if (remotePasswordDraft.value.trim()) {
      payload.remote.password = remotePasswordDraft.value.trim()
    }
    // never send empty passwordHash wipe accidentally when draft empty — keep existing hash
    const selectedId = selectedProviderId.value || provider.value?.id || ''
    const keyValue = apiKeyDraft.value.trim()
    const keyRefBefore = provider.value?.api_key_ref || ''
    cfg.value = await window.navora.config.save(payload)
    remotePasswordDraft.value = ''
    ensureDefaultProvider(cfg.value.ai)
    if (!cfg.value.ai.providers.some((p) => p.id === selectedProviderId.value)) {
      selectedProviderId.value = cfg.value.ai.default_provider || cfg.value.ai.providers[0]?.id || ''
    }
    if (keyValue) {
      const savedProv =
        cfg.value.ai.providers.find((p) => p.id === selectedId) ||
        cfg.value.ai.providers.find((p) => p.id === selectedProviderId.value)
      const keyRef = savedProv?.api_key_ref || keyRefBefore
      if (!keyRef) {
        showToast('API Key 无法保存：缺少密钥路径，请重选模型服务商后再试', 'error')
        return
      }
      const keyRes = await window.navora.secrets.setApiKey(keyRef, keyValue)
      if (!keyRes?.ok) {
        const err = (keyRes as { error?: string } | undefined)?.error
        showToast(
          err === 'remote_forbidden'
            ? '远程端不能保存 API Key，请在本机客户端设置'
            : 'API Key 保存失败',
          'error',
        )
        return
      }
      apiKeyDraft.value = ''
    }
    await refreshAllKeyFlags()
    await refreshApiKeyPreview()
    try {
      remoteStatus.value = await window.navora.remote.status()
    } catch {
      /* ignore */
    }
    await nextTick()
    if (exitAfter) {
      if (props.embedded) emit('close')
      else void router.push('/')
    } else {
      showToast('已应用')
    }
  } catch (e) {
    console.error(e)
    showToast(errMessage(e, '应用失败'), 'error')
  } finally {
    saving.value = false
    savingAndExit.value = false
  }
}

onMounted(() => {
  void load()
  unsubStoreInstalled = onStoreUiInstalled(() => {
    void onStoreInstalled()
  })
  unsubPlugins = window.navora?.plugins?.onChanged?.((payload) => {
    pluginsList.value = payload.plugins || []
    prunePluginBatchSelection()
  })
  unsubProposals = window.navora?.skills?.onProposalsChanged?.((payload) => {
    proposals.value = (payload.proposals || []).filter(
      (p) => p.action === 'create' || p.action === 'update',
    )
  })
})

onUnmounted(() => {
  unsubProposals?.()
  unsubPlugins?.()
  unsubStoreInstalled?.()
})
</script>

<style scoped>
.settings-page {
  height: 100vh;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(1200px 480px at 10% -10%, rgba(27, 79, 114, 0.08), transparent 60%),
    #eef2f5;
  user-select: none;
  -webkit-user-select: none;
}
.settings-page.is-embedded {
  height: min(88vh, 920px);
  max-height: calc(100vh - 48px);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.72);
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
  border-bottom: 1px solid #d9e2ea;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
}
.top-left {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.back-btn {
  color: #1b4f72 !important;
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
.nav-foot {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #e6edf3;
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
  transition: background 0.12s ease;
}
.nav-item:hover {
  background: #f3f7fa;
}
.nav-item.active {
  background: #e8f1f7;
}
.nav-label {
  font-size: 0.92rem;
  font-weight: 600;
  color: #1b2834;
}
.nav-item.active .nav-label {
  color: #1b4f72;
}
.nav-desc {
  font-size: 0.72rem;
  color: #8a97a5;
}

.panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid #d5dee7;
  background: #fff;
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
  color: #15202b;
}
.section-head p {
  margin: 4px 0 0;
  font-size: 0.82rem;
  color: #7a8a99;
}

.card {
  border: 1px solid #e4ebf1;
  border-radius: 10px;
  background: #fafcfd;
  padding: 16px 18px;
  margin-bottom: 14px;
}
.card-title {
  margin: 0 0 12px;
  font-size: 0.8rem;
  font-weight: 700;
  color: #5d6d7e;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
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
  border-top: 1px solid #e6edf3;
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
  border: 1px solid #c5d0db;
  background: #fff;
  color: #1b2834;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 0.78rem;
  cursor: pointer;
  white-space: nowrap;
}
.provider-tool-btn:hover:not(:disabled) {
  border-color: #1b4f72;
  color: #1b4f72;
}
.provider-tool-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.provider-tool-btn.danger {
  color: #a94442;
  border-color: #e0b4b4;
}
.provider-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 360px;
  overflow: auto;
  border: 1px solid #e2e8ee;
  border-radius: 10px;
}
.provider-list-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid #eef2f5;
  cursor: pointer;
}
.provider-list-item:last-child {
  border-bottom: 0;
}
.provider-list-item:hover {
  background: #f5f8fb;
}
.provider-list-item.active {
  background: #eaf2f8;
  box-shadow: inset 3px 0 0 #1b4f72;
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
  color: #1b2834;
}
.provider-list-model {
  font-size: 0.72rem;
  color: #6a7a88;
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
  background: #edf1f5;
  color: #5d6d7e;
}
.provider-badge.default {
  background: #d6e6f2;
  color: #1b4f72;
}
.provider-badge.ok {
  background: #dceee0;
  color: #1e6b45;
}
.provider-badge.miss {
  background: #f5e6e4;
  color: #a94442;
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
  border-top: 1px solid #e8eef4;
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
  border-bottom: 1px solid #e8eef4;
}
.switch-row-nested {
  margin-left: 12px;
  padding-left: 12px;
  border-left: 2px solid #e2eaf1;
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
  color: #1b2834;
}
.switch-hint {
  margin-top: 2px;
  font-size: 0.75rem;
  color: #8a97a5;
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
  color: #8a97a5;
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
  color: #8a97a5;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid #e4ebf1;
}
.perm-row {
  padding: 7px 10px;
  border-radius: 8px;
}
.perm-row:hover {
  background: #f3f7fa;
}
.perm-label {
  font-size: 0.88rem;
  font-weight: 500;
  color: #1b2834;
}
.perm-id {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.72rem;
  color: #8a97a5;
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
  color: #5d6d7e !important;
}
.proposal-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #e4ebf1;
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
  border-color: #1b4f72;
  box-shadow: 0 0 0 3px rgba(27, 79, 114, 0.14);
  background: #f3f8fc;
}
.skill-drop-hint {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #1b4f72;
  color: #fff;
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
  color: #15202b;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
}
.plugin-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.4;
  flex: 0 0 auto;
  width: max-content;
  max-width: 100%;
}
.plugin-tag.warn {
  color: #9a4b12;
  background: #fff1e0;
  border: 1px solid #f0c9a8;
}
.skill-card.plugin-suite-warn {
  border-color: #f0c9a8;
  background: #fffbf7;
}
.skill-id {
  margin-top: 2px;
  font-size: 0.72rem;
  color: #8a97a5;
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
  color: #5d6d7e;
  line-height: 1.45;
  white-space: pre-wrap;
}
.skill-flag {
  margin-top: 8px;
  font-size: 0.75rem;
  color: #1b4f72;
}
.about-name {
  font-size: 1.4rem;
  font-weight: 750;
  color: #15202b;
}
.about-tag {
  margin-top: 2px;
  font-size: 0.85rem;
  color: #5d6d7e;
}
.about-dl {
  margin: 18px 0 0;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px 18px;
}
.about-dl dt {
  font-size: 0.72rem;
  color: #8a97a5;
  margin-bottom: 2px;
}
.about-dl dd {
  margin: 0;
  font-size: 0.92rem;
  color: #1b2834;
  font-weight: 550;
}
.about-dl .span-all {
  grid-column: 1 / -1;
}
.about-note {
  margin: 16px 0 0;
  font-size: 0.8rem;
  color: #8a97a5;
}
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
  background: #fff;
}
.content :deep(input),
.content :deep(textarea) {
  user-select: text;
  -webkit-user-select: text;
}
.perm-select :deep(.v-field) {
  background: #fff;
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
  border-bottom: 1px solid #d9e2ea;
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
  border-left: 1px solid #e6edf3;
}
.settings-page.is-mobile .nav-item {
  flex: 0 0 auto;
  width: auto;
  min-height: 36px;
  padding: 8px 12px;
  align-items: center;
  justify-content: center;
  border: 1px solid #d5dee7;
  border-radius: 999px;
  background: #f7fafc;
}
.settings-page.is-mobile .nav-item.active {
  background: #1b4f72;
}
.settings-page.is-mobile .nav-item.active .nav-label {
  color: #fff;
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
  border-bottom: 1px solid #eef2f5;
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
.plugin-check-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  border-radius: inherit;
  background: rgba(248, 251, 253, 0.82);
  backdrop-filter: blur(2px);
}
.plugin-check-card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: min(100%, 280px);
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid #d5e3ef;
  background: #fff;
  box-shadow: 0 8px 24px rgba(21, 32, 43, 0.08);
}
.plugin-check-spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2.5px solid #c5d6e6;
  border-top-color: #1b4f72;
  animation: plugin-check-spin 0.75s linear infinite;
  flex-shrink: 0;
}
.plugin-check-title {
  font-size: 0.9rem;
  font-weight: 650;
  color: #15202b;
}
.plugin-check-sub {
  margin-top: 2px;
  font-size: 0.75rem;
  color: #6a7c8c;
}
@keyframes plugin-check-spin {
  to {
    transform: rotate(360deg);
  }
}

.plugin-source {
  margin-top: 3px;
  font-size: 0.72rem;
  color: #6b7c8c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-page.is-mobile .plugin-source {
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.skill-batch-check.on {
  color: #1b4f72;
}
.skill-card.skill-batch-mode {
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.skill-card.skill-batch-mode:hover {
  border-color: #b7c9d8;
}
.skill-card.skill-batch-selected {
  border-color: #1b4f72;
  box-shadow: 0 0 0 2px rgba(27, 79, 114, 0.12);
  background: #f3f8fc;
}
.skill-batch-count {
  margin-left: auto;
  font-size: 0.8rem;
  font-weight: 650;
  color: #8a97a5;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eef3f7;
  white-space: nowrap;
}
.skill-batch-count.ready {
  color: #1b4f72;
  background: #e3eef7;
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
  color: #15202b;
  letter-spacing: 0.01em;
  flex: 1;
  min-width: 0;
}
.list-batch-btn {
  color: #5d6d7e !important;
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
  color: #9aa8b5;
  font-size: 1.05rem;
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
  background: #fff;
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
  color: #314556;
  font-size: 0.88rem;
  text-align: left;
  cursor: pointer;
}
.skill-more-item:hover {
  background: #f3f7fa;
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
  color: #c0392b;
}
.skill-more-item.danger:hover {
  background: #fdecea;
}
</style>
