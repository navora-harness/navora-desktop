<template>
  <section class="file-manager" aria-label="文件管理" :aria-busy="loading" @keydown.esc.stop>
    <header class="main-top file-manager-head">
      <div class="file-manager-title"><AppIcon icon="folder-open" /><div><h1>文件</h1><p>{{ title || '选择左侧的对话文件夹' }}</p></div></div>
      <button type="button" class="file-manager-back" aria-label="返回对话" title="返回对话" @click="emit('back')"><AppIcon icon="comments" /><span>返回对话</span></button>
    </header>
    <template v-if="chatId">
      <div class="file-manager-body">
      <div class="file-manager-controls">
      <div class="file-manager-toolbar">
        <button type="button" class="file-manager-icon file-manager-up" aria-label="返回上一级目录" title="返回上一级目录" :disabled="directory==='.'" @click="emit('browse',parentDirectory)"><AppIcon icon="chevron-left" /></button>
        <nav class="file-manager-breadcrumbs" aria-label="文件目录"><button type="button" :aria-current="directory==='.'?'page':undefined" @click="emit('browse','.')"><AppIcon icon="folder" /><span>对话文件夹</span></button><template v-for="part in breadcrumbs" :key="part.path"><AppIcon icon="chevron-right" class="breadcrumb-divider" /><button type="button" :aria-current="part.path===directory?'page':undefined" :title="part.path" @click="emit('browse',part.path)"><span>{{ part.name }}</span></button></template></nav>
        <button type="button" class="file-manager-icon" aria-label="在系统中打开文件夹" title="在系统中打开文件夹" @click="reveal(directory)"><AppIcon icon="arrow-up-right-from-square" /></button>
        <button type="button" class="file-manager-icon" aria-label="刷新文件管理视图" title="刷新" :disabled="loading" @click="refreshAll"><AppIcon icon="arrow-rotate-right" /></button>
      </div>
      <div class="file-manager-options">
        <label class="file-manager-search"><AppIcon icon="magnifying-glass" /><input v-model="query" aria-label="搜索当前文件夹" placeholder="搜索文件" /><button v-if="query" type="button" aria-label="清空文件搜索" @click="clearSearch"><AppIcon icon="xmark" /></button></label>
        <label class="file-manager-sort"><select v-model="sort" aria-label="文件排序"><option value="name">名称</option><option value="recent">最近修改</option><option value="size">文件大小</option></select><AppIcon icon="chevron-down" /></label>
        <div class="file-manager-views" role="group" aria-label="文件显示方式"><button type="button" :aria-pressed="view==='list'" aria-label="列表视图" @click="view='list'"><AppIcon icon="list-ul" /></button><button type="button" :aria-pressed="view==='grid'" aria-label="网格视图" @click="view='grid'"><AppIcon icon="grid" /></button></div>
      </div>
      </div>
      <div class="file-manager-collection" :class="{'grid-collection':view==='grid','has-search':!!query.trim()}">
      <div v-if="error || (query && indexError)" class="file-manager-empty" role="alert"><span class="file-manager-empty-icon"><AppIcon icon="circle-exclamation" /></span><strong>无法读取文件夹</strong><p>请检查文件夹是否可用，然后重试。</p><button type="button" @click="refreshAll">重新加载</button></div>
      <div v-else-if="!rows.length" class="file-manager-empty"><span class="file-manager-empty-icon"><AppIcon :icon="query?'magnifying-glass':'folder-open'" /></span><strong>{{ loading || (query && indexLoading) ? '正在读取…' : query ? '没有匹配的文件' : '此文件夹为空' }}</strong><p v-if="!loading && !(query && indexLoading)">{{ query ? '试试其他文件名，或清空搜索。' : '保存在这里的文件和下载会显示在此处。' }}</p><button v-if="query && !indexLoading" type="button" @click="clearSearch">清空搜索</button></div>
      <div v-else class="file-manager-scroll" :class="{'is-grid':view==='grid'}" @keydown="onListKey">
        <div v-if="view==='list'" class="file-manager-columns" aria-hidden="true"><span>名称</span><span>类型</span><span>大小</span><span>修改时间</span><span /></div>
        <div v-for="(entry,index) in rows" :key="entry.path" class="file-manager-row" :data-file-path="entry.path" :data-download-state="entry.download?.state" :class="{selected:selected===entry.path}" @contextmenu="downloadMenu($event,entry)">
          <button type="button" class="file-manager-entry" :tabindex="selected===entry.path || (!visibleSelection && index===0) ? 0 : -1" :aria-label="`${entry.type==='dir'?'打开文件夹':'预览文件'} ${entry.path}`" :aria-disabled="entry.type==='file' && (entry.virtual || (entry.download && entry.download.state!=='completed')) || undefined" :title="entry.download ? `${entry.name}\n${downloadDetail(entry.download)}${entry.virtual ? '' : `\n${entry.path}`}` : entry.path" @focus="selected=entry.path" @click="open(entry)">
            <span class="file-manager-entry-icon" :data-kind="entry.type==='dir'?'folder':resourceKind(entry.path)"><AppIcon :icon="fileIcon(entry)" /></span>
            <span>
              <span class="file-manager-name-line"><strong>{{ entry.name }}</strong><FileDownloadIndicator v-if="entry.download" :download="entry.download" /><span v-else-if="entry.activeDownloads" class="manager-active-downloads" :title="`${entry.activeDownloads} 个文件正在下载`"><AppIcon icon="download" />{{ entry.activeDownloads }}</span></span>
              <small v-if="query">{{ entry.path }}</small>
            </span>
          </button>
          <span class="file-manager-type">{{ entry.type==='dir'?'文件夹':entry.name.split('.').length>1?entry.name.split('.').at(-1)?.toUpperCase():'文件' }}</span>
          <span class="file-manager-size">{{ entry.type==='dir'?'—':fileSize(entry.download && activeDownload(entry.download) ? entry.download.receivedBytes : entry.size) }}</span>
          <time :datetime="entry.mtimeMs ? new Date(entry.mtimeMs).toISOString() : undefined">{{ entry.mtimeMs ? new Date(entry.mtimeMs).toLocaleDateString() : '—' }}</time>
          <button v-if="!entry.virtual" type="button" class="file-manager-icon file-manager-reveal" :tabindex="selected===entry.path?0:-1" :aria-label="`在系统中显示 ${entry.name}`" title="在系统中显示" @click="reveal(entry.path)"><AppIcon icon="arrow-up-right-from-square" /></button>
        </div>
      </div>
      <footer class="file-manager-status" role="status"><span>{{ rows.length }} 项{{ query?'匹配结果':'' }}</span><span v-if="truncated || (query && snapshot?.truncated)">仅显示已索引项目</span><span v-if="query && snapshot?.unavailable">部分目录无法读取</span></footer>
      </div>
      </div>
    </template>
    <div v-else class="file-manager-empty"><span class="file-manager-empty-icon"><AppIcon icon="folder-open" /></span><strong>选择一个文件夹</strong><p>从左侧选择对话文件，查看文件与下载。</p></div>
    <SidebarContextMenu ref="downloadContextMenu">
      <template v-if="menuDownload">
        <button v-if="menuDownload.canPause" type="button" class="sidebar-more-item" role="menuitem" @click="downloadAction('pause')"><AppIcon icon="pause-circle" />暂停下载</button>
        <button v-if="menuDownload.canResume" type="button" class="sidebar-more-item" role="menuitem" @click="downloadAction('resume')"><AppIcon icon="arrow-right" />继续下载</button>
        <button v-if="menuDownload.canCancel" type="button" class="sidebar-more-item" role="menuitem" @click="downloadAction('cancel')"><AppIcon icon="xmark" />取消下载</button>
        <button v-if="menuDownload.source==='tool' && activeDownload(menuDownload)" type="button" class="sidebar-more-item" role="menuitem" title="停止所属对话的当前任务，包括正在运行的其他工具" @click="stopDownloadTask"><AppIcon icon="stop" />停止当前任务</button>
        <button v-if="!activeDownload(menuDownload)" type="button" class="sidebar-more-item" role="menuitem" title="仅移除下载状态，保留已保存文件" @click="downloadAction('remove')"><AppIcon icon="xmark" />移除下载状态</button>
      </template>
    </SidebarContextMenu>
  </section>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,toRef,watch} from 'vue'
import {useWorkspaceResources} from '@/composables/useWorkspaceResources'
import {resourceKind,searchWorkspaceResources} from '@shared/workspace-resources'
import type {WsEntry} from './sidebar/WorkspaceTreeNode.vue'
import type {BrowserDownloadEntry} from '@shared/types'
import {activeDownload,downloadDetail,mergeWorkspaceDownloads} from '@shared/workspace-downloads'
import FileDownloadIndicator from './FileDownloadIndicator.vue'
import SidebarContextMenu from './sidebar/SidebarContextMenu.vue'
const props=defineProps<{active:boolean;chatId:string;title:string;directory:string}>()
const emit=defineEmits<{browse:[path:string];preview:[path:string,chatId:string];back:[];notify:[text:string]}>()
const query=ref(''),sort=ref('name'),view=ref('list'),selected=ref(''),folderEntries=ref<WsEntry[]>([]),loading=ref(false),error=ref(false),truncated=ref(false)
const {entries,snapshot,loading:indexLoading,error:indexError,refresh:refreshIndex}=useWorkspaceResources(toRef(props,'chatId'))
const downloads=ref<BrowserDownloadEntry[]>([]),awaitingDisk=ref(new Set<string>())
const downloadContextMenu=ref<InstanceType<typeof SidebarContextMenu>|null>(null),menuDownloadId=ref('')
const menuDownload=computed(()=>downloads.value.find(item=>item.id===menuDownloadId.value))
const breadcrumbs=computed(()=>props.directory==='.'?[]:props.directory.split('/').filter(Boolean).map((name,index,parts)=>({name,path:parts.slice(0,index+1).join('/')})))
const parentDirectory=computed(()=>props.directory.split('/').filter(Boolean).slice(0,-1).join('/')||'.')
function fileIcon(entry:WsEntry){return entry.type==='dir'?'folder':resourceKind(entry.path)==='image'?'image':resourceKind(entry.path)==='code'?'code':'file-lines'}
function clearSearch(){query.value='';selected.value=''}
const rows=computed(()=>{
  const candidates:WsEntry[]=query.value.trim()?searchWorkspaceResources(entries.value.filter(entry=>props.directory==='.'||entry.path.startsWith(props.directory+'/')),query.value).map(entry=>({...entry,type:'file' as const})):folderEntries.value
  const merged=mergeWorkspaceDownloads(candidates,props.directory==='.'?'':props.directory,props.chatId,downloads.value,awaitingDisk.value,!!query.value.trim())
  const tokens=query.value.trim().normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean)
  return merged.filter(entry=>!tokens.length||tokens.every(token=>entry.path.normalize('NFKC').toLowerCase().includes(token))).sort((a,b)=>a.type!==b.type?(a.type==='dir'?-1:1):(sort.value==='recent'?(b.mtimeMs||0)-(a.mtimeMs||0):sort.value==='size'?(b.size||0)-(a.size||0):0)||a.name.localeCompare(b.name,'zh'))
})
const visibleSelection=computed(()=>rows.value.some(entry=>entry.path===selected.value))
let generation=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined,unsubscribe:(()=>void)|undefined,offDownloads:(()=>void)|undefined,downloadRevision=0
async function load(){
  if(!props.active)return
  const id=props.chatId,directory=props.directory,seq=++generation,verified=new Set(awaitingDisk.value)
  if(!id){folderEntries.value=[];loading.value=false;error.value=false;return}
  loading.value=true;error.value=false
  try{const result=await window.navora!.workspace.list(id,directory);if(disposed||seq!==generation)return;if(!result.ok&&!(String(result.error).includes('ENOENT')&&downloads.value.some(item=>item.chatId===id&&item.state!=='completed'&&item.relPath?.replace(/\\/g,'/').startsWith(directory+'/'))))throw Error('list_failed');folderEntries.value=result.entries||[];truncated.value=!!result.truncated;awaitingDisk.value=new Set([...awaitingDisk.value].filter(id=>!verified.has(id)))}
  catch{if(!disposed&&seq===generation)error.value=true}
  finally{if(!disposed&&seq===generation)loading.value=false}
}
function open(entry:WsEntry){selected.value=entry.path;if(entry.type==='dir')emit('browse',entry.path);else if(!entry.virtual&&(!entry.download||entry.download.state==='completed'))emit('preview',entry.path,props.chatId)}
function updateDownloads(items:BrowserDownloadEntry[]){
  const next=items.filter(item=>item.chatId===props.chatId),previous=downloads.value
  awaitingDisk.value=new Set([...awaitingDisk.value].filter(id=>next.some(item=>item.id===id)).concat(next.filter(item=>item.state==='completed'&&!previous.some(old=>old.id===item.id&&old.state==='completed'&&old.relPath===item.relPath)).map(item=>item.id)))
  downloads.value=next
  if(next.map(item=>`${item.id}:${item.state}:${item.relPath}`).sort().join('|')!==previous.map(item=>`${item.id}:${item.state}:${item.relPath}`).sort().join('|')){clearTimeout(timer);timer=setTimeout(()=>void load(),150)}
}
async function fetchDownloads(){const revision=downloadRevision,id=props.chatId;if(!id){updateDownloads([]);return}try{const items=await window.navora?.downloads.list(id);if(items&&!disposed&&revision===downloadRevision&&id===props.chatId)updateDownloads(items)}catch{ /* Keep files available if download status cannot be read. */ }}
function downloadMenu(event:MouseEvent,entry:WsEntry){if(!entry.download)return;event.preventDefault();menuDownloadId.value=entry.download.id;downloadContextMenu.value?.show(event)}
async function downloadAction(action:'pause'|'resume'|'cancel'|'remove'){const item=menuDownload.value;if(!item||!window.navora)return;try{const result=await window.navora.downloads[action](item.id);if(result&&!result.ok)emit('notify',('error' in result&&String(result.error))||'下载操作失败');downloadRevision++;await fetchDownloads()}catch{emit('notify','下载操作失败')}}
async function stopDownloadTask(){const item=menuDownload.value;if(item?.source!=='tool'||!activeDownload(item))return;try{await window.navora?.agent.stop(item.chatId)}catch{emit('notify','停止任务失败')}}
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
watch(()=>props.chatId,()=>{downloadRevision++;downloads.value=[];awaitingDisk.value=new Set();menuDownloadId.value='';void fetchDownloads()},{immediate:true})
watch(()=>props.active,active=>{if(active)void load()})
onMounted(()=>{unsubscribe=window.navora?.workspace.onChanged(event=>{if(!props.active||event.chatId!==props.chatId)return;clearTimeout(timer);timer=setTimeout(()=>void load(),150)});offDownloads=window.navora?.downloads.onChanged(payload=>{downloadRevision++;updateDownloads(payload.downloads)})})
onBeforeUnmount(()=>{disposed=true;generation++;clearTimeout(timer);unsubscribe?.();offDownloads?.()})
defineExpose({refresh:refreshAll,openFolder:()=>reveal(props.directory)})
</script>
<style scoped>
.file-manager{container-type:inline-size;display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;height:100%;overflow:hidden;color:#465467;background:#fbfcfd}
.file-manager-head{display:flex;align-items:center;flex-shrink:0;gap:12px;height:44px;min-height:44px;padding:0 20px;border-bottom:1px solid #e5e9ef;background:#fff;-webkit-app-region:drag}
.file-manager-title{display:flex;align-items:center;gap:9px;min-width:0;flex:1}.file-manager-title>svg{width:16px;height:16px;color:#75869b}.file-manager-title>div{display:flex;align-items:center;gap:10px;min-width:0}.file-manager-title h1{margin:0;flex-shrink:0;white-space:nowrap;font-size:13px;line-height:20px;font-weight:600;color:#35445a}.file-manager-title p{margin:0;max-width:34cqw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#718095}
.file-manager-back{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:0;border-radius:6px;font-size:11px;color:#687990;white-space:nowrap}.file-manager-back svg{width:13px;height:13px}
.file-manager-body{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;gap:12px;padding:14px 20px 16px}
.file-manager-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;min-width:0;flex-shrink:0}.file-manager-toolbar{display:flex;align-items:center;gap:4px;flex:1 1 240px;min-width:0}.file-manager-options{display:flex;align-items:center;gap:8px;min-width:0;flex:0 1 auto}
.file-manager-breadcrumbs{display:flex;align-items:center;gap:3px;min-width:0;flex:1;overflow:auto;scrollbar-width:none;font-size:12px;white-space:nowrap}.file-manager-breadcrumbs button{display:flex;align-items:center;gap:7px;min-width:0;flex-shrink:0;max-width:180px;padding:5px 6px;border-radius:5px;color:#718096}.file-manager-breadcrumbs button span{overflow:hidden;text-overflow:ellipsis}.file-manager-breadcrumbs button[aria-current=page]{color:#3f536e;font-weight:500}.file-manager-breadcrumbs svg{width:12px;height:12px;flex-shrink:0}.file-manager-breadcrumbs .breadcrumb-divider{width:9px;height:9px;color:#9aa8b8}
.file-manager-icon{display:grid;place-items:center;flex-shrink:0;width:32px;height:32px;border:0;border-radius:6px;color:#8895a6}.file-manager-icon svg{width:14px;height:14px}.file-manager-up{margin-left:-5px}
.file-manager-search{display:flex;align-items:center;gap:7px;width:clamp(120px,18cqw,220px);min-width:0;height:32px;padding:0 9px;border:1px solid #e0e5ec;border-radius:7px;background:#fff;font-size:12px}.file-manager-search>svg{width:13px;height:13px;flex-shrink:0;color:#97a3b3}.file-manager-search input{outline:none;min-width:0;flex:1;width:100%;color:#46576e}.file-manager-search input::placeholder{color:#9ba5b3}.file-manager-search button{display:grid;place-items:center;width:20px;height:20px;flex-shrink:0;border-radius:4px;color:#95a1b1}.file-manager-search button svg{width:11px;height:11px}.file-manager-search:focus-within{border-color:#91aaca;box-shadow:0 0 0 2px #6485aa10}
.file-manager-sort{position:relative;display:flex;flex-shrink:0;align-items:center;height:32px;border:1px solid #e0e5ec;border-radius:7px;background:#fff}.file-manager-sort select{appearance:none;outline:none;max-width:104px;min-width:82px;height:30px;padding:0 23px 0 10px;font:inherit;font-size:11px;color:#6e7d91;cursor:pointer}.file-manager-sort>svg{position:absolute;right:8px;width:9px;height:9px;color:#92a0b2;pointer-events:none}
.file-manager-views{display:flex;flex-shrink:0;gap:2px;padding:3px;border:1px solid #e0e5ec;border-radius:7px;background:#f1f4f8}.file-manager-views button{display:grid;place-items:center;width:26px;height:24px;border-radius:4px;color:#95a1b1}.file-manager-views button[aria-pressed=true]{background:#fff;color:#57799e;box-shadow:0 1px 3px #23364d0c}.file-manager-views svg{width:13px;height:13px}
.file-manager-collection{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden;border:1px solid #e4e9f0;border-radius:9px;background:#fff}.file-manager-scroll{flex:1;min-height:0;min-width:0;overflow:auto;scrollbar-width:thin;scrollbar-gutter:stable;padding:0 6px 6px}
.file-manager-columns,.file-manager-row{display:grid;grid-template-columns:minmax(110px,1fr) 76px 80px 106px 32px;align-items:center;gap:12px;min-width:0;padding:0 6px}.file-manager-columns{position:sticky;top:0;z-index:1;min-height:32px;margin-bottom:3px;border-bottom:1px solid #eaf0f5;background:#fff;font-size:11px;color:#77869a}.file-manager-columns>span:first-child{padding-left:6px}
.file-manager-row{position:relative;isolation:isolate;overflow:hidden;box-sizing:border-box;height:38px;border-bottom:1px solid #f0f3f7;border-radius:5px;background:transparent;font-size:12px}.file-manager-row:last-child{border-bottom-color:transparent}.file-manager-row:hover{background:#f6f8fb}.file-manager-row.selected{background:#edf3f9;box-shadow:inset 2px 0 #8ba8c7}.file-manager-row.selected:hover{background:#e8f0f8}
.file-manager-entry{display:flex;align-items:center;gap:9px;width:100%;height:100%;min-width:0;padding:4px 6px;text-align:left}.file-manager-entry-icon{display:grid;place-items:center;flex:0 0 22px;height:22px;border-radius:5px;background:#f3f5f8;color:#8391a3}.file-manager-entry-icon[data-kind=folder]{background:#eaf0f7;color:#6e89a8}.file-manager-entry-icon svg{width:14px;height:14px}.file-manager-entry>span:not(.file-manager-entry-icon){display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.file-manager-name-line{display:flex;align-items:center;gap:10px;min-width:0}.file-manager-name-line strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:450;color:#40536b}.file-manager-row.selected strong{color:#345477}.file-manager-entry small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;color:#7d8b9d}.file-manager-entry[aria-disabled=true]{cursor:default}.file-manager-type,.file-manager-size,.file-manager-row time{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7c899a;font-variant-numeric:tabular-nums}.file-manager-size{text-align:right}.file-manager-columns>span:nth-child(3){text-align:right}.manager-active-downloads{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;font-size:10px;color:#7b91ab}.manager-active-downloads svg{width:12px;height:12px}
.file-manager-reveal{opacity:0}.file-manager-row:is(:hover,:focus-within) .file-manager-reveal{opacity:1}.has-search .file-manager-row{height:46px}
.file-manager-collection.grid-collection{border:0;background:transparent}.file-manager-scroll.is-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,210px),1fr));grid-auto-rows:104px;align-content:start;gap:10px;padding:1px 1px 12px;scrollbar-gutter:auto}.is-grid .file-manager-row,.has-search .is-grid .file-manager-row{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:minmax(0,1fr) 18px;gap:8px;height:104px;padding:12px;border:1px solid #e0e6ee;border-radius:9px;background:#fff}.is-grid .file-manager-row:hover{border-color:#cad7e5;background:#fafcfe}.is-grid .file-manager-row.selected{border-color:#a4bdd7;background:#f2f6fb;box-shadow:inset 0 0 0 1px #c5d6e7}.is-grid .file-manager-entry{grid-column:1/-1;grid-row:1;padding:0 24px 0 0;gap:10px}.is-grid .file-manager-entry-icon{flex-basis:30px;height:30px;border-radius:7px}.is-grid .file-manager-entry-icon svg{width:18px;height:18px}.is-grid .file-manager-type{grid-column:1;grid-row:2;display:block;font-size:10px}.is-grid .file-manager-size{grid-column:2;grid-row:2;font-size:10px}.is-grid time{display:none}.is-grid .file-manager-reveal{position:absolute;right:6px;top:6px}
.file-manager-status{display:flex;flex-shrink:0;align-items:center;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;min-height:28px;padding:4px 12px;border-top:1px solid #eaf0f5;background:#fcfdfe;font-size:11px;color:#77869a}.grid-collection .file-manager-status{padding-inline:2px;background:transparent}
.file-manager-empty{display:flex;flex:1;flex-direction:column;justify-content:center;align-items:center;min-height:160px;gap:8px;padding:24px;text-align:center;color:#8a97a8}.file-manager-empty-icon{display:grid;place-items:center;width:42px;height:42px;margin-bottom:5px;border:1px solid #e8edf4;border-radius:11px;background:#f6f8fb;color:#8a9eb7}.file-manager-empty-icon svg{width:20px;height:20px}.file-manager-empty strong{font-size:13px;font-weight:500;color:#65758b}.file-manager-empty p{max-width:300px;margin:0;font-size:11px;line-height:1.7;color:#9aa5b4}.file-manager-empty button{padding:5px 10px;margin-top:5px;border:1px solid #e1e8f0;border-radius:6px;background:#fff;color:#6784a6;font-size:11px}
.file-manager :is(button,input,select,label){-webkit-app-region:no-drag}.file-manager :is(button,select,.file-manager-row){transition:background-color 140ms ease,border-color 140ms ease,color 140ms ease}.file-manager :is(.file-manager-icon,.file-manager-back,.file-manager-breadcrumbs button,.file-manager-search button):hover:not(:disabled){background:#eaf0f6;color:#4b6b90}.file-manager :is(button,input,select):focus-visible{outline:2px solid #7296bd;outline-offset:-2px}.file-manager button:disabled{opacity:.35;cursor:default}
@container (max-width:760px){.file-manager-toolbar{flex-basis:100%}.file-manager-options{flex:1}.file-manager-search{flex:1;width:auto}.file-manager-columns,.file-manager-row{grid-template-columns:minmax(100px,1fr) 62px 70px 32px;gap:8px}.file-manager-row time,.file-manager-columns>span:nth-child(4){display:none}}
@container (max-width:460px){.file-manager-body{padding:12px;gap:10px}.file-manager-head{padding-inline:12px}.file-manager-title p,.file-manager-back>span{display:none}.file-manager-breadcrumbs button{max-width:140px}.file-manager-columns,.file-manager-row{grid-template-columns:minmax(80px,1fr) 64px 32px;gap:5px}.file-manager-type,.file-manager-columns>span:nth-child(2){display:none}.file-manager-sort select{max-width:88px;min-width:76px}.file-manager-options{gap:6px}.file-manager-search{width:0}}
@media(hover:none){.file-manager-reveal{opacity:1}}@media(prefers-reduced-motion:reduce){.file-manager :is(button,select,.file-manager-row){transition:none}}
</style>
