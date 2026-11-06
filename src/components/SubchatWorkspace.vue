<template>
  <section class="subchat-workspace" aria-label="子对话工作区">
    <SubchatDetail v-if="selectedId" :key="selectedId" ref="detail" :parent-chat-id="parentChatId" :chat-id="selectedId" :active="effectiveActive" @back="emit('select',null)" @locate-parent="emit('locate-parent',$event)" @open-file="emit('open-file',$event)" @creator="emit('creator',$event)" @notify="emit('notify',$event)"><template #tools><Teleport :to="toolbarTarget||'body'" :disabled="!toolbarTarget"><div v-if="effectiveActive" class="subchat-workspace-tools"><button type="button" class="ui-icon-button" title="在当前子对话中查找（Ctrl/⌘ F）" aria-label="查找当前子对话" @click="openFind"><AppIcon icon="magnifying-glass"/></button><button type="button" class="ui-icon-button" title="刷新子对话" aria-label="刷新子对话" @click="refresh"><AppIcon icon="arrow-rotate-right"/></button><button v-if="detail?.stoppable" type="button" class="ui-icon-button" title="停止当前子任务" aria-label="停止当前子任务" @click="stop"><AppIcon icon="stop"/></button><button v-else type="button" class="ui-icon-button" title="重试当前子对话的最后一条消息" aria-label="重试当前子对话" @click="detail?.retry()"><AppIcon icon="arrow-rotate-right"/></button></div></Teleport></template></SubchatDetail>
    <SubchatList v-else ref="list" :parent-chat-id="parentChatId" :items="index.items" :loading="index.loading" :error="index.error" @select="emit('select',$event)" @menu="showSubchatMenu" @refresh="refresh"><template #tools><Teleport :to="toolbarTarget||'body'" :disabled="!toolbarTarget"><div v-if="effectiveActive" class="subchat-workspace-tools"><button type="button" class="ui-icon-button" title="搜索子对话" aria-label="搜索子对话" @click="openFind"><AppIcon icon="magnifying-glass"/></button><button type="button" class="ui-icon-button" title="刷新子对话列表" aria-label="刷新子对话列表" @click="refresh"><AppIcon icon="arrow-rotate-right"/></button></div></Teleport></template></SubchatList>
    <SidebarContextMenu ref="objectMenu">
      <button type="button" class="sidebar-more-item" role="menuitem" :disabled="menuBusy" @click="subchatAction('open')"><AppIcon icon="comments" /><span>打开子对话</span></button>
      <button type="button" class="sidebar-more-item" role="menuitem" :disabled="menuBusy" @click="subchatAction('parent')"><AppIcon icon="arrow-left" /><span>定位父对话</span></button>
      <button type="button" class="sidebar-more-item" role="menuitem" :disabled="menuBusy||!menuItem?.messageCount" @click="subchatAction('export')"><AppIcon icon="file-export" /><span>导出子对话</span></button>
      <button v-if="menuItem?.status==='running'" type="button" class="sidebar-more-item" role="menuitem" :disabled="menuBusy" @click="subchatAction('stop')"><AppIcon icon="stop" /><span>停止当前子任务</span></button>
    </SidebarContextMenu>
  </section>
</template>
<script setup lang="ts">
import {computed,onActivated,onBeforeUnmount,onDeactivated,nextTick,ref,toRef,watch} from 'vue'
import {registerWindowFindTarget} from '@/composables/useWindowFind'
import {refreshSubchatIndex,useSubchatIndex} from '@/composables/useConversationSession'
import AppIcon from './icons/AppIcon.vue'
import SubchatDetail from './SubchatDetail.vue'
import SubchatList from './SubchatList.vue'
import SidebarContextMenu from './sidebar/SidebarContextMenu.vue'
import type {SubchatIndexItem} from '@shared/types'
const props=withDefaults(defineProps<{parentChatId:string;selectedId?:string|null;active?:boolean;toolbarTarget?:HTMLElement|null}>(),{selectedId:null,active:true,toolbarTarget:null})
const emit=defineEmits<{select:[id:string|null];'locate-parent':[target:{chatId:string;toolCallId?:string}];'open-file':[target:{chatId:string;path:string}];creator:[kind:'plugin'|'skill'];notify:[message:string]}>()
const activated=ref(true),effectiveActive=computed(()=>props.active&&activated.value)
const unregisterFind=registerWindowFindTarget({target:()=>effectiveActive.value&&!props.selectedId?{key:`subchat-list:${props.parentChatId}`,scope:'workspace',kind:'subchat',label:'子对话列表'}:null,state:()=>({status:'unsupported',total:0,ordinal:0,notice:'请先打开一个子对话，再查找消息'}),setQuery:()=>{},step:()=>{},stop:()=>{}})
onBeforeUnmount(unregisterFind)
onActivated(()=>{activated.value=true})
onDeactivated(()=>{activated.value=false})
const index=useSubchatIndex(toRef(props,'parentChatId')),detail=ref<InstanceType<typeof SubchatDetail>>(),list=ref<InstanceType<typeof SubchatList>>()
const objectMenu=ref<InstanceType<typeof SidebarContextMenu>>(),menuTarget=ref<SubchatIndexItem|null>(null),menuBusy=ref(false)
const menuItem=computed(()=>index.value.items.find(item=>item.id===menuTarget.value?.id&&item.parentChatId===menuTarget.value?.parentChatId))
let menuGeneration=0,disposed=false
function showSubchatMenu(event:MouseEvent|KeyboardEvent,item:SubchatIndexItem){if(!effectiveActive.value||item.parentChatId!==props.parentChatId)return;menuGeneration++;menuTarget.value={...item,...(item.run?{run:{...item.run}}:{})};objectMenu.value?.show(event)}
async function subchatAction(action:'open'|'parent'|'export'|'stop'){
  const target=menuTarget.value,generation=menuGeneration
  if(!target||menuBusy.value)return
  const current=()=>!disposed&&effectiveActive.value&&generation===menuGeneration&&props.parentChatId===target.parentChatId&&index.value.items.some(item=>item.id===target.id&&item.parentChatId===target.parentChatId)
  if(!current())return
  menuBusy.value=true
  try{
    const chat=await window.navora!.chats.get(target.id)
    if(!current())return
    if(!chat||chat.kind!=='sub'||chat.parentChatId!==target.parentChatId)throw Error('此子对话已不存在，请刷新列表。')
    if(action==='open')emit('select',target.id)
    else if(action==='parent')emit('locate-parent',{chatId:target.parentChatId,toolCallId:chat.parentToolCallId})
    else if(action==='export'){const result=await window.navora!.chats.export(target.id);if(!result.ok&&!result.canceled)throw Error(result.error||'导出失败，请重试。')}
    else{
      if(target.status!=='running'||!target.run?.id||chat.subchatRun?.id!==target.run.id||(chat.subchatRun&&chat.subchatRun.status!=='running')||!await window.navora!.agent.isRunning(target.id))throw Error('任务状态已变化，请刷新后重新操作。')
      if(!current())return
      const result=await window.navora!.agent.stop(target.id,target.run.id)
      if(!result.ok)throw Error(result.error==='agent_run_changed'?'任务已变化，请重新打开菜单。':'停止子任务失败，请重试。')
      await refreshSubchatIndex(target.parentChatId)
    }
  }catch(error){emit('notify',error instanceof Error?error.message:'子对话操作失败。')}
  finally{menuBusy.value=false}
}
watch(()=>[props.parentChatId,effectiveActive.value],()=>{menuGeneration++;objectMenu.value?.hide();menuTarget.value=null})
onBeforeUnmount(()=>{disposed=true;menuGeneration++})
watch(effectiveActive,active=>{if(active)void refreshSubchatIndex(props.parentChatId)})
function openFind(){if(!effectiveActive.value)return;if(props.selectedId)detail.value?.openFind();else list.value?.focusSearch()}
async function refresh(){await refreshSubchatIndex(props.parentChatId);if(props.selectedId)await detail.value?.refresh()}
async function stop(){await detail.value?.stop()}
async function locateMessage(id:string){await nextTick();await detail.value?.locateMessage(id)}
async function locatePending(id?:string){await nextTick();await detail.value?.locatePending(id)}
defineExpose({openFind,stop,refresh,locateMessage,locatePending,get selectedChatId(){return props.selectedId||null},get running(){return detail.value?.running||false}})
</script>
<style scoped>.subchat-workspace{flex:1;width:100%;max-width:100%;height:100%;min-height:0;min-width:0;background:var(--navora-surface);color:var(--navora-ink);overflow:hidden}.subchat-workspace-tools{display:flex;align-items:center;gap:3px;flex:none}.subchat-workspace-tools .ui-icon-button{width:29px;height:29px}.subchat-workspace-tools svg{width:16px;height:16px}</style>
