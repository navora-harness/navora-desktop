<template>
  <SkillDialogShell
    :model-value="modelValue"
    :kicker="storeLabel"
    :title="`浏览${storeLabel}`"
    :title-warning="titleWarning"
    :subtitle="dialogSubtitle"
    :max-width="720"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="store-body" :class="{ 'is-busy': busy }">
      <div class="toolbar">
        <v-text-field
          v-model="query"
          density="compact"
          hide-details
          clearable
          placeholder="搜索产品 / 包 id"
          variant="outlined"
          @keyup.enter="refresh"
        />
        <v-btn variant="tonal" :loading="busy === 'list'" @click="refresh">刷新</v-btn>
      </div>
      <div v-if="statusLine" class="status-line" :class="{ err: !reachable }">{{ statusLine }}</div>
      <div v-if="!products.length && !busy" class="empty">
        商店为空或不可达。请确认商店服务状态。
      </div>
      <div v-else class="product-list">
        <CatalogItemCard
          v-for="p in products"
          :key="`${p.kind}:${p.productId}`"
          :name="p.name"
          :id-line="catalogProductIdLine(p)"
          :description="p.description"
          :source-line="catalogProductSourceLine(p)"
          :tags="catalogProductTags(p)"
          clickable
          @click="openDetail(p)"
        >
          <template #actions>
            <v-btn
              v-if="!p.installed"
              size="small"
              color="primary"
              :disabled="!!busy"
              @click="openInstall(p)"
            >
              安装
            </v-btn>
            <v-btn
              v-else-if="productHasUpdate(p)"
              size="small"
              color="primary"
              variant="tonal"
              :disabled="!!busy"
              @click="openUpdate(p)"
            >
              更新
            </v-btn>
            <span v-else class="installed-label">已安装</span>
            <v-menu v-if="p.installed" location="bottom end">
              <template #activator="{ props: menuProps }">
                <v-btn
                  icon
                  variant="text"
                  size="small"
                  class="skill-more-btn"
                  aria-label="更多"
                  :disabled="!!busy"
                  v-bind="menuProps"
                >
                  <font-awesome-icon icon="ellipsis-vertical" />
                </v-btn>
              </template>
              <v-list density="compact" min-width="120">
                <v-list-item
                  title="更改"
                  :disabled="!canChangeVariantFor(p)"
                  @click="canChangeVariantFor(p) && openChange(p)"
                />
                <v-list-item title="卸载" base-color="error" @click="openUninstall(p)" />
              </v-list>
            </v-menu>
          </template>
        </CatalogItemCard>
      </div>
    </div>

    <template #actions>
      <v-spacer />
      <v-btn variant="text" :disabled="!!busy" @click="emit('update:modelValue', false)"
        >关闭</v-btn
      >
    </template>
  </SkillDialogShell>

  <SkillDeleteDialog
    v-model="uninstallOpen"
    :kicker="uninstallTarget?.kind === 'skill' ? '技能' : '插件'"
    :entity-label="uninstallTarget?.kind === 'skill' ? '技能' : '插件'"
    action-verb="卸载"
    :subtitle="
      uninstallTarget?.kind === 'skill'
        ? '卸载后将从本机移除该技能，请确认目标无误'
        : '卸载后将从本机移除该插件，请确认目标无误'
    "
    :skill-id="uninstallTarget?.installed?.packageId"
    :name="uninstallTarget?.installed?.name || uninstallTarget?.name"
    :description="uninstallTarget?.description"
    :saving="busy === 'uninstall'"
    @confirm="confirmUninstall"
    @cancel="uninstallOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { StoreCatalogProduct } from '@shared/store'
import { storeErrorText } from '@shared/store'
import {
  catalogProductIdLine,
  catalogProductSourceLine,
  catalogProductTags,
  productHasUpdate,
} from '@shared/store-catalog-view'
import { useStoreUi } from '@/composables/useStoreUi'
import CatalogItemCard from './CatalogItemCard.vue'
import SkillDialogShell from '../skills/SkillDialogShell.vue'
import SkillDeleteDialog from '../skills/SkillDeleteDialog.vue'

const props = defineProps<{
  modelValue: boolean
  kind?: 'plugin' | 'skill' | 'all'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  installed: []
}>()

const { openProductDetail, openInstaller, resolveTitleWarning, lastInstalledAt } = useStoreUi()

const busy = ref<'' | 'list' | 'uninstall'>('')
const query = ref('')
const products = ref<StoreCatalogProduct[]>([])
const reachable = ref(true)
const statusLine = ref('')
const storeBaseUrl = ref('')
const titleWarning = ref<string | undefined>()
const uninstallOpen = ref(false)
const uninstallTarget = ref<StoreCatalogProduct | null>(null)

const storeLabel = computed(() => (props.kind === 'skill' ? '技能商店' : '插件商店'))

const dialogSubtitle = computed(() => {
  if (!reachable.value) return statusLine.value || '商店不可达'
  return statusLine.value || ''
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      query.value = ''
      uninstallOpen.value = false
      uninstallTarget.value = null
      void refresh()
    }
  },
)

watch(lastInstalledAt, () => {
  if (props.modelValue) void refresh()
})

function canChangeVariantFor(p: StoreCatalogProduct): boolean {
  return Boolean(p.installed) && p.displayMode === 'suite' && p.packages.length > 1
}

async function refresh() {
  if (!window.navora?.store) {
    reachable.value = false
    storeBaseUrl.value = ''
    titleWarning.value = '未知第三方来源（当前商店连接未加密）'
    statusLine.value = '当前环境无商店接口'
    products.value = []
    return
  }
  busy.value = 'list'
  try {
    const st = await window.navora.store.status()
    storeBaseUrl.value = st.baseUrl || ''
    titleWarning.value = await resolveTitleWarning()
    reachable.value = st.reachable
    statusLine.value = st.reachable
      ? `${st.productCount} 个产品`
      : `商店不可达${st.error ? `（${storeErrorText(st.error)}）` : ''}`
    const res = await window.navora.store.list({
      kind: props.kind || 'all',
      q: query.value || undefined,
    })
    products.value = res.ok ? res.products || [] : []
    if (!res.ok && res.error) statusLine.value = storeErrorText(res.error)
  } finally {
    busy.value = ''
  }
}

function openDetail(p: StoreCatalogProduct) {
  void openProductDetail({ product: p, titleWarning: titleWarning.value })
}

function openInstall(p: StoreCatalogProduct) {
  void openInstaller({ product: p, intent: 'install', titleWarning: titleWarning.value })
}

function openUpdate(p: StoreCatalogProduct) {
  void openInstaller({ product: p, intent: 'update', titleWarning: titleWarning.value })
}

function openChange(p: StoreCatalogProduct) {
  void openInstaller({ product: p, intent: 'change', titleWarning: titleWarning.value })
}

function openUninstall(p: StoreCatalogProduct) {
  uninstallTarget.value = p
  uninstallOpen.value = true
}

async function confirmUninstall() {
  const p = uninstallTarget.value
  const id = p?.installed?.packageId
  if (!p || !id) return
  busy.value = 'uninstall'
  try {
    if (p.kind === 'plugin') {
      if (!window.navora?.plugins?.remove) return
      const res = await window.navora.plugins.remove(id)
      if (!res.ok) return
    } else {
      if (!window.navora?.skills?.remove) return
      await window.navora.skills.remove(id)
    }
    uninstallOpen.value = false
    uninstallTarget.value = null
    emit('installed')
    await refresh()
  } finally {
    busy.value = ''
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      uninstallOpen.value = false
      uninstallTarget.value = null
    }
  },
)

defineExpose({ refresh })
</script>

<style scoped>
.store-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 280px;
}
.store-body.is-busy {
  opacity: 0.85;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.status-line {
  font-size: 12px;
  opacity: 0.7;
}
.status-line.err {
  color: rgb(var(--v-theme-error));
  opacity: 1;
}
.empty {
  padding: 24px 8px;
  text-align: center;
  opacity: 0.65;
}
.product-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow: auto;
}
.installed-label {
  font-size: 0.75rem;
  color: #8a97a5;
  padding: 0 6px;
  white-space: nowrap;
}
.skill-more-btn {
  color: #5d6d7e !important;
}
</style>
