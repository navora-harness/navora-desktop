<template>
  <div class="sidebar-panel browser-panel" :class="{ 'is-collapsed': collapsed }">
    <Teleport :to="headerTarget || 'body'" :disabled="!headerTarget" defer>
    <div v-show="headerVisible !== false" class="res-head" :class="{ 'docked-head': headerTarget }">
      <button type="button" v-if="!headerTarget && !embedded" class="res-label-btn" :aria-expanded="!collapsed" aria-label="折叠或展开浏览器资源" @click="collapsed = !collapsed">
        <AppIcon icon="chevron-down" class="res-chevron" />
        <span class="res-label">浏览器资源</span>
      </button>
      <div class="res-head-actions">
      <button type="button" class="quick-browser-btn icon-btn" :disabled="!chatId || busyQuickOpen" title="打开或复用浏览器（Ctrl/⌘ Shift B）" aria-label="快速打开浏览器" @click="quickOpen"><AppIcon :icon="busyQuickOpen ? 'circle-notch' : 'browser'" :spin="busyQuickOpen" /></button>
      <button
        type="button"
        class="icon-btn"
        :disabled="!chatId || busySession"
        :class="{ loading: busySession }"
        title="新建独立浏览会话并打开页面"
        aria-label="新建独立浏览会话"
        @click="createDialog=true"
      >
        <AppIcon icon="plus" />
      </button>
      </div>
    </div>
    </Teleport>
    <Transition name="resource-body">
    <div v-show="!collapsed" class="res-body" data-ctx-menu="browser">
      <div v-if="!tree.length" class="res-empty">暂无页面<button v-if="chatId" type="button" class="icon-btn" :disabled="busySession || busyQuickOpen" title="新建页面" aria-label="在此对话中新建页面" @click="quickOpen"><AppIcon icon="plus" /></button></div>
      <div v-else class="res-tree">
        <button v-if="!prefiltered&&emptySessions.length&&!includeEmpty&&!search.trim()" class="empty-sessions-toggle" type="button" :aria-expanded="showEmpty" @click="showEmpty=!showEmpty">{{ showEmpty?'隐藏':'显示' }}空会话（{{ emptySessions.length }}）</button>
        <div v-for="s in visibleSessions" :key="s.sessionId" class="tree-sess" :data-session-id="s.sessionId" :data-session-scope="isPublicBrowserSession(s)?'default':s.persist?'persistent':'temporary'">
          <div
            class="tree-row sess"
            :class="{'is-empty':!s.windows.length}"
            draggable="true"
            @dragstart="onDragStart($event, sessionRef(s))" @dragend="($event.currentTarget as HTMLElement).classList.remove('dragging')"
            @click="selectSession(s)"
          @contextmenu="onSessionMenu($event, s)"
          :title="`${sessionLabel(s)} · ${isPublicBrowserSession(s)?'所有对话共享网站数据':s.persist?'保留会话数据':'临时会话'}`"
        >
            <button type="button" class="tree-disclosure" :aria-label="`${expandedSessions.has(s.sessionId)?'折叠':'展开'}${sessionLabel(s)}`" :aria-expanded="expandedSessions.has(s.sessionId)" @click.stop="toggleSession(s.sessionId)"><AppIcon :icon="expandedSessions.has(s.sessionId)?'caret-down':'caret-right'" /></button>
            <button type="button" class="tree-name" :aria-label="`打开${sessionLabel(s)}`" @keydown="treeKey($event,s)" @click.stop="selectSession(s)">
              <AppIcon :icon="isPublicBrowserSession(s)?'globe':'layer-group'" class="tree-kind-icon session-kind-icon" />
              <span class="session-title">{{ sessionLabel(s) }}</span><span v-if="!isPublicBrowserSession(s)" class="tree-meta">{{ s.persist?'持久':'临时' }}</span>
            </button>
            <BrowserResourceActions class="session-actions" :count="s.windows.length||undefined" :label="`${sessionLabel(s)}更多操作`" :active="sessMenu?.open && menuSession?.sessionId===s.sessionId" @more="onSessionMenu($event,s)" />
          </div>
          <div v-if="!s.windows.length&&expandedSessions.has(s.sessionId)&&!search.trim()" class="session-empty-detail">
            <button type="button" class="session-create-browser" :disabled="!!busyWindow" :aria-busy="busyWindow===s.sessionId" :aria-label="`在${sessionLabel(s)}中创建新浏览器`" @click="createWindow(s.sessionId)">
              <AppIcon :icon="busyWindow===s.sessionId?'circle-notch':'plus'" :spin="busyWindow===s.sessionId" />
              <span>{{ busyWindow===s.sessionId?'正在创建…':'创建新浏览器' }}</span>
            </button>
          </div>
          <div v-if="s.windows.length" v-show="expandedSessions.has(s.sessionId)||!!search.trim()" class="tree-children">
            <div
              v-for="w in windowsOf(s)"
              :key="w.windowId"
              :data-page-id="w.windowId" :data-owner-id="browserPageChatId(s,w)"
              class="tree-row win"
              :class="{'is-selected':w.selected}"
              draggable="true"
              @dragstart="onDragStart($event, windowRef(s, w))" @dragend="($event.currentTarget as HTMLElement).classList.remove('dragging')"
              @click="showPage(w)"
              @contextmenu="onWindowMenu($event, s, w)"
              title="点击显示页面，拖到输入框可引用"
            >
              <button type="button" class="tree-name" :title="w.url" :aria-current="w.selected?'page':undefined" @keydown="treeKey($event,s,w)" @click.stop="showPage(w)">
                <span class="tree-kind-icon browser-kind-icon"><AppIcon icon="browser" /></span>
                <span class="page-labels"><span class="page-title">{{ windowLabel(s,w) }}</span><span v-if="showOwners" class="page-owner" :title="ownerLabel(browserPageChatId(s,w))">{{ ownerLabel(browserPageChatId(s,w)) }}</span></span>
                <span v-if="w.loading" class="tree-meta">加载中</span>
              </button>
              <BrowserResourceActions class="page-actions" label="页面更多操作" :active="winMenu?.open && menuWindow?.windowId===w.windowId" @more="onWindowMenu($event,s,w)" />
            </div>
          </div>
        </div>
      </div>
    </div>
    </Transition>

    <SidebarContextMenu ref="sessMenu">
      <div class="sidebar-ctx-label">{{ menuSession&&isPublicBrowserSession(menuSession)?'所有对话共享网站数据':menuSession?.persist?'持久会话':'临时会话' }}</div>
      <button v-if="menuSession?.windows.length" type="button" class="sidebar-more-item" role="menuitem" @click="openSession(menuSession!)"><AppIcon icon="browser" /><span>打开页面</span></button>
      <button type="button" class="sidebar-more-item" role="menuitem" @click="emit('add-ref', sessionRef(menuSession!))">
        <AppIcon icon="paperclip" />
        <span>引用到输入框</span>
      </button>
      <button type="button" class="sidebar-more-item" role="menuitem" :disabled="busyWindow === menuSession?.sessionId" @click="createWindow(menuSession!.sessionId)">
        <AppIcon icon="browser" />
        <span>在此会话新建页面</span>
      </button>
      <button v-if="menuSession&&!isPublicBrowserSession(menuSession)" type="button" class="sidebar-more-item" role="menuitem" @click="beginRename"><AppIcon icon="pen-to-square" /><span>重命名</span></button>
      <div class="sidebar-ctx-label with-sep">管理</div>
      <button type="button" class="sidebar-more-item" role="menuitem" :disabled="!closablePages||!!busyManagement" @click="beginManage('close-pages')"><AppIcon icon="xmark" /><span>{{ menuSession&&isPublicBrowserSession(menuSession)?'关闭当前对话的页面':'关闭全部页面' }}</span></button>
      <button type="button" class="sidebar-more-item danger" role="menuitem" :disabled="!!busyManagement||menuSession?.initialized===false" :title="menuSession?.initialized===false?'尚未创建网站数据':undefined" @click="beginManage('clear-data')"><AppIcon icon="trash" /><span>清除网站数据…</span></button>
      <button
        v-if="menuSession&&!isPublicBrowserSession(menuSession)"
        type="button"
        class="sidebar-more-item danger"
        role="menuitem"
        :disabled="!!busyManagement" @click="beginManage('delete')"
      >
        <AppIcon icon="xmark" />
        <span>删除会话及数据…</span>
      </button>
    </SidebarContextMenu>

    <SidebarContextMenu ref="winMenu">
      <button type="button" class="sidebar-more-item" role="menuitem" @click="emit('add-ref', windowRef(menuSession!, menuWindow!))">
        <AppIcon icon="plus" />
        <span>引用到输入框</span>
      </button>
      <button type="button" class="sidebar-more-item" role="menuitem" @click="showPage(menuWindow!)">
        <AppIcon icon="browser" />
        <span>{{ isRemote ? '远程查看' : '打开页面' }}</span>
      </button>
      <button type="button" class="sidebar-more-item" role="menuitem" :disabled="!menuAddressState.context||addressPending" :title="menuAddressState.reason" @click="pageAddressAction('copy')">
        <AppIcon icon="copy" />
        <span>{{ menuAddressState.copyLabel }}</span>
      </button>
      <button v-if="!isRemote&&menuAddressState.visible" type="button" class="sidebar-more-item" role="menuitem" :disabled="!menuAddressState.context||addressPending" :title="menuAddressState.reason" @click="pageAddressAction('external')"><AppIcon icon="arrow-up-right-from-square" /><span>{{ menuAddressState.label }}</span></button>
      <button type="button" class="sidebar-more-item danger" role="menuitem" @click="closeWindow(menuWindow!)">
        <AppIcon icon="xmark" />
        <span>关闭页面</span>
      </button>
    </SidebarContextMenu>
    <BrowserSessionCreateDialog v-model="createDialog" :chat-id="chatId" :owner-title="ownerLabel(chatId)" @created="createdSession" />
    <BrowserContentDialog :model-value="!!renameTarget" max-width="420" :persistent="!!busyManagement" @update:model-value="!$event&&(renameTarget=null)"><v-card><v-card-title>重命名会话</v-card-title><v-card-text><v-text-field v-model="renameDraft" label="会话名称" maxlength="80" hint="留空恢复默认名称" persistent-hint autofocus variant="outlined" @keydown.enter="saveRename" /><p v-if="dialogError" class="session-error" role="alert">{{ dialogError }}</p></v-card-text><v-card-actions><v-spacer /><v-btn :disabled="!!busyManagement" @click="renameTarget=null">取消</v-btn><v-btn color="primary" :loading="!!busyManagement" @click="saveRename()">保存</v-btn></v-card-actions></v-card></BrowserContentDialog>
    <BrowserConfirmationDialog :model-value="!!manageTarget" :confirmation="manageAction==='close-pages'?'close-session':manageAction==='clear-data'?'clear-session-data':'delete-session'" :context-key="manageTarget?.sessionId" max-width="460" :persistent="!!busyManagement" @update:model-value="!$event&&(manageTarget=null)"><v-card><v-card-title>{{ manageTitle }}</v-card-title><v-card-text><p>{{ manageTarget&&sessionLabel(manageTarget) }}</p><p v-if="manageTarget&&!isPublicBrowserSession(manageTarget)">所属对话：{{ ownerLabel(manageTarget.chatId) }}</p><p class="session-impact">{{ manageDescription }}</p><p v-if="dialogError" class="session-error" role="alert">{{ dialogError }}</p></v-card-text><v-card-actions><v-spacer /><v-btn :disabled="!!busyManagement" @click="manageTarget=null">取消</v-btn><v-btn :color="manageAction==='close-pages'?'primary':'error'" :loading="!!busyManagement" @click="confirmManage">{{ manageTitle }}</v-btn></v-card-actions></v-card></BrowserConfirmationDialog>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '../icons/AppIcon.vue'
import BrowserResourceActions from './BrowserResourceActions.vue'
import { computed, ref,watch } from 'vue'
import type { BrowserContextRef, BrowserSessionManageAction, BrowserTreeSession, BrowserTreeWindow } from '@shared/types'
import { browserSessionLabel } from '@shared/browser-session'
import {browserPageChatId,isPublicBrowserSession} from '@shared/browser-resource-sessions'
import {browserPageAddressState,browserPageAddressError,sameBrowserPageAddress,type BrowserPageAddressContext,type BrowserPageAddressAction} from '@shared/browser-page-address'
import BrowserSessionCreateDialog from './BrowserSessionCreateDialog.vue'
import SidebarContextMenu from './SidebarContextMenu.vue'
import BrowserContentDialog from '../BrowserContentDialog.vue'
import BrowserConfirmationDialog from '../BrowserConfirmationDialog.vue'

const props = withDefaults(defineProps<{
  headerTarget?: string
  headerVisible?: boolean
  embedded?: boolean
  chatId: string
  tree: BrowserTreeSession[]
  isRemote: boolean
  ownerLabel: (chatId: string) => string
  dndMime: string
  includeEmpty?: boolean
  search?: string
  ownerMatched?: boolean
  prefiltered?: boolean
  showOwners?: boolean
  knownSessionIds?: string[]
}>(), {headerVisible:true,includeEmpty:false,search:'',ownerMatched:false,prefiltered:false,showOwners:false})

const emit = defineEmits<{
  'add-ref': [ref: BrowserContextRef]
  'ask-close-session': [session: BrowserTreeSession]
  'remote-view': [windowId: string]
  'request-page': [sessionId:string]
  notify: [text: string, color?: string]
}>()

const collapsed = ref(false)
function sessionLabel(session:BrowserTreeSession){
  const label=browserSessionLabel(session)
  const duplicates=props.tree.filter(candidate=>browserSessionLabel(candidate)===label)
  return duplicates.length>1?`${label} · ${session.sessionId.replace(/^sess_/,'').slice(0,6)}`:label
}
const busySession = ref(false)
const busyQuickOpen = ref(false)
const busyWindow = ref<string | null>(null)
const sessMenu = ref<InstanceType<typeof SidebarContextMenu> | null>(null)
const winMenu = ref<InstanceType<typeof SidebarContextMenu> | null>(null)
const menuSession = ref<BrowserTreeSession | null>(null)
const menuWindow = ref<BrowserTreeWindow | null>(null)
const menuAddressState=computed(()=>browserPageAddressState(menuWindow.value,menuSession.value&&menuWindow.value?browserPageChatId(menuSession.value,menuWindow.value):props.chatId))
const addressPending=ref(false)
let addressSnapshot:BrowserPageAddressContext|undefined
const expandedSessions=ref(new Set<string>())
const collapsedSessions=new Set<string>()
const showEmpty=ref(false),createDialog=ref(false),busyManagement=ref(''),renameTarget=ref<BrowserTreeSession|null>(null),renameDraft=ref(''),dialogError=ref('')
const manageTarget=ref<BrowserTreeSession|null>(null),manageAction=ref<BrowserSessionManageAction>('close-pages')
const manageChatId=ref('')
const sharedManage=computed(()=>!!manageTarget.value&&isPublicBrowserSession(manageTarget.value))
const manageTitle=computed(()=>manageAction.value==='close-pages'?(sharedManage.value?'关闭当前对话的页面':'关闭全部页面'):manageAction.value==='clear-data'?(sharedManage.value?'清除共享网站数据':'清除网站数据'):'删除会话及数据')
const manageDescription=computed(()=>sharedManage.value?(manageAction.value==='close-pages'?'只关闭当前对话在默认会话中打开的页面。其它对话页面和共享登录数据会保留。':'将关闭默认会话的所有页面，并清除共享 Cookie、网站存储和缓存。所有对话使用的登录状态都会受到影响；执行中的页面操作需先结束。'):manageAction.value==='close-pages'?'关闭此会话的页面，保留网站数据。网页可取消关闭。':manageAction.value==='clear-data'?'先关闭全部页面，再清除 Cookie、网站存储和缓存；网站可能要求重新登录。':'先关闭全部页面，再清除网站数据并删除会话。不会删除所属对话、消息或文件。')
const closablePages=computed(()=>menuSession.value?.windows.filter(page=>!isPublicBrowserSession(menuSession.value!)||!!props.chatId&&browserPageChatId(menuSession.value!,page)===props.chatId).length||0)
const emptySessions=computed(()=>props.tree.filter(s=>!isPublicBrowserSession(s)&&!s.windows.length))
const sessionMatches=(s:BrowserTreeSession)=>props.ownerMatched||sessionLabel(s).toLocaleLowerCase().includes(props.search.trim().toLocaleLowerCase())
function windowsOf(s:BrowserTreeSession){const needle=props.search.trim().toLocaleLowerCase();return props.prefiltered||!needle||sessionMatches(s)?s.windows:s.windows.filter(w=>(w.title+' '+w.url).toLocaleLowerCase().includes(needle))}
const visibleSessions=computed(()=>[...props.tree].filter(s=>props.prefiltered||isPublicBrowserSession(s)||(props.search.trim()?(sessionMatches(s)||windowsOf(s).length):s.windows.length||props.includeEmpty||showEmpty.value)).sort((a,b)=>Number(isPublicBrowserSession(b))-Number(isPublicBrowserSession(a))))
let sessionsWithPages=new Set<string>()
watch(()=>[props.tree.map(s=>`${s.sessionId}:${!!s.windows.length}`).join('\0'),props.knownSessionIds?.join('\0')],()=>{
  const live=new Set(props.tree.filter(s=>s.windows.length||isPublicBrowserSession(s)).map(s=>s.sessionId))
  for(const id of live)if(!sessionsWithPages.has(id)&&!collapsedSessions.has(id))expandedSessions.value.add(id)
  const known=new Set(props.knownSessionIds||props.tree.map(s=>s.sessionId))
  for(const id of expandedSessions.value)if(!known.has(id))expandedSessions.value.delete(id)
  for(const id of collapsedSessions)if(!known.has(id))collapsedSessions.delete(id)
  sessionsWithPages=live
},{immediate:true})
function toggleSession(id:string){if(expandedSessions.value.has(id)){expandedSessions.value.delete(id);collapsedSessions.add(id)}else{expandedSessions.value.add(id);collapsedSessions.delete(id)}}
function selectSession(s:BrowserTreeSession){expandedSessions.value.add(s.sessionId);collapsedSessions.delete(s.sessionId);const page=s.windows.find(w=>w.selected)||s.windows[0];if(page)showPage(page)}
function treeKey(event:KeyboardEvent,s:BrowserTreeSession,w?:BrowserTreeWindow){
  if(event.isComposing)return
  if(event.key==='F10'&&event.shiftKey){if(w)onWindowMenu(event,s,w);else onSessionMenu(event,s);return}
  if(event.key==='ArrowRight'&&!w){event.preventDefault();expandedSessions.value.add(s.sessionId);collapsedSessions.delete(s.sessionId);return}
  if(event.key==='ArrowLeft'){event.preventDefault();if(w)(event.currentTarget as HTMLElement).closest('.tree-sess')?.querySelector<HTMLButtonElement>('.sess .tree-name')?.focus();else{expandedSessions.value.delete(s.sessionId);collapsedSessions.add(s.sessionId)}return}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
  event.preventDefault()
  const buttons=[...(event.currentTarget as HTMLElement).closest('.res-tree')?.querySelectorAll<HTMLButtonElement>('.tree-name')||[]].filter(button=>button.checkVisibility())
  const index=buttons.indexOf(event.currentTarget as HTMLButtonElement)
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowDown'?1:-1)))
  buttons[next]?.focus()
}
async function openSession(s:BrowserTreeSession){
  if(busyWindow.value===s.sessionId)return
  const page=s.windows.find(w=>w.selected)||s.windows[0]
  if(!page){await createWindow(s.sessionId);return}
  expandedSessions.value.add(s.sessionId)
  collapsedSessions.delete(s.sessionId)
  showPage(page)
}

function sessionRef(s: BrowserTreeSession): BrowserContextRef {
  return {
    kind: 'session',
    sessionId: s.sessionId,
    sessionIndex: s.sessionIndex,
    label: sessionLabel(s),
  }
}

function windowLabel(s:BrowserTreeSession,w:BrowserTreeWindow){
  const label=w.title||(w.url==='about:blank'?'新标签页':'无标题')
  const duplicates=s.windows.filter(item=>(item.title||(item.url==='about:blank'?'新标签页':'无标题'))===label)
  return duplicates.length>1?`${label} ${duplicates.findIndex(item=>item.windowId===w.windowId)+1}`:label
}

function windowRef(s: BrowserTreeSession, w: BrowserTreeWindow): BrowserContextRef {
  return {
    kind: 'window',
    sessionId: s.sessionId,
    windowId: w.windowId,
    sessionIndex: s.sessionIndex,
    label: windowLabel(s,w),
    url: w.url,
  }
}

function onDragStart(e: DragEvent, ref: BrowserContextRef) {
  if (!e.dataTransfer) return
  ;(e.currentTarget as HTMLElement)?.classList.add('dragging')
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData(props.dndMime, JSON.stringify(ref))
  e.dataTransfer.setData('text/plain', ref.kind === 'window' ? `@窗口 ${ref.label}` : `@Session ${ref.label}`)
}

function onSessionMenu(e: MouseEvent|KeyboardEvent, s: BrowserTreeSession) {
  menuSession.value = s
  sessMenu.value?.show(e)
}

function onWindowMenu(e: MouseEvent|KeyboardEvent, s: BrowserTreeSession, w: BrowserTreeWindow) {
  menuSession.value = s
  menuWindow.value = w
  addressSnapshot=browserPageAddressState(w,browserPageChatId(s,w)).context
  winMenu.value?.show(e)
}

async function createdSession(session:BrowserTreeSession){showEmpty.value=true;await createWindow(session.sessionId)}
function beginRename(){if(!menuSession.value||isPublicBrowserSession(menuSession.value))return;renameTarget.value=menuSession.value;renameDraft.value=menuSession.value.name||'';dialogError.value=''}
async function saveRename(event?:KeyboardEvent){
  if(event?.isComposing)return
  event?.preventDefault()
  if(!renameTarget.value||busyManagement.value||!window.navora)return
  const target=renameTarget.value;busyManagement.value=target.sessionId;dialogError.value=''
  try{await window.navora.browser.updateSession(target.sessionId,{name:renameDraft.value});renameTarget.value=null;emit('notify','会话名称已保存','primary')}
  catch(error){dialogError.value=error instanceof Error?error.message:'重命名失败'}
  finally{busyManagement.value=''}
}
function beginManage(action:BrowserSessionManageAction){if(!menuSession.value||isPublicBrowserSession(menuSession.value)&&(action==='delete'||action==='close-pages'&&!props.chatId))return;manageTarget.value=menuSession.value;manageAction.value=action;manageChatId.value=props.chatId;dialogError.value=''}
async function confirmManage(){
  if(!manageTarget.value||busyManagement.value||!window.navora)return
  const target=manageTarget.value;busyManagement.value=target.sessionId;dialogError.value=''
  try{
    if(!props.tree.some(s=>s.sessionId===target.sessionId&&s.chatId===target.chatId))throw Error('会话已不存在，请刷新后重试')
    const common=isPublicBrowserSession(target)
    if(common&&manageAction.value==='close-pages'&&props.chatId!==manageChatId.value)throw Error('当前对话已切换，请重新打开会话菜单。')
    const result=await window.navora.browser.manageSession(target.sessionId,manageAction.value,common?{...(manageAction.value==='close-pages'?{chatId:manageChatId.value}:{}),...(manageAction.value==='clear-data'?{confirmedSharedImpact:true}:{})}:undefined)
    manageTarget.value=null
    emit('notify',result.remainingPages?`已关闭 ${result.closedPages} 个页面；其余页面取消关闭`:result.deleted?'会话及网站数据已删除':result.action==='clear-data'?'网站数据已清除，会话已保留':`已关闭 ${result.closedPages} 个页面，会话数据已保留`,'primary')
  }catch(error){dialogError.value=error instanceof Error?error.message:'会话管理失败'}
  finally{busyManagement.value=''}
}

async function quickOpen() {
  if (!window.navora || !props.chatId || busyQuickOpen.value) return
  busyQuickOpen.value = true
  collapsed.value = false
  try {
    const pages=props.tree.flatMap(s=>s.windows)
    const existing = pages.find(w=>w.selected)||pages[0]
    if (existing) { showPage(existing); return }
    const session = await window.navora.browser.createSession(props.chatId)
    await createWindow(session.sessionId)
  } catch (error) { emit('notify', error instanceof Error ? error.message : '打开浏览器失败') }
  finally { busyQuickOpen.value = false }
}
defineExpose({ quickOpen })

async function createWindow(sessionId: string) {
  if (!window.navora || busyWindow.value) return
  const target=props.tree.find(session=>session.sessionId===sessionId),chatId=target&&!isPublicBrowserSession(target)?target.chatId:props.chatId
  if(!chatId){emit('request-page',sessionId);return}
  busyWindow.value = sessionId
  try {
    if(target&&isPublicBrowserSession(target))await window.navora.browser.createSession(chatId)
    const page=await window.navora.browser.createWindow(sessionId,{chatId,url:'about:blank',show:!props.isRemote})
    expandedSessions.value.add(sessionId)
    collapsedSessions.delete(sessionId)
    if(props.isRemote)emit('remote-view',page.windowId)
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '创建窗口失败')
  } finally {
    busyWindow.value = null
  }
}

async function focusWindow(w: BrowserTreeWindow) {
  if (!window.navora) return
  try {
    await window.navora.browser.setVisible(w.windowId, true)
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '前置窗口失败')
  }
}
function showPage(w:BrowserTreeWindow){if(props.isRemote)emit('remote-view',w.windowId);else void focusWindow(w)}

async function closeWindow(w: BrowserTreeWindow) {
  if (!window.navora) return
  try {
    await window.navora.browser.closeWindow(w.windowId)
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '关闭窗口失败')
  }
}

async function pageAddressAction(action:BrowserPageAddressAction) {
  const context=addressSnapshot
  if(!context||addressPending.value)return
  // Remote browser resources cannot start the remote host's system browser.
  addressPending.value=true
  try{
    if(props.isRemote){
      if(action!=='copy')throw Error('browser_desktop_only')
      const session=props.tree.find(session=>session.windows.some(page=>page.windowId===context.pageId)),page=session?.windows.find(page=>page.windowId===context.pageId)
      if(!page||!sameBrowserPageAddress(context,browserPageAddressState(page,session?browserPageChatId(session,page):undefined).context))throw Error('browser_page_address_changed')
      await navigator.clipboard.writeText(context.url)
    }else await window.navora!.browser.workspace.pageAddressAction(context,action)
    if(action==='copy')emit('notify','已复制网址','primary')
  }
  catch(error){emit('notify',browserPageAddressError(error))}
  finally{addressPending.value=false}
}
</script>

<style scoped>
.sidebar-panel {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-height: 0;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.res-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  margin-bottom: 8px;
  padding: 0 12px 0 2px;
}
.res-label-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  line-height: 1;
}
.res-chevron {
  width: 0.7em;
  font-size: 0.62rem;
  opacity: 0.55;
  flex-shrink: 0;
}
.res-label {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.65;
}
.res-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 0 1 auto;
}
.res-empty {
  font-size: 0.75rem;
  opacity: 0.5;
  padding: 4px 12px 8px 2px;
}
.res-tree {
  overflow: auto;
  min-height: 0;
  max-height: min(22vh, 200px);
  padding-bottom: 4px;
  padding-right: 2px;
  scrollbar-gutter: stable;
}
.tree-sess + .tree-sess {
  margin-top: 4px;
}
.tree-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  box-sizing: border-box;
  border-radius: 6px;
  padding: 4px 6px;
  margin-right: 8px;
  cursor: auto;
  font-size: 0.78rem;
  line-height: 1.25;
}
.tree-row.dragging {cursor:grabbing}
.tree-row:hover {
  background: rgba(255, 255, 255, 0.06);
}
.tree-row.win {
  padding-left: 8px;
  opacity: 0.92;
}
.tree-children{margin:2px 0 4px 16px;padding:2px 0 2px 9px;border-left:1px solid #d7dfe8}
.tree-children .tree-row.win{position:relative}
.tree-children .tree-row.win::after{content:'';position:absolute;left:-10px;top:50%;width:9px;height:1px;background:#d7dfe8}
.tree-disclosure{display:grid;place-items:center;width:16px;height:24px;flex:0 0 16px;padding:0;border:0;border-radius:4px;background:transparent;color:#7d8998;cursor:default}
.tree-disclosure:hover{background:#e3eaf2;color:#405a77}
.tree-disclosure>.app-icon{width:10px;height:10px}
.tree-disclosure-space{width:16px;flex:0 0 16px}
.tree-kind-icon{display:grid;place-items:center;width:15px;height:15px;flex:0 0 15px;color:#68809a}
.tree-kind-icon>.app-icon{width:14px;height:14px}
.session-kind-icon{color:#7385a0}
.tree-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.tree-row.sess .tree-name{gap:6px}
.tree-row.win .tree-name{display:flex;align-items:center;gap:7px}
.tree-row.win .page-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tree-meta {
  margin-left: 4px;
  font-size: 0.65rem;
  opacity: 0.55;
  font-weight: 400;
}
.icon-btn {
  appearance: none;
  border: 0;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  border-radius: 4px;
  width: 24px;
  height: 24px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  font-size: 0.72rem;
  line-height: 1;
  cursor: pointer;
}
.res-head > .icon-btn {
  background: transparent;
  color: rgba(236, 240, 241, 0.55);
  border-radius: 5px;
  width: 22px;
  height: 22px;
  font-size: 0.7rem;
}
.res-head > .icon-btn:hover:not(:disabled) {
  background: #e8edf4;
  color: #34465c;
}
.icon-btn:hover:not(:disabled) {
  background: #e8edf4;
  color: #34465c;
}
.icon-btn.danger:hover:not(:disabled) {
  background: rgba(231, 76, 60, 0.35);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.icon-btn.loading {
  opacity: 0.45;
  pointer-events: none;
}
.tree-row{margin-right:0;min-height:34px;padding:5px 6px;color:#4b5d74;border:1px solid transparent}.tree-row.sess{height:36px;padding:0 5px;background:transparent}.tree-row:hover{background:#e8eef5;border-color:#d5dfeb}.tree-name{text-align:left;display:flex;align-items:center;gap:6px;font-size:12px}.session-title{overflow:hidden;text-overflow:ellipsis;color:#3e526c;font-weight:500;white-space:nowrap}.tree-meta{font-size:10px;margin:0;color:#7a8798;opacity:1}.session-persistent{display:grid;place-items:center;flex:0 0 12px;color:#7e9186}.session-persistent>.app-icon{width:12px;height:12px}.tree-row.win .tree-meta{margin-left:5px}.res-head-actions{display:flex;gap:2px;margin-left:auto}.res-head-actions .icon-btn{background:transparent}.icon-btn:focus-visible,.tree-name:focus-visible,.tree-disclosure:focus-visible{outline:2px solid #5d80aa;outline-offset:-2px}
.browser-panel button{cursor:pointer}
.browser-panel .tree-row{pointer-events:auto}
</style>
<style scoped>
.page-labels{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}.page-owner{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:1.2;color:var(--navora-muted)}.tree-row.sess .session-title{flex:1}.tree-row.sess .tree-meta{flex-shrink:0}.tree-row.sess .tree-name{color:var(--navora-ink)}.session-title{color:inherit}.tree-children{border-color:var(--navora-stroke)}.tree-children .tree-row.win::after{background:var(--navora-stroke)}.tree-row{color:var(--navora-ink)}.tree-row:hover{background:var(--control-hover);border-color:var(--navora-stroke)}
</style>
<style scoped>
.tree-row.win.is-selected{position:relative;border-radius:7px;background:var(--control-selected);color:var(--navora-accent)}
.tree-row.win.is-selected::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--navora-accent)}
.tree-row.win.is-selected .tree-name{color:var(--navora-accent);font-weight:500}
.empty-sessions-toggle{display:flex;align-items:center;gap:5px;padding:7px 5px;font-size:11px;color:var(--navora-muted);text-align:left}.empty-sessions-toggle .app-icon{width:10px;height:10px}.empty-sessions-toggle:focus-visible{outline:2px solid var(--navora-accent);outline-offset:-2px;border-radius:5px}.session-empty-detail{font-size:11px;color:var(--navora-muted);padding:7px 12px 10px 27px;line-height:1.7}.res-empty{line-height:1.7;opacity:1;color:var(--navora-muted)}.res-empty>.icon-btn{margin-left:8px}.session-impact{font-size:13px;line-height:1.8;margin-top:14px}.session-error{font-size:12px;color:rgb(var(--v-theme-error));margin-top:12px}
.session-create-browser{display:inline-flex;align-items:center;gap:7px;max-width:100%;min-height:32px;padding:5px 10px;border:1px solid var(--navora-stroke);border-radius:7px;background:transparent;color:var(--navora-accent);font:inherit;font-size:12px;line-height:20px;text-align:left;cursor:pointer}
.session-create-browser>.app-icon{width:13px;height:13px;flex:0 0 13px}
.session-create-browser>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.session-create-browser:hover:not(:disabled){background:var(--control-hover);border-color:var(--navora-accent)}
.session-create-browser:active:not(:disabled){background:var(--control-selected,var(--control-hover))}
.session-create-browser:focus-visible{outline:2px solid var(--navora-accent);outline-offset:2px}
.session-create-browser:disabled{opacity:.55;cursor:default}
</style>
