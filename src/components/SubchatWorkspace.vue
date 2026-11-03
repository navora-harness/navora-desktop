<template>
  <section class="subchat-workspace" aria-label="子对话工作区">
    <SubchatDetail v-if="selectedId" :key="selectedId" ref="detail" :parent-chat-id="parentChatId" :chat-id="selectedId" :active="effectiveActive" @back="emit('select',null)" @locate-parent="emit('locate-parent',$event)" @open-file="emit('open-file',$event)" @creator="emit('creator',$event)" @notify="emit('notify',$event)"><template #tools><Teleport :to="toolbarTarget||'body'" :disabled="!toolbarTarget"><div v-if="effectiveActive" class="subchat-workspace-tools"><button type="button" class="ui-icon-button" title="在当前子对话中查找（Ctrl/⌘ F）" aria-label="查找当前子对话" @click="openFind"><AppIcon icon="magnifying-glass"/></button><button type="button" class="ui-icon-button" title="刷新子对话" aria-label="刷新子对话" @click="refresh"><AppIcon icon="arrow-rotate-right"/></button><button v-if="detail?.stoppable" type="button" class="ui-icon-button" title="停止当前子任务" aria-label="停止当前子任务" @click="stop"><AppIcon icon="stop"/></button><button v-else type="button" class="ui-icon-button" title="重试当前子对话的最后一条消息" aria-label="重试当前子对话" @click="detail?.retry()"><AppIcon icon="arrow-rotate-right"/></button></div></Teleport></template></SubchatDetail>
    <SubchatList v-else ref="list" :parent-chat-id="parentChatId" :items="index.items" :loading="index.loading" :error="index.error" @select="emit('select',$event)" @refresh="refresh"><template #tools><Teleport :to="toolbarTarget||'body'" :disabled="!toolbarTarget"><div v-if="effectiveActive" class="subchat-workspace-tools"><button type="button" class="ui-icon-button" title="搜索子对话" aria-label="搜索子对话" @click="openFind"><AppIcon icon="magnifying-glass"/></button><button type="button" class="ui-icon-button" title="刷新子对话列表" aria-label="刷新子对话列表" @click="refresh"><AppIcon icon="arrow-rotate-right"/></button></div></Teleport></template></SubchatList>
  </section>
</template>
<script setup lang="ts">
import {computed,onActivated,onDeactivated,nextTick,ref,toRef,watch} from 'vue'
import {refreshSubchatIndex,useSubchatIndex} from '@/composables/useConversationSession'
import AppIcon from './icons/AppIcon.vue'
import SubchatDetail from './SubchatDetail.vue'
import SubchatList from './SubchatList.vue'
const props=withDefaults(defineProps<{parentChatId:string;selectedId?:string|null;active?:boolean;toolbarTarget?:HTMLElement|null}>(),{selectedId:null,active:true,toolbarTarget:null})
const emit=defineEmits<{select:[id:string|null];'locate-parent':[target:{chatId:string;toolCallId?:string}];'open-file':[target:{chatId:string;path:string}];creator:[kind:'plugin'|'skill'];notify:[message:string]}>()
const activated=ref(true),effectiveActive=computed(()=>props.active&&activated.value)
onActivated(()=>{activated.value=true})
onDeactivated(()=>{activated.value=false})
const index=useSubchatIndex(toRef(props,'parentChatId')),detail=ref<InstanceType<typeof SubchatDetail>>(),list=ref<InstanceType<typeof SubchatList>>()
watch(effectiveActive,active=>{if(active)void refreshSubchatIndex(props.parentChatId)})
function openFind(){if(!effectiveActive.value)return;if(props.selectedId)detail.value?.openFind();else list.value?.focusSearch()}
async function refresh(){await refreshSubchatIndex(props.parentChatId);if(props.selectedId)await detail.value?.refresh()}
async function stop(){await detail.value?.stop()}
async function locateMessage(id:string){await nextTick();await detail.value?.locateMessage(id)}
async function locatePending(id?:string){await nextTick();await detail.value?.locatePending(id)}
defineExpose({openFind,stop,refresh,locateMessage,locatePending,get selectedChatId(){return props.selectedId||null},get running(){return detail.value?.running||false}})
</script>
<style scoped>.subchat-workspace{flex:1;width:100%;max-width:100%;height:100%;min-height:0;min-width:0;background:var(--navora-surface);color:var(--navora-ink);overflow:hidden}.subchat-workspace-tools{display:flex;align-items:center;gap:3px;flex:none}.subchat-workspace-tools .ui-icon-button{width:29px;height:29px}.subchat-workspace-tools svg{width:16px;height:16px}</style>
