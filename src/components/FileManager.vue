<template>
  <section class="file-manager" aria-label="文件管理" :aria-busy="loading" @keydown.esc.stop>
    <header class="main-top file-manager-head">
      <div class="file-manager-title"><font-awesome-icon icon="folder-open" /><div><h1>文件</h1><p>{{ title || '选择左侧的对话文件夹' }}</p></div></div>
      <button type="button" class="file-manager-back" @click="emit('back')"><font-awesome-icon icon="comments" />返回对话</button>
    </header>
    <template v-if="chatId">
      <div class="file-manager-toolbar">
        <nav class="file-manager-breadcrumbs" aria-label="文件目录"><button type="button" @click="emit('browse','.')"><font-awesome-icon icon="folder" />对话文件夹</button><template v-for="part in breadcrumbs" :key="part.path"><span>/</span><button type="button" @click="emit('browse',part.path)">{{ part.name }}</button></template></nav>
        <button type="button" class="file-manager-icon" aria-label="在系统中打开文件夹" title="在系统中打开文件夹" @click="reveal(directory)"><font-awesome-icon icon="arrow-up-right-from-square" /></button>
        <button type="button" class="file-manager-icon" aria-label="刷新文件管理视图" title="刷新" :disabled="loading" @click="refreshAll"><font-awesome-icon icon="arrow-rotate-right" /></button>
      </div>
      <div class="file-manager-options">
        <label class="file-manager-search"><font-awesome-icon icon="magnifying-glass" /><input v-model="query" aria-label="搜索当前文件夹" placeholder="搜索文件名或路径" /><button v-if="query" type="button" aria-label="清空文件搜索" @click="query=''">×</button></label>
        <select v-model="sort" aria-label="文件排序"><option value="name">名称</option><option value="recent">最近修改</option><option value="size">文件大小</option></select>
        <div class="file-manager-views" role="group" aria-label="文件显示方式"><button type="button" :aria-pressed="view==='list'" aria-label="列表视图" @click="view='list'"><font-awesome-icon icon="list-ul" /></button><button type="button" :aria-pressed="view==='grid'" aria-label="网格视图" @click="view='grid'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></button></div>
      </div>
      <div v-if="error || (query && indexError)" class="file-manager-empty" role="alert"><font-awesome-icon icon="circle-exclamation" /><span>无法读取文件夹</span><button type="button" @click="refreshAll">重试</button></div>
      <div v-else-if="!rows.length" class="file-manager-empty"><font-awesome-icon icon="folder-open" /><span>{{ loading || (query && indexLoading) ? '正在读取…' : query ? '没有匹配的文件' : '此文件夹为空' }}</span></div>
      <div v-else class="file-manager-scroll" :class="{'is-grid':view==='grid'}" @keydown="onListKey">
        <div v-if="view==='list'" class="file-manager-columns" aria-hidden="true"><span>名称</span><span>类型</span><span>大小</span><span>修改时间</span><span /></div>
        <div v-for="(entry,index) in rows" :key="entry.path" class="file-manager-row" :data-file-path="entry.path" :class="{selected:selected===entry.path}">
          <button type="button" class="file-manager-entry" :tabindex="selected===entry.path || (!selected && index===0) ? 0 : -1" :aria-label="`${entry.type==='dir'?'打开文件夹':'预览文件'} ${entry.path}`" :title="entry.path" @focus="selected=entry.path" @click="open(entry)"><font-awesome-icon :icon="entry.type==='dir'?'folder':'file-lines'" /><span><strong>{{ entry.name }}</strong><small v-if="query">{{ entry.path }}</small></span></button>
          <span class="file-manager-type">{{ entry.type==='dir'?'文件夹':entry.name.split('.').length>1?entry.name.split('.').at(-1)?.toUpperCase():'文件' }}</span>
          <span class="file-manager-size">{{ entry.type==='dir'?'—':fileSize(entry.size) }}</span>
          <time :datetime="entry.mtimeMs ? new Date(entry.mtimeMs).toISOString() : undefined">{{ entry.mtimeMs ? new Date(entry.mtimeMs).toLocaleDateString() : '—' }}</time>
          <button type="button" class="file-manager-icon file-manager-reveal" :tabindex="selected===entry.path?0:-1" :aria-label="`在系统中显示 ${entry.name}`" title="在系统中显示" @click="reveal(entry.path)"><font-awesome-icon icon="arrow-up-right-from-square" /></button>
        </div>
      </div>
      <footer class="file-manager-status"><span>{{ rows.length }} 项{{ query?'匹配结果':'' }}</span><span v-if="truncated || (query && snapshot?.truncated)">仅显示已索引项目</span><span v-if="query && snapshot?.unavailable">部分目录无法读取</span></footer>
    </template>
    <div v-else class="file-manager-empty"><font-awesome-icon icon="folder-open" /><span>在左侧选择一个有文件的对话</span></div>
  </section>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,toRef,watch} from 'vue'
import {useWorkspaceResources} from '@/composables/useWorkspaceResources'
import {searchWorkspaceResources} from '@shared/workspace-resources'
import type {WsEntry} from './sidebar/WorkspaceTreeNode.vue'
const props=defineProps<{active:boolean;chatId:string;title:string;directory:string}>()
const emit=defineEmits<{browse:[path:string];preview:[path:string,chatId:string];back:[];notify:[text:string]}>()
const query=ref(''),sort=ref('name'),view=ref('list'),selected=ref(''),folderEntries=ref<WsEntry[]>([]),loading=ref(false),error=ref(false),truncated=ref(false)
const {entries,snapshot,loading:indexLoading,error:indexError,refresh:refreshIndex}=useWorkspaceResources(toRef(props,'chatId'))
const breadcrumbs=computed(()=>props.directory==='.'?[]:props.directory.split('/').filter(Boolean).map((name,index,parts)=>({name,path:parts.slice(0,index+1).join('/')})))
const rows=computed(()=>{
  const candidates:WsEntry[]=query.value.trim()?searchWorkspaceResources(entries.value.filter(entry=>props.directory==='.'||entry.path.startsWith(props.directory+'/')),query.value).map(entry=>({...entry,type:'file' as const})):folderEntries.value
  return [...candidates].sort((a,b)=>a.type!==b.type?(a.type==='dir'?-1:1):(sort.value==='recent'?(b.mtimeMs||0)-(a.mtimeMs||0):sort.value==='size'?(b.size||0)-(a.size||0):0)||a.name.localeCompare(b.name,'zh'))
})
let generation=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined,unsubscribe:(()=>void)|undefined
async function load(){
  if(!props.active)return
  const id=props.chatId,directory=props.directory,seq=++generation
  if(!id){folderEntries.value=[];loading.value=false;error.value=false;return}
  loading.value=true;error.value=false
  try{const result=await window.navora!.workspace.list(id,directory);if(disposed||seq!==generation)return;if(!result.ok)throw Error('list_failed');folderEntries.value=result.entries||[];truncated.value=!!result.truncated}
  catch{if(!disposed&&seq===generation)error.value=true}
  finally{if(!disposed&&seq===generation)loading.value=false}
}
function open(entry:WsEntry){selected.value=entry.path;if(entry.type==='dir')emit('browse',entry.path);else emit('preview',entry.path,props.chatId)}
function onListKey(event:KeyboardEvent){
  if(!(event.target as Element).classList.contains('file-manager-entry')||!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return
  event.preventDefault();event.stopPropagation()
  const box=event.currentTarget as HTMLElement,buttons=[...box.querySelectorAll<HTMLButtonElement>('.file-manager-entry')],index=buttons.indexOf(event.target as HTMLButtonElement)
  const columns=view.value==='grid'?getComputedStyle(box).gridTemplateColumns.split(' ').length:1
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:index+(event.key==='ArrowDown'?columns:event.key==='ArrowUp'?-columns:event.key==='ArrowRight'?1:-1)
  const target=buttons[Math.max(0,Math.min(buttons.length-1,next))];target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'})
}
async function reveal(path:string){try{const result=await window.navora!.workspace.reveal(props.chatId,path);if(!result.ok)throw Error('reveal_failed')}catch{emit('notify','无法打开文件所在位置')}}
function refreshAll(){void load();void refreshIndex(true)}
function fileSize(size?:number){return size==null?'—':size<1024?`${size} B`:size<1048576?`${(size/1024).toFixed(1)} KB`:`${(size/1048576).toFixed(1)} MB`}
watch(()=>[props.chatId,props.directory],()=>{generation++;folderEntries.value=[];query.value='';selected.value='';void load()},{immediate:true})
watch(()=>props.active,active=>{if(active)void load()})
onMounted(()=>{unsubscribe=window.navora?.workspace.onChanged(event=>{if(!props.active||event.chatId!==props.chatId)return;clearTimeout(timer);timer=setTimeout(()=>void load(),150)})})
onBeforeUnmount(()=>{disposed=true;generation++;clearTimeout(timer);unsubscribe?.()})
</script>
<style scoped>
.file-manager{container-type:inline-size;display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;height:100%;color:#465467;background:#fff;overflow:hidden}
.file-manager-head{display:flex;align-items:center;flex-shrink:0;gap:16px;height:44px;min-height:44px;padding:4px 24px;border-bottom:1px solid #e0e5ec;-webkit-app-region:drag}.file-manager-title{display:flex;align-items:center;gap:12px;min-width:0;flex:1}.file-manager-title>svg{width:20px;height:20px;color:#637a93}.file-manager-title>div{min-width:0;display:flex;align-items:center;gap:12px}.file-manager-title h1{font-size:15px;margin:0;color:#263548}.file-manager-title p{margin:0;max-width:32vw;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7c8795}.file-manager-back{display:flex;align-items:center;gap:7px;padding:6px 9px;border:1px solid #d8dfe7;border-radius:7px;font-size:12px;color:#65758a;white-space:nowrap}
.file-manager-toolbar,.file-manager-options{display:flex;align-items:center;gap:8px;padding:13px 24px;flex-shrink:0;min-width:0}.file-manager-options{padding-top:0;border-bottom:1px solid #e0e5ec;padding-bottom:14px}.file-manager-breadcrumbs{display:flex;align-items:center;gap:6px;flex:1;min-width:0;overflow-x:auto;font-size:12px;white-space:nowrap}.file-manager-breadcrumbs>span{color:#a0aab7}.file-manager-breadcrumbs button{display:flex;align-items:center;gap:7px;padding:4px;border-radius:5px}.file-manager-breadcrumbs svg{width:12px}.file-manager-icon{display:grid;place-items:center;flex-shrink:0;width:28px;height:28px;border:1px solid transparent;border-radius:7px;color:#758397}.file-manager-icon svg{width:13px;height:13px}.file-manager-search{display:flex;align-items:center;gap:9px;min-width:0;flex:1;max-width:440px;height:34px;padding:0 10px;border:1px solid #cbd4df;border-radius:8px;background:#fbfcfd;font-size:12px}.file-manager-search>svg{width:13px;color:#8190a1}.file-manager-search input{outline:none;min-width:0;width:100%;color:#3f5066}.file-manager-search:focus-within{border-color:#6485aa;box-shadow:0 0 0 2px #6485aa12}.file-manager-options select{border:1px solid #d8dfe7;border-radius:7px;padding:6px 9px;font-size:12px;max-width:110px;min-height:32px}.file-manager-views{display:flex;border:1px solid #d8dfe7;border-radius:7px;padding:2px}.file-manager-views button{display:grid;place-items:center;width:28px;height:25px;border-radius:5px;color:#6b7c91}.file-manager-views button[aria-pressed=true]{background:#eaf0f6;color:#3e648d}.file-manager-views svg{width:14px;height:14px}
.file-manager-scroll{flex:1;min-height:0;overflow:auto;padding:0 24px 12px;scrollbar-width:thin}.file-manager-columns,.file-manager-row{display:grid;grid-template-columns:minmax(120px,1fr) 65px 76px 105px 28px;align-items:center;gap:10px;min-width:0}.file-manager-columns{position:sticky;top:0;z-index:1;height:38px;font-size:11px;color:#8390a0;background:#fff;border-bottom:1px solid #e5e9ef}.file-manager-columns>span:first-child{padding-left:10px}.file-manager-row{min-height:49px;border-bottom:1px solid #edf0f4;font-size:11px;border-radius:6px}.file-manager-row.selected{background:#f0f4f9}.file-manager-entry{display:flex;align-items:center;gap:11px;min-width:0;text-align:left;padding:10px}.file-manager-entry>svg{width:17px;height:19px;flex-shrink:0;color:#7087a0}.file-manager-entry>span{display:flex;flex-direction:column;gap:3px;min-width:0}.file-manager-entry strong{font-size:12px;font-weight:500;color:#3d4f65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-manager-entry small{font-size:10px;color:#8995a5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-manager-type,.file-manager-size,.file-manager-row time{color:#7a8798;font-variant-numeric:tabular-nums}.file-manager-row:hover{background:#f5f7fa}.file-manager-reveal{opacity:0}.file-manager-row:is(:hover,:focus-within) .file-manager-reveal{opacity:1}
.file-manager-scroll.is-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));grid-auto-rows:max-content;align-content:start;gap:12px;padding-top:16px}.is-grid .file-manager-row{display:grid;grid-template-columns:1fr 28px;padding:10px;border:1px solid #dce3ec;border-radius:10px;gap:6px}.is-grid .file-manager-entry{grid-column:1/-1;flex-direction:column;align-items:flex-start;padding:6px;gap:12px}.is-grid .file-manager-entry>svg{width:26px;height:30px}.is-grid .file-manager-entry>span{max-width:100%}.is-grid .file-manager-type{display:none}.is-grid .file-manager-size{padding-left:6px}.is-grid time{grid-column:1;grid-row:3;padding-left:6px;font-size:10px}.is-grid .file-manager-reveal{grid-column:2;grid-row:2/4}
.file-manager-empty{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;flex:1;min-height:180px;padding:24px;color:#8693a4;font-size:13px}.file-manager-empty>svg{width:32px;height:32px;color:#8a9bb0}.file-manager-empty button{color:#486c94}.file-manager-status{display:flex;justify-content:space-between;gap:12px;padding:10px 24px;border-top:1px solid #e0e5ec;font-size:11px;color:#8390a0;flex-shrink:0}
.file-manager button{-webkit-app-region:no-drag}.file-manager :is(button,select){transition:background-color 140ms,color 140ms}.file-manager :is(.file-manager-icon,.file-manager-back,.file-manager-breadcrumbs button):hover{background:#edf1f6;color:#3b5b7f}.file-manager :is(button,input,select):focus-visible{outline:2px solid #5b7fa7;outline-offset:2px}.file-manager button:disabled{opacity:.4}
@container (max-width:640px){.file-manager-columns,.file-manager-row{grid-template-columns:minmax(100px,1fr) 72px 28px}.file-manager-type,.file-manager-row time,.file-manager-columns>span:nth-child(2),.file-manager-columns>span:nth-child(4){display:none}}
@media(max-width:800px){.file-manager-toolbar,.file-manager-options{padding-inline:14px}.file-manager-scroll{padding-inline:14px}.file-manager-back{font-size:11px}.file-manager-options{flex-wrap:wrap}.file-manager-search{flex-basis:180px}.file-manager-reveal{opacity:1}}
@media(prefers-reduced-motion:reduce){.file-manager :is(button,select){transition:none}}
</style>
