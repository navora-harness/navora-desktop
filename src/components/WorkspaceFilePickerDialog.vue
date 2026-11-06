<template>
  <NativePanelDialog v-model="opened" :active="active" :content="presentation.content" :initial-content="initialContent" :context-key="chatId" :title="title" focus-mode="input" :max-width="460" content-class="file-picker-dialog" @action="act" @error="emit('error',$event)" @after-leave="emit('after-leave')" @after-enter="focusFallback">
    <section ref="fallback" class="file-workspace-picker" :aria-label="title"><header><strong>{{ title }}</strong><button type="button" class="file-workspace-close" aria-label="关闭文件选择" @click="opened=false"><AppIcon icon="xmark" /></button></header><WorkspaceFilePicker :chat-id="chatId" :show-locate="showLocate" @open="choose" @locate="locate" /></section>
  </NativePanelDialog>
</template>
<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import type {NativePanelAction} from '@shared/native-ui'
import {workspacePickerFilters,workspacePickerPanel} from '@shared/native-dialog-panels'
import {useWorkspaceResources} from '@/composables/useWorkspaceResources'
import {useNativeUi} from '@/composables/useNativeUi'
import NativePanelDialog from './NativePanelDialog.vue'
import WorkspaceFilePicker from './WorkspaceFilePicker.vue'
import AppIcon from './icons/AppIcon.vue'
const props=withDefaults(defineProps<{modelValue:boolean;chatId:string;title?:string;showLocate?:boolean;active?:boolean}>(),{title:'打开对话文件',showLocate:true,active:true})
const emit=defineEmits<{'update:modelValue':[open:boolean];open:[path:string];locate:[messageId:string];error:[message:string];'after-leave':[]}>()
const capabilities=useNativeUi()
const opened=computed({get:()=>props.modelValue,set:value=>emit('update:modelValue',value)}),owner=computed(()=>props.modelValue&&capabilities.panelItemsSupported.value?props.chatId:''),query=ref(''),kind=ref('all'),page=ref(0),fallback=ref<HTMLElement>()
const {entries,snapshot,loading,error,refresh}=useWorkspaceResources(owner)
const options=computed(()=>({title:props.title,chatId:props.chatId,query:query.value,kind:kind.value,entries:entries.value,loading:loading.value,error:error.value,snapshot:snapshot.value,page:page.value,showLocate:props.showLocate}))
const presentation=computed(()=>workspacePickerPanel(options.value)),initialContent=computed(()=>workspacePickerPanel({...options.value,includeValue:true}).content)
function choose(path:string){if(!props.modelValue||!props.active||!props.chatId)return;opened.value=false;emit('open',path)}
function locate(id:string){if(!props.modelValue||!props.active||!props.chatId)return;opened.value=false;emit('locate',id)}
function act(action:NativePanelAction){
  if(!props.modelValue||!props.active||!props.chatId)return
  if(action.id==='workspace-picker-query'&&typeof action.value==='string'){
    query.value=action.value
    if(action.type==='submit'){const first=presentation.value.matches[0];if(first)choose(first.path)}
  }else if(action.id==='workspace-picker-kind'&&action.type==='change'&&typeof action.value==='string'&&workspacePickerFilters.some(filter=>filter.id===action.value))kind.value=action.value
  else if(action.type==='click'){
    if(action.id==='workspace-picker-close')opened.value=false
    else if(['workspace-picker-refresh','workspace-picker-retry','workspace-picker-retry-error'].includes(action.id)&&!loading.value)void refresh(true)
    else if(action.id==='workspace-picker-previous')page.value=Math.max(0,presentation.value.page-1)
    else if(action.id==='workspace-picker-next')page.value=Math.min(Math.max(0,Math.ceil(presentation.value.matches.length/30)-1),presentation.value.page+1)
    else{const target=presentation.value.actions.get(action.id),entry=target&&entries.value.find(item=>item.id===target.resourceId&&item.path===target.path&&item.revision===target.revision&&item.ownerChatId===props.chatId);if(!entry||!target)return;if(target.kind==='open')choose(target.path);else if(target.messageId)locate(target.messageId)}
  }
}
function focusFallback(){fallback.value?.querySelector('input')?.focus()}
watch([query,kind,()=>props.chatId],()=>{page.value=0})
watch(()=>props.modelValue,open=>{if(open){query.value='';kind.value='all';page.value=0}})
watch(()=>props.chatId,()=>{if(props.modelValue)opened.value=false})
</script>
