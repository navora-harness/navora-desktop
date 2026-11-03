<template><span class="composer-native-panels" aria-hidden="true" /></template>
<script setup lang="ts">
import {onBeforeUnmount,watch} from 'vue'
import type {NativePanelAction} from '@shared/native-ui'
import {composerNativeModelControlId,composerNativeModelMatches,composerNativePanelContent,type ComposerNativePanelKind,type ComposerNativePanelState} from '@shared/composer-native-panels'
import {useNativePanel} from '@/composables/useNativeUi'

const props=defineProps<{chatId:string;state:ComposerNativePanelState}>()
const emit=defineEmits<{
  model:[providerId:string,model:string];reasoning:[id:string];mode:[id:string];permission:[id:string];retry:[];'update:modelQuery':[query:string];closed:[kind:ComposerNativePanelKind];notify:[message:string]
}>()
let kind:ComposerNativePanelKind='model',owner='',generation=0
const native=useNativePanel({key:'composer-controls',contextKey:()=>props.chatId,onAction:handleAction,onDismissed:closed,onClosed:closed})
function closed(){const previous=owner;if(!previous)return;owner='';generation++;emit('closed',kind)}
async function hide(){closed();await native.hide()}
async function show(next:ComposerNativePanelKind,anchor:HTMLElement){
  const ticket=++generation,chatId=props.chatId
  if(!chatId)return false
  await native.ready()
  if(ticket!==generation||chatId!==props.chatId||!native.supported.value)return false
  kind=next;owner=chatId
  let shown=false
  try{shown=await native.show(composerNativePanelContent(next,props.state),anchor,{placement:next==='mode'||next==='permission'?'top-start':'top-end',focusMode:next==='model'?'input':'menu'})}catch{if(ticket===generation){owner='';emit('notify','面板暂时无法打开，当前选择和草稿已保留，请重新打开。')}return false}
  if(ticket!==generation||chatId!==props.chatId){if(shown)await native.hide();return false}
  if(!shown)owner=''
  return shown
}
function handleAction(action:NativePanelAction){
  if(!owner||owner!==props.chatId||!native.open.value)return
  const state=props.state
  if(kind==='model'){
    if(action.id==='model:search'){
      if(action.type==='change'&&typeof action.value==='string')emit('update:modelQuery',action.value)
      else if(action.type==='submit'&&!state.modelBusy){const first=state.modelOptions.find(item=>composerNativeModelMatches(item,typeof action.value==='string'?action.value:state.modelQuery));if(first)emit('model',first.providerId,first.model)}
      return
    }
    if(action.id==='model:retry'&&action.type==='click'){emit('retry');return}
    if(action.id==='model:reasoning'&&action.type==='change'&&!state.modelBusy&&typeof action.value==='string'&&state.reasoningLevels.some(item=>item.id===action.value)){emit('reasoning',action.value);return}
    if(action.type==='click'&&!state.modelBusy){const matches=state.modelOptions.filter(item=>composerNativeModelControlId(item.key)===action.id&&composerNativeModelMatches(item,state.modelQuery));if(matches.length===1){const item=matches[0]!;emit('model',item.providerId,item.model)}}
  }else if(kind==='mode'||kind==='permission'){
    const permission=kind==='permission',choices=permission?state.permissionOptions:state.modes,busy=permission?state.permissionBusy:state.modeBusy
    if(action.type!=='click'||busy)return
    const item=choices.find(choice=>`${kind}:${choice.id}`===action.id)
    if(item){void hide();if(permission)emit('permission',item.id);else emit('mode',item.id)}
  }
}
watch(()=>props.state,()=>{if(owner===props.chatId&&native.open.value)void native.update(composerNativePanelContent(kind,props.state))},{deep:true})
watch(()=>props.chatId,()=>{void hide()})
onBeforeUnmount(()=>{owner='';generation++;void native.destroy()})
defineExpose({show,hide,supported:native.supported,opened:native.open})
</script>
<style>.composer-native-panels{display:none}</style>
