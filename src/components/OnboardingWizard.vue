<template>
  <v-dialog
    :model-value="modelValue"
    :fullscreen="isMobileLayout"
    :max-width="isMobileLayout ? undefined : 680"
    persistent
    scrollable
    class="onboarding-overlay"
    :content-class="
      isMobileLayout ? 'onboarding-dialog onboarding-dialog--mobile' : 'onboarding-dialog'
    "
    scrim="#15202b"
    :opacity="1"
    @update:model-value="onDialogModel"
  >
    <div v-if="cfg" class="ob-card" :class="{ 'is-mobile': isMobileLayout }">
      <header class="ob-head">
        <div class="ob-brand">
          <img src="/app-icon.png" alt="" class="ob-logo" />
          <div>
            <div class="ob-kicker">{{ manual ? '设置向导' : '欢迎使用' }}</div>
            <h2 class="ob-title">Navora</h2>
          </div>
        </div>
        <p class="ob-sub">{{ stepMeta.sub }}</p>
        <div class="ob-steps" aria-hidden="true">
          <span
            v-for="(s, i) in steps"
            :key="s.id"
            class="ob-dot"
            :class="{ active: i === step, done: i < step }"
          />
        </div>
        <div class="ob-step-label">{{ step + 1 }} / {{ steps.length }} · {{ stepMeta.title }}</div>
      </header>

      <div class="ob-body">
        <!-- 模型 -->
        <div v-if="step === 0" class="ob-pane">
          <p class="ob-hint">点选下方预设快速添加并设为默认，再填写 API Key。之后也可在设置中继续添加。</p>
          <div class="ob-presets" role="list">
            <button
              v-for="p in quickPresets"
              :key="p.id"
              type="button"
              class="ob-preset-chip"
              :class="{ active: isPresetActive(p.id) }"
              role="listitem"
              @click="quickAddPreset(p.id)"
            >
              {{ p.shortLabel }}
            </button>
          </div>
          <p v-if="currentPresetHint" class="ob-preset-hint">{{ currentPresetHint }}</p>
          <v-select
            v-model="selectedProviderId"
            :items="providerItems"
            item-title="title"
            item-value="value"
            label="当前服务商"
            variant="outlined"
            density="comfortable"
            color="primary"
            base-color="#c5d0db"
            class="navora-select mt-3"
            :menu-props="selectMenuProps"
            hide-details
            @update:model-value="onProviderPick"
          />
          <v-text-field
            v-if="provider"
            v-model="provider.base_url"
            label="Base URL"
            variant="outlined"
            density="comfortable"
            color="primary"
            base-color="#c5d0db"
            hide-details
            class="mt-3"
          />
          <v-select
            v-if="provider"
            v-model="provider.model"
            :items="provider.models"
            label="默认模型"
            variant="outlined"
            density="comfortable"
            color="primary"
            base-color="#c5d0db"
            class="navora-select mt-3"
            :menu-props="selectMenuProps"
            hide-details
          />
          <v-text-field
            v-model="apiKeyDraft"
            :label="apiKeyLabel"
            type="password"
            autocomplete="off"
            variant="outlined"
            density="comfortable"
            color="primary"
            base-color="#c5d0db"
            hide-details
            class="mt-3"
            placeholder="粘贴 API Key"
          />
        </div>

        <!-- 工作区 -->
        <div v-else-if="step === 1" class="ob-pane">
          <p class="ob-hint">
            Agent 读写文件、下载内容会落在工作区。每个 Chat 使用独立子目录。
          </p>
          <v-text-field
            v-model="cfg.files.root_dirname"
            label="内置相对目录名"
            variant="outlined"
            density="comfortable"
            color="primary"
            base-color="#c5d0db"
            hint="相对数据目录，如 workspace → dataRoot/workspace/&lt;chatId&gt;"
            persistent-hint
            :disabled="!!cfg.files.custom_root"
          />
          <v-text-field
            v-model="cfg.files.custom_root"
            label="自定义工作区根目录（绝对路径）"
            variant="outlined"
            density="comfortable"
            color="primary"
            base-color="#c5d0db"
            hint="填写后使用 custom_root/&lt;chatId&gt;；可留空"
            persistent-hint
            class="mt-2"
          />
          <div class="ob-row mt-2">
            <v-btn variant="outlined" color="primary" size="small" @click="pickCustomRoot">
              选择文件夹
            </v-btn>
            <v-btn
              variant="text"
              size="small"
              :disabled="!cfg.files.custom_root"
              @click="cfg.files.custom_root = ''"
            >
              清除自定义
            </v-btn>
          </div>
        </div>

        <!-- 权限 -->
        <div v-else-if="step === 2" class="ob-pane">
          <p class="ob-hint">
            控制 Agent 能否自动执行敏感操作。新 Chat 会继承此处预设，之后可在设置中微调单项。
          </p>
          <v-select
            :model-value="cfg.permissions.preset"
            :items="presetItems"
            item-title="title"
            item-value="value"
            label="权限预设"
            variant="outlined"
            density="comfortable"
            color="primary"
            base-color="#c5d0db"
            class="navora-select"
            :menu-props="selectMenuProps"
            hide-details
            @update:model-value="onPresetChange"
          />
          <ul class="ob-bullets">
            <li><strong>均衡</strong>：常用浏览允许，写入/脚本需确认（推荐）</li>
            <li><strong>保守</strong>：多数能力需询问，高风险默认拒绝</li>
            <li><strong>放手</strong>：除技能增改外全部直接执行</li>
            <li v-if="manual"><strong>自定义</strong>：保留你在设置中已微调的能力档位</li>
          </ul>
        </div>

        <!-- 远程 -->
        <div v-else-if="step === 3" class="ob-pane">
          <p class="ob-hint">
            可选：在手机或另一台电脑上通过浏览器控制本机 Agent。默认账号 admin / admin；对外暴露时建议改密。
          </p>
          <div class="ob-switch-row">
            <div>
              <div class="ob-switch-title">启用远程访问</div>
              <div class="ob-switch-hint">开启后立即监听；账号与端口点「下一步」时保存</div>
            </div>
            <v-switch
              v-model="cfg.remote.enabled"
              color="primary"
              hide-details
              density="compact"
            />
          </div>
          <div class="ob-grid" :class="{ muted: !cfg.remote.enabled }">
            <v-text-field
              v-model="cfg.remote.host"
              label="监听地址"
              variant="outlined"
              density="comfortable"
              color="primary"
              base-color="#c5d0db"
              hide-details
              :disabled="!cfg.remote.enabled"
            />
            <v-text-field
              v-model.number="cfg.remote.port"
              type="number"
              label="端口"
              variant="outlined"
              density="comfortable"
              color="primary"
              base-color="#c5d0db"
              hide-details
              :disabled="!cfg.remote.enabled"
            />
            <v-text-field
              v-model="cfg.remote.username"
              label="用户名"
              variant="outlined"
              density="comfortable"
              color="primary"
              base-color="#c5d0db"
              hide-details
              class="span-2"
              :disabled="!cfg.remote.enabled"
            />
            <v-text-field
              v-model="remotePasswordDraft"
              type="password"
              autocomplete="new-password"
              label="密码（留空不改）"
              variant="outlined"
              density="comfortable"
              color="primary"
              base-color="#c5d0db"
              hide-details
              class="span-2"
              :disabled="!cfg.remote.enabled"
            />
          </div>
        </div>
      </div>

      <footer class="ob-foot">
        <button type="button" class="ob-skip" :disabled="saving" @click="skip">
          跳过引导
        </button>
        <div class="ob-foot-right">
          <v-btn
            v-if="step > 0"
            variant="text"
            color="primary"
            :disabled="saving"
            @click="step -= 1"
          >
            上一步
          </v-btn>
          <v-btn color="primary" :loading="saving" :disabled="saving" @click="next">
            {{ step >= steps.length - 1 ? '完成' : '下一步' }}
          </v-btn>
        </div>
      </footer>
      <p v-if="errorText" class="ob-error">{{ errorText }}</p>
    </div>
    <div v-else class="ob-card ob-loading">正在加载配置…</div>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  modesForPreset,
  type AppConfig,
} from '@shared/config'
import {
  addProviderFromPresetId,
  ensureDefaultProvider,
  newCustomProvider,
  normalizeProvider,
} from '@shared/model-providers'
import { MODEL_PRESETS, findModelPreset, matchModelPreset } from '@shared/model-presets'
import type { PermissionPreset } from '@shared/types'
import { useMobileLayout } from '@/composables/useMobileLayout'

const props = defineProps<{
  modelValue: boolean
  /** Opened from Settings → About */
  manual?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  completed: []
}>()

const { isMobileLayout } = useMobileLayout()

const steps = [
  { id: 'model', title: '配置模型', sub: '接入大模型，开始与 Agent 对话' },
  { id: 'workspace', title: '工作区', sub: '指定文件读写与下载落盘位置' },
  { id: 'permissions', title: '权限', sub: '决定 Agent 自动操作的确认强度' },
  { id: 'remote', title: '远程访问', sub: '可选：用浏览器从其他设备控制' },
] as const

const step = ref(0)
const cfg = ref<AppConfig | null>(null)
const saving = ref(false)
const errorText = ref('')
const selectedProviderId = ref('')
const apiKeyDraft = ref('')
const apiKeyPreview = ref('')
const remotePasswordDraft = ref('')
const keyConfigured = ref(false)

const selectMenuProps = { contentClass: 'navora-select-menu' }

const quickPresets = MODEL_PRESETS.map((p) => ({
  id: p.id,
  shortLabel:
    p.id === 'moonshot'
      ? 'Kimi'
      : p.id === 'qwen'
        ? '通义千问'
        : p.id === 'zhipu'
          ? '智谱'
          : p.id === 'siliconflow'
            ? 'SiliconFlow'
            : p.id === 'openrouter'
              ? 'OpenRouter'
              : p.id === 'mimo'
                ? 'MiMo'
                : p.id === 'ollama'
                  ? 'Ollama'
                  : p.id === 'custom'
                    ? '自定义'
                    : p.label,
}))

const stepMeta = computed(() => steps[step.value] || steps[0])

const providerItems = computed(() => {
  const list = cfg.value?.ai.providers || []
  return list.map((p) => ({ title: p.label || p.id, value: p.id }))
})

const provider = computed(() => {
  const list = cfg.value?.ai.providers || []
  if (!list.length) return undefined
  return list.find((p) => p.id === selectedProviderId.value) || list[0]
})

const currentPresetHint = computed(() => {
  const p = provider.value
  if (!p) return ''
  const src = p.source_preset || p.id
  return findModelPreset(src)?.hint || ''
})

const apiKeyLabel = computed(() =>
  apiKeyPreview.value
    ? `API Key（已配置 ${apiKeyPreview.value}，留空不改）`
    : 'API Key',
)

const presetItems = computed(() => {
  const base = [
    { title: '均衡（推荐）', value: 'balanced' },
    { title: '保守', value: 'conservative' },
    { title: '放手', value: 'open' },
  ]
  // 首次自动引导不提供「自定义」；设置里手动打开时保留，便于沿用已微调档位
  if (props.manual) {
    base.push({ title: '自定义', value: 'custom' })
  }
  return base
})

function onDialogModel(v: boolean) {
  if (!v) emit('update:modelValue', false)
}

async function load() {
  if (!window.navora) return
  const c = await window.navora.config.get()
  ensureDefaultProvider(c.ai)
  for (const p of c.ai.providers) normalizeProvider(p)
  if (!c.remote) {
    c.remote = {
      enabled: false,
      host: '0.0.0.0',
      port: 8790,
      username: 'admin',
      passwordHash: '',
    }
  }
  cfg.value = c
  selectedProviderId.value = c.ai.default_provider || c.ai.providers[0]?.id || ''
  apiKeyDraft.value = ''
  remotePasswordDraft.value = ''
  errorText.value = ''
  step.value = 0
  // 首次自动引导若当前是 custom，回落到均衡，避免下拉显示英文 raw value
  if (!props.manual && c.permissions.preset === 'custom') {
    c.permissions.preset = 'balanced'
    c.permissions.modes = modesForPreset('balanced')
  }
  await refreshKeyPreview()
}

async function refreshKeyPreview() {
  const p = provider.value
  if (!p || !window.navora) {
    apiKeyPreview.value = ''
    keyConfigured.value = false
    return
  }
  try {
    const st = await window.navora.secrets.getApiKey(p.api_key_ref)
    apiKeyPreview.value = st.preview || ''
    keyConfigured.value = !!st.configured
  } catch {
    apiKeyPreview.value = ''
    keyConfigured.value = false
  }
}

function findExistingByPreset(presetId: string) {
  const list = cfg.value?.ai.providers || []
  const byRef = list.find((p) => p.id === presetId || p.source_preset === presetId)
  if (byRef) return byRef
  // 兼容旧配置（如 openai_compatible 无 source_preset）：按 Base URL 识别，避免重复添加
  return list.find((p) => matchModelPreset(p.base_url || '') === presetId)
}

function isPresetActive(presetId: string) {
  const p = provider.value
  if (!p) return false
  if (p.id === presetId || p.source_preset === presetId) return true
  return matchModelPreset(p.base_url || '') === presetId
}

function selectProviderAsDefault(id: string) {
  if (!cfg.value) return
  const switched = selectedProviderId.value !== id
  selectedProviderId.value = id
  cfg.value.ai.default_provider = id
  // 仅切换服务商时清空 Key 草稿，避免误点同一预设把已输入 Key 清掉
  if (switched) apiKeyDraft.value = ''
  void refreshKeyPreview()
}

function quickAddPreset(presetId: string) {
  if (!cfg.value || !presetId) return
  const existing = findExistingByPreset(presetId)
  if (existing) {
    selectProviderAsDefault(existing.id)
    return
  }
  if (presetId === 'custom') {
    const added = newCustomProvider(cfg.value.ai.providers.map((p) => p.id))
    cfg.value.ai.providers.push(added)
    ensureDefaultProvider(cfg.value.ai)
    selectProviderAsDefault(added.id)
    return
  }
  const added = addProviderFromPresetId(presetId, cfg.value.ai.providers)
  if (!added) return
  cfg.value.ai.providers.push(added)
  ensureDefaultProvider(cfg.value.ai)
  selectProviderAsDefault(added.id)
}

function onProviderPick(id: string) {
  if (!cfg.value || !id) return
  let hit = cfg.value.ai.providers.find((p) => p.id === id)
  if (!hit) {
    const added = addProviderFromPresetId(id, cfg.value.ai.providers)
    if (added) {
      cfg.value.ai.providers.push(added)
      hit = added
    }
  }
  if (hit) selectProviderAsDefault(hit.id)
}

function onPresetChange(preset: PermissionPreset) {
  if (!cfg.value) return
  cfg.value.permissions.preset = preset
  if (preset !== 'custom') {
    cfg.value.permissions.modes = modesForPreset(preset)
  }
}

async function pickCustomRoot() {
  if (!window.navora || !cfg.value) return
  const res = await window.navora.workspace.pickDirectory()
  if (res.ok && res.path) cfg.value.files.custom_root = res.path
}

async function persistCurrentStep(): Promise<boolean> {
  if (!cfg.value || !window.navora) return false
  saving.value = true
  errorText.value = ''
  try {
    ensureDefaultProvider(cfg.value.ai)
    if (provider.value) {
      cfg.value.ai.default_provider = provider.value.id
      normalizeProvider(provider.value)
    }
    if (typeof cfg.value.remote.port === 'number') {
      cfg.value.remote.port = Math.min(65535, Math.max(1, Math.floor(cfg.value.remote.port) || 8790))
    }
    const payload = JSON.parse(JSON.stringify(cfg.value)) as AppConfig & {
      remote: AppConfig['remote'] & { password?: string }
    }
    if (remotePasswordDraft.value.trim()) {
      payload.remote.password = remotePasswordDraft.value.trim()
    }
    const keyValue = apiKeyDraft.value.trim()
    const keyRefBefore = provider.value?.api_key_ref || ''
    const selectedId = provider.value?.id || ''
    cfg.value = await window.navora.config.save(payload)
    if (keyValue) {
      const savedProv = cfg.value.ai.providers.find((p) => p.id === selectedId)
      const keyRef = savedProv?.api_key_ref || keyRefBefore
      if (!keyRef) {
        errorText.value = 'API Key 无法保存：缺少密钥路径'
        return false
      }
      const keyRes = await window.navora.secrets.setApiKey(keyRef, keyValue)
      if (!keyRes?.ok) {
        const err = (keyRes as { error?: string } | undefined)?.error
        errorText.value =
          err === 'remote_forbidden'
            ? '远程端不能保存 API Key，请在本机客户端设置'
            : 'API Key 保存失败'
        return false
      }
      apiKeyDraft.value = ''
      await refreshKeyPreview()
    }
    remotePasswordDraft.value = ''
    return true
  } catch (e) {
    console.error(e)
    const raw = e instanceof Error ? e.message : ''
    errorText.value = raw.includes('remote_no_password')
        ? '请先设置远程密码'
        : raw || '保存失败，请重试'
    return false
  } finally {
    saving.value = false
  }
}

async function markCompleted() {
  if (!window.navora) return
  // 只写完成标记，避免整份配置回写带来无关校验干扰
  const saved = await window.navora.config.save({
    app: { onboarding_completed: true },
  } as Partial<AppConfig>)
  if (cfg.value) {
    cfg.value.app.onboarding_completed = true
    if (saved?.app) cfg.value.app = { ...cfg.value.app, ...saved.app }
  }
}

async function next() {
  const ok = await persistCurrentStep()
  if (!ok) return
  if (step.value >= steps.length - 1) {
    try {
      await markCompleted()
    } catch (e) {
      console.error(e)
      errorText.value = e instanceof Error ? e.message : '完成引导失败，请重试'
      return
    }
    emit('update:modelValue', false)
    emit('completed')
    return
  }
  step.value += 1
}

async function skip() {
  if (!cfg.value) {
    emit('update:modelValue', false)
    return
  }
  saving.value = true
  errorText.value = ''
  try {
    await markCompleted()
    emit('update:modelValue', false)
    emit('completed')
  } catch (e) {
    console.error(e)
    const raw = e instanceof Error ? e.message : ''
    errorText.value = raw || '跳过失败，请重试'
  } finally {
    saving.value = false
  }
}

watch(
  () => props.modelValue,
  async (v) => {
    if (v) await load()
  },
  { immediate: true },
)
</script>

<style scoped>
.ob-card {
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid #d5dee7;
}
.ob-card.is-mobile {
  border-radius: 0;
  border: none;
  height: 100%;
  max-height: 100dvh;
  display: flex;
  flex-direction: column;
}
.ob-loading {
  padding: 56px 32px;
  text-align: center;
  color: #7a8a99;
  font-size: 0.95rem;
}
.ob-head {
  padding: 26px 28px 18px;
  background: linear-gradient(180deg, #f4f8fb 0%, #fff 100%);
  border-bottom: 1px solid #e8eef4;
  flex-shrink: 0;
}
.ob-card.is-mobile .ob-head {
  padding: calc(16px + env(safe-area-inset-top, 0px)) 16px 14px;
}
.ob-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
}
.ob-logo {
  width: 48px;
  height: 48px;
  border-radius: 12px;
}
.ob-kicker {
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #1b4f72;
  opacity: 0.75;
}
.ob-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 750;
  color: #15202b;
  line-height: 1.2;
}
.ob-sub {
  margin: 0 0 16px;
  font-size: 0.92rem;
  color: #5d6d7e;
  line-height: 1.5;
}
.ob-steps {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.ob-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #d5e2ec;
}
.ob-dot.done {
  background: #7f9bb0;
}
.ob-dot.active {
  width: 22px;
  background: #1b4f72;
}
.ob-step-label {
  font-size: 0.8rem;
  font-weight: 650;
  color: #1b4f72;
}
.ob-body {
  padding: 22px 28px 12px;
  min-height: 340px;
}
.ob-card.is-mobile .ob-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  padding: 14px 16px 8px;
}
.ob-hint {
  margin: 0 0 16px;
  font-size: 0.88rem;
  color: #5d6d7e;
  line-height: 1.55;
}
.ob-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ob-preset-chip {
  border: 1px solid #d5dee7;
  background: #fff;
  color: #1b2834;
  border-radius: 8px;
  padding: 8px 13px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 650;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}
.ob-preset-chip:hover {
  border-color: #9bb6c9;
  background: #f4f8fb;
  color: #1b4f72;
}
.ob-preset-chip.active {
  border-color: #1b4f72;
  background: #e8f1f7;
  color: #1b4f72;
}
.ob-preset-hint {
  margin: 10px 0 0;
  font-size: 0.75rem;
  color: #7a8a99;
  line-height: 1.45;
}
.ob-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.ob-bullets {
  margin: 14px 0 0;
  padding-left: 1.1rem;
  font-size: 0.82rem;
  color: #5d6d7e;
  line-height: 1.55;
}
.ob-bullets strong {
  color: #1b2834;
}
.ob-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e8eef4;
}
.ob-switch-title {
  font-size: 0.9rem;
  font-weight: 650;
  color: #15202b;
}
.ob-switch-hint {
  margin-top: 2px;
  font-size: 0.75rem;
  color: #7a8a99;
}
.ob-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.ob-grid.muted {
  opacity: 0.55;
  pointer-events: none;
}
.ob-grid .span-2 {
  grid-column: 1 / -1;
}
.ob-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 24px 20px;
  border-top: 1px solid #e8eef4;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.ob-card.is-mobile .ob-foot {
  padding: 12px 12px calc(14px + env(safe-area-inset-bottom, 0px));
}
.ob-skip {
  border: none;
  background: transparent;
  color: #7a8a99;
  font: inherit;
  font-size: 0.88rem;
  cursor: pointer;
  padding: 8px 8px;
  min-height: 42px;
}
.ob-skip:hover:not(:disabled) {
  color: #1b4f72;
}
.ob-skip:disabled {
  opacity: 0.5;
  cursor: default;
}
.ob-foot-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ob-error {
  margin: 0;
  padding: 0 28px 16px;
  font-size: 0.82rem;
  color: #c0392b;
}
</style>

<!-- overlay 经 teleport 挂到 body；Vuetify scrim 默认用 element opacity，会禁用 backdrop-filter -->
<style>
.v-overlay.onboarding-overlay > .v-overlay__scrim {
  /* 必须用背景 alpha，不能用 opacity，否则高斯模糊不生效 */
  opacity: 1 !important;
  background: rgba(21, 32, 43, 0.52) !important;
  backdrop-filter: blur(16px) saturate(1.15);
  -webkit-backdrop-filter: blur(16px) saturate(1.15);
}
.onboarding-dialog--mobile {
  margin: 0 !important;
  max-width: 100% !important;
  width: 100% !important;
  height: 100% !important;
  border-radius: 0 !important;
}
.onboarding-dialog--mobile .ob-card {
  height: 100%;
  max-height: 100dvh;
}
@media (max-width: 480px) {
  .ob-grid {
    grid-template-columns: 1fr;
  }
  .ob-preset-chip {
    padding: 9px 12px;
    min-height: 40px;
  }
}
</style>
