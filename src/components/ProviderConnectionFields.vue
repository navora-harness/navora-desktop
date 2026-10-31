<template>
  <v-text-field v-if="showName" v-model="provider.label" label="显示名称" class="span-2" />
  <v-text-field v-model="provider.base_url" label="Base URL" class="span-2" />
  <v-text-field
    :model-value="keyDraft"
    :label="keyLabel"
    :placeholder="keyPlaceholder"
    type="password"
    autocomplete="off"
    class="span-2"
    @update:model-value="emit('update:keyDraft', $event)"
  ><template #append-inner><slot name="key-actions" /></template></v-text-field>
  <v-select v-if="showModel" v-model="provider.model" :items="provider.models" label="默认模型" class="span-2" :menu-props="{contentClass:'navora-select-menu'}" hide-details />
</template>
<script setup lang="ts">
import type { AiProviderConfig } from '@shared/config'
withDefaults(defineProps<{ provider:AiProviderConfig; keyDraft:string; keyLabel:string; keyPlaceholder?:string; showName?:boolean; showModel?:boolean }>(), { showName:true, showModel:false, keyPlaceholder:'' })
const emit = defineEmits<{ 'update:keyDraft':[value:string] }>()
</script>
