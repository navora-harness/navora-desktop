<template>
  <div v-if="token && !dismissed" class="composer-resources" role="listbox" id="composer-resource-options" aria-label="添加上下文">
    <div class="command-heading">{{ heading }}<span>↑ ↓ 选择 · Enter 添加 · Esc 关闭</span></div>
    <div v-if="error" class="command-empty" role="status">{{ error }}</div>
    <div v-else-if="!options.length" class="command-empty">{{ loading ? '正在加载…' : '没有匹配的资源' }}</div>
    <button v-for="(option,index) in options" :id="'composer-option-'+index" :key="option.key" type="button" role="option" :aria-selected="index===selected" :class="{selected:index===selected}" @pointermove="selected=index" @mousedown.prevent @click="choose(option)">
      <font-awesome-icon :icon="option.icon" /><span class="command-body"><strong>{{ option.label }}</strong><small>{{ option.detail }}</small></span><span v-if="option.command" class="command-shortcut">{{ option.command }}</span>
    </button>
  </div>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {BrowserContextRef,BrowserTreeSession} from '@shared/types'
import type {WorkspaceResource} from '@shared/workspace-resources'
import {composerToken} from '@shared/composer-commands'
type Option={key:string;label:string;detail:string;icon:string;command?:string;reference?:BrowserContextRef;path?:string}
const props=defineProps<{text:string;chatId:string;files:WorkspaceResource[]}>()
const emit=defineEmits<{replace:[selection:{start:number;end:number;text:string;reference?:BrowserContextRef}]}>()
const caret=ref(0),dismissed=ref(false),selected=ref(0),tree=ref<BrowserTreeSession[]>([]),loading=ref(false),error=ref('')
const token=computed(()=>composerToken(props.text,caret.value))
const heading=computed(()=>({all:'添加上下文',file:'文件',session:'浏览器会话',window:'浏览器窗口'})[token.value?.kind||'all'])
const commands:Option[]=[{key:'files',label:'文件',detail:'引用当前对话中的文件',icon:'file',command:'/文件 '},{key:'sessions',label:'会话',detail:'引用浏览器登录会话',icon:'layer-group',command:'/会话 '},{key:'windows',label:'浏览器',detail:'引用已打开的浏览器窗口',icon:'window-maximize',command:'/浏览器 '}]
const options=computed(()=>{
  const current=token.value;if(!current)return []
  const q=current.query.toLocaleLowerCase()
  const windows:Option[]=tree.value.flatMap(s=>s.windows.map(w=>({key:w.windowId,label:w.title||'无标题窗口',detail:w.url,icon:'window-maximize',reference:{kind:'window' as const,sessionId:s.sessionId,sessionIndex:s.sessionIndex,windowId:w.windowId,label:w.title||'无标题窗口',url:w.url}})))
  const sessions:Option[]=tree.value.map(s=>({key:s.sessionId,label:`会话 ${s.sessionIndex}`,detail:`${s.windows.length} 个窗口 · ${s.persist?'已保留':'临时'}`,icon:'layer-group',reference:{kind:'session' as const,sessionId:s.sessionId,sessionIndex:s.sessionIndex,label:`会话 ${s.sessionIndex}`}}))
  const files:Option[]=props.files.map(f=>({key:f.id,label:f.name,detail:f.path,icon:'file',path:f.path}))
  const list=current.kind==='all'?commands:current.kind==='file'?files:current.kind==='session'?sessions:windows
  return list.filter(o=>!q||(o.label+' '+o.detail+' '+o.command+' '+o.key).toLocaleLowerCase().includes(q)).slice(0,40)
})
let generation=0,disposed=false
async function loadTree(){
  const request=++generation;selected.value=0;error.value='';loading.value=false
  if(!token.value||token.value.kind==='file'||!props.chatId)return
  const owner=props.chatId;loading.value=true
  try{const all=await window.navora!.browser.treeAll();if(!disposed&&request===generation&&owner===props.chatId)tree.value=all.filter(s=>s.chatId===owner)}
  catch{if(!disposed&&request===generation)error.value='暂时无法读取浏览器资源'}
  finally{if(request===generation)loading.value=false}
}
watch(()=>[token.value?.kind,props.chatId],loadTree)
watch(()=>props.chatId,()=>{tree.value=[];dismissed.value=true})
watch(options,()=>{selected.value=Math.min(selected.value,Math.max(0,options.value.length-1))})
function onInput(event:Event){const input=event.target as HTMLTextAreaElement;caret.value=input.selectionStart;dismissed.value=false;selected.value=0}
function choose(option:Option){
  const current=token.value;if(!current)return
  const text=option.command??(option.path?`[文件：${JSON.stringify(option.path)}] `:'')
  emit('replace',{start:current.start,end:current.end,text,reference:option.reference})
  caret.value=current.start+text.length;dismissed.value=!option.command;selected.value=0
}
function handleKeydown(event:KeyboardEvent):boolean{
  if(event.isComposing||!token.value||dismissed.value)return false
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismissed.value=true;return true}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();selected.value=(selected.value+(event.key==='ArrowDown'?1:-1)+Math.max(1,options.value.length))%Math.max(1,options.value.length);document.getElementById('composer-option-'+selected.value)?.scrollIntoView({block:'nearest'});return true}
  if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(options.value[selected.value])choose(options.value[selected.value]!);return true}
  return false
}
function outside(event:PointerEvent){if(!(event.target as Element).closest('.composer-resources,.composer-input'))dismissed.value=true}
let unsubscribe:(()=>void)|undefined
onMounted(()=>{document.addEventListener('pointerdown',outside);unsubscribe=window.navora?.browser.onTreeUpdated(()=>{if(token.value&&!dismissed.value)void loadTree()})})
onBeforeUnmount(()=>{disposed=true;generation++;unsubscribe?.();document.removeEventListener('pointerdown',outside)})
defineExpose({onInput,handleKeydown})
</script>
<style scoped>
.composer-resources{position:absolute;bottom:calc(100% + 8px);left:0;width:min(440px,100%);max-height:min(330px,45dvh);overflow:auto;background:#fff;border:1px solid #ccd6e2;border-radius:14px;box-shadow:0 8px 30px #23364b1a;padding:7px;z-index:15;animation:command-enter 130ms ease-out}.command-heading{display:flex;justify-content:space-between;gap:8px;padding:7px 9px;color:#53647a;font-size:12px}.command-heading>span{font-size:10px;color:#7d8794}.composer-resources>button{display:flex;align-items:center;gap:11px;width:100%;padding:9px;border-radius:8px;text-align:left;color:#39495d;min-height:48px}.composer-resources>button.selected,.composer-resources>button:hover{background:#edf2f7}.composer-resources>button>svg{width:16px;color:#617a96}.command-body{min-width:0;flex:1;display:grid;gap:2px}.command-body strong{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.command-body small{font-size:11px;color:#768293;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.command-shortcut{font-size:11px;color:#79889b}.command-empty{padding:16px 10px;color:#748196;font-size:12px}@keyframes command-enter{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.composer-resources{animation:none}}
</style>
