<template>
  <v-menu v-model="open" :location="location" :offset="6" :content-class="['ui-action-menu-overlay',{'browser-default-cursor':defaultCursor}]" @update:model-value="emit('open', $event)">
    <template #activator="{ props: trigger }">
      <button v-bind="trigger" type="button" class="ui-icon-button" :aria-label="label" :title="label" :disabled="disabled"><AppIcon :icon="icon" /></button>
    </template>
    <div class="ui-action-menu" role="menu" :aria-label="label" @keydown="onKey">
      <template v-for="item in items" :key="item.id">
        <div v-if="item.divider" class="ui-menu-divider" role="separator" />
        <button type="button" role="menuitem" :class="{danger:item.danger}" :disabled="item.disabled" :title="item.reason" @click="emit('select',item.id)"><AppIcon v-if="item.icon" :icon="item.icon" /><span>{{ item.label }}</span></button>
      </template>
    </div>
  </v-menu>
</template>
<script setup lang="ts">
import {ref} from 'vue'
import AppIcon from './icons/AppIcon.vue'
export type ActionMenuItem={id:string;label:string;icon?:string;disabled?:boolean;reason?:string;danger?:boolean;divider?:boolean}
withDefaults(defineProps<{label:string;items:ActionMenuItem[];disabled?:boolean;icon?:string;location?:'bottom end'|'bottom start'|'top start';defaultCursor?:boolean}>(),{icon:'ellipsis',location:'bottom end',defaultCursor:false})
const emit=defineEmits<{select:[id:string];open:[value:boolean]}>(),open=ref(false)
function onKey(event:KeyboardEvent){
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
  event.preventDefault();event.stopPropagation()
  const buttons=[...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  if(!buttons.length)return
  const at=buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:at<0?(event.key==='ArrowUp'?buttons.length-1:0):(at+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length
  buttons[next]?.focus()
}
</script>
