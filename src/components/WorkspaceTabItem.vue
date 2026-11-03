<template>
  <div class="workspace-tab-item" :class="{active:selected,selected,'is-loading':loading}" :draggable="draggable" role="presentation">
    <button :id="tabId" type="button" role="tab" :data-page-id="pageId" :data-file-key="fileKey" :aria-selected="selected" :aria-controls="controls" :aria-label="ariaLabel || label" :tabindex="selected?0:-1" :title="title || label" @click="$emit('select')">
      <img v-if="faviconUrl && failedFaviconUrl!==faviconUrl" class="workspace-tab-favicon" :src="faviconUrl" alt="" @error="failedFaviconUrl=faviconUrl" />
      <AppIcon v-else :icon="icon || (kind==='browser'?'globe':'file-lines')" class="workspace-tab-kind-icon" />
      <span>{{ label }}</span>
    </button>
    <button type="button" class="workspace-tab-close" :disabled="closeDisabled" :aria-label="closeLabel || `关闭 ${label}`" :title="`关闭 ${label}`" @click.stop="$emit('close')"><AppIcon icon="xmark" /></button>
  </div>
</template>

<script setup lang="ts">
import {ref,watch} from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const props=withDefaults(defineProps<{
  tabId?:string
  pageId?:string
  fileKey?:string
  controls?:string
  ariaLabel?:string
  label:string
  title?:string
  kind:'file'|'browser'
  icon?:string
  faviconUrl?:string
  loading?:boolean
  selected:boolean
  draggable?:boolean
  closeDisabled?:boolean
  closeLabel?:string
}>(),{draggable:false,closeDisabled:false})
defineEmits<{select:[];close:[]}>()
const failedFaviconUrl=ref('')
watch(()=>props.faviconUrl,()=>{failedFaviconUrl.value=''})
</script>

<style>
.workspace-tab-item{position:relative;display:flex;align-items:center;box-sizing:border-box;flex:0 1 210px;min-width:126px;max-width:228px;height:36px;overflow:hidden;border:1px solid #d5dce5;border-radius:9px;background:#f5f7fa;color:#53657b;transition:background-color 140ms ease,border-color 140ms ease,color 140ms ease,box-shadow 140ms ease}
.workspace-tab-item::before,.workspace-tab-item::after{position:absolute;z-index:0;pointer-events:none;content:""}
.workspace-tab-item::before{inset:0;background:linear-gradient(105deg,transparent 20%,rgba(74,132,190,.025) 34%,rgba(74,132,190,.14) 49%,rgba(74,132,190,.025) 64%,transparent 78%);opacity:0;transform:translateX(-65%)}
.workspace-tab-item::after{inset:auto auto 0 0;width:34%;height:2px;border-radius:0 2px 0 0;background:linear-gradient(90deg,rgba(61,119,180,.2),#4a84be 72%,rgba(61,119,180,.2));opacity:0;transform:translateX(-110%)}
.workspace-tab-item.is-loading::before{opacity:1;animation:workspace-tab-loading-sweep 1.8s ease-in-out infinite}
.workspace-tab-item.is-loading::after{opacity:1;animation:workspace-tab-loading-line 1.8s ease-in-out infinite}
.workspace-tab-item:hover{border-color:#bdcbd9;background:#edf2f7;color:#30465f}
.workspace-tab-item.active{border-color:#9eb5ce;background:#fff;color:#203a57;box-shadow:0 1px 3px rgba(35,52,72,.07)}
.workspace-tab-item>[role=tab]{display:flex;align-items:center;gap:8px;flex:1;min-width:0;height:100%;padding:0 5px 0 10px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;font:inherit;font-size:13px;font-weight:550;white-space:nowrap;cursor:pointer}
.workspace-tab-item>[role=tab],.workspace-tab-item>.workspace-tab-close{position:relative;z-index:1}
.workspace-tab-item>[role=tab]>span{overflow:hidden;text-overflow:ellipsis}
.workspace-tab-item .workspace-tab-kind-icon,.workspace-tab-item .workspace-tab-favicon{width:16px;height:16px;flex:0 0 16px;color:#5c7189;object-fit:contain}
.workspace-tab-item.active .workspace-tab-kind-icon{color:#3c648d}
.workspace-tab-item .workspace-tab-favicon{border-radius:3px}
.workspace-tab-item>.workspace-tab-close{display:grid;place-items:center;width:24px;height:24px;min-height:24px;flex:0 0 24px;margin:0 4px 0 0;padding:0;border:0;border-radius:6px;background:transparent;color:#65778d;opacity:0;transition:opacity 120ms ease,background-color 120ms ease,color 120ms ease;cursor:pointer}
.workspace-tab-item:is(:hover,.active,:focus-within)>.workspace-tab-close{opacity:1}
.workspace-tab-item>.workspace-tab-close:hover:not(:disabled){background:#fdebec;color:#b5323c}
.workspace-tab-item>.workspace-tab-close:focus-visible,.workspace-tab-item>[role=tab]:focus-visible{outline:2px solid #6487b1;outline-offset:-2px;opacity:1}
@keyframes workspace-tab-loading-sweep{0%{transform:translateX(-65%)}100%{transform:translateX(65%)}}
@keyframes workspace-tab-loading-line{0%{transform:translateX(-110%)}100%{transform:translateX(405%)}}
@media(prefers-reduced-motion:reduce){.workspace-tab-item,.workspace-tab-item>.workspace-tab-close{transition:none}.workspace-tab-item.is-loading::before{animation:none;opacity:.7;transform:none;background:rgba(74,132,190,.08)}.workspace-tab-item.is-loading::after{animation:none;opacity:1;transform:none;width:100%}}
</style>
