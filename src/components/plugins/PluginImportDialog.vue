<template>
  <SkillDialogShell
    :model-value="modelValue"
    kicker="插件"
    :title="dialogTitle"
    :subtitle="saving ? progressSubtitle : shellSubtitle"
    :max-width="640"
    @update:model-value="onDialogModel"
  >
    <div class="import-body" :class="{ 'is-busy': saving || selecting }">
      <ol v-if="stepDefs.length > 1" class="step-rail" aria-label="安装步骤">
        <li
          v-for="(s, i) in stepDefs"
          :key="s.id"
          class="step-rail-item"
          :class="{
            active: i === stepIndex,
            done: i < stepIndex,
          }"
        >
          <span class="step-rail-num">{{ i + 1 }}</span>
          <span class="step-rail-label">{{ s.label }}</span>
        </li>
      </ol>

      <!-- Step: target (suite variant) -->
      <div v-if="currentStepId === 'target'" class="step-pane">
        <section class="hero">
          <div class="hero-name">{{ productName }}</div>
          <p class="hero-desc selectable">{{ productDescription }}</p>
          <div class="chip-row">
            <span class="chip mono">{{ productId }}</span>
            <span v-if="livePreview?.suite" class="chip mono">套件 {{ livePreview.suite }}</span>
          </div>
        </section>

        <div class="field">
          <div class="field-label">选择变体</div>
          <v-radio-group v-model="selectedPackageId" hide-details density="compact">
            <v-radio
              v-for="pkg in suitePackages"
              :key="pkg.id"
              :value="pkg.id"
              :label="packageOptionLabel(pkg)"
            />
          </v-radio-group>
          <p v-if="activePackage?.description" class="field-hint selectable">
            {{ activePackage.description }}
          </p>
        </div>
      </div>

      <!-- Step: confirm -->
      <div v-else class="step-pane">
        <div class="preview-card">
          <div class="preview-head">
            <div class="preview-title-row">
              <div class="preview-name">{{ livePreview?.name || '未命名' }}</div>
              <span v-if="livePreview?.version" class="preview-ver">v{{ livePreview.version }}</span>
            </div>
            <p class="preview-desc">{{ livePreview?.description || '（无描述）' }}</p>
          </div>

          <dl class="meta-grid">
            <div class="meta-row">
              <dt>方式</dt>
              <dd>{{ modeLabel }}</dd>
            </div>
            <div class="meta-row">
              <dt>来源</dt>
              <dd class="mono" :title="livePreview?.sourcePath || undefined">
                {{ livePreview?.sourceLabel || '—' }}
              </dd>
            </div>
            <div v-if="sizeLabel" class="meta-row">
              <dt>大小</dt>
              <dd>{{ sizeLabel }}</dd>
            </div>
            <div class="meta-row">
              <dt>标识</dt>
              <dd class="mono">{{ livePreview?.id || '—' }}</dd>
            </div>
            <div v-if="livePreview?.suite || isSuiteZip" class="meta-row">
              <dt>套件</dt>
              <dd class="mono">{{ livePreview?.suite || livePreview?.productId || '—' }}</dd>
            </div>
          </dl>

          <div v-if="livePreview?.existing" class="conflict-box" role="status">
            <div class="conflict-title">将覆盖已有插件</div>
            <div class="conflict-body">
              <span class="conflict-name">{{ livePreview.existing.name }}</span>
              <span class="conflict-meta">
                id {{ livePreview.existing.id
                }}<template v-if="livePreview.existing.version">
                  · v{{ livePreview.existing.version }}</template
                ><template v-if="livePreview.existing.source">
                  · {{ livePreview.existing.source }}</template
                >
              </span>
            </div>
          </div>

          <div
            v-if="suiteConflicts.length"
            class="conflict-box suite-box"
            :class="{ 'is-blocked': hasBundledSuiteConflict }"
            role="status"
          >
            <div class="conflict-title">
              {{
                hasBundledSuiteConflict
                  ? '套件冲突（含随附插件，无法继续）'
                  : '同套件已安装其它包，需先卸载再安装'
              }}
            </div>
            <div v-for="c in suiteConflicts" :key="c.id" class="conflict-body suite-item">
              <span class="conflict-name">{{ c.name }}</span>
              <span class="conflict-meta">
                id {{ c.id
                }}<template v-if="c.version"> · v{{ c.version }}</template
                ><template v-if="c.source"> · {{ c.source }}</template
                ><template v-if="c.bundled || c.kind === 'bundled'"> · 随附</template>
              </span>
            </div>
            <p v-if="!hasBundledSuiteConflict" class="suite-hint">
              点击「{{ confirmLabel }}」将先卸载上述包，再完成本次{{
                livePreview?.mode === 'link' ? '外链' : '安装'
              }}。
            </p>
            <p v-else class="suite-hint">请先在设置中处理随附包；或改用其它套件产品包。</p>
          </div>
        </div>

        <div v-if="saving" class="progress-panel" role="status" aria-live="polite">
          <div class="progress-spinner" aria-hidden="true" />
          <div class="progress-copy">
            <div class="progress-title">{{ progressTitle }}</div>
            <div class="progress-steps">
              <div
                v-for="step in steps"
                :key="step.key"
                class="progress-step"
                :class="{
                  done: step.state === 'done',
                  active: step.state === 'active',
                  pending: step.state === 'pending',
                }"
              >
                <span class="step-dot" />
                <span class="step-label">{{ step.label }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #actions>
      <v-btn v-if="canGoBack" variant="text" :disabled="saving || selecting" @click="goBack">
        上一步
      </v-btn>
      <v-spacer />
      <v-btn variant="text" :disabled="saving" @click="emit('update:modelValue', false)">取消</v-btn>
      <v-btn
        v-if="currentStepId === 'target'"
        color="primary"
        :disabled="!selectedPackageId || saving"
        :loading="selecting"
        @click="goNextFromTarget"
      >
        继续
      </v-btn>
      <v-btn
        v-else
        color="primary"
        :loading="saving"
        :disabled="saving || selecting || hasBundledSuiteConflict || !livePreview"
        @click="
          emit('confirm', {
            overwrite: Boolean(livePreview?.existing),
            replaceSuite: suiteConflicts.length > 0,
            packageId: isSuiteZip ? selectedPackageId || livePreview?.id : undefined,
          })
        "
      >
        {{ confirmLabel }}
      </v-btn>
    </template>
  </SkillDialogShell>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  PluginImportPreview,
  PluginImportProgress,
  PluginSuitePackagePreview,
} from '@shared/plugins'
import SkillDialogShell from '../skills/SkillDialogShell.vue'

type StepId = 'target' | 'confirm'
type StepDef = { id: StepId; label: string }
type StepState = 'pending' | 'active' | 'done'
type Step = { key: string; label: string; state: StepState }

const props = defineProps<{
  modelValue: boolean
  preview: PluginImportPreview | null
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [opts: { overwrite: boolean; replaceSuite: boolean; packageId?: string }]
}>()

const phaseIndex = ref(0)
const livePhase = ref<PluginImportProgress['phase'] | ''>('')
const stepDefs = ref<StepDef[]>([])
const stepIndex = ref(0)
const selectedPackageId = ref('')
const livePreview = ref<PluginImportPreview | null>(null)
const selecting = ref(false)
let stopProgress: (() => void) | null = null
let phaseTimer: ReturnType<typeof setInterval> | null = null

const isSuiteZip = computed(
  () =>
    livePreview.value?.displayMode === 'suite' &&
    (livePreview.value?.packages?.length || 0) > 1,
)

const suitePackages = computed(() => livePreview.value?.packages || [])

const activePackage = computed(
  () => suitePackages.value.find((p) => p.id === selectedPackageId.value) || null,
)

const productName = computed(
  () => livePreview.value?.productName || livePreview.value?.name || '未命名',
)
const productId = computed(
  () => livePreview.value?.productId || livePreview.value?.suite || livePreview.value?.id || '—',
)
const productDescription = computed(
  () =>
    livePreview.value?.productDescription ||
    livePreview.value?.description ||
    '（无描述）',
)

const currentStepId = computed(() => stepDefs.value[stepIndex.value]?.id || 'confirm')
const canGoBack = computed(
  () => stepIndex.value > 0 && currentStepId.value === 'confirm' && !props.saving,
)

const suiteConflicts = computed(() => livePreview.value?.suiteConflicts || [])

const hasBundledSuiteConflict = computed(() =>
  suiteConflicts.value.some((c) => c.bundled || c.kind === 'bundled'),
)

const isSuiteChange = computed(
  () => suiteConflicts.value.length > 0 && !hasBundledSuiteConflict.value,
)

const dialogTitle = computed(() => {
  if (hasBundledSuiteConflict.value) return '无法导入'
  if (currentStepId.value === 'target') return '安装插件'
  if (isSuiteChange.value) return '更改套件'
  return '导入插件'
})

const shellSubtitle = computed(() => {
  if (currentStepId.value === 'target') return '同套件只能保留一个变体'
  return conflictHint.value
})

const modeLabel = computed(() => {
  if (livePreview.value?.mode === 'link') return '开发外链（不复制）'
  if (livePreview.value?.displayMode === 'suite') return '套件压缩包安装'
  if (livePreview.value?.mode === 'zip') return '压缩包安装'
  return livePreview.value?.source || '—'
})

const phaseKeyOrder = computed(() => {
  const replace = isSuiteChange.value
  if (livePreview.value?.mode === 'link') {
    return [
      ...(replace ? (['replace_suite'] as const) : []),
      'verify',
      'import',
    ]
  }
  return [
    'verify',
    ...(replace ? (['replace_suite'] as const) : []),
    'extract',
    'import',
  ]
})

const phaseLabels = computed(() =>
  phaseKeyOrder.value.map((k) => {
    if (k === 'replace_suite') return '卸载同套件包'
    if (k === 'verify') return livePreview.value?.mode === 'link' ? '校验清单' : '校验压缩包'
    if (k === 'extract') return '解压并写入插件目录'
    return '加载插件模块'
  }),
)

const steps = computed<Step[]>(() =>
  phaseLabels.value.map((label, i) => ({
    key: `${i}`,
    label,
    state: !props.saving
      ? 'pending'
      : i < phaseIndex.value
        ? 'done'
        : i === phaseIndex.value
          ? 'active'
          : 'pending',
  })),
)

const progressTitle = computed(() => {
  if (livePreview.value?.mode === 'link') return '正在外链插件…'
  return '正在安装插件…'
})

const progressSubtitle = computed(() => {
  const labels = phaseLabels.value
  const i = Math.min(phaseIndex.value, labels.length - 1)
  return labels[i] || '请稍候'
})

function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const sizeLabel = computed(() => formatBytes(livePreview.value?.sizeBytes))

const conflictHint = computed(() => {
  if (hasBundledSuiteConflict.value) {
    return '同套件存在随附插件冲突，无法导入'
  }
  const mode = livePreview.value?.mode
  const ex = livePreview.value?.existing
  const suite = livePreview.value?.suite
  const n = suiteConflicts.value.length
  if (n > 0) {
    const g = suite ? `套件「${suite}」` : '同套件'
    return `${g}已安装其它包，需先卸载再安装本包`
  }
  if (mode === 'link') {
    if (!ex) return '确认后以外链方式直接加载该文件夹（不复制到插件目录）'
    return `将覆盖已有「${ex.name}」，改为外链加载此文件夹`
  }
  if (!ex) return '确认后解压安装到本地插件目录（压缩包 ≤ 200MB）'
  return `将覆盖已有插件「${ex.name}」，启用状态尽量保留`
})

const confirmLabel = computed(() => {
  if (hasBundledSuiteConflict.value) return '无法导入'
  const mode = livePreview.value?.mode
  if (isSuiteChange.value) {
    return mode === 'link' ? '卸载并外链' : '卸载并安装'
  }
  const ex = livePreview.value?.existing
  if (mode === 'link') return ex ? '覆盖并外链' : '确认外链'
  return ex ? '覆盖安装' : '确认安装'
})

function packageOptionLabel(pkg: PluginSuitePackagePreview) {
  return `${pkg.name} (${pkg.id}) · v${pkg.version}`
}

function planSteps(preview: PluginImportPreview | null): StepDef[] {
  const confirm: StepDef = { id: 'confirm', label: '确认安装' }
  if (
    preview?.displayMode === 'suite' &&
    (preview.packages?.length || 0) > 1 &&
    preview.mode === 'zip'
  ) {
    return [{ id: 'target', label: '选择变体' }, confirm]
  }
  return [confirm]
}

function boot(preview: PluginImportPreview | null) {
  livePreview.value = preview
  selectedPackageId.value =
    preview?.displayMode === 'suite'
      ? preview.id ||
        preview.packages?.find((p) => p.id.endsWith('-universal'))?.id ||
        preview.packages?.[0]?.id ||
        ''
      : preview?.id || ''
  stepDefs.value = planSteps(preview)
  stepIndex.value = 0
  selecting.value = false
}

watch(
  () => [props.modelValue, props.preview] as const,
  ([open, preview]) => {
    if (!open) return
    boot(preview)
  },
  { immediate: true },
)

function clearPhaseTimer() {
  if (phaseTimer) {
    clearInterval(phaseTimer)
    phaseTimer = null
  }
}

watch(
  () => props.saving,
  (busy) => {
    clearPhaseTimer()
    livePhase.value = ''
    if (!busy) {
      phaseIndex.value = 0
      return
    }
    phaseIndex.value = 0
    phaseTimer = setInterval(() => {
      if (livePhase.value) return
      const max = Math.max(0, phaseLabels.value.length - 1)
      if (phaseIndex.value < max) phaseIndex.value += 1
    }, 4000)
  },
)

function applyProgress(p: PluginImportProgress) {
  livePhase.value = p.phase
  const idx = phaseKeyOrder.value.indexOf(p.phase)
  if (idx >= 0) phaseIndex.value = idx
}

onMounted(() => {
  stopProgress = window.navora?.plugins?.onImportProgress?.(applyProgress) || null
})
onUnmounted(() => {
  stopProgress?.()
  clearPhaseTimer()
})

function onDialogModel(v: boolean) {
  if (props.saving && !v) return
  emit('update:modelValue', v)
}

function goBack() {
  if (!canGoBack.value) return
  stepIndex.value = Math.max(0, stepIndex.value - 1)
}

async function goNextFromTarget() {
  if (!selectedPackageId.value || !livePreview.value?.sourcePath) return
  if (!window.navora?.plugins?.parsePath) {
    stepIndex.value = stepDefs.value.findIndex((s) => s.id === 'confirm')
    return
  }
  selecting.value = true
  try {
    const res = await window.navora.plugins.parsePath(livePreview.value.sourcePath, {
      packageId: selectedPackageId.value,
    })
    if (!res.ok || !res.preview) return
    livePreview.value = res.preview
    selectedPackageId.value = res.preview.id
    const confirmIdx = stepDefs.value.findIndex((s) => s.id === 'confirm')
    stepIndex.value = confirmIdx >= 0 ? confirmIdx : stepIndex.value + 1
  } finally {
    selecting.value = false
  }
}
</script>

<style scoped>
.import-body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.import-body.is-busy .step-pane {
  opacity: 0.55;
  filter: saturate(0.85);
  pointer-events: none;
}

.step-rail {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.step-rail-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  background: #eef3f7;
  color: #8a9aab;
  font-size: 0.75rem;
  font-weight: 600;
}
.step-rail-item.active {
  background: rgba(27, 79, 114, 0.12);
  color: #1b4f72;
}
.step-rail-item.done {
  color: #5d6d7e;
}
.step-rail-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  font-variant-numeric: tabular-nums;
  font-size: 0.72rem;
}
.step-rail-item.active .step-rail-num {
  background: #1b4f72;
  color: #fff;
}

.hero {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid #e0e7ee;
  background: linear-gradient(180deg, #f7fafc 0%, #fff 100%);
}
.hero-name {
  font-size: 1.05rem;
  font-weight: 750;
  color: #15202b;
  letter-spacing: -0.01em;
}
.hero-desc {
  margin: 6px 0 0;
  font-size: 0.88rem;
  line-height: 1.45;
  color: #3d5163;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef3f7;
  color: #5a6b7a;
  font-size: 0.75rem;
}
.field {
  margin-top: 12px;
}
.field-label {
  font-size: 0.78rem;
  font-weight: 650;
  color: #5a6b7a;
  margin-bottom: 6px;
}
.field-hint {
  margin: 8px 0 0;
  font-size: 0.8rem;
  line-height: 1.4;
  color: #5a6b7a;
}

.preview-card {
  border-radius: 12px;
  border: 1px solid #e0e7ee;
  background: #f8fafc;
  overflow: hidden;
  transition: opacity 0.2s ease;
}
.preview-head {
  padding: 14px 16px 12px;
  border-bottom: 1px solid #e8eef4;
}
.preview-title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.preview-name {
  font-size: 1.08rem;
  font-weight: 700;
  color: #15202b;
  line-height: 1.3;
}
.preview-ver {
  font-size: 0.78rem;
  font-weight: 600;
  color: #5d6d7e;
  font-variant-numeric: tabular-nums;
}
.preview-desc {
  margin: 8px 0 0;
  color: #5d6d7e;
  font-size: 0.88rem;
  line-height: 1.5;
}

.meta-grid {
  margin: 0;
  padding: 4px 0;
}
.meta-row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 10px 14px;
  align-items: baseline;
  padding: 8px 16px;
}
.meta-row + .meta-row {
  border-top: 1px solid #eef2f6;
}
.meta-row dt {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: #8a9aab;
  letter-spacing: 0.02em;
}
.meta-row dd {
  margin: 0;
  font-size: 0.86rem;
  color: #2c3a47;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-row dd.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  color: #3d4f5f;
}

@media (max-width: 600px) {
  .meta-row {
    grid-template-columns: 44px minmax(0, 1fr);
    padding: 8px 14px;
  }
  .meta-row dd,
  .meta-row dd.mono,
  .conflict-meta {
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .preview-head {
    padding: 12px 14px 10px;
  }
}

.conflict-box {
  margin: 0;
  padding: 12px 16px 14px;
  border-top: 1px solid #f0d6d2;
  background: #fdf6f5;
}
.suite-box {
  border-top-color: #f0c9a8;
  background: #fff8f1;
}
.suite-box.is-blocked {
  border-top-color: #f0d6d2;
  background: #fdf6f5;
}
.suite-item + .suite-item {
  margin-top: 8px;
}
.suite-hint {
  margin: 10px 0 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: #8a6a64;
}
.conflict-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: #c0392b;
  letter-spacing: 0.02em;
}
.suite-box:not(.is-blocked) .conflict-title {
  color: #b85c1a;
}
.conflict-body {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.conflict-name {
  font-size: 0.9rem;
  font-weight: 650;
  color: #15202b;
}
.conflict-meta {
  font-size: 0.76rem;
  color: #8a6a64;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress-panel {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid #d5e3ef;
  background: linear-gradient(180deg, #f7fbfe 0%, #eef5fb 100%);
}
.progress-spinner {
  width: 28px;
  height: 28px;
  margin-top: 2px;
  border-radius: 50%;
  border: 2.5px solid #c5d6e6;
  border-top-color: #1b4f72;
  animation: plugin-spin 0.75s linear infinite;
  flex-shrink: 0;
}
.progress-title {
  font-size: 0.92rem;
  font-weight: 650;
  color: #15202b;
}
.progress-steps {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.progress-step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: #8a9aab;
  transition: color 0.2s ease;
}
.progress-step.active {
  color: #1b4f72;
  font-weight: 600;
}
.progress-step.done {
  color: #2e7d4f;
}
.step-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #c5d0db;
  flex-shrink: 0;
}
.progress-step.active .step-dot {
  background: #1b4f72;
  box-shadow: 0 0 0 3px rgba(27, 79, 114, 0.18);
  animation: plugin-pulse 1.1s ease-in-out infinite;
}
.progress-step.done .step-dot {
  background: #2e7d4f;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

@keyframes plugin-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes plugin-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 3px rgba(27, 79, 114, 0.12);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(27, 79, 114, 0.22);
  }
}
</style>
