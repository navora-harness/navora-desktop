<template>
  <div class="global-resources" :data-resource-kind="kind">
    <div class="global-resource-content">
    <div v-if="kind==='browser'" class="browser-resource-controls">
      <div class="browser-scope-buttons" role="group" aria-label="浏览器资源范围"><button type="button" :aria-pressed="scope==='current'" :disabled="!activeChatId" @click="scope='current'">当前对话</button><button type="button" :aria-pressed="scope==='all'" @click="scope='all'">全部对话</button></div>
      <div class="browser-display-controls"><label class="browser-filter-select"><select v-model="resourceFilter" aria-label="浏览器资源显示范围"><option value="pages">有页面</option><option value="all">全部会话</option></select><AppIcon icon="chevron-down" /></label><button class="resource-action" type="button" title="在指定对话中新建页面" aria-label="新建浏览器页面" @click="beginCreatePage"><AppIcon icon="plus" /></button></div>
    </div>
    <div class="global-resource-filter">
      <AppIcon icon="magnifying-glass" />
      <input v-model="query" :aria-label="kind === 'files' ? '搜索文件所属对话' : '搜索浏览器资源'" :placeholder="kind==='files'?'搜索对话':'搜索对话、会话、页面或网址'" />
      <button v-if="query" type="button" class="resource-action" aria-label="清空资源搜索" title="清空搜索" @click="query=''"><AppIcon icon="xmark" /></button>
      <button class="resource-action" type="button" title="刷新资源" aria-label="刷新资源" :disabled="loading" @click="reload(true)"><AppIcon icon="arrow-rotate-right" /></button>
    </div>
    <div class="global-resource-scope">{{kind==='browser'?'所属对话':'对话'}} <span>{{ owners.length }}<template v-if="kind==='browser'"> · {{ matchingPages }} 个页面</template></span></div>
    <div v-if="error" class="global-resource-empty">{{ error }} <button type="button" @click="reload()">重试</button></div>
    <div v-if="loading && !owners.length" class="global-resource-empty">正在加载…</div>
    <div v-else-if="!owners.length&&!error" class="global-resource-empty">{{ query ? `没有匹配“${query}”的资源` : kind === 'files' ? '暂无文件' : '当前范围暂无浏览器页面' }}<button v-if="query" type="button" @click="query=''">清空搜索</button><button v-if="kind==='browser'&&scope==='current'" type="button" @click="scope='all'">查看全部对话</button><button v-if="kind==='browser'&&!query" type="button" @click="beginCreatePage">新建页面</button></div>
    <div v-else class="global-resource-list">
      <div v-if="unavailable" class="global-resource-empty">部分文件夹暂不可读</div>
      <section v-for="owner in owners" :key="owner.id" class="resource-owner" :class="{expanded: isExpanded(owner.id)}" :data-owner-id="owner.id">
        <div class="resource-owner-head" @contextmenu="kind==='browser' && openOwnerMenu($event,owner)">
          <button type="button" class="resource-owner-toggle" :aria-expanded="canExpand(owner.id) ? isExpanded(owner.id) : undefined" @click="toggleOwner(owner.id)">
            <AppIcon v-if="canExpand(owner.id)" :icon="isExpanded(owner.id)?'chevron-down':'chevron-right'" class="owner-chevron" />
            <span v-else class="owner-chevron-space" aria-hidden="true" />
            <AppIcon v-if="kind==='files'" icon="folder" class="owner-folder-icon" />
            <AppIcon v-else icon="comments" class="owner-chat-icon" />
            <span class="owner-title" :title="owner.title">{{ owner.title || '新对话' }}</span>
            <span v-if="owner.id === activeChatId" class="owner-current">当前</span>
          </button>
          <BrowserResourceActions v-if="kind==='browser'" class="owner-actions" :count="isExpanded(owner.id) ? undefined : browserCount(owner.id)" :label="`${owner.title || '新对话'}更多操作`" :active="ownerMenu?.open && menuOwner?.id===owner.id" @more="openOwnerMenu($event,owner)" />
          <button v-else type="button" class="resource-action owner-open" title="打开此对话" aria-label="打开资源所属对话" @click="emit('selectChat',owner.id)"><AppIcon icon="arrow-up-right-from-square" /></button>
        </div>
        <div v-if="isExpanded(owner.id)" class="resource-owner-body">
          <WorkspaceFilesPanel v-if="kind === 'files'" :key="owner.id" :chat-id="owner.id" :downloads="downloads" embedded navigation-only @notify="notify" @preview="emit('preview',{chatId:owner.id,path:$event.path})" @browse="emit('browse',{chatId:owner.id,path:$event})" />
          <BrowserResourcesPanel v-else :chat-id="owner.id" :tree="sessionsOf(owner.id)" :include-empty="resourceFilter==='all'" :search="query" :owner-matched="!!query.trim()&&owner.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())" embedded :header-visible="false" :is-remote="isRemote" :owner-label="ownerLabel" :dnd-mime="dndMime" @notify="notify" @add-ref="emit('addRef',$event)" @ask-close-session="emit('askCloseSession',$event)" @remote-view="emit('remoteView',$event)" />
        </div>
      </section>
    </div>
    <button v-if="kind==='browser'&&hiddenEmptySessions&&!query&&resourceFilter==='pages'" type="button" class="empty-session-discovery" @click="resourceFilter='all'">查看其它对话的空会话（{{ hiddenEmptySessions }}）</button>
    </div>
    <SidebarContextMenu ref="ownerMenu">
      <button type="button" class="sidebar-more-item" role="menuitem" :disabled="loading || !!busyOwner" @click="menuOwner && (createSessionOwner=menuOwner)"><AppIcon icon="plus" /><span>新建会话</span></button>
      <button type="button" class="sidebar-more-item" role="menuitem" :disabled="loading || !!busyOwner" @click="menuOwner && openOwner(menuOwner)"><AppIcon icon="browser" /><span>打开浏览器</span></button>
      <button type="button" class="sidebar-more-item" role="menuitem" @click="menuOwner && emit('selectChat',menuOwner.id)"><AppIcon icon="comments" /><span>打开对话</span></button>
    </SidebarContextMenu>
    <BrowserSessionCreateDialog :model-value="!!createSessionOwner" :chat-id="createSessionOwner?.id||''" :owner-title="createSessionOwner?.title" @update:model-value="!$event&&(createSessionOwner=null)" @created="openCreatedSession" />
    <v-dialog v-model="createPageDialog" max-width="420" :persistent="!!busyOwner"><v-card><v-card-title>新建浏览器页面</v-card-title><v-card-text><label class="create-owner-label">所属对话<select v-model="createPageOwner" aria-label="新建页面所属对话"><option v-for="chat in chats" :key="chat.id" :value="chat.id">{{ chat.title||'新对话' }}</option></select></label><p class="create-owner-hint">优先使用此对话的默认会话；没有会话时创建临时会话。</p><p v-if="createPageError" role="alert" class="create-page-error">{{ createPageError }}</p></v-card-text><v-card-actions><v-spacer /><v-btn :disabled="!!busyOwner" @click="createPageDialog=false">取消</v-btn><v-btn color="primary" :disabled="!createPageOwner" :loading="!!busyOwner" @click="createOwnerPage">新建页面</v-btn></v-card-actions></v-card></v-dialog>
  </div>
</template>
<script setup lang="ts">
import AppIcon from '../icons/AppIcon.vue'
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {BrowserContextRef,BrowserDownloadEntry,BrowserTreeSession,ChatSession} from '@shared/types'
import WorkspaceFilesPanel from './WorkspaceFilesPanel.vue'
import BrowserResourcesPanel from './BrowserResourcesPanel.vue'
import BrowserResourceActions from './BrowserResourceActions.vue'
import SidebarContextMenu from './SidebarContextMenu.vue'
import BrowserSessionCreateDialog from './BrowserSessionCreateDialog.vue'
import {filterBrowserResourceOwners} from '@shared/browser-resource-filter'
const props=defineProps<{kind:'files'|'browser';active?:boolean;chats:ChatSession[];activeChatId:string;isRemote:boolean;ownerLabel:(id:string)=>string;dndMime:string}>()
const emit=defineEmits<{notify:[text:string,color?:string];preview:[selection:{chatId:string;path:string}];browse:[selection:{chatId:string;path:string}];selectChat:[id:string];addRef:[ref:BrowserContextRef];askCloseSession:[session:BrowserTreeSession];remoteView:[id:string]}>()
const query=ref(''),expanded=ref(props.activeChatId),sessions=ref<BrowserTreeSession[]>([]),loading=ref(false),error=ref('')
const scope=ref<'current'|'all'>('all'),resourceFilter=ref<'pages'|'all'>('pages')
try{const saved=localStorage.getItem('navora.browser-resource-scope');if(saved==='current'&&props.activeChatId)scope.value='current'}catch{}
watch(scope,value=>{try{localStorage.setItem('navora.browser-resource-scope',value)}catch{}})
const createSessionOwner=ref<ChatSession|null>(null),createPageDialog=ref(false),createPageOwner=ref(''),createPageError=ref('')
const downloads=ref<BrowserDownloadEntry[]>([])
const busyOwner=ref(''),menuOwner=ref<ChatSession|null>(null),ownerMenu=ref<InstanceType<typeof SidebarContextMenu>|null>(null)
let offDownloads:(()=>void)|undefined,downloadsUpdated=false
function updateDownloads(items:BrowserDownloadEntry[]){
  const completed=items.filter(item=>item.state==='completed'&&downloads.value.some(previous=>previous.id===item.id&&previous.state!=='completed'))
  if(completed.length){fileOwners.value=new Set([...fileOwners.value,...completed.map(item=>item.chatId)]);void reload(true)}
  downloads.value=items
}
onMounted(()=>{if(props.kind==='files'){void window.navora?.downloads.list().then(items=>{if(!downloadsUpdated)updateDownloads(items)}).catch(()=>{});offDownloads=window.navora?.downloads.onChanged(payload=>{downloadsUpdated=true;updateDownloads(payload.downloads)})}})
onBeforeUnmount(()=>offDownloads?.())
const fileOwners=ref(new Set<string>()),unavailable=ref(0)
const downloadOwners=computed(()=>new Set(downloads.value.filter(item=>item.state!=='completed').map(item=>item.chatId)))
const sessionsByChat=computed(()=>{
  const grouped=new Map<string,BrowserTreeSession[]>()
  for(const session of sessions.value){
    const owned=grouped.get(session.chatId)
    if(owned)owned.push(session)
    else grouped.set(session.chatId,[session])
  }
  return grouped
})
const sessionsOf=(id:string)=>sessionsByChat.value.get(id)||[]
const browserCount=(id:string)=>sessionsOf(id).reduce((n,s)=>n+s.windows.length,0)
const canExpand=(id:string)=>props.kind==='files'||sessionsOf(id).length>0||id===props.activeChatId
const isExpanded=(id:string)=>(expanded.value===id||(props.kind==='browser'&&!!query.value.trim()))&&canExpand(id)
const owners=computed(()=>{
  if(props.kind==='browser')return filterBrowserResourceOwners(props.chats,sessions.value,{currentChatId:props.activeChatId,scope:scope.value,includeEmpty:resourceFilter.value==='all',query:query.value})
  const needle=query.value.trim().toLocaleLowerCase()
  return props.chats.filter(chat=>props.kind==='browser'||fileOwners.value.has(chat.id)||downloadOwners.value.has(chat.id))
    .filter(chat=>!needle||chat.title.toLocaleLowerCase().includes(needle)||(props.kind==='browser'&&sessionsOf(chat.id).some(s=>s.windows.some(w=>(w.title+' '+w.url).toLocaleLowerCase().includes(needle)))))
})
const matchingPages=computed(()=>owners.value.reduce((count,owner)=>count+sessionsOf(owner.id).reduce((sum,session)=>sum+session.windows.filter(page=>!query.value.trim()||`${owner.title} ${session.name||`会话 ${session.sessionIndex}`} ${page.title} ${page.url}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())).length,0),0))
const hiddenEmptySessions=computed(()=>sessions.value.filter(session=>!session.windows.length&&(scope.value==='all'||session.chatId===props.activeChatId)&&!owners.value.some(owner=>owner.id===session.chatId)).length)
function notify(text:string,color?:string){emit('notify',text,color)}
function toggleOwner(id:string){if(!canExpand(id)){emit('selectChat',id);return}expanded.value=expanded.value===id?'':id;if(props.kind==='files')emit('browse',{chatId:id,path:'.'})}
function openOwnerMenu(event:MouseEvent,owner:ChatSession){menuOwner.value=owner;ownerMenu.value?.show(event)}
async function openOwner(owner:ChatSession,newSession=false){
  if(!window.navora||busyOwner.value)return
  busyOwner.value=owner.id
  try{
    const tree=sessionsOf(owner.id)
    const pages=tree.flatMap(s=>s.windows)
    const page=newSession?undefined:pages.find(w=>w.selected)||pages[0]
    if(page){
      if(props.isRemote)emit('remoteView',page.windowId)
      else await window.navora.browser.setVisible(page.windowId,true)
    }else{
      const session=(!newSession&&(tree.find(s=>s.isDefault)||tree[0]))||await window.navora.browser.createSession(owner.id,{persist:newSession})
      const created=await window.navora.browser.createWindow(session.sessionId,{url:'about:blank',show:!props.isRemote})
      if(props.isRemote)emit('remoteView',created.windowId)
    }
    const updated=await window.navora.browser.tree(owner.id)
    if(disposed)return
    updateSessions(owner.id,updated)
    expanded.value=owner.id
  }catch(error){notify(error instanceof Error?error.message:'打开浏览器失败')}
  finally{busyOwner.value=''}
}
function beginCreatePage(){createPageOwner.value=props.chats.some(chat=>chat.id===props.activeChatId)?props.activeChatId:props.chats[0]?.id||'';createPageError.value='';createPageDialog.value=true}
async function createOwnerPage(){
  if(!window.navora||busyOwner.value||!createPageOwner.value)return
  const ownerId=createPageOwner.value;busyOwner.value=ownerId;createPageError.value=''
  try{
    if(!props.chats.some(chat=>chat.id===ownerId))throw Error('所属对话已不存在')
    const tree=await window.navora.browser.tree(ownerId),session=tree.find(s=>s.isDefault)||tree[0]||await window.navora.browser.createSession(ownerId,{persist:false})
    const page=await window.navora.browser.createWindow(session.sessionId,{url:'about:blank',show:!props.isRemote})
    if(props.isRemote)emit('remoteView',page.windowId)
    updateSessions(ownerId,await window.navora.browser.tree(ownerId));expanded.value=ownerId;scope.value='all';createPageDialog.value=false
  }catch(error){createPageError.value=error instanceof Error?error.message:'创建页面失败'}
  finally{busyOwner.value=''}
}
async function openCreatedSession(session:BrowserTreeSession){
  if(!window.navora||busyOwner.value)return
  busyOwner.value=session.chatId
  try{
    const page=await window.navora.browser.createWindow(session.sessionId,{url:'about:blank',show:!props.isRemote})
    if(props.isRemote)emit('remoteView',page.windowId)
    updateSessions(session.chatId,await window.navora.browser.tree(session.chatId));expanded.value=session.chatId
  }catch(error){notify(error instanceof Error?error.message:'会话已创建，但页面打开失败')}
  finally{busyOwner.value=''}
}
let disposed=false,again=false,browserRevision=0,timer:ReturnType<typeof setTimeout>|undefined,unsubscribe:(()=>void)|undefined
function updateSessions(chatId:string,tree:BrowserTreeSession[]){
  browserRevision++
  // A parent-chat snapshot also contains its children; keep each session under its own owner.
  sessions.value=[...sessions.value.filter(s=>s.chatId!==chatId),...tree.filter(s=>s.chatId===chatId)]
}
async function reload(force=false){
  if(props.active===false)return
  if(loading.value){again=true;return}
  loading.value=true;error.value=''
  try{if(props.kind==='files'){const result=await window.navora!.workspace.owners(force===true);if(!disposed){fileOwners.value=new Set(result.chatIds);unavailable.value=result.unavailable}}else{const revision=browserRevision,result=await window.navora!.browser.treeAll();if(!disposed){if(revision===browserRevision)sessions.value=result;else again=true}}}
  catch{if(!disposed)error.value='加载资源失败'}
  finally{loading.value=false;if(again&&!disposed){again=false;void reload()}}
}
watch(()=>props.active,active=>{if(active){void reload();if(props.kind==='files'&&expanded.value)emit('browse',{chatId:expanded.value,path:'.'})}})
watch(()=>owners.value.map(owner=>owner.id).join('\0'),()=>{const list=owners.value;if(!list.some(owner=>owner.id===expanded.value))expanded.value=list.find(owner=>owner.id===props.activeChatId)?.id||list[0]?.id||'';if(props.kind==='files'&&props.active!==false)emit('browse',{chatId:expanded.value,path:'.'})})
watch(()=>props.activeChatId,id=>{if(props.kind==='browser'){expanded.value=id;if(!id)scope.value='all'}})
watch(()=>props.chats.map(chat=>chat.id).join(','),()=>{void reload()})
onMounted(()=>{void reload();const changed=()=>{clearTimeout(timer);timer=setTimeout(()=>void reload(),120)};unsubscribe=props.kind==='browser'?window.navora?.browser.onTreeUpdated(payload=>updateSessions(payload.chatId,payload.tree)):window.navora?.workspace.onChanged(changed)})
onBeforeUnmount(()=>{disposed=true;clearTimeout(timer);unsubscribe?.()})
</script>
<style scoped>
.global-resources{display:flex;flex-direction:column;flex:1;min-height:0;font-size:12px;color:#566174}
.global-resource-content{display:flex;flex-direction:column;flex:1;min-height:0}
.global-resource-filter{display:flex;align-items:center;gap:7px;border:1px solid #d8dfe8;border-radius:8px;background:#fff;padding:3px 7px;margin:0 2px 10px;min-height:32px}.global-resource-filter>svg{width:12px;color:#818b98}.global-resource-filter:focus-within{border-color:#6588b2;box-shadow:0 0 0 2px #6588b21a}
.global-resource-filter input{min-width:0;flex:1;outline:none;color:#37455a;font-size:12px;width:100%}.global-resource-filter input::placeholder{color:#7a8492}
.global-resource-scope{display:flex;align-items:center;justify-content:space-between;padding:0 7px 7px;color:#858e9b;font-size:11px}.global-resource-list{overflow-y:auto;min-height:0;flex:1;scrollbar-width:thin;padding:0 2px}
.resource-owner-head{display:flex;align-items:center;gap:1px}.resource-owner-toggle{display:flex;align-items:center;gap:7px;min-width:0;flex:1;min-height:34px;padding:5px;border-radius:7px;cursor:pointer;text-align:left;color:#566174}
.resource-owner-toggle:hover{background:#e9edf2;color:#283d57}.owner-chevron,.owner-chevron-space{width:8px;height:8px;flex-shrink:0}.owner-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.owner-current{font-size:10px;color:#6c86a4;white-space:nowrap}
.resource-action{width:26px;height:26px;display:grid;place-items:center;border:1px solid transparent;border-radius:6px;flex-shrink:0;color:#65758a;cursor:pointer}.resource-action>svg{width:12px;height:12px}.resource-action:hover{background:#e7e9ee;border-color:#dce0e7;color:#272d36}.resource-action:disabled{opacity:.45;cursor:default}.owner-open{opacity:0}.resource-owner-head:is(:hover,:focus-within) .owner-open{opacity:1}
.resource-owner-body{padding:3px 0 8px 11px;margin:0 0 4px 8px;border-left:1px solid #d8dfe8;min-height:0}.resource-owner-body :deep(.sidebar-panel){margin:0;padding:0;border:0}.resource-owner-body :deep(.res-head){min-height:28px;padding:0;justify-content:space-between}.resource-owner-body :deep(.res-body){max-height:45dvh;overflow:auto}.resource-owner-body :deep(.res-tree){max-height:none;overflow:visible}.resource-owner-body :deep(.res-empty){min-height:60px}.resource-owner-body :deep(.ws-root){font-size:10px}
.global-resource-empty{padding:20px 10px;color:#8591a0;text-align:center}.global-resource-empty button{color:#3a6c9d;margin-left:5px}
.resource-owner-toggle,.resource-action,.owner-open{transition:background-color 140ms ease,color 140ms ease,opacity 140ms ease}button:focus-visible{outline:2px solid #537ab9;outline-offset:-2px}
@media(hover:none){.owner-open{opacity:1}}@media(prefers-reduced-motion:reduce){.resource-owner-toggle,.resource-action,.owner-open{transition:none}}
.owner-folder-icon{width:12px;height:12px;color:#7c8ba0;flex-shrink:0}
.owner-chat-icon{width:13px;height:13px;color:#6c85a1;flex-shrink:0}
.global-resources[data-resource-kind=browser] .resource-owner{margin-bottom:4px}.global-resources[data-resource-kind=browser] .resource-owner-head{min-height:36px}.global-resources[data-resource-kind=browser] .resource-owner-body{padding:1px 0 5px 11px}.global-resources[data-resource-kind=browser] .resource-owner-body :deep(.res-body){max-height:none;overflow:visible}
.global-resources[data-resource-kind=files] .resource-owner{margin-bottom:4px}.global-resources[data-resource-kind=files] .resource-owner.expanded>.resource-owner-head{background:transparent;border-radius:6px}.global-resources[data-resource-kind=files] .resource-owner.expanded .owner-title{color:#46566b;font-weight:600}.global-resources[data-resource-kind=files] .resource-owner-body{padding:1px 0 5px 4px;margin:0 0 2px;border:0;min-height:0}.global-resources[data-resource-kind=files] .resource-owner-body :deep(.res-body){max-height:35dvh}.global-resources[data-resource-kind=files] .resource-owner-body :deep(.res-empty){min-height:38px;font-size:11px}.global-resources[data-resource-kind=files] .resource-owner-toggle{min-height:30px;font-size:12px}.global-resources[data-resource-kind=files] .owner-chevron{width:10px;height:10px}
.browser-resource-controls{display:flex;align-items:center;justify-content:space-between;gap:7px;flex-wrap:wrap;margin:0 2px 10px}.browser-scope-buttons{display:flex;padding:3px;border-radius:7px;background:var(--navora-surface);gap:2px}.browser-scope-buttons button{padding:4px 7px;font-size:11px;border-radius:5px;color:var(--navora-muted);white-space:nowrap}.browser-scope-buttons button[aria-pressed=true]{background:var(--control-selected);color:var(--navora-accent)}.browser-scope-buttons button:disabled{opacity:.4}.browser-display-controls{display:flex;align-items:center;gap:3px}.browser-display-controls select{font-size:11px;min-width:76px;padding:4px;color:var(--navora-muted);border-radius:5px;border:1px solid var(--control-border)}.global-resource-filter input:focus-visible{outline:none!important;box-shadow:none!important}.empty-session-discovery{font-size:11px;line-height:1.7;padding:10px 7px;text-align:left;color:var(--navora-accent);border-top:1px solid var(--control-border);margin-top:5px}.create-owner-label{display:flex;flex-direction:column;gap:8px;font-size:12px}.create-owner-label select{max-width:100%;border:1px solid var(--control-border);border-radius:8px;padding:10px;color:var(--navora-ink)}.create-owner-hint{font-size:12px;line-height:1.7;color:var(--navora-muted);margin:12px 0 0}.create-page-error{font-size:12px;color:rgb(var(--v-theme-error));margin-top:10px}
.browser-filter-select{position:relative;display:flex;align-items:center}.browser-filter-select select{padding-right:20px}.browser-filter-select>.app-icon{position:absolute;right:6px;width:10px;height:10px;pointer-events:none;color:var(--navora-muted)}
</style>
