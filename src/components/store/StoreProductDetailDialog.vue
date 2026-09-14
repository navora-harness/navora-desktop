<template>
  <SkillDialogShell
    :model-value="modelValue"
    :kicker="kindLabel"
    title="产品详情"
    :title-warning="titleWarning"
    :subtitle="subtitle"
    :max-width="780"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="displayProduct" class="detail-body" :class="{ 'is-busy': busy }">
      <section class="hero">
        <div class="hero-top">
          <h3 class="hero-name">{{ displayProduct.name }}</h3>
          <span v-if="displayProduct.displayMode === 'suite'" class="pill suite"
            >套件 · {{ displayProduct.packages.length }}</span
          >
          <span v-else-if="displayProduct.installed" class="pill ok">已安装</span>
        </div>
        <p class="hero-desc selectable">{{ displayProduct.description || '（无描述）' }}</p>
        <div class="chip-row">
          <span class="chip mono">{{ displayProduct.productId }}</span>
          <span v-if="displayProduct.installed" class="chip mono">
            已装 {{ displayProduct.installed.packageId
            }}<template v-if="displayProduct.installed.version"
              >@{{ displayProduct.installed.version }}</template
            >
          </span>
          <span v-if="updateTargetVersion" class="chip mono accent"
            >最新 {{ updateTargetVersion }}</span
          >
        </div>
      </section>

      <section v-if="displayProduct.displayMode === 'suite'" class="variants">
        <div class="section-label">套件变体</div>
        <div class="variant-list">
          <div
            v-for="pkg in displayProduct.packages"
            :key="pkg.id"
            class="variant-item"
            :class="{ current: displayProduct.installed?.packageId === pkg.id }"
          >
            <div class="variant-head">
              <span class="variant-name">{{ pkg.name }}</span>
              <span v-if="displayProduct.installed?.packageId === pkg.id" class="pill">当前</span>
            </div>
            <div class="variant-meta mono">
              {{ pkg.id }} · {{ latestPackageVersion(pkg)?.version || '—' }}
            </div>
            <p v-if="pkg.description" class="variant-desc selectable">{{ pkg.description }}</p>
          </div>
        </div>
      </section>

      <section class="docs-panel">
        <div class="docs-bar">
          <span>产品说明</span>
          <span v-if="docsFileName" class="docs-bar-hint">{{ docsFileName }}</span>
          <span v-else-if="docsPackageId" class="docs-bar-hint mono">{{ docsPackageId }}</span>
        </div>
        <div v-if="docsLoading" class="docs-empty">加载说明…</div>
        <div v-else-if="docsHtml" class="md-body selectable" v-html="docsHtml" />
        <div v-else class="docs-empty">{{ docsEmptyText }}</div>
      </section>
    </div>

    <template #actions>
      <v-spacer />
      <template v-if="displayProduct">
        <span v-if="displayProduct.installed && !hasUpdate" class="footer-installed">已安装</span>
        <v-menu v-if="displayProduct.installed" location="top">
          <template #activator="{ props: menuProps }">
            <v-btn
              icon
              variant="text"
              aria-label="更多"
              :disabled="busy"
              v-bind="menuProps"
            >
              <font-awesome-icon icon="ellipsis-vertical" />
            </v-btn>
          </template>
          <v-list density="compact" min-width="120">
            <v-list-item
              title="更改"
              :disabled="!canChange"
              @click="canChange && emit('change')"
            />
            <v-list-item title="卸载" base-color="error" @click="emit('uninstall')" />
          </v-list>
        </v-menu>
        <v-btn
          v-if="hasUpdate"
          color="primary"
          variant="tonal"
          :disabled="busy"
          @click="emit('update')"
        >
          更新
        </v-btn>
        <v-btn
          v-if="!displayProduct.installed"
          color="primary"
          :disabled="busy"
          @click="emit('install')"
        >
          安装
        </v-btn>
      </template>
      <v-btn variant="text" :disabled="busy" @click="emit('update:modelValue', false)"
        >关闭</v-btn
      >
    </template>
  </SkillDialogShell>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { StoreCatalogPackage, StoreCatalogProduct } from '@shared/store'
import { compareStoreVersions, latestPackageVersion, storeErrorText } from '@shared/store'
import SkillDialogShell from '../skills/SkillDialogShell.vue'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps<{
  modelValue: boolean
  product: StoreCatalogProduct | null
  titleWarning?: string
  /** True while an async action (e.g. uninstall) is in progress. */
  busy?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  install: []
  update: []
  change: []
  uninstall: []
}>()

const docsLoading = ref(false)
const docsHtml = ref('')
const docsFileName = ref('')
const docsPackageId = ref('')
const docsError = ref('')
/** Keep last product for close animation so content does not vanish mid-fade. */
const displayProduct = ref<StoreCatalogProduct | null>(null)

const kindLabel = computed(() => (displayProduct.value?.kind === 'skill' ? '技能' : '插件'))

const subtitle = computed(() => {
  if (displayProduct.value?.displayMode === 'suite') return '同套件只能保留一个变体'
  return displayProduct.value?.kind === 'skill' ? '查看技能商店产品' : '查看插件商店产品'
})

const updateTargetVersion = computed(() => {
  const p = displayProduct.value
  if (!p?.installed?.packageId) return ''
  const pkg = p.packages.find((x) => x.id === p.installed!.packageId)
  const latest = latestPackageVersion(pkg)
  if (!latest) return ''
  if (!p.installed.version) return latest.version
  return compareStoreVersions(latest.version, p.installed.version) > 0 ? latest.version : ''
})

const hasUpdate = computed(() => Boolean(updateTargetVersion.value))

const canChange = computed(
  () =>
    Boolean(displayProduct.value?.installed) &&
    displayProduct.value?.displayMode === 'suite' &&
    (displayProduct.value?.packages.length || 0) > 1,
)

const docsEmptyText = computed(() => docsError.value || '暂无产品说明')

watch(
  () => props.product,
  (p) => {
    if (p) displayProduct.value = p
  },
  { immediate: true },
)

watch(
  () => [props.modelValue, props.product?.productId, props.product?.kind] as const,
  ([open]) => {
    if (open && props.product) {
      displayProduct.value = props.product
      void loadDocs(props.product)
    }
    // Do not clear content on close — parent clears after leave animation.
  },
)

function pickDocsPackage(p: StoreCatalogProduct): StoreCatalogPackage | null {
  const pkgs = p.packages || []
  const withDocs = (pkg: StoreCatalogPackage) =>
    Boolean(latestPackageVersion(pkg)?.hasReadme && latestPackageVersion(pkg)?.readmePath)
  if (p.installed?.packageId) {
    const installed = pkgs.find((x) => x.id === p.installed!.packageId)
    if (installed && withDocs(installed)) return installed
  }
  const universal = pkgs.find((x) => x.id.endsWith('-universal') && withDocs(x))
  if (universal) return universal
  return pkgs.find((x) => withDocs(x)) || pkgs[0] || null
}

async function loadDocs(p: StoreCatalogProduct) {
  docsLoading.value = true
  docsHtml.value = ''
  docsFileName.value = ''
  docsPackageId.value = ''
  docsError.value = ''
  try {
    if (!window.navora?.store?.readDocs) {
      docsError.value = '当前客户端缺少说明接口，请重启 Electron'
      return
    }
    const pkg = pickDocsPackage(p)
    if (!pkg) {
      docsError.value = storeErrorText('readme_not_found')
      return
    }
    const latest = latestPackageVersion(pkg)
    docsPackageId.value = pkg.id
    const res = await window.navora.store.readDocs({
      kind: p.kind,
      packageId: pkg.id,
      version: latest?.version,
    })
    if (!res.ok || !res.markdown) {
      docsError.value = storeErrorText(res.error || 'readme_not_found')
      return
    }
    docsFileName.value = res.fileName || ''
    docsHtml.value = renderMarkdown(res.markdown)
  } catch (e) {
    docsError.value = storeErrorText(e instanceof Error ? e.message : String(e))
  } finally {
    docsLoading.value = false
  }
}
</script>

<style scoped>
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.detail-body.is-busy {
  opacity: 0.72;
  pointer-events: none;
}
.hero {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid #e0e7ee;
  background: linear-gradient(180deg, #f7fafc 0%, #fff 100%);
}
.hero-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.hero-name {
  margin: 0;
  font-size: 1.12rem;
  font-weight: 750;
  color: #15202b;
  letter-spacing: -0.015em;
  line-height: 1.25;
}
.hero-desc {
  margin: 8px 0 0;
  font-size: 0.9rem;
  line-height: 1.5;
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
.chip.accent {
  background: rgba(27, 79, 114, 0.1);
  color: #1b4f72;
}
.pill {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(27, 79, 114, 0.12);
  color: #1b4f72;
  font-weight: 650;
}
.pill.suite {
  background: #eef3f7;
  color: #3d5163;
}
.pill.ok {
  background: rgba(46, 125, 50, 0.12);
  color: #2e7d32;
}
.section-label {
  font-size: 0.78rem;
  font-weight: 650;
  color: #5a6b7a;
  margin-bottom: 8px;
}
.variant-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.variant-item {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #e0e7ee;
  background: #fff;
}
.variant-item.current {
  border-color: rgba(27, 79, 114, 0.4);
  background: rgba(27, 79, 114, 0.04);
}
.variant-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.variant-name {
  font-weight: 650;
  font-size: 0.88rem;
  color: #15202b;
}
.variant-meta {
  margin-top: 3px;
  font-size: 0.72rem;
  color: #8a9aab;
}
.variant-desc {
  margin: 6px 0 0;
  font-size: 0.8rem;
  line-height: 1.4;
  color: #5a6b7a;
}
.docs-panel {
  border: 1px solid #e0e7ee;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.docs-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #e8eef3;
  background: #f7fafc;
  font-size: 0.78rem;
  font-weight: 650;
  color: #3d5163;
}
.docs-bar-hint {
  font-weight: 500;
  color: #8a9aab;
  font-size: 0.72rem;
}
.docs-empty {
  padding: 28px 16px;
  text-align: center;
  color: #8a9aab;
  font-size: 0.9rem;
}
.md-body {
  max-height: min(42vh, 420px);
  overflow: auto;
  padding: 14px 16px 18px;
  font-size: 0.92rem;
  line-height: 1.55;
  color: #243447;
}
.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3) {
  margin: 0.85em 0 0.4em;
  line-height: 1.25;
  color: #15202b;
}
.md-body :deep(h1) {
  font-size: 1.2rem;
}
.md-body :deep(h2) {
  font-size: 1.05rem;
}
.md-body :deep(h3) {
  font-size: 0.98rem;
}
.md-body :deep(p),
.md-body :deep(ul),
.md-body :deep(ol) {
  margin: 0.45em 0;
}
.md-body :deep(ul),
.md-body :deep(ol) {
  padding-left: 1.3em;
}
.md-body :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.86em;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: #eef3f7;
}
.md-body :deep(pre) {
  overflow: auto;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f3f7fa;
  border: 1px solid #e4ebf1;
}
.md-body :deep(pre code) {
  padding: 0;
  background: transparent;
}
.md-body :deep(a) {
  color: #1f6feb;
}
.md-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid #e0e7ee;
  padding: 6px 8px;
  text-align: left;
}
.footer-installed {
  font-size: 13px;
  color: rgba(21, 32, 43, 0.55);
  margin-right: 4px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
