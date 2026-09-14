<template>
  <div v-if="items.length" class="catalog-item-list" @click.stop>
    <CatalogItemCard
      v-for="item in items"
      :key="item.key"
      :name="item.name"
      :id-line="item.idLine"
      :description="item.description"
      :source-line="item.sourceLine"
      :tags="item.tags"
      :clickable="item.canOpen"
      @click="item.canOpen && openDetail(item)"
    >
      <template v-if="item.canInstall || item.canUpdate" #actions>
        <v-btn
          v-if="item.canInstall"
          size="small"
          color="primary"
          :disabled="busy"
          @click="openInstall(item, 'install')"
        >
          安装
        </v-btn>
        <v-btn
          v-else
          size="small"
          color="primary"
          variant="tonal"
          :disabled="busy"
          @click="openInstall(item, 'update')"
        >
          更新
        </v-btn>
      </template>
    </CatalogItemCard>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatMessage } from '@shared/types'
import type { StoreKind } from '@shared/store'
import { parseCatalogToolItems, type CatalogToolItem } from '@shared/store-catalog-view'
import { useStoreUi } from '@/composables/useStoreUi'
import CatalogItemCard from './CatalogItemCard.vue'

const props = defineProps<{
  message: ChatMessage
}>()

const { openProductDetailById, openInstallerById } = useStoreUi()
const busy = ref(false)

const items = computed(() => parseCatalogToolItems(props.message))

async function openDetail(item: CatalogToolItem) {
  if (!item.kind || !item.productId) return
  busy.value = true
  try {
    await openProductDetailById(item.kind, item.productId)
  } catch {
    /* store may be unreachable */
  } finally {
    busy.value = false
  }
}

async function openInstall(item: CatalogToolItem, intent: 'install' | 'update') {
  if (!item.kind || !item.productId) return
  busy.value = true
  try {
    await openInstallerById(item.kind as StoreKind, item.productId, intent)
  } catch {
    /* store may be unreachable */
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.catalog-item-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 10px 12px 12px;
}
</style>
