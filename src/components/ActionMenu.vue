<template>
  <button v-if="native.menusSupported.value&&!nativeFailed" ref="nativeTrigger" type="button" class="ui-icon-button" :aria-label="label" :title="label" :disabled="disabled" aria-haspopup="menu" :aria-expanded="nativeOpen" @click="showNative"><AppIcon :icon="icon" /></button>
  <v-menu v-else v-model="open" :location="location" :offset="6" :content-class="['ui-action-menu-overlay',{'browser-default-cursor':defaultCursor,'action-menu-navigation-closing':navigationClosing}]">
    <template #activator="{ props: trigger }">
      <button v-bind="trigger" type="button" class="ui-icon-button" :aria-label="label" :title="label" :disabled="disabled"><AppIcon :icon="icon" /></button>
    </template>
    <div class="ui-action-menu" role="menu" :aria-label="label" :inert="navigationClosing" :aria-hidden="navigationClosing||undefined" @keydown="onKey">
      <template v-for="item in items" :key="item.id">
        <div v-if="item.divider" class="ui-menu-divider" role="separator" />
        <button type="button" role="menuitem" :class="{danger:item.danger}" :disabled="item.disabled" :title="item.reason" @click="emit('select',item.id)"><AppIcon v-if="item.icon" :icon="item.icon" /><span>{{ item.label }}</span></button>
      </template>
    </div>
  </v-menu>
</template>
<script setup lang="ts">
import {nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import AppIcon from './icons/AppIcon.vue'
import {BROWSER_CHROME_OPEN,requestBrowserChromeOpen} from '@shared/browser-chrome-events'
import {useNativeUi} from '@/composables/useNativeUi'
import {NATIVE_UI_OPEN,type NativeMenuItem} from '@shared/native-ui'
export type ActionMenuItem={id:string;label:string;icon?:string;disabled?:boolean;reason?:string;danger?:boolean;divider?:boolean}
const props=withDefaults(defineProps<{label:string;items:ActionMenuItem[];disabled?:boolean;icon?:string;location?:'bottom end'|'bottom start'|'top start';defaultCursor?:boolean}>(),{icon:'ellipsis',location:'bottom end',defaultCursor:false})
const emit=defineEmits<{select:[id:string];open:[value:boolean];'dom-open':[value:boolean]}>(),open=ref(false),navigationClosing=ref(false)
const native=useNativeUi(),nativeTrigger=ref<HTMLElement>(),nativeOpen=ref(false),nativeFailed=ref(false)
let nativeGeneration=0,disposed=false
const chromeId=`actions-${crypto.randomUUID()}`
// A navigation handoff waits for the actual inactive/inert DOM, not a decorative
// leave animation. Hidden native windows can suspend that animation indefinitely.
async function hideAndWait(){navigationClosing.value=true;open.value=false;await hideNative();await nextTick()}
watch(open,value=>{if(value){navigationClosing.value=false;requestBrowserChromeOpen(chromeId)}emit('open',value);emit('dom-open',value)},{flush:'sync'})
function otherChrome(event:Event){if((event as CustomEvent<string>).detail!==chromeId){open.value=false;void hideNative()}}
function otherNative(){open.value=false;if(!nativeOpen.value)nativeGeneration++}
async function hideNative(){nativeGeneration++;if(!nativeOpen.value)return;nativeOpen.value=false;emit('open',false);await native.closeMenu()}
async function fallback(){nativeOpen.value=false;nativeFailed.value=true;emit('open',false);await nextTick();open.value=true}
async function showNative(){
  if(props.disabled||!nativeTrigger.value)return
  if(nativeOpen.value){await hideNative();return}
  const generation=++nativeGeneration
  await native.ready();if(disposed||generation!==nativeGeneration)return
  if(!native.menusSupported.value){await fallback();return}
  const snapshot=JSON.stringify(props.items),items:NativeMenuItem[]=[]
  for(const item of props.items){if(item.divider&&items.length)items.push({id:`separator-${item.id}`,label:'',type:'separator'});items.push({id:item.id,label:item.label,icon:item.icon,enabled:!item.disabled,reason:item.reason})}
  nativeOpen.value=true;emit('open',true)
  try{
    const result=await native.popupMenu(items,nativeTrigger.value,{placement:props.location.replace(' ','-') as 'bottom-end'|'bottom-start'|'top-start',contextKey:chromeId})
    if(disposed||generation!==nativeGeneration)return
    nativeOpen.value=false;emit('open',false)
    if(!result.supported){await fallback();return}
    const selected=props.items.find(item=>item.id===result.selectedId)
    if(selected&&!selected.disabled&&!props.disabled&&JSON.stringify(props.items)===snapshot)emit('select',selected.id)
  }catch{if(!disposed&&generation===nativeGeneration)await fallback()}
  finally{if(generation===nativeGeneration&&nativeOpen.value){nativeOpen.value=false;emit('open',false)}}
}
watch(()=>JSON.stringify(props.items),()=>{if(nativeOpen.value)void hideNative()})
watch(()=>props.disabled,value=>{if(value)void hideNative()})
onMounted(()=>{window.addEventListener(BROWSER_CHROME_OPEN,otherChrome);window.addEventListener(NATIVE_UI_OPEN,otherNative);void native.ready()})
onBeforeUnmount(()=>{disposed=true;void hideNative();window.removeEventListener(BROWSER_CHROME_OPEN,otherChrome);window.removeEventListener(NATIVE_UI_OPEN,otherNative)})
defineExpose({hide:()=>{open.value=false;void hideNative()},hideAndWait})
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
<style>
.v-menu.v-overlay>.v-overlay__content.action-menu-navigation-closing{visibility:hidden!important;pointer-events:none!important}
</style>
