<template>
  <v-dialog :key="presentation" ref="dialog" v-bind="$attrs" :model-value="modelValue" @update:model-value="events.updateModel" @after-enter="events.afterEnter" @after-leave="events.afterLeave"><slot /></v-dialog>
</template>
<script setup lang="ts">
import {nextTick,onBeforeUnmount,ref,shallowRef,watch} from 'vue'
import {registerBrowserConfirmation,type BrowserConfirmationKind} from '@/composables/useBrowserSurfaceLayout'
import {createBrowserDialogLifecycle} from '@shared/browser-dialog-lifecycle'

defineOptions({inheritAttrs:false})
const props=defineProps<{modelValue:boolean;confirmation:BrowserConfirmationKind;contextKey?:string}>()
const emit=defineEmits<{'update:modelValue':[value:boolean];'after-enter':[];'after-leave':[]}>()
const key=`confirmation-${crypto.randomUUID()}`,lifecycle=createBrowserDialogLifecycle(),presentation=ref(0),dialog=ref<{contentEl?:HTMLElement}>()
const events=shallowRef({afterEnter:()=>{},afterLeave:()=>{},updateModel:(_value:boolean)=>{}})
let disposed=false
function finish(token:number){if(disposed||!lifecycle.afterLeave(token))return;registerBrowserConfirmation(key,null);emit('after-leave')}
watch(()=>props.modelValue,open=>{
  const token=lifecycle.setOpen(open);presentation.value=token
  if(open){
    events.value={afterEnter:()=>{if(!disposed&&lifecycle.afterEnter(token))emit('after-enter')},afterLeave:()=>finish(token),updateModel:value=>{if(!disposed&&token===lifecycle.current())emit('update:modelValue',value)}}
  }else{
    // A same-tick open/close never creates a leave transition.
    void nextTick(()=>{if(!disposed&&!props.modelValue&&!dialog.value?.contentEl?.isConnected)finish(token)})
  }
},{immediate:true,flush:'sync'})
// Registration spans the complete current leave transition, including nested confirmations.
watch(()=>[props.modelValue,props.confirmation,props.contextKey],()=>{if(props.modelValue)registerBrowserConfirmation(key,{kind:props.confirmation,contextKey:props.contextKey||''})},{immediate:true,flush:'sync'})
onBeforeUnmount(()=>{disposed=true;registerBrowserConfirmation(key,null)})
</script>
