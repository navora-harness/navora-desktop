import { computed, ref } from 'vue'
import type { StoreCatalogProduct, StoreKind } from '@shared/store'

export type StoreSelectIntent = 'install' | 'update' | 'change'
export type StoreInstallerStepId = 'target' | 'confirm'

export type StoreBrowseRequest = {
  kind?: StoreKind | 'all'
}

export type StoreProductDetailRequest = {
  product: StoreCatalogProduct
  /** Yellow warning next to title (e.g. non-HTTPS store). */
  titleWarning?: string
}

/** Unified store installer (multi-step wizard in one window). */
export type StoreInstallerRequest = {
  product: StoreCatalogProduct
  intent: StoreSelectIntent
  titleWarning?: string
  /** Force starting step; default is auto (1 or 2 steps). */
  startStep?: StoreInstallerStepId
}

/** @deprecated Use StoreInstallerRequest */
export type StoreSelectTargetRequest = StoreInstallerRequest

const browseOpen = ref(false)
const browseKind = ref<StoreKind | 'all'>('plugin')

const detailOpen = ref(false)
const detailReq = ref<StoreProductDetailRequest | null>(null)

const installerOpen = ref(false)
const installerReq = ref<StoreInstallerRequest | null>(null)

const lastInstalledAt = ref(0)
const installedListeners = new Set<() => void>()

function isInsecureStoreUrl(baseUrl: string | undefined | null): boolean {
  const u = String(baseUrl || '').trim().toLowerCase()
  if (!u) return true
  return !u.startsWith('https:')
}

async function resolveTitleWarning(): Promise<string | undefined> {
  try {
    const st = await window.navora?.store?.status?.()
    if (isInsecureStoreUrl(st?.baseUrl)) {
      return '未知第三方来源（当前商店连接未加密）'
    }
  } catch {
    return '未知第三方来源（当前商店连接未加密）'
  }
  return undefined
}

/**
 * Programmatic store UI: browse / product detail / installer wizard.
 * Mount `<StoreUiHost />` once (e.g. App.vue).
 */
export function useStoreUi() {
  function openBrowse(opts?: StoreBrowseRequest) {
    browseKind.value = opts?.kind || 'plugin'
    browseOpen.value = true
  }

  function closeBrowse() {
    browseOpen.value = false
  }

  async function openProductDetail(input: StoreProductDetailRequest) {
    const titleWarning =
      input.titleWarning !== undefined ? input.titleWarning : await resolveTitleWarning()
    detailReq.value = { product: input.product, titleWarning }
    detailOpen.value = true
  }

  async function openProductDetailById(kind: StoreKind, productId: string) {
    const id = String(productId || '').trim()
    if (!id) throw new Error('product_id_required')
    const res = await window.navora?.store?.get?.(id, kind)
    if (!res?.ok) throw new Error(res?.error || 'store_list_failed')
    const product = res.product
    if (!product) throw new Error('product_not_found')
    await openProductDetail({ product })
    return product
  }

  function closeProductDetail() {
    detailOpen.value = false
  }

  function clearDetailReq() {
    detailReq.value = null
  }

  /** Open the multi-step store installer (select target → confirm, or confirm-only). */
  async function openInstaller(input: StoreInstallerRequest) {
    const titleWarning =
      input.titleWarning !== undefined ? input.titleWarning : await resolveTitleWarning()
    installerReq.value = {
      product: input.product,
      intent: input.intent,
      titleWarning,
      startStep: input.startStep,
    }
    installerOpen.value = true
  }

  async function openInstallerById(
    kind: StoreKind,
    productId: string,
    intent: StoreSelectIntent,
    startStep?: StoreInstallerStepId,
  ) {
    const id = String(productId || '').trim()
    if (!id) throw new Error('product_id_required')
    const res = await window.navora?.store?.get?.(id, kind)
    if (!res?.ok) throw new Error(res?.error || 'store_list_failed')
    const product = res.product
    if (!product) throw new Error('product_not_found')
    await openInstaller({ product, intent, startStep })
    return product
  }

  function closeInstaller() {
    installerOpen.value = false
  }

  function clearInstallerReq() {
    installerReq.value = null
  }

  /** @deprecated Use openInstaller */
  async function openSelectTarget(input: StoreInstallerRequest) {
    return openInstaller(input)
  }

  /** @deprecated Use openInstallerById */
  async function openSelectTargetById(
    kind: StoreKind,
    productId: string,
    intent: StoreSelectIntent,
  ) {
    return openInstallerById(kind, productId, intent)
  }

  function closeSelectTarget() {
    closeInstaller()
  }

  function clearSelectReq() {
    clearInstallerReq()
  }

  function notifyInstalled() {
    lastInstalledAt.value = Date.now()
    for (const fn of installedListeners) {
      try {
        fn()
      } catch (e) {
        console.warn('[store-ui] installed listener failed', e)
      }
    }
  }

  function onInstalled(fn: () => void) {
    installedListeners.add(fn)
    return () => installedListeners.delete(fn)
  }

  /** Refresh product snapshot inside an open detail dialog after install/uninstall. */
  function patchDetailProduct(product: StoreCatalogProduct | null) {
    if (!detailReq.value) return
    if (!product) {
      detailOpen.value = false
      return
    }
    detailReq.value = { ...detailReq.value, product }
  }

  return {
    browseOpen,
    browseKind: computed(() => browseKind.value),
    detailOpen,
    detailReq: computed(() => detailReq.value),
    installerOpen,
    installerReq: computed(() => installerReq.value),
    /** @deprecated alias of installerOpen */
    selectOpen: installerOpen,
    /** @deprecated alias of installerReq */
    selectReq: computed(() => installerReq.value),
    lastInstalledAt: computed(() => lastInstalledAt.value),
    openBrowse,
    closeBrowse,
    openProductDetail,
    openProductDetailById,
    closeProductDetail,
    clearDetailReq,
    openInstaller,
    openInstallerById,
    closeInstaller,
    clearInstallerReq,
    openSelectTarget,
    openSelectTargetById,
    closeSelectTarget,
    clearSelectReq,
    notifyInstalled,
    onInstalled,
    patchDetailProduct,
    resolveTitleWarning,
  }
}
