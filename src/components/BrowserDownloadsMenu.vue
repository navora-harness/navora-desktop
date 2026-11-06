<template>
  <v-menu v-model="open" :target="menuTarget || undefined" :location="location" origin="auto" :offset="6" :close-on-content-click="false" content-class="browser-downloads-menu">
    <template #activator="{ props: menuProps }">
      <button
        v-show="items.length > 0"
        type="button"
        :class="btnClass"
        class="browser-downloads-trigger"
        :data-downloading="summary.progressCount > 0"
        :data-paused="summary.allPaused"
        :title="triggerLabel"
        :aria-label="triggerLabel"
        v-bind="activatorProps(menuProps)"
        :aria-expanded="open || native.open.value"
        :ref="el => bindActivator(el, menuProps.ref)"
        @pointerdown="menuTarget=null"
        @click.stop="open || native.open.value ? hide() : show()"
        @keydown.esc.stop.prevent="hide(true)"
      >
        <svg class="dl-progress-ring" :class="{'has-progress':summary.progressCount>0,indeterminate:summary.progressCount>0&&summary.progressPercent===null,paused:summary.allPaused,'is-inactive':!animateTrigger}" :data-progress="summary.progressPercent ?? 'unknown'" :data-paused="summary.allPaused" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="dl-progress-track" cx="12" cy="12" r="9" />
          <circle v-if="summary.progressCount" class="dl-progress-value" cx="12" cy="12" r="9" :stroke-dasharray="56.55" :stroke-dashoffset="summary.progressPercent===null?42:56.55*(1-summary.progressPercent/100)" />
        </svg>
        <AppIcon icon="download" />
      </button>
    </template>
    <div ref="panel" class="dl-panel" :data-download-owner="chromeId" :class="{'is-inactive':!documentVisible || !active}" role="dialog" aria-label="下载" tabindex="-1" @keydown.esc.stop.prevent="hide(true)">
      <div class="dl-panel-head">
        <div class="dl-panel-titles">
          <strong>下载</strong>
        </div>
        <button class="dl-act" type="button" :disabled="!latestCompleted" title="在文件夹中显示最新下载的文件" @click="latestCompleted&&revealFile(latestCompleted.id)"><AppIcon icon="folder-open" /></button>
        <button class="dl-act" type="button" title="搜索下载" @click="searchOpen=!searchOpen"><AppIcon icon="magnifying-glass" /></button>
        <v-menu v-if="finishedCount" location="bottom end">
          <template #activator="{props:optionsProps}"><button v-bind="optionsProps" class="dl-act" type="button" title="下载更多操作"><AppIcon icon="ellipsis" /></button></template>
          <div class="dl-more-panel"><button type="button" class="dl-more-item" @click="clearFinished"><AppIcon icon="trash" />清除已结束的下载记录</button></div>
        </v-menu>
      </div>
      <input v-if="searchOpen" v-model="searchQuery" class="dl-search" placeholder="搜索下载" aria-label="搜索下载" maxlength="512" />
      <div v-if="operationError" class="dl-operation-error" role="alert">{{ operationError }}</div>
      <div v-if="!visibleItems.length" class="dl-empty">
        <AppIcon icon="download" />
        <strong>暂无下载</strong>
        <p>下载的文件会显示在这里</p>
      </div>
      <ul v-else class="dl-list">
        <li v-for="item in visibleItems" :key="item.id" class="dl-item" tabindex="0" @contextmenu.prevent.stop="showItemMenu(item,{x:$event.clientX,y:$event.clientY,width:1,height:1})" @keydown.shift.f10.prevent.stop="showItemMenu(item,$event.currentTarget as HTMLElement)">
          <div class="dl-file-icon" :class="{'has-type-icon':fileArtwork[item.id]}" :data-state="item.state" aria-hidden="true"><img v-if="fileArtwork[item.id]" :src="fileArtwork[item.id]" alt="" @error="failedArtwork[item.id]=fileArtwork[item.id]!" /><AppIcon v-else icon="file-lines" /></div>
          <div class="dl-item-main">
            <div class="dl-name" :title="item.relPath ? `${item.filename}\n${item.relPath}` : item.filename">{{ item.filename }}</div>
            <div class="dl-meta">
              <span v-if="item.source === 'tool'" class="dl-source">工具</span>
              <span class="dl-state" :data-state="item.state">{{ stateLabel(item.state) }}</span>
              <span v-if="sizeText(item)" class="dl-size" :title="sizeText(item)">{{ sizeText(item) }}</span>
            </div>
            <div v-if="item.relPath" class="dl-path" :title="item.relPath">{{ item.relPath }}</div>
            <div v-if="item.error && isTerminal(item.state)" class="dl-error">{{ item.error }}</div>
            <div
              v-if="showProgress(item) && progressPct(item) != null"
              class="dl-bar"
              role="progressbar"
              :class="{ paused: item.state === 'paused' }"
              :aria-label="`${item.filename} 下载进度`"
              :aria-valuenow="progressPct(item)!"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span class="dl-bar-fill" :style="{ width: `${progressPct(item)}%` }" />
            </div>
            <div
              v-else-if="showProgress(item)"
              class="dl-bar indeterminate"
              :class="{ paused: item.state === 'paused' }"
              role="progressbar"
              :aria-label="`${item.filename} 下载进度`"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span class="dl-bar-fill" />
            </div>
          </div>
          <div class="dl-item-actions">
            <button
              v-if="item.state === 'started' && item.canPause"
              type="button"
              class="dl-act"
              :disabled="!item.canPause"
              title="暂停下载"
              aria-label="暂停下载"
              @click="pauseItem(item.id)"
            >
              <AppIcon icon="pause-circle" />
            </button>
            <button
              v-if="item.state === 'paused'"
              type="button"
              class="dl-act"
              :disabled="!item.canResume"
              :title="item.canResume ? '继续下载' : '当前无法恢复'"
              aria-label="继续下载"
              @click="resumeItem(item.id)"
            >
              <AppIcon icon="arrow-right" />
            </button>
            <button
              v-if="item.source !== 'tool' && (item.state === 'intercepted' || item.state === 'started' || item.state === 'paused')"
              type="button"
              class="dl-act danger"
              :disabled="item.canCancel === false"
              :title="cancelTitle(item)"
              :aria-label="cancelTitle(item)"
              @click="cancelItem(item.id)"
            >
              <AppIcon icon="xmark" />
            </button>
            <button
              v-if="item.state === 'completed'"
              type="button"
              class="dl-act"
              title="打开文件"
              aria-label="打开文件"
              @click="openFile(item.id)"
            >
              <AppIcon icon="arrow-up-right-from-square" />
            </button>
            <button v-if="item.source === 'tool' && item.state === 'started'" type="button" class="dl-act danger" title="停止此下载所在的任务" aria-label="停止此下载所在的任务" @click="stopToolTask(item.chatId)"><AppIcon icon="stop" /></button>
            <v-menu :target="moreOpen===item.id?contextPoint:undefined" :model-value="moreOpen===item.id" @update:model-value="moreOpen=$event?item.id:null" location="bottom end" origin="auto" :offset="6" content-class="browser-download-actions" :close-on-content-click="true">
              <template #activator="{ props: moreProps }">
                <button
                  type="button"
                  class="dl-act dl-more"
                  title="更多"
                  aria-label="下载更多操作"
                  v-bind="moreProps"
                  @pointerdown="contextPoint=undefined"
                >
                  <AppIcon icon="ellipsis" />
                </button>
              </template>
              <div :ref="element=>setMorePanel(item.id,element)" class="dl-more-panel" :data-download-owner="chromeId" role="menu" aria-label="下载更多操作">
                <template v-for="entry in browserDownloadContextMenu(item)" :key="entry.id">
                  <hr v-if="entry.type==='separator'" />
                  <button v-else type="button" class="dl-more-item" role="menuitem" @click="runItemAction(item,entry.id)"><AppIcon :icon="entry.icon||'file'" />{{ entry.label }}</button>
                </template>
              </div>
            </v-menu>
          </div>
        </li>
      </ul>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { VMenu } from 'vuetify/components'
import type { BrowserDownloadEntry, BrowserDownloadState } from '../../shared/types'
import { downloadsForChat, DownloadSnapshotGate, sortDownloads, summarizeDownloads } from '@shared/browser-download-presentation'
import { downloadProgress } from '@shared/workspace-downloads'
import { BROWSER_CHROME_OPEN, requestBrowserChromeOpen } from '@shared/browser-chrome-events'
import AppIcon from './icons/AppIcon.vue'
import {NATIVE_UI_OPEN,type NativeAnchor} from '@shared/native-ui'
import {browserDownloadsNativePanel,browserDownloadContextMenu} from '@shared/browser-native-panels'
import {useNativePanel,useNativeUi} from '@/composables/useNativeUi'
import {useSafeBrowserPopup} from '@/utils/browser-popup-placement'
import {downloadFilePreset} from '@shared/download-file-icons'
import {browserNativeId} from '@shared/browser-native-panels'
import type {ComponentPublicInstance} from 'vue'

const props = withDefaults(
  defineProps<{
    chatId?: string | null
    /** Scope list to current chat when true. */
    onlyActiveChat?: boolean
    active?: boolean
    location?: InstanceType<typeof VMenu>['$props']['location']
    btnClass?: string
  }>(),
  {
    chatId: null,
    onlyActiveChat: false,
    active: true,
    location: 'top end',
    btnClass: 'sidebar-icon-btn',
  },
)

const open = ref(false), trigger = ref<HTMLButtonElement | null>(null), panel = ref<HTMLElement | null>(null)
const moreOpen=ref<string|null>(null),morePanels=ref<Record<string,HTMLElement>>({})
const contextPoint=ref<[number,number]|undefined>()
function setMorePanel(id:string,element:Element|ComponentPublicInstance|null){if(element instanceof HTMLElement)morePanels.value[id]=element;else delete morePanels.value[id]}
useSafeBrowserPopup(()=>open.value?panel.value?.closest<HTMLElement>('.v-overlay__content'):null,()=>hide(true))
useSafeBrowserPopup(()=>moreOpen.value?morePanels.value[moreOpen.value]?.closest<HTMLElement>('.v-overlay__content'):null,()=>{moreOpen.value=null})
const menuTarget = ref<HTMLElement | [number, number] | null>(null)
const emit=defineEmits<{open:[value:boolean];domOpen:[value:boolean]}>()
const chromeId = `downloads-${getCurrentInstance()!.uid}`
// An explicitly local empty scope must never turn into the global downloads view.
const scopeChatId = computed(() => props.chatId === null && !props.onlyActiveChat ? null : String(props.chatId || '').trim())
const items = ref<BrowserDownloadEntry[]>([])
const searchOpen=ref(false),searchQuery=ref('')
const visibleItems=computed(()=>{const query=searchOpen.value?searchQuery.value.trim().toLocaleLowerCase():'';return query?items.value.filter(item=>`${item.filename}\n${item.relPath||''}`.toLocaleLowerCase().includes(query)):items.value})
const latestCompleted=computed(()=>items.value.find(item=>item.state==='completed'))
const systemArtwork=ref<Record<string,string>>({}),failedArtwork=ref<Record<string,string>>({})
const artworkRequests=new Map<string,string>()
const artworkKey=(item:BrowserDownloadEntry)=>JSON.stringify([item.chatId,item.id,item.filename,item.state==='completed',item.savePath,item.relPath])
const fileArtwork=computed(()=>Object.fromEntries(items.value.flatMap(item=>{
  const source=downloadFilePreset(item.filename)?.dataUrl||systemArtwork.value[artworkKey(item)]
  return source&&failedArtwork.value[item.id]!==source?[[item.id,source]]:[]
})))
const nativeFileIcons=computed(()=>Object.fromEntries(items.value.flatMap(item=>fileArtwork.value[item.id]?[[item.id,downloadFilePreset(item.filename)?.key||browserNativeId('download-file',artworkKey(item))]]:[])))
const nativeArtwork=computed(()=>Object.fromEntries(Object.entries(nativeFileIcons.value).map(([id,name])=>[name,fileArtwork.value[id]!])))
const itemMenu=useNativeUi()
const menuDownloadId=ref<string>()
async function showDownloadOptions(anchor:HTMLElement|NativeAnchor,targetId?:string){
  const generation=scopeGeneration
  const result=await itemMenu.popupMenu([{id:'clear',label:'清除已结束的下载记录',icon:'trash'}],anchor,{contextKey:`${chromeId}:options`,parentPanelId:native.open.value?native.id:undefined,parentPanelTargetId:native.open.value?targetId:undefined})
  if(alive&&props.active&&generation===scopeGeneration&&result.selectedId==='clear')await clearFinished()
}
async function showItemMenu(item:BrowserDownloadEntry,anchor:HTMLElement|NativeAnchor,sourceType?:'mouse'|'keyboard'){
  const generation=scopeGeneration,chatId=item.chatId,id=item.id
  menuDownloadId.value=id
  const result=await itemMenu.popupMenu(browserDownloadContextMenu(item),anchor,{contextKey:`${chromeId}:${chatId}:${id}`,parentPanelId:native.open.value?native.id:undefined,parentPanelTargetId:native.open.value?`${browserNativeId('download',id)}-row`:undefined,sourceType}).finally(()=>{if(menuDownloadId.value===id)menuDownloadId.value=undefined})
  if(!result.supported){
    const bounds=anchor instanceof HTMLElement?anchor.getBoundingClientRect():anchor
    contextPoint.value=[bounds.x,bounds.y];moreOpen.value=id;return
  }
  if(!alive||!props.active||generation!==scopeGeneration||!result.selectedId)return
  const current=items.value.find(value=>value.id===id&&value.chatId===chatId)
  if(!current||!browserDownloadContextMenu(current).some(value=>value.id===result.selectedId))return
  await runItemAction(current,result.selectedId)
}
async function runItemAction(current:BrowserDownloadEntry,action:string){
  const {id,chatId}=current
  const latest=items.value.find(value=>value.id===id&&value.chatId===chatId)
  if(!alive||!props.active||!latest||!browserDownloadContextMenu(latest).some(value=>value.id===action))return
  moreOpen.value=null
  if(action==='copy'){
    try{await navigator.clipboard.writeText(latest.url)}catch{operationError.value='无法复制下载链接。'}
  }else if(action==='open')await openFile(id)
  else if(action==='reveal')await revealFile(id)
  else if(action==='pause')await pauseItem(id)
  else if(action==='resume')await resumeItem(id)
  else if(action==='cancel')await cancelItem(id)
  else if(action==='remove')await removeItem(id)
  else if(action==='stop')await stopToolTask(chatId)
}
const operationError = ref('')
const documentVisible = ref(!document.hidden), triggerVisible = ref(false)
const animateTrigger = computed(() => props.active && documentVisible.value && triggerVisible.value)
const gate = new DownloadSnapshotGate()
let scopeGeneration = 0, alive = true, focusGeneration = 0
let focusReturn: HTMLElement | null = null
let observer: IntersectionObserver | null = null
let offChanged: (() => void) | null = null
const nativeOffset=ref(0)
const nativeWidth=ref(Math.min(384,window.innerWidth-32))
const nativeListMeasurement=ref<{key:string;height:number}>()
const nativeListMeasurements=new Map<string,number>()
const nativeGeometryKey=computed(()=>{const offset=Math.min(Math.max(0,Math.ceil(visibleItems.value.length/40)-1)*40,nativeOffset.value);return JSON.stringify([nativeWidth.value,offset,visibleItems.value.slice(offset,offset+40).map(item=>[item.id,item.filename,item.state,item.error,item.source,item.canPause,item.canResume,item.canCancel,item.state==='paused'&&downloadProgress(item)!==null])])})
const nativePresentation=computed(()=>browserDownloadsNativePanel(visibleItems.value,{offset:nativeOffset.value,error:operationError.value,width:nativeWidth.value,fileIcons:nativeFileIcons.value,folderAvailable:!!latestCompleted.value,searchQuery:searchOpen.value?searchQuery.value:undefined,selectedId:menuDownloadId.value,listHeight:nativeListMeasurement.value?.key===nativeGeometryKey.value?nativeListMeasurement.value.height:nativeListMeasurements.get(nativeGeometryKey.value)}))
const native=useNativePanel({key:chromeId,contextKey:()=>`${scopeChatId.value}:${props.active}`,icons:()=>nativeArtwork.value,onAction:action=>{
  if(action.type==='change'&&action.id==='downloads-query'&&typeof action.value==='string'&&props.active&&alive){searchQuery.value=action.value;nativeOffset.value=0;return}
  if(action.type==='contextMenu'&&props.active&&alive&&action.anchor){
    const current=items.value.find(item=>`${browserNativeId('download',item.id)}-row`===action.id)
    if(current)void showItemMenu(current,action.anchor,action.sourceType)
    return
  }
  if(action.type!=='click'||!props.active||!alive)return
  const command=nativePresentation.value.actions.get(action.id)
  if(!command)return
  if(command.action==='clear'){void showDownloadOptions(action.anchor||trigger.value||{x:window.innerWidth-16,y:48,width:1,height:1},action.id);return}
  if(command.action==='search'){
    searchOpen.value=!searchOpen.value;nativeOffset.value=0
    const expanded=searchOpen.value
    void nextTick(async()=>{if(!alive||!props.active||!native.open.value||searchOpen.value!==expanded)return;if(await native.update(nativePresentation.value.content))await native.focus(expanded?'downloads-query':'downloads-search')})
    return
  }
  if(command.action==='folder'){if(latestCompleted.value)void revealFile(latestCompleted.value.id);return}
  if(command.action==='more'){nativeOffset.value=nativePresentation.value.offset+40;return}
  if(command.action==='previous'){nativeOffset.value=Math.max(0,nativePresentation.value.offset-40);return}
  if(!('id' in command))return
  const current=items.value.find(item=>item.id===command.id&&item.chatId===command.chatId)
  if(!current||scopeChatId.value!==null&&current.chatId!==scopeChatId.value)return
  if(command.action==='menu'){void showItemMenu(current,action.anchor||trigger.value||{x:window.innerWidth-16,y:48,width:1,height:1});return}
  if(command.action==='pause')void pauseItem(current.id)
  else if(command.action==='resume')void resumeItem(current.id)
  else if(command.action==='cancel')void cancelItem(current.id)
  else if(command.action==='open')void openFile(current.id)
  else if(command.action==='reveal')void revealFile(current.id)
  else if(command.action==='remove')void removeItem(current.id)
  else if(command.action==='stop')void stopToolTask(current.chatId)
}})
let nativeMeasurementTicket=0,nativeMeasuringKey=''
async function measureNativeDownloads(){
  const key=nativeGeometryKey.value,ids=nativePresentation.value.rowIds
  if(!native.open.value||!ids.length||nativeListMeasurements.has(key)||nativeMeasuringKey===key)return
  const ticket=++nativeMeasurementTicket;nativeMeasuringKey=key
  // Native shaping decides whether a filename wraps. Measure the laid-out extent
  // once per geometry change instead of estimating glyph widths or polling progress.
  const [first,last]=await Promise.all([native.getBounds(ids[0]!),native.getBounds(ids[ids.length-1]!)]).catch(()=>[null,null])
  if(ticket===nativeMeasurementTicket)nativeMeasuringKey=''
  if(!alive||!native.open.value||ticket!==nativeMeasurementTicket||key!==nativeGeometryKey.value||!first||!last)return
  const height=Math.ceil(last.y+last.height-first.y)+2
  if(height>0){const fitted=Math.min(352,height);nativeListMeasurements.set(key,fitted);if(nativeListMeasurements.size>16)nativeListMeasurements.delete(nativeListMeasurements.keys().next().value!);nativeListMeasurement.value={key,height:fitted}}
}

function activatorProps(value:Record<string,unknown>){return {...value,onClick:undefined}}

function bindActivator(element: unknown, forwarded: unknown) {
  trigger.value = element instanceof HTMLButtonElement ? element : null
  if (typeof forwarded === 'function') forwarded(element)
  else if (forwarded && typeof forwarded === 'object' && 'value' in forwarded) (forwarded as { value: unknown }).value = element
}

const summary = computed(() => summarizeDownloads(items.value))
const triggerLabel = computed(() => {
  const value = summary.value
  const state = value.progressCount ? value.allPaused ? '已暂停' : '下载中' : items.value.some(item => item.state === 'intercepted') ? '等待确认' : items.value.some(item => item.state === 'failed') ? '包含失败记录' : ''
  const percent = value.progressCount && value.progressPercent !== null ? `${value.progressPercent}%` : ''
  return ['下载', value.activeCount ? `${value.activeCount} 项活动下载` : `${items.value.length} 项记录`, state, percent,native.error.value?'面板暂不可用，请重新打开':''].filter(Boolean).join('，')
})

watch([open,native.open], ([dom,value],previous) => {
  const visible=dom||value
  emit('open', visible);emit('domOpen',dom)
  if (!visible || previous?.some(Boolean)) return
  if(dom)requestBrowserChromeOpen(chromeId)
  if (!focusReturn) focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null
  void refresh()
}, { flush: 'sync' })

async function show(anchor?: HTMLElement) {
  if (scopeChatId.value === '' || !props.active) return
  const generation=++focusGeneration,scope=scopeChatId.value
  requestBrowserChromeOpen(chromeId)
  focusReturn = anchor || (items.value.length ? trigger.value : fallbackControl()) || (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  // More-menu entries are removed as their menu closes; keep their final screen position.
  const source = anchor || (items.value.length ? trigger.value : fallbackControl() || focusReturn)
  const bounds = source?.getBoundingClientRect()
  const shown=await native.show(nativePresentation.value.content,source||{x:window.innerWidth-16,y:48,width:1,height:1},{placement:props.location?.toString().startsWith('top')?'top-end':'bottom-end',contentInset:8,radius:20}).catch(()=>false)
  if(!alive||generation!==focusGeneration||scope!==scopeChatId.value||!props.active){void native.hide();return}
  if(shown)void measureNativeDownloads()
  if(shown||native.supported.value)return
  menuTarget.value = items.value.length && trigger.value ? trigger.value : bounds ? [bounds.right, bounds.bottom] : [window.innerWidth - 16, 48]
  open.value = true
  void nextTick(() => { if (open.value && alive) panel.value?.focus({ preventScroll: true }) })
}

function hide(restoreFocus = false) {
  nativeMeasurementTicket++
  nativeMeasuringKey=''
  void itemMenu.closeMenu()
  const target = items.value.length && trigger.value?.getClientRects().length ? trigger.value : focusReturn
  const token = ++focusGeneration
  open.value = false
  moreOpen.value = null
  void native.hide()
  focusReturn = null
  if (restoreFocus) void nextTick(() => { if (alive && token === focusGeneration && target?.isConnected && target.getClientRects().length) target.focus({ preventScroll: true }) })
}
defineExpose({ show, hide })

function ownsFocus() {
  const element = document.activeElement
  return element === trigger.value || element instanceof HTMLElement && element.closest('[data-download-owner]')?.getAttribute('data-download-owner') === chromeId
}
function fallbackControl(): HTMLElement | null {
  const host = trigger.value?.parentElement
  const explicit = host?.querySelector<HTMLElement>('button[aria-label="浏览器更多操作"]')
  if (explicit) return explicit
  const controls = [...(host?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') || [])]
  const at = controls.indexOf(trigger.value!)
  return [...controls.slice(at + 1), ...controls.slice(0, Math.max(0, at)).reverse()].find(element => element.getClientRects().length > 0) || null
}
function applyEntries(entries: readonly BrowserDownloadEntry[]) {
  const next = scopeChatId.value === null ? sortDownloads(entries) : downloadsForChat(entries, scopeChatId.value)
  const disappeared = items.value.length > 0 && next.length === 0
  const focused = disappeared && ownsFocus()
  const fallback = focused ? fallbackControl() : null
  items.value = next
  if (disappeared) {
    hide()
    const token = focusGeneration
    if (focused) void nextTick(() => { if (alive && token === focusGeneration && fallback?.isConnected && fallback.getClientRects().length) fallback.focus({ preventScroll: true }) })
  }
}

function onChromeOpen(event: Event) { if ((event as CustomEvent<string>).detail !== chromeId) hide() }
function onNativeChromeOpen(event:Event){const detail=(event as CustomEvent<{id:string;parentPanelId?:string}>).detail;if(detail?.parentPanelId===native.id)return;if(detail?.id===native.id)open.value=false;else hide()}
function onVisibilityChange() { documentVisible.value = !document.hidden }
function onPanelResize(){nativeWidth.value=Math.min(384,window.innerWidth-32)}

const finishedCount = computed(
  () => items.value.filter((d) => isTerminal(d.state)).length,
)

function isTerminal(state: BrowserDownloadState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled'
}

function showProgress(item: BrowserDownloadEntry): boolean {
  return item.state === 'started' || item.state === 'paused'
}

function stateLabel(state: BrowserDownloadState): string {
  switch (state) {
    case 'intercepted':
      return '待确认'
    case 'started':
      return '下载中'
    case 'paused':
      return '已暂停'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
    default:
      return state
  }
}

function cancelTitle(item: BrowserDownloadEntry): string {
  if (item.state === 'intercepted') return '拒绝并取消此次下载'
  if (item.canCancel === false) return '当前无法取消'
  return '取消下载'
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${Math.floor(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function sizeText(item: BrowserDownloadEntry): string {
  const recv = item.receivedBytes
  const total = item.totalBytes
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
    if (
      typeof recv === 'number' &&
      Number.isFinite(recv) &&
      recv >= 0 &&
      (item.state === 'started' || item.state === 'paused')
    ) {
      return `${formatBytes(recv)} / ${formatBytes(total)}`
    }
    return formatBytes(total)
  }
  if (typeof recv === 'number' && Number.isFinite(recv) && recv > 0) return formatBytes(recv)
  return ''
}

function progressPct(item: BrowserDownloadEntry): number | null {
  return downloadProgress(item)
}

async function refresh() {
  const chatId = scopeChatId.value
  if (chatId === '' || !window.navora?.downloads?.list) { applyEntries([]); return }
  const ticket = gate.begin()
  try {
    const entries = await window.navora.downloads.list(chatId ?? undefined)
    if (alive && scopeChatId.value === chatId && gate.accepts(ticket)) applyEntries(entries)
  } catch {
    if (alive && gate.accepts(ticket)) operationError.value = '下载暂时无法更新，请稍后重试。'
  }
}

async function command(run: (chatId?: string) => Promise<{ ok: boolean; error?: string }> | undefined) {
  const chatId = scopeChatId.value, generation = scopeGeneration
  if (chatId === '') return
  gate.changed()
  operationError.value = ''
  try {
    const result = await run(chatId ?? undefined)
    if (!alive || generation !== scopeGeneration || chatId !== scopeChatId.value) return
    gate.changed()
    if (result && !result.ok) operationError.value = '下载操作未完成，请根据当前状态重试。'
    await refresh()
  } catch {
    if (alive && generation === scopeGeneration) operationError.value = '下载操作暂时未完成，请稍后重试。'
  }
}

async function clearFinished() {
  if (finishedCount.value) await command(chatId => window.navora?.downloads?.clear(chatId))
}

async function removeItem(id: string) { await command(chatId => window.navora?.downloads?.remove(id, chatId)) }
async function pauseItem(id: string) { await command(chatId => window.navora?.downloads?.pause?.(id, chatId)) }
async function resumeItem(id: string) { await command(chatId => window.navora?.downloads?.resume?.(id, chatId)) }
async function cancelItem(id: string) { await command(chatId => window.navora?.downloads?.cancel?.(id, chatId)) }
async function revealFile(id: string) { await command(chatId => window.navora?.downloads?.reveal(id, chatId)) }
async function openFile(id: string) { await command(chatId => window.navora?.downloads?.open(id, chatId)) }
async function stopToolTask(chatId: string) {
  if (scopeChatId.value === null || chatId === scopeChatId.value) await command(async () => { await window.navora?.agent.stop(chatId); return { ok: true } })
}

watch(
  scopeChatId,
  () => {
    scopeGeneration++; gate.reset(); hide()
    items.value = []; operationError.value = '';nativeOffset.value=0;searchOpen.value=false;searchQuery.value=''
    void refresh()
  },
)
watch(() => props.active, value => { if (!value) hide() })
watch(nativePresentation,value=>{if(native.open.value)void native.update(value.content).then(updated=>{if(updated)void measureNativeDownloads()})})
watch(()=>items.value.map(item=>artworkKey(item)).join('\n'),()=>{
  const currentKeys=new Set(items.value.map(artworkKey))
  systemArtwork.value=Object.fromEntries(Object.entries(systemArtwork.value).filter(([key])=>currentKeys.has(key)))
  for(const [key] of artworkRequests)if(!currentKeys.has(key))artworkRequests.delete(key)
  for(const item of items.value){
    if(downloadFilePreset(item.filename)||!window.navora?.downloads?.icon)continue
    const key=artworkKey(item)
    if(artworkRequests.has(key))continue
    artworkRequests.set(key,item.id)
    void window.navora.downloads.icon(item.id,item.chatId).then(source=>{
      if(alive&&artworkRequests.get(key)===item.id&&source?.startsWith('data:image/png;base64,'))systemArtwork.value={...systemArtwork.value,[key]:source}
    }).catch(()=>{})
  }
})

onMounted(() => {
  offChanged =
    window.navora?.downloads?.onChanged((payload) => {
      if (scopeChatId.value === '') return
      if (!gate.acceptPush(payload)) return
      applyEntries(payload.downloads)
    }) || null
  // Subscribe before reading the initial list so any later push invalidates that snapshot.
  void refresh()
  window.addEventListener(BROWSER_CHROME_OPEN, onChromeOpen)
  window.addEventListener(NATIVE_UI_OPEN,onNativeChromeOpen)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('resize',onPanelResize)
  if (typeof IntersectionObserver !== 'undefined' && trigger.value) {
    observer = new IntersectionObserver(entries => { triggerVisible.value = entries.some(entry => entry.isIntersecting) })
    observer.observe(trigger.value)
  } else triggerVisible.value = true
})

onUnmounted(() => {
  alive = false; scopeGeneration++; gate.reset(); hide()
  offChanged?.()
  offChanged = null
  observer?.disconnect()
  window.removeEventListener(BROWSER_CHROME_OPEN, onChromeOpen)
  window.removeEventListener(NATIVE_UI_OPEN,onNativeChromeOpen)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('resize',onPanelResize)
})
</script>

<style scoped>
.browser-downloads-trigger{position:relative;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;min-width:32px;min-height:32px;color:var(--navora-muted);transition:background-color 140ms ease,color 140ms ease}
.browser-downloads-trigger:hover:not(:disabled){color:var(--navora-ink)}
.browser-downloads-trigger>.dl-progress-ring:not(.has-progress){display:none}
.browser-downloads-trigger[data-downloading='true']{color:var(--navora-accent)}
.browser-downloads-trigger[data-paused='true']{color:var(--navora-muted)}
.browser-downloads-trigger[aria-expanded='true']{background:var(--control-selected);color:var(--navora-accent)}
.browser-downloads-trigger:focus-visible{outline:2px solid var(--control-focus);outline-offset:-2px}
.browser-downloads-trigger>.dl-progress-ring{position:absolute;inset:0;margin:auto;width:28px;height:28px;overflow:visible;pointer-events:none}
.dl-progress-ring circle{fill:none;stroke-width:1.6}
.dl-progress-ring .dl-progress-track{stroke:var(--navora-stroke)}
.dl-progress-ring .dl-progress-value{stroke:currentColor;stroke-linecap:round;transform:rotate(-90deg);transform-origin:12px 12px;transition:stroke-dashoffset 180ms ease}
.dl-progress-ring.indeterminate{animation:dl-ring-rotate 1.1s linear infinite}
.dl-progress-ring.indeterminate .dl-progress-value{stroke-dasharray:14 42}
.dl-progress-ring.indeterminate.paused,.dl-progress-ring.indeterminate.is-inactive{animation:none}
.browser-downloads-trigger>.app-icon{position:relative;z-index:1;width:16px;height:16px}
.browser-downloads-trigger[data-downloading='true']>.app-icon{width:12px;height:12px}
@keyframes dl-ring-rotate{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.dl-progress-ring.indeterminate{animation:none}.dl-progress-ring .dl-progress-value{transition:none}.browser-downloads-trigger{transition:none}}
@media(pointer:coarse){.browser-downloads-trigger{min-width:40px;min-height:40px}}
.dl-panel {
  box-sizing: border-box;
  width: min(384px, calc(100vw - 24px));
  max-height: min(420px, calc(100dvh - 80px));
  display: flex;
  flex-direction: column;
  background: var(--navora-surface);
  color: var(--navora-ink);
  border-radius: 20px;
  border: 1px solid var(--navora-stroke);
  box-shadow: 0 4px 12px color-mix(in srgb,var(--navora-ink) 4%,transparent), 0 12px 32px color-mix(in srgb,var(--navora-ink) 8%,transparent);
  overflow: hidden;
}
.dl-panel-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 56px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--navora-stroke);
}
.dl-panel-titles {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 8px;
  min-width: 0;
}
.dl-panel-titles>.app-icon{width:16px;height:16px;color:var(--navora-muted)}
.dl-panel-titles strong {
  font-size: 18px;
  line-height: 24px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dl-clear {
  flex-shrink: 0;
  min-height: 28px;
  border: 0;
  background: transparent;
  color: var(--navora-muted);
  font-size: 12px;
  cursor: default;
  padding: 4px 6px;
  border-radius: 6px;
  white-space: nowrap;
}
.dl-clear:hover:not(:disabled) {
  background: var(--control-hover);
  color: var(--navora-ink);
}
.dl-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 24px 16px 26px;
  text-align: center;
  color: var(--navora-muted);
  font-size: 13px;
}
.dl-empty>.app-icon{width:24px;height:24px;margin-bottom:4px}
.dl-empty strong{color:var(--navora-ink);font-size:13px;font-weight:500;line-height:20px}
.dl-empty p{margin:0;font-size:12px;line-height:18px}
.dl-operation-error{padding:10px 12px;font-size:12px;color:var(--control-danger);border-bottom:1px solid var(--navora-stroke)}
.dl-list {
  min-height: 0;
  overscroll-behavior: contain;
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scrollbar-width: thin;
}
.dl-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  min-height: 60px;
  border-radius: 12px;
  background: transparent;
}
.dl-item:has(.dl-bar){padding-bottom:16px;min-height:68px}
.dl-item:hover,.dl-item:focus-visible{background:color-mix(in srgb,var(--navora-muted) 14%,transparent)}
.dl-file-icon{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;border-radius:8px;background:color-mix(in srgb,var(--navora-muted) 7%,transparent);color:var(--navora-muted)}
.dl-file-icon>.app-icon{width:18px;height:18px}
.dl-file-icon.has-type-icon{background:transparent}
.dl-file-icon>img{display:block;width:28px;height:28px;object-fit:contain}
.dl-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dl-name {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  overflow: hidden;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.dl-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--navora-muted);
}
.dl-source,.dl-state{flex-shrink:0;white-space:nowrap}
.dl-size{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.dl-source+.dl-state::before{content:'·';margin-right:6px;color:var(--navora-muted)}
.dl-size::before{content:'·';margin-right:6px}
.dl-state[data-state='intercepted'] {
  color: var(--navora-muted);
}
.dl-state[data-state='started'] {
  color: var(--navora-accent);
}
.dl-state[data-state='paused'] {
  color: var(--navora-muted);
}
.dl-state[data-state='completed'] {
  color: var(--navora-accent);
}
.dl-state[data-state='failed'] {
  color: var(--control-danger);
}
.dl-state[data-state='cancelled'] {
  color: var(--navora-muted);
}
.dl-path {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.dl-error {
  font-size: 11px;
  line-height: 16px;
  overflow-wrap: anywhere;
  color: var(--control-danger);
}
.dl-bar {
  position: absolute;
  left: 50px;
  right: 8px;
  bottom: 10px;
  height: 3px;
  border-radius: 999px;
  background: var(--navora-stroke);
  overflow: hidden;
  margin-top: 2px;
}
.dl-bar-fill {
  display: block;
  height: 100%;
  background: var(--navora-accent);
  border-radius: inherit;
}
.dl-bar.indeterminate .dl-bar-fill {
  width: 36%;
  animation: dl-indeterminate 1.1s ease-in-out infinite;
}
.dl-bar.indeterminate.paused .dl-bar-fill {
  animation-play-state: paused;
  background: var(--navora-muted);
}
.dl-bar.paused .dl-bar-fill{background:var(--navora-muted)}
.dl-panel.is-inactive .dl-bar.indeterminate .dl-bar-fill{animation:none}
.dl-item-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.dl-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  min-height: 28px;
  border: 0;
  background: transparent;
  color: var(--navora-muted);
  font-size: 12px;
  padding: 0;
  border-radius: 6px;
  cursor: default;
  white-space: nowrap;
}
.dl-act>.app-icon{width:16px;height:16px}
.dl-act:hover:not(:disabled) {
  background: var(--control-hover);
  color: var(--navora-ink);
}
.dl-act:disabled {
  opacity: 0.4;
  cursor: default;
}
.dl-act.danger {
  color: var(--navora-muted);
}
.dl-act.danger:hover:not(:disabled) {
  color: var(--control-danger);
  background: color-mix(in srgb,var(--control-danger) 10%,transparent);
}
.dl-act.dl-more {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--navora-muted);
}
.dl-more-panel {
  min-width: 148px;
  padding: 4px;
  background: var(--navora-surface);
  border-radius: 8px;
  box-shadow: 0 8px 22px color-mix(in srgb,var(--navora-ink) 12%,transparent);
}
.dl-more-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--navora-ink);
  cursor: default;
}
.dl-more-item>.app-icon{width:16px;height:16px;color:var(--navora-muted)}
.dl-more-item:hover {
  background: var(--control-hover);
}
.dl-more-item.danger {
  color: var(--control-danger);
}
.dl-more-item.danger:hover {
  background: color-mix(in srgb,var(--control-danger) 10%,transparent);
}
@keyframes dl-indeterminate {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}
.dl-panel :is(button):focus-visible,.dl-more-panel button:focus-visible{outline:2px solid var(--control-focus);outline-offset:-2px}
@media(prefers-reduced-motion:reduce){.dl-bar.indeterminate .dl-bar-fill{animation:none;width:100%;opacity:.55}}
@media(pointer:coarse){.dl-panel button,.dl-more-panel button{min-height:44px}}
</style>

<style>
/* Reuse the existing sidebar / mobile button geometry. */
.sidebar-icon-btn,
.mobile-topbar-btn {
  position: relative;
}
.browser-downloads-menu {
  z-index: 2600 !important;
}
.v-menu.v-overlay>.v-overlay__content:is(.browser-downloads-menu,.browser-download-actions){padding:0;border:0;border-radius:12px;background:transparent!important;box-shadow:none!important;backdrop-filter:none!important;overflow:visible}
.v-menu.v-overlay>.v-overlay__content.browser-downloads-menu>.dl-panel,.v-menu.v-overlay>.v-overlay__content.browser-download-actions>.dl-more-panel{background:var(--navora-surface);border:1px solid var(--navora-stroke);border-radius:12px;box-shadow:0 4px 12px color-mix(in srgb,var(--navora-ink) 4%,transparent),0 12px 32px color-mix(in srgb,var(--navora-ink) 8%,transparent);backdrop-filter:none}
.browser-downloads-menu button,.browser-download-actions button{cursor:default}
.dl-more-panel {
  z-index: 2700;
}
</style>

<style scoped>
.dl-item-actions{opacity:0;pointer-events:none}
.dl-item:hover .dl-item-actions,.dl-item:focus-within .dl-item-actions{opacity:1;pointer-events:auto}
.dl-search{margin:8px 12px;padding:6px 8px;border:1px solid var(--navora-stroke);border-radius:6px;color:var(--navora-ink);background:var(--navora-surface)}
@media(hover:none){.dl-item-actions{opacity:1;pointer-events:auto}}
</style>
