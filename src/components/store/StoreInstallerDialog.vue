<template>
  <SkillDialogShell
    :model-value="modelValue"
    :kicker="kindLabel"
    :title="shellTitle"
    :title-warning="titleWarning"
    :subtitle="shellSubtitle"
    :max-width="640"
    @update:model-value="onModel"
  >
    <div v-if="displayProduct" class="installer" :class="{ 'is-busy': isBusy }">
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

      <!-- Step: target -->
      <div v-if="currentStepId === 'target'" class="step-pane">
        <section class="hero">
          <div class="hero-name">{{ displayProduct.name }}</div>
          <p class="hero-desc selectable">{{ displayProduct.description || '（无描述）' }}</p>
          <div class="chip-row">
            <span class="chip mono">{{ displayProduct.productId }}</span>
            <span v-if="displayProduct.installed" class="chip mono">
              当前 {{ displayProduct.installed.packageId
              }}<template v-if="displayProduct.installed.version"
                >@{{ displayProduct.installed.version }}</template
              >
            </span>
          </div>
        </section>

        <div
          v-if="
            intent === 'change' ||
            (intent === 'install' && displayProduct.displayMode === 'suite')
          "
          class="field"
        >
          <div class="field-label">选择变体</div>
          <v-radio-group v-model="packageId" hide-details density="compact">
            <v-radio
              v-for="pkg in displayProduct.packages"
              :key="pkg.id"
              :value="pkg.id"
              :label="packageOptionLabel(pkg)"
              :disabled="intent === 'change' && pkg.id === displayProduct.installed?.packageId"
            />
          </v-radio-group>
          <p v-if="activePackage?.description" class="field-hint selectable">
            {{ activePackage.description }}
          </p>
        </div>

        <div v-else-if="intent === 'update'" class="field">
          <div class="field-label">当前包</div>
          <div class="mono package-line">{{ packageId }}</div>
        </div>

        <div class="field">
          <div class="field-label">版本</div>
          <v-select
            v-model="version"
            :items="versionItems"
            density="compact"
            hide-details
            variant="outlined"
          />
        </div>
      </div>

      <!-- Step: confirm -->
      <div v-else-if="currentStepId === 'confirm'" class="step-pane">
        <div v-if="previewLoading" class="docs-empty">正在预检安装…</div>
        <div v-else class="import-body">
          <div class="preview-card">
            <div class="preview-head">
              <div class="preview-title-row">
                <div class="preview-name">{{ preview?.name || displayProduct.name }}</div>
                <span v-if="preview?.version" class="preview-ver">v{{ preview.version }}</span>
              </div>
              <p class="preview-desc selectable">
                {{ preview?.description || displayProduct.description || '（无描述）' }}
              </p>
            </div>

            <dl class="meta-grid">
              <div class="meta-row">
                <dt>方式</dt>
                <dd>{{ modeLabel }}</dd>
              </div>
              <div class="meta-row">
                <dt>来源</dt>
                <dd>{{ storeSourceLabel }}</dd>
              </div>
              <div v-if="sizeLabel" class="meta-row">
                <dt>大小</dt>
                <dd>{{ sizeLabel }}</dd>
              </div>
              <div class="meta-row">
                <dt>标识</dt>
                <dd class="mono">{{ preview?.packageId || packageId || '—' }}</dd>
              </div>
              <div v-if="preview?.suite || displayProduct.displayMode === 'suite'" class="meta-row">
                <dt>套件</dt>
                <dd class="mono">{{ preview?.suite || displayProduct.productId }}</dd>
              </div>
            </dl>

            <div v-if="preview?.local?.sameId" class="conflict-box" role="status">
              <div class="conflict-title">将覆盖已有{{ kindLabel }}</div>
              <div class="conflict-body">
                <span class="conflict-name">{{ preview.local.sameId.name }}</span>
                <span class="conflict-meta">
                  id {{ preview.local.sameId.id
                  }}<template v-if="preview.local.sameId.version">
                    · v{{ preview.local.sameId.version }}</template
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
                  ><template v-if="c.bundled || c.kind === 'bundled'"> · 随附</template>
                </span>
              </div>
              <p v-if="!hasBundledSuiteConflict" class="suite-hint">
                点击「{{ confirmLabel }}」将先卸载上述包，再完成本次安装。
              </p>
              <p v-else class="suite-hint">请先在设置中处理随附包；或改用其它套件产品包。</p>
            </div>

            <div
              v-if="preview?.error && preview.ok === false"
              class="conflict-box suite-box is-blocked"
            >
              <div class="conflict-title">{{ previewErrorLabel }}</div>
            </div>

            <div v-if="preview?.yanked && preview.ok" class="conflict-box" role="status">
              <div class="conflict-title">该版本已标记下架，仍可按你的选择安装</div>
            </div>
          </div>

          <div v-if="busy === 'install'" class="progress-panel" role="status" aria-live="polite">
            <div class="progress-spinner" aria-hidden="true" />
            <div class="progress-copy">
              <div class="progress-title">{{ progressTitle }}</div>
              <div class="progress-steps">
                <div v-if="downloadSizeLabel" class="progress-bytes">{{ downloadSizeLabel }}</div>
                <div
                  v-for="step in progressSteps"
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
    </div>

    <template #actions>
      <v-btn
        v-if="canGoBack"
        variant="text"
        :disabled="isBusy"
        @click="goBack"
      >
        上一步
      </v-btn>
      <v-spacer />
      <v-btn variant="text" :disabled="isBusy" @click="emit('update:modelValue', false)"
        >取消</v-btn
      >
      <v-btn
        v-if="currentStepId === 'target'"
        color="primary"
        :disabled="!canContinueTarget || isBusy"
        :loading="busy === 'preview'"
        @click="goNextFromTarget"
      >
        继续
      </v-btn>
      <v-btn
        v-else
        color="primary"
        :loading="busy === 'install'"
        :disabled="
          isBusy ||
          previewLoading ||
          hasBundledSuiteConflict ||
          preview?.ok === false ||
          !preview
        "
        @click="runInstall"
      >
        {{ confirmLabel }}
      </v-btn>
    </template>
  </SkillDialogShell>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  StoreCatalogPackage,
  StoreCatalogProduct,
  StoreInstallProgress,
  StorePreviewInstallResult,
  StoreProgressPhase,
} from '@shared/store'
import { compareStoreVersions, latestPackageVersion, storeErrorText } from '@shared/store'
import type { StoreSelectIntent, StoreInstallerStepId } from '@/composables/useStoreUi'
import SkillDialogShell from '../skills/SkillDialogShell.vue'

type InstallerStepId = StoreInstallerStepId

const props = defineProps<{
  modelValue: boolean
  product: StoreCatalogProduct | null
  intent: StoreSelectIntent
  titleWarning?: string
  /** Override auto step plan (e.g. force confirm-only). */
  startStep?: InstallerStepId
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  installed: []
}>()

type StepDef = { id: InstallerStepId; label: string }
type StepState = 'pending' | 'active' | 'done'
type ProgressStep = { key: string; label: string; state: StepState }

const busy = ref<'' | 'preview' | 'install'>('')
const previewLoading = ref(false)
const packageId = ref('')
const version = ref('')
const preview = ref<StorePreviewInstallResult | null>(null)
const displayProduct = ref<StoreCatalogProduct | null>(null)
const displayIntent = ref<StoreSelectIntent>('install')
const stepDefs = ref<StepDef[]>([])
const stepIndex = ref(0)
const phaseIndex = ref(0)
const livePhase = ref<StoreProgressPhase | ''>('')
const liveBytes = ref<{ recv?: number; total?: number }>({})
let stopProgress: (() => void) | null = null
let phaseTimer: ReturnType<typeof setInterval> | null = null

const isBusy = computed(
  () => busy.value === 'preview' || busy.value === 'install' || previewLoading.value,
)
const intent = computed(() => displayIntent.value)
const kindLabel = computed(() => (displayProduct.value?.kind === 'skill' ? '技能' : '插件'))
const storeSourceLabel = computed(() =>
  displayProduct.value?.kind === 'skill' ? '技能商店' : '插件商店',
)
const currentStepId = computed(() => stepDefs.value[stepIndex.value]?.id || 'confirm')
const canGoBack = computed(
  () => stepIndex.value > 0 && currentStepId.value === 'confirm' && busy.value !== 'install',
)

const shellTitle = computed(() => {
  if (intent.value === 'change') return '更改套件'
  if (intent.value === 'update') return `更新${kindLabel.value}`
  return `安装${kindLabel.value}`
})

const shellSubtitle = computed(() => {
  if (busy.value === 'install') return progressSubtitle.value
  if (currentStepId.value === 'target') {
    if (intent.value === 'change') return '选择要切换的变体与版本'
    if (intent.value === 'update') return '选择要更新到的版本'
    if (displayProduct.value?.displayMode === 'suite') return '同套件只能保留一个变体'
    return '确认包与版本'
  }
  return conflictHint.value
})

const activePackage = computed(
  () => displayProduct.value?.packages.find((p) => p.id === packageId.value) || null,
)

const versionItems = computed(() => {
  const vers = activePackage.value?.versions || []
  const filtered =
    intent.value === 'update' && displayProduct.value?.installed?.version
      ? vers.filter(
          (v) =>
            compareStoreVersions(v.version, displayProduct.value!.installed!.version || '0') > 0,
        )
      : vers
  return filtered.map((v) => ({
    title: v.status === 'yanked' ? `${v.version}（已下架）` : v.version,
    value: v.version,
  }))
})

const canContinueTarget = computed(() => {
  if (!packageId.value || !version.value) return false
  if (intent.value === 'change' && packageId.value === displayProduct.value?.installed?.packageId) {
    return false
  }
  return true
})

const suiteConflicts = computed(() => preview.value?.local?.suiteConflicts || [])
const hasBundledSuiteConflict = computed(
  () =>
    Boolean(preview.value?.blockers?.includes('bundled_cannot_overwrite')) ||
    suiteConflicts.value.some((c) => c.bundled || c.kind === 'bundled'),
)
const isSuiteChange = computed(
  () =>
    intent.value === 'change' ||
    (suiteConflicts.value.length > 0 && !hasBundledSuiteConflict.value),
)

const modeLabel = computed(() => {
  if (intent.value === 'update') return '商店更新'
  if (intent.value === 'change') return '商店更改变体'
  return '商店安装'
})

const sizeLabel = computed(() => formatBytes(preview.value?.size))

const conflictHint = computed(() => {
  if (hasBundledSuiteConflict.value) return '同套件存在随附插件冲突，无法继续'
  const n = suiteConflicts.value.length
  const suite = preview.value?.suite
  if (n > 0) {
    const g = suite ? `套件「${suite}」` : '同套件'
    return `${g}已安装其它包，需先卸载再安装本包`
  }
  const ex = preview.value?.local?.sameId
  if (intent.value === 'update') {
    return ex
      ? `将更新「${ex.name}」到 v${preview.value?.version || ''}`
      : '确认后从商店下载并更新'
  }
  if (intent.value === 'change') return '确认后更换套件变体（同套件仅保留一个）'
  if (!ex) return '确认后从商店下载并安装到本地'
  return `将覆盖已有「${ex.name}」，启用状态尽量保留`
})

const confirmLabel = computed(() => {
  if (hasBundledSuiteConflict.value) return '无法安装'
  if (isSuiteChange.value) return '卸载并安装'
  if (intent.value === 'update') {
    return preview.value?.version ? `更新到 ${preview.value.version}` : '确认更新'
  }
  const ex = preview.value?.local?.sameId
  return ex ? '覆盖安装' : '确认安装'
})

const phaseKeys = computed<StoreProgressPhase[]>(() => {
  const replace = isSuiteChange.value
  return [
    'download',
    'verify',
    ...(replace ? (['replace_suite'] as const) : []),
    'extract',
    'import',
  ]
})

const phaseLabels = computed(() =>
  phaseKeys.value.map((k) => {
    if (k === 'replace_suite') return '卸载同套件包'
    if (k === 'download') return '下载商店包'
    if (k === 'verify') return '校验完整性'
    if (k === 'extract') {
      return displayProduct.value?.kind === 'skill' ? '解压技能包' : '解压并写入插件目录'
    }
    return `写入并加载${kindLabel.value}`
  }),
)

const previewErrorLabel = computed(() =>
  storeErrorText(preview.value?.error || preview.value?.blockers?.[0], {
    minHostVersion: preview.value?.minHostVersion,
  }),
)

const downloadSizeLabel = computed(() => {
  if (busy.value !== 'install' || livePhase.value !== 'download') return ''
  const recv = liveBytes.value.recv
  const total = liveBytes.value.total || preview.value?.size
  if (recv == null) return ''
  if (total) return `${formatBytes(recv)} / ${formatBytes(total)}`
  return formatBytes(recv)
})

const progressSteps = computed<ProgressStep[]>(() =>
  phaseLabels.value.map((label, i) => ({
    key: `${i}`,
    label,
    state:
      busy.value !== 'install'
        ? 'pending'
        : i < phaseIndex.value
          ? 'done'
          : i === phaseIndex.value
            ? 'active'
            : 'pending',
  })),
)

const progressTitle = computed(() => {
  if (intent.value === 'update') return `正在更新${kindLabel.value}…`
  if (intent.value === 'change') return '正在更改套件…'
  return `正在安装${kindLabel.value}…`
})

const progressSubtitle = computed(() => {
  const labels = phaseLabels.value
  const i = Math.min(phaseIndex.value, labels.length - 1)
  return labels[i] || '请稍候'
})

watch(
  () => props.product,
  (p) => {
    if (p) displayProduct.value = p
  },
  { immediate: true },
)

watch(
  () => [props.modelValue, props.product?.productId, props.intent, props.startStep] as const,
  ([open]) => {
    if (!open || !props.product) return
    void boot(props.product, props.intent, props.startStep)
  },
)

watch(packageId, () => {
  if (props.modelValue && currentStepId.value === 'target') syncDefaultVersion()
})

watch(
  () => busy.value === 'install',
  (installing) => {
    clearPhaseTimer()
    livePhase.value = ''
    liveBytes.value = {}
    if (!installing) {
      phaseIndex.value = 0
      return
    }
    phaseIndex.value = 0
    // Fallback only if主进程未推进度（例如旧远程）。
    phaseTimer = setInterval(() => {
      if (livePhase.value) return
      const max = Math.max(0, phaseLabels.value.length - 1)
      if (phaseIndex.value < max) phaseIndex.value += 1
    }, 4000)
  },
)

function applyProgress(p: StoreInstallProgress) {
  livePhase.value = p.phase
  liveBytes.value = { recv: p.bytesReceived, total: p.bytesTotal }
  const idx = phaseKeys.value.indexOf(p.phase)
  if (idx >= 0) phaseIndex.value = idx
}

onMounted(() => {
  stopProgress = window.navora?.store?.onProgress?.(applyProgress) || null
})
onUnmounted(() => {
  stopProgress?.()
  clearPhaseTimer()
})

function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function clearPhaseTimer() {
  if (phaseTimer) {
    clearInterval(phaseTimer)
    phaseTimer = null
  }
}

/** Decide installer steps: target may be skipped for simple single-package installs. */
function planInstallerSteps(
  product: StoreCatalogProduct,
  nextIntent: StoreSelectIntent,
  forceStart?: InstallerStepId,
): StepDef[] {
  const target: StepDef = {
    id: 'target',
    label: nextIntent === 'change' ? '选择变体' : nextIntent === 'update' ? '选择版本' : '选择目标',
  }
  const confirm: StepDef = {
    id: 'confirm',
    label: nextIntent === 'change' ? '确认更改' : nextIntent === 'update' ? '确认更新' : '确认安装',
  }

  if (forceStart === 'confirm') return [confirm]
  if (forceStart === 'target') return [target, confirm]

  const needsTarget =
    nextIntent === 'change' ||
    nextIntent === 'update' ||
    product.displayMode === 'suite' ||
    (product.packages[0]?.versions?.length || 0) > 1

  return needsTarget ? [target, confirm] : [confirm]
}

async function boot(
  product: StoreCatalogProduct,
  nextIntent: StoreSelectIntent,
  forceStart?: InstallerStepId,
) {
  displayProduct.value = product
  displayIntent.value = nextIntent
  preview.value = null
  busy.value = ''
  previewLoading.value = false
  stepDefs.value = planInstallerSteps(product, nextIntent, forceStart)
  stepIndex.value = 0
  initSelection(product, nextIntent)

  if (currentStepId.value === 'confirm') {
    await runPreview()
  }
}

function initSelection(product: StoreCatalogProduct, nextIntent: StoreSelectIntent) {
  if (nextIntent === 'update') {
    packageId.value = product.installed?.packageId || product.packages[0]?.id || ''
  } else if (nextIntent === 'change') {
    const other =
      product.packages.find((p) => p.id !== product.installed?.packageId) || product.packages[0]
    packageId.value = other?.id || ''
  } else if (product.displayMode === 'suite') {
    packageId.value =
      product.packages.find((x) => x.id.endsWith('-universal'))?.id ||
      product.packages[0]?.id ||
      ''
  } else {
    packageId.value = product.packages[0]?.id || product.productId
  }
  syncDefaultVersion()
}

function packageOptionLabel(pkg: StoreCatalogPackage) {
  const latest = latestPackageVersion(pkg)?.version
  const current = displayProduct.value?.installed?.packageId === pkg.id
  return `${pkg.name} (${pkg.id})${latest ? ` · ${latest}` : ''}${current ? ' · 当前' : ''}`
}

function syncDefaultVersion() {
  const items = versionItems.value
  if (!items.length) {
    version.value = ''
    return
  }
  if (intent.value === 'update') {
    version.value = items[0]?.value || ''
    return
  }
  const latest = latestPackageVersion(activePackage.value)
  const latestOk =
    latest && items.some((x) => x.value === latest.version) ? latest.version : ''
  version.value = latestOk || items[0]?.value || ''
}

function onModel(v: boolean) {
  if (busy.value === 'install' && !v) return
  emit('update:modelValue', v)
}

function goBack() {
  if (!canGoBack.value) return
  preview.value = null
  stepIndex.value = Math.max(0, stepIndex.value - 1)
}

async function goNextFromTarget() {
  if (!canContinueTarget.value) return
  const ok = await runPreview()
  if (!ok) return
  const confirmIdx = stepDefs.value.findIndex((s) => s.id === 'confirm')
  stepIndex.value = confirmIdx >= 0 ? confirmIdx : stepIndex.value + 1
}

async function runPreview(): Promise<boolean> {
  if (!displayProduct.value || !window.navora?.store) return false
  busy.value = 'preview'
  previewLoading.value = true
  try {
    const res = await window.navora.store.previewInstall({
      kind: displayProduct.value.kind,
      packageId: packageId.value,
      version: version.value,
    })
    preview.value = res
    return true
  } catch (e) {
    preview.value = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
    return false
  } finally {
    busy.value = ''
    previewLoading.value = false
  }
}

async function runInstall() {
  if (!preview.value || !window.navora?.store) return
  busy.value = 'install'
  try {
    const res = await window.navora.store.install({
      kind: preview.value.kind!,
      packageId: preview.value.packageId!,
      version: preview.value.version,
      overwrite: Boolean(preview.value.needsOverwrite),
      replaceSuite: Boolean(preview.value.needsReplaceSuite),
    })
    if (!res.ok) {
      preview.value = {
        ...preview.value,
        ok: false,
        error: res.error,
        local: {
          ...preview.value.local,
          suiteConflicts: res.suiteConflicts || preview.value.local?.suiteConflicts,
        },
      }
      return
    }
    preview.value = null
    emit('installed')
    emit('update:modelValue', false)
  } finally {
    busy.value = ''
  }
}
</script>

<style scoped>
.installer {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.installer.is-busy .step-pane {
  opacity: 0.72;
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
.package-line {
  font-size: 0.85rem;
  color: #243447;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7fafc;
  border: 1px solid #e8eef3;
}
.docs-empty {
  padding: 28px 16px;
  text-align: center;
  color: #8a9aab;
  font-size: 0.9rem;
}
.import-body {
  position: relative;
}
.preview-card {
  border-radius: 12px;
  border: 1px solid #e0e7ee;
  background: #f8fafc;
  overflow: hidden;
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
.conflict-box {
  margin: 0;
  padding: 12px 16px 14px;
  border-top: 1px solid #e8eef4;
  background: #fff8ef;
}
.conflict-box.is-blocked {
  background: #fdf2f0;
}
.conflict-title {
  font-size: 0.84rem;
  font-weight: 700;
  color: #8a5a00;
  margin-bottom: 6px;
}
.conflict-box.is-blocked .conflict-title {
  color: #c0392b;
}
.conflict-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.82rem;
  color: #5d6d7e;
}
.conflict-name {
  font-weight: 650;
  color: #2c3a47;
}
.conflict-meta {
  font-size: 0.76rem;
  opacity: 0.85;
}
.suite-item + .suite-item {
  margin-top: 8px;
}
.suite-hint {
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: #7a8a99;
  line-height: 1.45;
}
.progress-panel {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid #e0e7ee;
  background: #fff;
}
.progress-spinner {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border: 2px solid rgba(27, 79, 114, 0.2);
  border-top-color: #1b4f72;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}
.progress-title {
  font-size: 0.88rem;
  font-weight: 650;
  color: #15202b;
  margin-bottom: 8px;
}
.progress-bytes {
  font-size: 0.75rem;
  color: #5d6d7e;
  font-variant-numeric: tabular-nums;
  margin-bottom: 8px;
}
.progress-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.progress-step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: #8a9aab;
}
.progress-step.active {
  color: #1b4f72;
  font-weight: 600;
}
.progress-step.done {
  color: #5d6d7e;
}
.step-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #d5dee7;
  flex-shrink: 0;
}
.progress-step.active .step-dot {
  background: #1b4f72;
}
.progress-step.done .step-dot {
  background: #7f8c8d;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
