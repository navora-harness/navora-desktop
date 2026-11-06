<template>
  <div class="global-resources" :data-resource-kind="kind">
    <div v-if="kind==='browser'" class="browser-resource-controls">
      <div class="browser-scope-buttons" role="group" aria-label="浏览器资源范围"><button type="button" :aria-pressed="scope==='current'" :disabled="!activeChatId" @click="scope='current'">当前对话</button><button type="button" :aria-pressed="scope==='all'" @click="scope='all'">全部对话</button></div>
      <div class="browser-display-controls"><button class="resource-action" type="button" title="新建浏览器页面" aria-label="新建浏览器页面" :disabled="!!busyOwner" @click="beginCreatePage()"><AppIcon icon="plus" /></button><button class="resource-action" type="button" title="浏览器资源选项" aria-label="浏览器资源选项" @click="resourceMenu?.show($event)"><AppIcon icon="ellipsis" /></button></div>
    </div>
    <div class="global-resource-filter">
      <AppIcon icon="magnifying-glass" /><input v-model="query" :aria-label="kind==='files'?'搜索文件所属对话':'搜索浏览器资源'" :placeholder="kind==='files'?'搜索对话':'搜索会话、页面或网址'" />
      <button v-if="query" type="button" class="resource-action" aria-label="清空资源搜索" @click="query=''"><AppIcon icon="xmark" /></button><button class="resource-action" type="button" title="刷新资源" aria-label="刷新资源" :disabled="loading" @click="reload(true)"><AppIcon icon="arrow-rotate-right" /></button>
    </div>
    <div v-if="error" class="global-resource-empty" role="status">{{ error }} <button type="button" @click="reload()">重试</button></div>
    <div v-if="kind==='browser'" class="global-resource-list browser-session-list" :aria-busy="loading">
      <BrowserResourcesPanel :chat-id="activeChatId" :tree="browserModel.sessions" :known-session-ids="[DEFAULT_BROWSER_SESSION_ID,...sessions.map(session=>session.sessionId)]" :search="query" prefiltered :show-owners="scope==='all'" embedded :header-visible="false" :is-remote="isRemote" :owner-label="ownerLabel" :dnd-mime="dndMime" @notify="notify" @add-ref="emit('addRef',$event)" @ask-close-session="emit('askCloseSession',$event)" @remote-view="emit('remoteView',$event)" @request-page="beginCreatePage($event)" />
      <p v-if="query.trim()&&!browserModel.matched&&!loading&&!error" class="global-resource-empty">没有匹配的资源</p>
      <button v-if="browserModel.hiddenEmpty&&!query.trim()" type="button" class="empty-session-discovery" @click="resourceFilter='all'">显示空会话（{{ browserModel.hiddenEmpty }}）</button>
    </div>
    <template v-else>
      <div class="global-resource-scope">对话 <span>{{ owners.length }}</span></div>
      <div v-if="loading&&!owners.length" class="global-resource-empty">正在加载…</div>
      <div v-else-if="!owners.length&&!error" class="global-resource-empty">{{ query?'没有匹配的资源':'暂无文件' }}</div>
      <div v-else class="global-resource-list">
        <div v-if="unavailable" class="global-resource-empty">部分文件夹暂不可读</div>
        <section v-for="owner in owners" :key="owner.id" class="resource-owner" :class="{expanded:expanded===owner.id}" :data-owner-id="owner.id">
          <div class="resource-owner-head"><button type="button" class="resource-owner-toggle" :aria-expanded="hasOwnerFolders(owner.id)?expanded===owner.id:undefined" @click="toggleOwner(owner.id)"><AppIcon v-if="hasOwnerFolders(owner.id)" :icon="expanded===owner.id?'caret-down':'caret-right'" class="owner-chevron" /><span v-else class="owner-disclosure-space" aria-hidden="true" /><AppIcon icon="folder" class="owner-folder-icon" /><span class="owner-title" :title="owner.title">{{ owner.title||'新对话' }}</span><span v-if="owner.id===activeChatId" class="owner-current">当前</span></button><button type="button" class="resource-action owner-open" title="打开此对话" aria-label="打开资源所属对话" @click="emit('selectChat',owner.id)"><AppIcon icon="arrow-up-right-from-square" /></button></div>
          <div v-if="expanded===owner.id&&hasOwnerFolders(owner.id)" class="resource-owner-body"><WorkspaceFilesPanel :key="owner.id" :chat-id="owner.id" :downloads="downloads" embedded navigation-only @notify="notify" @preview="emit('preview',{chatId:owner.id,path:$event.path})" @browse="emit('browse',{chatId:owner.id,path:$event})" /></div>
        </section>
      </div>
    </template>
    <SidebarContextMenu ref="resourceMenu">
      <button type="button" class="sidebar-more-item" role="menuitem" :disabled="!!busyOwner" @click="beginCreateSession"><AppIcon icon="layer-group" /><span>新建专用会话…</span></button>
      <button type="button" class="sidebar-more-item" role="menuitemcheckbox" :aria-checked="resourceFilter==='all'" @click="resourceFilter=resourceFilter==='all'?'pages':'all'"><AppIcon icon="list-ul" /><span>显示空会话</span></button>
    </SidebarContextMenu>
    <BrowserSessionCreateDialog :model-value="!!createSessionOwner" :chat-id="createSessionOwner?.id||''" :owner-title="createSessionOwner?.title" @update:model-value="!$event&&(createSessionOwner=null)" @created="openCreatedSession" />
    <BrowserContentDialog v-model="createPageDialog" max-width="400" :persistent="!!busyOwner"><v-card><v-card-title>{{ createMode==='session'?'新建专用会话':'新建浏览器页面' }}</v-card-title><v-card-text><label class="create-owner-label">所属对话<select v-model="createPageOwner" aria-label="新建页面所属对话"><option v-for="chat in chats" :key="chat.id" :value="chat.id">{{ chat.title||'新对话' }}</option></select></label><p v-if="!chats.length" class="create-page-error">请先新建一个对话。</p><p v-if="createPageError" role="alert" class="create-page-error">{{ createPageError }}</p></v-card-text><v-card-actions><v-spacer /><v-btn :disabled="!!busyOwner" @click="createPageDialog=false">取消</v-btn><v-btn color="primary" :disabled="!createPageOwner" :loading="!!busyOwner" @click="confirmOwner">{{ createMode==='session'?'继续':'新建页面' }}</v-btn></v-card-actions></v-card></BrowserContentDialog>
  </div>
</template>
<script setup lang="ts">
import AppIcon from '../icons/AppIcon.vue'
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {BrowserContextRef,BrowserDownloadEntry,BrowserTreeSession,ChatSession} from '@shared/types'
import WorkspaceFilesPanel from './WorkspaceFilesPanel.vue'
import BrowserResourcesPanel from './BrowserResourcesPanel.vue'
import SidebarContextMenu from './SidebarContextMenu.vue'
import BrowserContentDialog from '../BrowserContentDialog.vue'
import BrowserSessionCreateDialog from './BrowserSessionCreateDialog.vue'
import {browserResourceSessions,mergeBrowserResourceSessions} from '@shared/browser-resource-sessions'
import {DEFAULT_BROWSER_SESSION_ID} from '@shared/browser-session'
import {downloadRelativePath} from '@shared/workspace-downloads'
const props=defineProps<{kind:'files'|'browser';active?:boolean;chats:ChatSession[];activeChatId:string;isRemote:boolean;ownerLabel:(id:string)=>string;dndMime:string}>()
const emit=defineEmits<{notify:[text:string,color?:string];preview:[selection:{chatId:string;path:string}];browse:[selection:{chatId:string;path:string}];selectChat:[id:string];addRef:[ref:BrowserContextRef];askCloseSession:[session:BrowserTreeSession];remoteView:[id:string]}>()
const query=ref(''),expanded=ref(props.activeChatId),sessions=ref<BrowserTreeSession[]>([]),loading=ref(false),error=ref(''),scope=ref<'current'|'all'>('all'),resourceFilter=ref<'pages'|'all'>('pages')
try{const saved=localStorage.getItem('navora.browser-resource-scope');if(saved==='current'&&props.activeChatId)scope.value='current'}catch{}
watch(scope,value=>{try{localStorage.setItem('navora.browser-resource-scope',value)}catch{}})
const browserModel=computed(()=>browserResourceSessions(props.chats,sessions.value,{currentChatId:props.activeChatId,scope:scope.value,includeEmpty:resourceFilter.value==='all',query:query.value}))
const resourceMenu=ref<InstanceType<typeof SidebarContextMenu>>(),createSessionOwner=ref<Pick<ChatSession,'id'|'title'>|null>(null),createPageDialog=ref(false),createPageOwner=ref(''),createPageError=ref(''),createMode=ref<'page'|'session'>('page'),createPageSession=ref(''),busyOwner=ref('')
const downloads=ref<BrowserDownloadEntry[]>([]),fileOwners=ref(new Set<string>()),unavailable=ref(0)
const ownerFolderState=ref<Record<string,boolean>>({})
const downloadFolderOwners=computed(()=>new Set(downloads.value.filter(item=>downloadRelativePath(item)?.includes('/')).map(item=>item.chatId)))
function hasOwnerFolders(id:string){return ownerFolderState.value[id]===true||downloadFolderOwners.value.has(id)}
const downloadOwners=computed(()=>new Set(downloads.value.filter(item=>item.state!=='completed').map(item=>item.chatId)))
const owners=computed(()=>props.chats.filter(chat=>fileOwners.value.has(chat.id)||downloadOwners.value.has(chat.id)).filter(chat=>!query.value.trim()||chat.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
let disposed=false,again=false,browserRevision=0,timer:ReturnType<typeof setTimeout>|undefined,unsubscribe:(()=>void)|undefined,offDownloads:(()=>void)|undefined,downloadsUpdated=false
function notify(text:string,color?:string){emit('notify',text,color)}
function toggleOwner(id:string){expanded.value=expanded.value===id?'':id;emit('browse',{chatId:id,path:'.'})}
function currentOwner(){return props.activeChatId?{id:props.activeChatId,title:props.ownerLabel(props.activeChatId)}:undefined}
function beginCreatePage(sessionId=''){createMode.value='page';createPageSession.value=sessionId;createPageError.value='';const owner=currentOwner();if(owner){void createOwnerPage(owner.id);return}createPageOwner.value=props.chats[0]?.id||'';createPageDialog.value=true}
function beginCreateSession(){createMode.value='session';createPageError.value='';const owner=currentOwner();if(owner){createSessionOwner.value=owner;return}createPageOwner.value=props.chats[0]?.id||'';createPageDialog.value=true}
async function confirmOwner(){if(!createPageOwner.value)return;if(createMode.value==='session'){const owner=props.chats.find(chat=>chat.id===createPageOwner.value);if(!owner){createPageError.value='所属对话已不存在';return}createPageDialog.value=false;createSessionOwner.value=owner}else await createOwnerPage(createPageOwner.value)}
async function createOwnerPage(chatId:string){
  if(!window.navora||busyOwner.value)return
  busyOwner.value=chatId;createPageError.value=''
  try{
    const session=!createPageSession.value||createPageSession.value===DEFAULT_BROWSER_SESSION_ID?(await window.navora.browser.createSession(chatId)).sessionId:createPageSession.value
    const page=await window.navora.browser.createWindow(session,{chatId,url:'about:blank',show:!props.isRemote})
    if(props.isRemote)emit('remoteView',page.windowId)
    await refreshOwner(chatId);createPageDialog.value=false
  }catch(cause){createPageError.value=cause instanceof Error?cause.message:'创建页面失败';if(!createPageDialog.value)notify(createPageError.value)}
  finally{busyOwner.value=''}
}
async function openCreatedSession(session:BrowserTreeSession){createPageSession.value=session.sessionId;await createOwnerPage(session.chatId)}
function updateSessions(chatId:string,tree:BrowserTreeSession[]){browserRevision++;sessions.value=mergeBrowserResourceSessions(sessions.value,chatId,tree)}
async function refreshOwner(chatId:string){const tree=await window.navora!.browser.tree(chatId);if(!disposed)updateSessions(chatId,tree)}
async function inspectOwnerFolders(ids:string[]){
  const state:Record<string,boolean>={}
  let cursor=0
  await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{
    while(!disposed&&cursor<ids.length){
      const id=ids[cursor++]!
      try{const result=await window.navora!.workspace.list(id,'.');if(result.ok)state[id]=(result.entries||[]).some(entry=>entry.type==='dir')}catch{ /* The next resource refresh retries unavailable roots. */ }
    }
  }))
  if(!disposed)ownerFolderState.value=state
}
async function reload(force=false){
  if(props.active===false)return
  if(loading.value){again=true;return}loading.value=true;error.value=''
  try{if(props.kind==='files'){const result=await window.navora!.workspace.owners(force===true);if(!disposed){fileOwners.value=new Set(result.chatIds);unavailable.value=result.unavailable;await inspectOwnerFolders(result.chatIds)}}else{const revision=browserRevision,result=await window.navora!.browser.treeAll();if(!disposed){if(revision===browserRevision)sessions.value=result;else again=true}}}
  catch{if(!disposed)error.value='加载资源失败'}
  finally{loading.value=false;if(again&&!disposed){again=false;void reload()}}
}
function updateDownloads(items:BrowserDownloadEntry[]){const completed=items.filter(item=>item.state==='completed'&&downloads.value.some(previous=>previous.id===item.id&&previous.state!=='completed'));if(completed.length){fileOwners.value=new Set([...fileOwners.value,...completed.map(item=>item.chatId)]);void reload(true)}downloads.value=items}
watch(()=>props.active,active=>{if(active){void reload();if(props.kind==='files'&&expanded.value)emit('browse',{chatId:expanded.value,path:'.'})}})
watch(()=>owners.value.map(owner=>owner.id).join('\0'),()=>{if(!owners.value.some(owner=>owner.id===expanded.value))expanded.value=owners.value.find(owner=>owner.id===props.activeChatId)?.id||owners.value[0]?.id||'';if(props.kind==='files'&&props.active!==false)emit('browse',{chatId:expanded.value,path:'.'})})
watch(()=>props.activeChatId,id=>{if(!id)scope.value='all';if(props.kind==='files')expanded.value=id})
watch(()=>props.chats.map(chat=>chat.id).join(','),()=>void reload())
onMounted(()=>{void reload();const changed=()=>{clearTimeout(timer);timer=setTimeout(()=>void reload(),120)};unsubscribe=props.kind==='browser'?window.navora?.browser.onTreeUpdated(payload=>updateSessions(payload.chatId,payload.tree)):window.navora?.workspace.onChanged(changed);if(props.kind==='files'){void window.navora?.downloads.list().then(items=>{if(!downloadsUpdated)updateDownloads(items)}).catch(()=>{});offDownloads=window.navora?.downloads.onChanged(payload=>{downloadsUpdated=true;updateDownloads(payload.downloads)})}})
onBeforeUnmount(()=>{disposed=true;clearTimeout(timer);unsubscribe?.();offDownloads?.()})
</script>
<style scoped>
.global-resources{display:flex;flex-direction:column;flex:1;min-height:0;font-size:12px;color:var(--navora-ink)}.global-resource-filter{display:flex;align-items:center;gap:7px;border:1px solid var(--navora-stroke);border-radius:8px;background:var(--navora-surface);padding:3px 7px;margin:0 2px 10px;min-height:32px;flex-shrink:0}.global-resource-filter>svg{width:12px;color:var(--navora-muted)}.global-resource-filter:focus-within{border-color:var(--navora-accent)}.global-resource-filter input{min-width:0;flex:1;outline:none!important;color:inherit;font-size:12px;width:100%}.global-resource-filter input::placeholder{color:var(--navora-muted)}.global-resource-scope{display:flex;justify-content:space-between;padding:0 7px 7px;color:var(--navora-muted);font-size:11px}.global-resource-list{overflow-y:auto;min-height:0;flex:1;scrollbar-width:thin;scrollbar-gutter:stable;padding:0 2px}.resource-owner-head{display:flex;align-items:center;gap:1px}.resource-owner-toggle{display:flex;align-items:center;gap:7px;min-width:0;flex:1;min-height:30px;padding:5px;border-radius:7px;text-align:left;color:var(--navora-muted)}.resource-owner-toggle:hover{background:var(--control-hover);color:var(--navora-ink)}.owner-chevron,.owner-folder-icon,.owner-disclosure-space{width:12px;height:12px;flex-shrink:0}.owner-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.resource-action{width:26px;height:26px;display:grid;place-items:center;border:1px solid transparent;border-radius:6px;flex-shrink:0;color:var(--navora-muted)}.resource-action>svg{width:13px;height:13px}.resource-action:hover{background:var(--control-hover);color:var(--navora-ink)}.resource-action:disabled{opacity:.45}.owner-open{opacity:0}.resource-owner-head:is(:hover,:focus-within) .owner-open{opacity:1}.resource-owner-body{padding:1px 0 5px 4px;min-height:0}.resource-owner-body :deep(.sidebar-panel){margin:0;padding:0;border:0}.resource-owner-body :deep(.res-body){max-height:35dvh;overflow:auto}.resource-owner-body :deep(.res-empty){min-height:38px;font-size:11px}.global-resource-empty{margin:0;padding:16px 10px;color:var(--navora-muted);text-align:center;font-size:12px}.global-resource-empty button{color:var(--navora-accent);margin-left:5px}.browser-resource-controls{display:flex;align-items:center;justify-content:space-between;gap:7px;margin:0 2px 9px;flex-shrink:0}.browser-scope-buttons{display:flex;padding:3px;border-radius:7px;background:var(--navora-surface);gap:2px}.browser-scope-buttons button{padding:4px 7px;font-size:11px;border-radius:5px;color:var(--navora-muted);white-space:nowrap}.browser-scope-buttons button[aria-pressed=true]{background:var(--control-selected);color:var(--navora-accent)}.browser-scope-buttons button:disabled{opacity:.4}.browser-display-controls{display:flex;gap:3px}.empty-session-discovery{padding:8px 6px;color:var(--navora-muted);font-size:11px;text-align:left}.empty-session-discovery:hover{color:var(--navora-accent)}.create-owner-label{display:flex;flex-direction:column;gap:8px;font-size:12px}.create-owner-label select{width:100%;border:1px solid var(--navora-stroke);border-radius:8px;padding:10px;color:var(--navora-ink)}.create-page-error{font-size:12px;color:var(--control-danger,#b65045);margin-top:10px}.browser-session-list :deep(.sidebar-panel){margin:0;padding:0;border:0;flex:none}.browser-session-list :deep(.res-body),.browser-session-list :deep(.res-tree){max-height:none;overflow:visible}.browser-session-list :deep(.res-tree){padding-right:0;scrollbar-gutter:auto}button{cursor:pointer}button:focus-visible{outline:2px solid var(--navora-accent);outline-offset:-2px}@media(hover:none){.owner-open{opacity:1}}
</style>
<style scoped>
.owner-current{font-size:10px;color:var(--navora-muted);white-space:nowrap}.resource-owner.expanded .owner-title{font-weight:600;color:var(--navora-ink)}
</style>
