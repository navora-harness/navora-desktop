<template>
  <StoreBrowseDialog
    v-model="browseOpen"
    :kind="browseKind"
    @installed="onAnyInstalled"
  />
  <StoreProductDetailDialog
    v-model="detailOpen"
    :product="detailReq?.product || null"
    :title-warning="detailReq?.titleWarning"
    :busy="detailBusy === 'uninstall'"
    @install="onDetailInstall"
    @update="onDetailUpdate"
    @change="onDetailChange"
    @uninstall="onDetailUninstall"
  />
  <StoreInstallerDialog
    v-model="installerOpen"
    :product="installerReq?.product || null"
    :intent="installerReq?.intent || 'install'"
    :title-warning="installerReq?.titleWarning"
    :start-step="installerReq?.startStep"
    @installed="onInstallerInstalled"
  />
  <SkillDeleteDialog
    v-model="uninstallOpen"
    :kicker="detailReq?.product?.kind === 'skill' ? '技能' : '插件'"
    :entity-label="detailReq?.product?.kind === 'skill' ? '技能' : '插件'"
    action-verb="卸载"
    :subtitle="
      detailReq?.product?.kind === 'skill'
        ? '卸载后将从本机移除该技能，请确认目标无误'
        : '卸载后将从本机移除该插件，请确认目标无误'
    "
    :skill-id="detailReq?.product?.installed?.packageId"
    :name="detailReq?.product?.installed?.name || detailReq?.product?.name"
    :description="detailReq?.product?.description"
    :saving="detailBusy === 'uninstall'"
    @confirm="confirmUninstall"
    @cancel="uninstallOpen = false"
  />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useStoreUi } from '@/composables/useStoreUi'
import SkillDeleteDialog from '../skills/SkillDeleteDialog.vue'
import StoreBrowseDialog from './StoreBrowseDialog.vue'
import StoreInstallerDialog from './StoreInstallerDialog.vue'
import StoreProductDetailDialog from './StoreProductDetailDialog.vue'

const CLEAR_AFTER_MS = 320

const {
  browseOpen,
  browseKind,
  detailOpen,
  detailReq,
  installerOpen,
  installerReq,
  openInstaller,
  notifyInstalled,
  patchDetailProduct,
  clearDetailReq,
  clearInstallerReq,
} = useStoreUi()

const uninstallOpen = ref(false)
const detailBusy = ref<'' | 'uninstall'>('')

watch(detailOpen, (open) => {
  if (open) return
  window.setTimeout(() => {
    if (!detailOpen.value) clearDetailReq()
  }, CLEAR_AFTER_MS)
})

watch(installerOpen, (open) => {
  if (open) return
  window.setTimeout(() => {
    if (!installerOpen.value) clearInstallerReq()
  }, CLEAR_AFTER_MS)
})

function onAnyInstalled() {
  notifyInstalled()
  void refreshDetailProduct()
}

function onInstallerInstalled() {
  notifyInstalled()
  void refreshDetailProduct()
}

async function refreshDetailProduct() {
  const cur = detailReq.value?.product
  if (!cur || !window.navora?.store?.list) return
  try {
    const res = await window.navora.store.list({ kind: cur.kind })
    const next = (res.products || []).find(
      (p) => p.kind === cur.kind && p.productId === cur.productId,
    )
    patchDetailProduct(next || null)
  } catch {
    /* ignore */
  }
}

function onDetailInstall() {
  const p = detailReq.value?.product
  if (!p) return
  void openInstaller({
    product: p,
    intent: 'install',
    titleWarning: detailReq.value?.titleWarning,
  })
}

function onDetailUpdate() {
  const p = detailReq.value?.product
  if (!p) return
  void openInstaller({
    product: p,
    intent: 'update',
    titleWarning: detailReq.value?.titleWarning,
  })
}

function onDetailChange() {
  const p = detailReq.value?.product
  if (!p) return
  void openInstaller({
    product: p,
    intent: 'change',
    titleWarning: detailReq.value?.titleWarning,
  })
}

function onDetailUninstall() {
  if (!detailReq.value?.product?.installed?.packageId) return
  uninstallOpen.value = true
}

async function confirmUninstall() {
  const p = detailReq.value?.product
  const id = p?.installed?.packageId
  if (!p || !id) return
  detailBusy.value = 'uninstall'
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
    notifyInstalled()
    await refreshDetailProduct()
  } finally {
    detailBusy.value = ''
  }
}
</script>
