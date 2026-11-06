<template>
  <section ref="panelArea" class="browser-tab-panel" :data-control-owner="controlOwner" :data-control-activity="automation?.activity || 'idle'" :aria-busy="isNavigating || controlTransition" aria-label="浏览器标签页" @keydown.esc="cancelSelection">
    <form class="browser-tab-toolbar" @submit.prevent>
      <div class="browser-navigation" role="group" aria-label="网页导航">
        <button type="button" class="ui-icon-button browser-nav-action browser-back" title="后退" aria-label="浏览器后退" :disabled="!canBack" @click="navigateCommand('back')"><AppIcon icon="arrow-left" /></button>
        <button v-if="canForward" type="button" class="ui-icon-button browser-nav-action browser-forward" title="前进" aria-label="浏览器前进" @click="navigateCommand('forward')"><AppIcon icon="arrow-right" /></button>
        <button type="button" class="ui-icon-button browser-nav-action browser-reload" :class="{loading:isNavigating}" :title="isNavigating?'停止加载':failure?'重新加载':'刷新'" :aria-label="isNavigating?'停止加载网页':failure?'重新加载网页':'刷新浏览器标签页'" :disabled="!id" @click="isNavigating?stopNavigation():retry()"><AppIcon :icon="isNavigating?'xmark':'arrow-rotate-right'" /></button>
      </div>
      <BrowserAddressBar ref="addressInput" :page-id="id" :chat-id="chatId" :url="navigationTarget || pageUrl" :state="startState" :active="active" :load-error="loadError" @navigate="navigate" @focused="editing=$event;if($event)loadStart()" @history-changed="loadStart" @dom-open="addressDomOpen=$event">
        <template #notice><div v-if="noticeVisible && error && !editing && !selecting" class="browser-operation-notice" role="alert"><button type="button" class="browser-operation-message" :title="error" aria-label="查看操作提示" @click="agentControl?.show()"><AppIcon icon="circle-exclamation" /><span>{{ error }}</span></button><button type="button" class="browser-operation-dismiss" aria-label="关闭操作提示" @click="noticeVisible=false"><AppIcon icon="xmark" /></button></div></template>
        <template #actions><BrowserAgentControl ref="agentControl" :page-id="id" :page-title="pageTitle" :url="pageUrl" :active="active" :state="automation" :pending="controlPending || (retrying?'reload':false)" :selection-busy="selectionStarting" :selecting="selecting" :feedback="feedbackEnabled" :settings="automationSettings" :notice="error" @command="agentCommand" @dom-open="agentDomOpen=$event" @settings="openBrowserSettings" /></template>
      </BrowserAddressBar>
      <button v-if="!isStart" type="button" class="browser-annotation-toggle" :aria-pressed="selecting" :disabled="!desktop || failure || selectionStarting || targetSaving" title="点击或拖选添加批注；按住空格临时浏览" @click="toggleAnnotation"><AppIcon icon="annotate" /><span>批注</span></button>
      <Teleport :to="toolbarTarget||'body'" :disabled="!toolbarTarget||!active"><div class="browser-page-tools" @keydown.esc="cancelSelection">
      <BrowserDownloadsMenu ref="downloadsMenu" :chat-id="chatId" :active="active && !selecting" only-active-chat location="bottom end" btn-class="ui-icon-button" @dom-open="downloadsDomOpen=$event" />
      <button v-if="!selecting&&nativeMore.menusSupported.value" ref="moreTrigger" type="button" class="ui-icon-button browser-page-more" aria-label="浏览器更多操作" title="浏览器更多操作" aria-haspopup="menu" :aria-expanded="moreNativeOpen" :disabled="!id" @click="openNativeMore"><AppIcon icon="ellipsis" /></button>
      <ActionMenu v-else-if="!selecting" ref="moreMenu" label="浏览器更多操作" default-cursor :context-key="JSON.stringify(addressState.context)" :items="browserActions" @select="browserAction" @open="browserMoreOpened" @dom-open="moreDomOpen=$event" />
</div></Teleport>
    </form>
    <div v-if="displayOptions" class="browser-view-options">
      <span class="browser-option-label">网页尺寸</span>
      <select v-model="viewport" aria-label="网页视口尺寸" :disabled="selecting" @change="viewport!=='custom' && setViewport()"><option value="auto">自适应</option><option value="390x844">手机 390 × 844</option><option value="1280x800">桌面 1280 × 800</option><option value="custom">自定义</option></select>
      <template v-if="viewport==='custom'"><input v-model.number="customWidth" :disabled="selecting" type="number" min="1" max="7680" aria-label="视口宽度" /><span>×</span><input v-model.number="customHeight" :disabled="selecting" type="number" min="1" max="4320" aria-label="视口高度" /><button type="button" :disabled="selecting" @click="setViewport">应用</button></template>
      <span class="browser-option-label">缩放</span><select v-model.number="zoom" :disabled="menuZoomDisabled" aria-label="网页缩放" @change="run('zoom',zoom)"><option v-for="factor in browserZoomSteps" :key="factor" :value="factor">{{ Math.round(factor*100) }}%</option></select>
      <button type="button" class="ui-icon-button" title="收起显示设置" aria-label="收起显示设置" @click="displayOptions=false"><AppIcon icon="xmark" /></button>
    </div>
    <div v-if="automation?.pageBlocker?.state==='confirmed'&&automation.pageBlocker.requiresUser" class="browser-blocker-notice" role="alert"><AppIcon icon="shield-halved"/><span><strong>网页需要本人处理</strong><small>{{automation.pageBlocker.kind==='login_required'?'请在当前网页完成登录，然后重新检查。':'请接管当前网页完成验证，然后重新检查。'}}</small></span><button type="button" class="ui-button" :disabled="!!controlPending" @click="agentCommand('takeControl')">我来处理</button><button type="button" class="ui-button" :disabled="!!controlPending" @click="agentCommand('resume')">我已完成，重新检查</button></div>
    <span class="browser-control-announcement" role="status" aria-live="polite" aria-atomic="true">{{ statusTitle }}</span>
    <div class="browser-view-frame" :class="`is-${controlTone}`" :data-feedback="feedbackEnabled">
    <div v-if="desktop" ref="viewportArea" class="browser-viewport-area" :class="{'has-failure':failure,'is-start':isStart}">
      <BrowserStartPage v-if="isStart" :state="startState" :chat-id="chatId" @navigate="navigate" @changed="loadStart" @open-file="openStartFile" />
      <div v-if="failure" class="browser-page-failure" role="alert">
        <div class="browser-failure-icon"><AppIcon :icon="crashed?'browser':'globe'" /></div>
        <h3>{{ crashed?'页面意外退出':'暂时无法打开此网页' }}</h3>
        <p>{{ crashed?'重新加载可恢复浏览，页面中未保存的内容可能已丢失。':browserLoadFailureHint(loadError?.code) }}</p>
        <span v-if="loadError" class="browser-failure-url" :title="loadError.url">{{ loadError.url }}</span>
        <div class="browser-failure-actions"><button type="button" class="ui-button primary" :disabled="retrying" @click="retry"><AppIcon icon="arrow-rotate-right" />{{ retrying?'正在重新加载…':'重新加载' }}</button><button v-if="canBack" type="button" class="ui-button" :disabled="isNavigating" @click="navigateCommand('back')">返回上一页</button></div>
      </div>
      <div v-show="!isStart" class="browser-native-slot" :style="appliedViewport?{width:`${appliedViewport.width*zoom}px`,height:`${appliedViewport.height*zoom}px`,flex:'none'}:{}" ref="slotArea"><img v-if="frozenFrame" class="browser-frozen-frame" :src="frozenFrame" alt="" aria-hidden="true" draggable="false" /><span v-if="!id">正在连接浏览器…</span><div v-if="frozenUnavailable" class="browser-preview-unavailable" role="status">页面预览暂不可用。关闭当前面板后恢复浏览。</div></div>
    </div>
    <div v-else class="browser-tab-notice">远程端请使用浏览器资源中的远程查看。</div>
    </div>
    <BrowserAnnotationEditor v-if="floatingTarget || floatingNote" :key="floatingTarget?.id || floatingNote?.id" v-model="floatingComment" :source-page-id="id" :context-key="floatingTarget?.id || floatingNote?.id || ''" :active="active" :anchor="annotationAnchor" :bounds="annotationEditorBounds" :saved="!!floatingNote" :stale="annotationPhase==='stale' || floatingSelection?.url!==pageUrl || !!floatingNote && floatingNote.anchorState==='stale'" :busy="targetSaving" :pending="targetDraftPending>0 || !!floatingNote && draftState(floatingNote).pending" :error="targetDraftError || (floatingNote?draftState(floatingNote).error:'')" @save="saveFloatingAnnotation" @keep="keepNativeAnnotationEditor" @discard="discardFloatingTarget" @recover="recoverTargetDrafts" @unavailable="annotationUnavailable" @error="error=$event" />
  </section>
</template>
<script setup lang="ts">
import AppIcon from './icons/AppIcon.vue'
import {hasVisibleUi} from '@/utils/visible-ui'
import {browserConfirmationActive,browserDockRight,reportBrowserViewport,reportBrowserLayout} from '@/composables/useBrowserSurfaceLayout'
import BrowserAnnotationEditor from './BrowserAnnotationEditor.vue'
import type {BrowserAnnotationTarget,BrowserAnnotationPhase} from '@shared/browser-workspace'
import {prepareBrowserOverlayFrame} from '@shared/browser-overlay-frame'
import BrowserAddressBar from './BrowserAddressBar.vue'
import BrowserStartPage from './BrowserStartPage.vue'
import {browserInputTarget,type BrowserStartState} from '@shared/browser-start'
import {fileWindowError} from '@shared/file-windows'
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {browserLoadFailureHint,type BrowserAnnotation,type BrowserDraftCopy,type BrowserLoadError} from '@shared/browser-workspace'
import {ANNOTATION_CHAT_EDIT,ANNOTATION_CHAT_SAVED} from '@shared/browser-annotation-chat'
import {consumeAnnotationEdit} from '@/composables/annotationChatEditor'
import {ANNOTATION_COMMENT_LIMIT,ANNOTATION_DRAFT_LIMIT} from '@shared/browser-annotation-limits'
import ActionMenu from './ActionMenu.vue'
import BrowserDownloadsMenu from './BrowserDownloadsMenu.vue'
import BrowserAgentControl from './BrowserAgentControl.vue'
import type {BrowserAgentAction} from '@shared/browser-agent-control'
import {createAnnotationDrafts} from '@/composables/annotationDrafts'
import {normalizeBrowserAutomation,type BrowserAutomationState} from '@shared/browser-automation'
import type {BrowserTreeWindow} from '@shared/types'
import {BROWSER_ZOOM_STEPS,browserNativeId,browserZoomNativeMenuItem,browserZoomTarget} from '@shared/browser-native-panels'
import {browserPageAddressState,browserPageAddressError,type BrowserPageAddressContext,type BrowserPageAddressAction} from '@shared/browser-page-address'
import {NATIVE_UI_OPEN,type NativeMenuControlEvent,type NativeMenuItem} from '@shared/native-ui'
import {BROWSER_CHROME_OPEN} from '@shared/browser-chrome-events'
import {useNativeUi} from '@/composables/useNativeUi'
import {openWindowFind,registerWindowFindTarget} from '@/composables/useWindowFind'
import type {WindowFindState} from '@shared/window-find'
const props=withDefaults(defineProps<{chatId:string;tabKey?:string;pageId?:string;url?:string;active?:boolean;detached?:boolean;expanded?:boolean;toolbarTarget?:HTMLElement|null;automationState?:BrowserAutomationState}>(),{active:true})
const emit=defineEmits<{changed:[title:string,url:string,pageId:string,faviconUrl?:string,loading?:boolean];expand:[];openFile:[path:string]}>()
const desktop=window.navora?.app.platform!=='web',api=window.navora!.browser.workspace
const id=ref(props.pageId||''),pageUrl=ref(props.url||''),pageTitle=ref(''),navigationTarget=ref(''),editing=ref(false),error=ref(''),busy=ref(false)
const stopPending=ref(false),isNavigating=computed(()=>!stopPending.value&&(busy.value||!!navigationTarget.value))
const retrying=ref(false)
const automation=ref<BrowserAutomationState|undefined>(props.automationState),feedbackEnabled=ref(true)
const automationSettings=ref(normalizeBrowserAutomation(undefined)),agentDomOpen=ref(false),noticeVisible=ref(false)
const agentControl=ref<InstanceType<typeof BrowserAgentControl>>(),downloadsMenu=ref<InstanceType<typeof BrowserDownloadsMenu>>(),moreMenu=ref<InstanceType<typeof ActionMenu>>()
const nativeMore=useNativeUi(),moreTrigger=ref<HTMLElement>(),moreNativeOpen=ref(false),menuZoomPending=ref(false)
let moreMenuGeneration=0,moreMenuRequestId:string|undefined,moreMenuRefresh:Promise<boolean>=Promise.resolve(true),moreMenuContextCurrent:(()=>boolean)|undefined
let noticeTimer:ReturnType<typeof setTimeout>|undefined,previewRequest=0
const controlPending=ref<''|'takeControl'|'resume'|'pause'|'retryAutomation'>('')
const controlOwner=computed(()=>automation.value?.owner || (manual.value?'user':'ai'))
const controlTransition=computed(()=>!!controlPending.value || automation.value?.activity==='handoff')
const controlFault=computed(()=>automation.value?.nativeConfirmed===false || automation.value?.error==='release_unconfirmed' || automation.value?.error==='cleanup_unconfirmed')
const cleanupCanReload=computed(()=>automation.value?.error==='cleanup_unconfirmed'&&automation.value.nativeConfirmed&&!automation.value.inputProtected)
const pageActionActive=computed(()=>!!automation.value?.activeOperations&&(automation.value.activity==='acting'||automation.value.activity==='waiting'))
const controlTone=computed(()=>controlTransition.value?'handoff':controlFault.value||automation.value?.activity==='error'?'error':controlOwner.value==='user'?'user':controlOwner.value==='paused'?'paused':feedbackEnabled.value&&pageActionActive.value?'active':'idle')
const statusTitle=computed(()=>{
  if(controlTransition.value)return automation.value?.handoffTarget==='user'?'正在结束 AI 输入，准备交还页面':'正在结束当前输入'
  if(controlFault.value)return automation.value?.error==='cleanup_unconfirmed'?'输入清理尚未确认':'控制状态尚未确认'
  if(error.value)return error.value
  if(automation.value?.activity==='error')return automation.value.error==='renderer_gone'?'页面已退出，自动化已暂停':'本次页面操作未完成'
  if(selecting.value)return selectionStarting.value?'等待当前页面操作结束后进入批注':selectionKind.value==='region'?'正在选择批注区域':selectionKind.value==='element'?'正在选择批注元素':'正在选择批注目标，可点击或拖动框选'
  if(controlOwner.value==='user')return '你正在操作'
  if(controlOwner.value==='paused')return '浏览器操作已暂停'
  if(pageActionActive.value)return automation.value?.label || (automation.value?.activity==='waiting'?'AI 正在等待页面响应':'AI 正在操作页面')
  if(automation.value?.activity==='waiting')return '等待 AI 下一步操作'
  if(automation.value?.needsObservation)return '已允许新的 AI 操作'
  if(isNavigating.value)return '正在加载页面'
  return automation.value?'已允许 AI 操作，当前空闲':'正在读取控制状态'
})
function acceptControlState(page:Pick<BrowserTreeWindow,'automation'|'manualControl'>){
  const incoming=page.automation,current=automation.value
  if(incoming){
    if(current?.stateRevision!==undefined&&incoming.stateRevision!==undefined&&incoming.stateRevision<current.stateRevision)return
    if(current&&incoming.epoch<current.epoch)return
    automation.value=incoming
  }
  manual.value=page.manualControl===true || incoming?.owner==='user'
}
watch(()=>props.automationState,state=>{if(state)acceptControlState({automation:state})})
const frozenFrame=ref(''),frozenUnavailable=ref(false)
const loadError=ref<BrowserLoadError>(),crashed=ref(false),failure=computed(()=>crashed.value||!!loadError.value),downloadsDomOpen=ref(false)
const isStart=computed(()=>pageUrl.value==='about:blank'&&!navigationTarget.value&&!failure.value),addressDomOpen=ref(false),startState=ref<BrowserStartState>({links:[],history:[]})
let startRequest=0,navigationRequest=0,offStart:(()=>void)|undefined
async function loadStart(){if(!desktop||!props.active)return;const request=++startRequest;try{const state=await api.startPage(props.chatId);if(!disposed&&request===startRequest)startState.value=state}catch{if(!disposed)error.value='访问记录暂时无法读取，请重试。'}}
async function navigate(input:string){
  if(!id.value)return
  if(selecting.value){await cancelCapture();if(selecting.value)return}
  const request=++navigationRequest
  try{const target=browserInputTarget(input);navigationTarget.value=target;if(target==='about:blank'){await closeFind()}await run('navigate',target)}catch(e){if(request===navigationRequest)error.value=String(e).includes('invalid')?'请输入有效的网址或搜索内容。':message(e)}finally{
    if(request===navigationRequest){navigationTarget.value='';await refresh();if(props.active&&!disposed){await nextTick();await layout();if(!editing.value&&document.activeElement===document.body){if(isStart.value)addressInput.value?.focus();else await run('focus')}}}
  }
}
async function stopNavigation(){
  if(!id.value||stopPending.value)return
  stopPending.value=true
  navigationRequest++
  navigationTarget.value=''
  busy.value=false
  try{
    const stopped=await run('stop')
    await refresh()
    if(stopped)busy.value=false
  }finally{stopPending.value=false}
}
async function openStartFile(path:string){
  if(!props.detached){emit('openFile',path);return}
  try{await window.navora!.fileTabs.open(props.chatId,path)}
  catch(e){error.value=fileWindowError(e)}
}

const findOpen=ref(false),findQuery=ref(''),findMatches=ref(0),findOrdinal=ref(0),findPending=ref(false),findFailure=ref('')
let findToken='',findGeneration=0,findDocument='',findTimer:ReturnType<typeof setTimeout>|undefined,offFindFocus:(()=>void)|undefined,offFindResult:(()=>void)|undefined,offPageMenu:(()=>void)|undefined
const viewport=ref('auto'),zoom=ref(1),customWidth=ref(1024),customHeight=ref(768),manual=ref(false),selecting=ref(false),selectionKind=ref<'auto'|'element'|'region'>('auto')
const annotationActive=ref(false)
const selectionStarting=ref(false),draftEpoch=ref(0)
const drafts=createAnnotationDrafts(api,props.chatId,()=>draftEpoch.value++)
function draftState(note:BrowserAnnotation){void draftEpoch.value;return drafts.state(note)}
const panelArea=ref<HTMLElement|null>(null)
const appliedViewport=ref<{width:number;height:number}|null>(null),draftConflicts=ref<Record<string,boolean>>({})
const canBack=ref(false),canForward=ref(false),displayOptions=ref(false),moreDomOpen=ref(false),noteBusy=ref('')
const addressPage=ref<BrowserTreeWindow>(),addressState=computed(()=>browserPageAddressState(addressPage.value?.windowId===id.value?addressPage.value:undefined,props.chatId))
let moreAddressSnapshot:BrowserPageAddressContext|undefined
const browserZoomSteps=computed(()=>[...new Set<number>([...BROWSER_ZOOM_STEPS,zoom.value])].sort((a,b)=>a-b))
function browserMoreOpened(open:boolean){if(open)moreAddressSnapshot=addressState.value.context}
async function pageAddressAction(action:BrowserPageAddressAction){
  const context=moreAddressSnapshot
  if(!context||!props.active)return
  try{await api.pageAddressAction(context,action)}catch(cause){error.value=browserPageAddressError(cause)}
}
const browserActions=computed(()=>[
  {id:'home',label:'返回主页',icon:'house',disabled:selecting.value},
  {id:'display',label:displayOptions.value?'收起显示设置':'网页尺寸与缩放',icon:'sliders'},
  {id:'forward',label:'前进',icon:'arrow-right',disabled:!canForward.value||selecting.value},
  {id:'reloadIgnoringCache',label:'忽略缓存重新加载',icon:'arrow-rotate-right',disabled:!id.value||selecting.value||isNavigating.value||controlTransition.value||pageActionActive.value},
  {id:'find',label:'在网页中查找',icon:'magnifying-glass',reason:'Ctrl+F',disabled:!id.value||failure.value||selecting.value||isStart.value||isNavigating.value},
  {id:'copy-url',label:addressState.value.copyLabel,icon:'link',disabled:!addressState.value.context,reason:addressState.value.reason,divider:true},
  ...(addressState.value.visible?[{id:'external',label:addressState.value.label,icon:'arrow-up-right-from-square',disabled:!addressState.value.context,reason:addressState.value.reason}]:[]),
  {id:'control',label:'Agent 控制',icon:'robot'},
  {id:'downloads',label:'下载',icon:'download'},
  {id:'settings',label:'浏览器设置',icon:'gear',disabled:!desktop||!id.value,reason:!desktop?'请在桌面端打开浏览器设置':undefined,divider:true},
  {id:'move',label:props.detached?'移回主工作区':'移至独立窗口',icon:props.detached?'workspace-attach':'arrow-up-right-from-square',disabled:!id.value||selecting.value||pageActionActive.value||controlTransition.value,reason:selecting.value?'请先退出批注选择':undefined,divider:true},
  ...(props.detached?[]:[{id:'expand',label:props.expanded?'收起工作区（恢复分栏）':'展开工作区',icon:props.expanded?'workspace-restore':'workspace-expand'}])
])
function browserAction(action:string){if(action==='copy-url'||action==='external')void pageAddressAction(action==='external'?'external':'copy');else if(action==='reloadIgnoringCache')void run('reloadIgnoringCache');else if(action==='home')void navigate('about:blank');else if(action==='display')displayOptions.value=!displayOptions.value;else if(action==='find')void openFind();else if(action==='move')void move();else if(action==='expand')emit('expand');else if(action==='forward')void run('forward');else if(action==='control')void nextTick(()=>agentControl.value?.show());else if(action==='settings')void openBrowserSettings();else if(action==='downloads'){const anchor=(props.toolbarTarget||panelArea.value)?.querySelector<HTMLElement>('[aria-label="浏览器更多操作"]');downloadsMenu.value?.show(anchor||undefined)}}
const menuZoomDisabled=computed(()=>zoomBusy({automation:automation.value,annotationSelecting:annotationActive.value,loading:busy.value})||menuZoomPending.value||selecting.value||!!controlPending.value||isNavigating.value)
function nativeBrowserActions(factor=zoom.value,disabled=menuZoomDisabled.value):NativeMenuItem[]{
  const items:NativeMenuItem[]=[]
  for(const item of browserActions.value){
    if(item.divider&&items.length)items.push({id:`separator-${item.id}`,type:'separator',label:''})
    items.push({id:item.id,label:item.id==='display'&&nativeMore.menuControlsSupported.value?'网页尺寸':item.label,icon:item.icon,enabled:!item.disabled,reason:item.reason})
    if(item.id==='display'&&nativeMore.menuControlsSupported.value)items.push(browserZoomNativeMenuItem(factor,disabled))
  }
  return items
}
function closeNativeMore(){moreMenuGeneration++;moreMenuRequestId=undefined;moreMenuContextCurrent=undefined;moreNativeOpen.value=false;menuZoomPending.value=false;void nativeMore.closeMenu()}
function updateBrowserMenu(requestId:string,items:NativeMenuItem[]){
  const generation=moreMenuGeneration
  const updated=moreMenuRefresh.catch(()=>false).then(()=>generation===moreMenuGeneration&&moreNativeOpen.value?nativeMore.updateMenu(requestId,items):false)
  moreMenuRefresh=updated;return updated
}
function zoomBusy(page:Pick<BrowserTreeWindow,'automation'|'annotationSelecting'|'loading'>){const state=page.automation;return !!page.annotationSelecting||page.loading||!!state?.nativePending||state?.activity==='handoff'||!!state?.activeOperations||state?.activity==='acting'||state?.nativeConfirmed===false||!!state?.error}
/** Read presentation state only; never navigate, focus or rewrite an input draft. */
function applyPageChrome(page:BrowserTreeWindow){
  addressPage.value=page
  crashed.value=!!page.crashed;loadError.value=page.loadError;annotationActive.value=!!page.annotationSelecting
  canBack.value=!!page.canGoBack;canForward.value=!!page.canGoForward;zoom.value=page.zoomFactor||1;acceptControlState(page);busy.value=page.loading
  pageUrl.value=page.url;pageTitle.value=page.title
}
function refreshOpenBrowserMenu(){
  if(!moreNativeOpen.value||!moreMenuRequestId||menuZoomPending.value)return
  const requestId=moreMenuRequestId,generation=moreMenuGeneration
  void updateBrowserMenu(requestId,nativeBrowserActions()).then(updated=>{if(!updated&&generation===moreMenuGeneration&&requestId===moreMenuRequestId)closeNativeMore()}).catch(cause=>{if(generation===moreMenuGeneration&&requestId===moreMenuRequestId){error.value=message(cause);closeNativeMore()}})
}
async function openNativeMore(){
  if(!props.active||!id.value||!moreTrigger.value||selecting.value)return
  if(moreNativeOpen.value){closeNativeMore();return}
  const generation=++moreMenuGeneration,pageId=id.value,chatId=props.chatId,cachedUrl=pageUrl.value,navigation=navigationRequest,clickDocumentEpoch=automation.value?.documentEpoch
  let url=cachedUrl,documentEpoch=clickDocumentEpoch,snapshotReady=false
  // A freshly transferred panel can render before its first URL/layout refresh.
  // Bind the menu to the canonical page, not an unfinished presentation claim.
  const current=()=>!disposed&&generation===moreMenuGeneration&&props.active&&id.value===pageId&&props.chatId===chatId&&navigationRequest===navigation&&!selecting.value&&(!snapshotReady||(pageUrl.value===url||pageUrl.value===cachedUrl)&&(automation.value?.documentEpoch===undefined||automation.value.documentEpoch===documentEpoch))
  moreMenuContextCurrent=current
  moreNativeOpen.value=true
  const preparationInterrupted=()=>closeNativeMore()
  window.addEventListener(BROWSER_CHROME_OPEN,preparationInterrupted)
  window.addEventListener(NATIVE_UI_OPEN,preparationInterrupted)
  try{
    const initial=await api.tabState(chatId)
    window.removeEventListener(BROWSER_CHROME_OPEN,preparationInterrupted)
    window.removeEventListener(NATIVE_UI_OPEN,preparationInterrupted)
    const initialPage=initial.pages.find(page=>page.windowId===pageId),hostId=initial.hostId
    if(!current())return
    if(initial.activeId!==pageId||!initialPage||clickDocumentEpoch!==undefined&&initialPage.automation?.documentEpoch!==clickDocumentEpoch){closeNativeMore();return}
    url=initialPage.url;documentEpoch=initialPage.automation?.documentEpoch;snapshotReady=true
    if(!current()){closeNativeMore();return}
    applyPageChrome(initialPage)
    moreAddressSnapshot=addressState.value.context
    const onControlAction=async(detail:NativeMenuControlEvent)=>{
      if(detail.itemId!=='zoom'||!['out','in','reset'].includes(detail.controlId)||!current())return
      // The bridge serializes repeated controls in this exact popup request.
      menuZoomPending.value=true
      try{
        const state=await api.tabState(chatId),page=state.pages.find(page=>page.windowId===pageId)
        if(!current())return
        if(state.hostId!==hostId||state.activeId!==pageId||!page||page.url!==url||page.automation?.documentEpoch!==documentEpoch){closeNativeMore();return}
        const factor=page.zoomFactor||1
        if(zoomBusy(page)){if(!await updateBrowserMenu(detail.requestId,nativeBrowserActions(factor,true))&&current())closeNativeMore();return}
        const target=browserZoomTarget(factor,detail.controlId)
        if(target===undefined||target===factor)return
        if(!await updateBrowserMenu(detail.requestId,nativeBrowserActions(factor,true))){if(current())closeNativeMore();return}
        if(!current())return
        await api.command(pageId,'zoom',target)
        const latest=await api.tabState(chatId),updated=latest.pages.find(page=>page.windowId===pageId)
        if(!current())return
        if(latest.hostId!==hostId||latest.activeId!==pageId||!updated||updated.url!==url||updated.automation?.documentEpoch!==documentEpoch){closeNativeMore();return}
        zoom.value=updated.zoomFactor||1;acceptControlState(updated)
        if(!await updateBrowserMenu(detail.requestId,nativeBrowserActions(zoom.value,zoomBusy(updated)||menuZoomDisabled.value))&&current())closeNativeMore()
      }catch(cause){if(current()){error.value=message(cause);closeNativeMore()}}
      finally{if(generation===moreMenuGeneration)menuZoomPending.value=false}
    }
    const result=await nativeMore.popupMenu(nativeBrowserActions(),moreTrigger.value,{placement:'bottom-end',contextKey:browserNativeId('browser-more',`${pageId}:${hostId}:${documentEpoch}:${url}`),sourcePageId:pageId,onOpened:requestId=>{if(current()){moreMenuRequestId=requestId;refreshOpenBrowserMenu()}},onControlAction})
    if(!current())return
    if(!result.supported){error.value='浏览器菜单暂不可用，请重试。';return}
    if(!result.selectedId)return
    const finalState=await api.tabState(chatId),finalPage=finalState.pages.find(page=>page.windowId===pageId)
    if(!current()||finalState.hostId!==hostId||finalState.activeId!==pageId||!finalPage||finalPage.url!==url||finalPage.automation?.documentEpoch!==documentEpoch)return
    const selected=browserActions.value.find(item=>item.id===result.selectedId)
    if(selected&&!selected.disabled)browserAction(selected.id)
  }catch(cause){if(current())error.value=message(cause)}
  finally{window.removeEventListener(BROWSER_CHROME_OPEN,preparationInterrupted);window.removeEventListener(NATIVE_UI_OPEN,preparationInterrupted);if(generation===moreMenuGeneration){moreMenuRequestId=undefined;moreMenuContextCurrent=undefined;moreNativeOpen.value=false;menuZoomPending.value=false}}
}
watch([browserActions,zoom,menuZoomDisabled,()=>automation.value?.stateRevision,menuZoomPending],refreshOpenBrowserMenu)
async function openBrowserSettings(){
  if(!id.value||!props.active)return
  await moreMenu.value?.hideAndWait();closeChrome();await nextTick()
  try{const result=await window.navora?.app.openSettings('browser');if(!result?.ok)throw Error(result?.error||'无法打开浏览器设置，请重试。')}catch(cause){error.value=message(cause)}
}
function cancelSelection(e:KeyboardEvent){if(!selecting.value||e.isComposing||e.keyCode===229||e.repeat||floatingTarget.value||floatingNote.value)return;e.preventDefault();e.stopPropagation();void cancelCapture()}
const fixedSize=computed(()=>viewport.value==='custom'?{width:customWidth.value,height:customHeight.value}:{width:Number(viewport.value.split('x')[0])||390,height:Number(viewport.value.split('x')[1])||844})
const slotArea=ref<HTMLElement|null>(null),viewportArea=ref<HTMLElement|null>(null),addressInput=ref<InstanceType<typeof BrowserAddressBar>|null>(null)
const notes=ref<BrowserAnnotation[]>([]),comments=ref<Record<string,string>>({})
watch([id,pageUrl],()=>{void loadNotes();void loadTargetDrafts()})
async function annotationUnavailable(text:string){await cancelCapture();error.value=text}
async function openContextAnnotation(target:BrowserAnnotationTarget){
  if(disposed||!props.active||target.pageId!==id.value||targetSaving.value)return
  const pageId=id.value
  await closeFind();if(!await clearFloatingEditor())return
  if(disposed||!props.active||pageId!==id.value)return
  selecting.value=true;annotationActive.value=true;manual.value=true;singleAnnotation=true;annotationPhase.value='target-ready'
  await openTargetEditor(target)
}
async function toggleAnnotation(){if(selecting.value)await cancelCapture();else await begin('auto')}
async function navigateCommand(command:'back'|'forward'){if(selecting.value)await cancelCapture();if(!selecting.value)await run(command)}
async function editChatAnnotation(){
  if(!props.active||disposed||targetSaving.value)return
  const detail=consumeAnnotationEdit(props.chatId,id.value)
  if(!detail)return
  try{
    await closeAnnotationEditor();if(floatingTarget.value||floatingNote.value)return
    await loadNotes();await loadTargetDrafts()
    if(disposed||!props.active||detail.pageId!==id.value)return
    if(detail.noteId){
      const note=notes.value.find(note=>note.id===detail.noteId);if(!note)return
      if(detail.copyId){const copy=drafts.copies(note.id).find(copy=>copy.id===detail.copyId);if(!copy)throw Error('冲突副本已变化，请重试。');await resolveDraft(note,copy,copy.text)}
      if(detail.latest)await useLatest(note)
      await openSavedAnnotationEditor(note);singleAnnotation=true
    }else if(detail.targetId){const target=targetDrafts.value.find(target=>target.id===detail.targetId);if(target){await openTargetEditor(target);singleAnnotation=true}}
  }catch(cause){error.value=message(cause)}
}
const annotationPhase=ref<BrowserAnnotationPhase>('armed'),floatingTarget=ref<BrowserAnnotationTarget|null>(null),floatingNote=ref<BrowserAnnotation|null>(null),targetText=ref(''),targetDrafts=ref<BrowserAnnotationTarget[]>([])
const targetSaving=ref(false),targetDraftPending=ref(0),targetDraftError=ref(''),annotationMeasure=ref(0)
const targetEditorId=crypto.randomUUID(),targetSequences=new Map<string,number>(),locallyStoredTargets=new Map<string,number>()
let targetWriteChain:Promise<void>=Promise.resolve(),annotationEditVersion=0,annotationEditorClosing=false,singleAnnotation=false
const targetBufferKey=(targetId:string)=>`navora.annotation-target-buffer.v1:${props.chatId}:${targetId}`
const floatingSelection=computed(()=>floatingTarget.value?.selection||floatingNote.value?.selection)
const annotationAnchor=computed(()=>{void annotationMeasure.value;const selection=floatingSelection.value,r=slotArea.value?.getBoundingClientRect();if(!selection||!r)return {x:0,y:0,width:0,height:0};return {x:r.x+selection.rect.x*r.width/selection.viewport.width,y:r.y+selection.rect.y*r.height/selection.viewport.height,width:selection.rect.width*r.width/selection.viewport.width,height:selection.rect.height*r.height/selection.viewport.height}})
const annotationEditorBounds=computed(()=>{void annotationMeasure.value;const area=viewportArea.value?.getBoundingClientRect(),panel=panelArea.value?.getBoundingClientRect(),r=area&&area.height>=210?area:panel;return r?{x:Math.max(8,r.x),y:Math.max(8,r.y),width:Math.min(r.width,innerWidth-16),height:Math.min(r.height,innerHeight-r.y-8)}:{x:8,y:8,width:innerWidth-16,height:innerHeight-16}})
const floatingComment=computed({get:()=>floatingNote.value?comments.value[floatingNote.value.id]||'':targetText.value,set:text=>{if(floatingNote.value){comments.value[floatingNote.value.id]=text;rememberDraft(floatingNote.value,text)}else rememberTargetText(text)}})
function targetBufferRetained(targetId:string){return locallyStoredTargets.get(targetId)!==undefined&&locallyStoredTargets.get(targetId)===targetSequences.get(targetId)}
function rememberTargetText(text:string,baseVersion?:number){
  targetText.value=text
  const target=floatingTarget.value;if(!target)return
  const sequence=(targetSequences.get(target.id)||0)+1;targetSequences.set(target.id,sequence);targetDraftPending.value++
  try{localStorage.setItem(targetBufferKey(target.id),JSON.stringify({text,version:baseVersion??target.version,sequence,editorId:targetEditorId,updatedAt:Date.now()}));locallyStoredTargets.set(target.id,sequence)}catch{}
  targetWriteChain=targetWriteChain.catch(()=>{}).then(async()=>{
    try{
      const row=await api.writeAnnotationTarget(props.chatId,target.id,baseVersion??target.version,{text,editorId:targetEditorId,sequence})
      Object.assign(target,row)
      if(floatingTarget.value?.id===target.id&&targetSequences.get(target.id)===sequence)targetDraftError.value=''
    }catch(cause){if(floatingTarget.value?.id===target.id)targetDraftError.value=String(cause).includes('annotation_target_draft_conflict')?'其他窗口已修改目标，当前文字已另存冲突副本。':targetBufferRetained(target.id)?'草稿暂未同步；本机缓冲已保留，可稍后重试。':'草稿暂未写入磁盘，请保留此窗口并重试。';void loadTargetDrafts()}
    finally{targetDraftPending.value--}
  })
}
async function loadTargetDrafts(){if(!desktop||!id.value)return;try{targetDrafts.value=await api.annotationTargets(props.chatId,id.value)}catch(cause){if(props.active&&!disposed)error.value=message(cause)}}
async function openTargetEditor(target:BrowserAnnotationTarget){
  if(targetSaving.value)return
  await targetWriteChain
  if(!selecting.value&&!failure.value)await begin('auto')
  if(!selecting.value&&!failure.value)return
  floatingNote.value=null;floatingTarget.value=target;targetText.value=target.comment;targetDraftError.value='';annotationMeasure.value++
  let buffered:{text:string;version:number;updatedAt:number}|undefined
  try{const value=JSON.parse(localStorage.getItem(targetBufferKey(target.id))||'null');if(value&&typeof value.text==='string'&&value.text.length<=ANNOTATION_DRAFT_LIMIT&&Number.isSafeInteger(value.version))buffered=value}catch{}
  if(buffered&&buffered.text!==target.comment)rememberTargetText(buffered.text,buffered.version)
  await nextTick();void layout()
}
async function openSavedAnnotationEditor(note:BrowserAnnotation){
  if(!selecting.value&&!failure.value)await begin('auto')
  if(!selecting.value&&!failure.value)return
  floatingTarget.value=null;floatingNote.value=note;targetDraftError.value='';annotationMeasure.value++
  await nextTick();void layout()
}
async function keepNativeAnnotationEditor(settled?:(closed:boolean)=>void){const key=floatingTarget.value?.id||floatingNote.value?.id;try{await closeAnnotationEditor(key)}finally{settled?.(!key||(floatingTarget.value?.id||floatingNote.value?.id)!==key)}}
async function closeAnnotationEditor(expectedEditorKey?:string){
  const editorKey=floatingTarget.value?.id||floatingNote.value?.id,pageId=id.value
  if(expectedEditorKey&&expectedEditorKey!==editorKey)return
  annotationEditorClosing=true;annotationEditVersion++
  const expectedTargetId=floatingSelection.value?.targetId||floatingTarget.value?.id||floatingNote.value?.sourceTargetId||'target_legacy_editor'
  try{
  await targetWriteChain
  if((floatingTarget.value?.id||floatingNote.value?.id)!==editorKey)return
  if(floatingTarget.value&&targetDraftError.value&&!targetBufferRetained(floatingTarget.value.id))return
  if(floatingNote.value){try{await drafts.flush(floatingNote.value.id)}catch(cause){targetDraftError.value=message(cause);return}}
  if((floatingTarget.value?.id||floatingNote.value?.id)!==editorKey)return
  floatingTarget.value=null;floatingNote.value=null;targetDraftError.value=''
  if(!disposed&&props.active&&pageId===id.value&&selecting.value){
    if(singleAnnotation){manual.value=await api.cancelAnnotation(props.chatId,id.value);selecting.value=false;annotationActive.value=false;singleAnnotation=false}
    else await api.annotationMode(props.chatId,id.value,'armed',expectedTargetId).catch(cause=>{error.value=message(cause)})
  }
  await loadTargetDrafts();await nextTick();await layout()
  window.dispatchEvent(new CustomEvent(ANNOTATION_CHAT_SAVED,{detail:{chatId:props.chatId}}))
  if(selecting.value&&props.active)await run('focus')
  }finally{annotationEditorClosing=false}
}
async function saveFloatingAnnotation(){
  if(targetSaving.value)return
  targetSaving.value=true
  try{
    if(!floatingComment.value.trim()||floatingComment.value.length>ANNOTATION_COMMENT_LIMIT)throw Error('批注请填写 1–4000 字，超出内容会保留为草稿。')
    await targetWriteChain
    if(targetDraftError.value)throw Error('草稿尚需处理，请先查看保留的草稿。')
    if(floatingNote.value)await save(floatingNote.value)
    else if(floatingTarget.value){const target=floatingTarget.value;await api.commitAnnotationTarget(props.chatId,id.value,target.id,target.version);try{localStorage.removeItem(targetBufferKey(target.id))}catch{}}
    await loadNotes();await closeAnnotationEditor();window.dispatchEvent(new CustomEvent(ANNOTATION_CHAT_SAVED,{detail:{chatId:props.chatId}}))
  }catch(cause){targetDraftError.value=message(cause)}finally{targetSaving.value=false}
}
async function discardFloatingTarget(){
  const target=floatingTarget.value;if(!target||targetSaving.value)return
  if(targetText.value.trim()&&!window.confirm('放弃此目标及尚未保存的意见？'))return
  targetSaving.value=true
  try{await targetWriteChain;await api.discardAnnotationTarget(props.chatId,id.value,target.id,target.version);try{localStorage.removeItem(targetBufferKey(target.id))}catch{};targetDraftError.value='';await closeAnnotationEditor()}catch(cause){targetDraftError.value=message(cause)}finally{targetSaving.value=false}
}
async function recoverTargetDrafts(){await closeAnnotationEditor();if(floatingTarget.value||floatingNote.value)return;await loadTargetDrafts();window.dispatchEvent(new CustomEvent(ANNOTATION_CHAT_SAVED,{detail:{chatId:props.chatId}}));error.value='草稿已保留在对话中，可从批注卡片继续编辑。'}
let disposed=false,timer:ReturnType<typeof setInterval>|undefined,observer:ResizeObserver|undefined,unsubscribe:(()=>void)|undefined,unfocus:(()=>void)|undefined,unpresent:(()=>void)|undefined,unlayout:(()=>void)|undefined,polling=false,lastLayout='',lastViewport='',notesRequest=0,notesLoading=false,layoutOwner='',layoutVersion=0,layoutGeneration=0,layoutClaimVersion=0
let hostGeneration=-1
let layingOut=false,layoutAgain=false,offFiles:(()=>void)|undefined,offConfig:(()=>void)|undefined,configRevision=0,layoutFrame=0
const surfaceKey=`browser-surface-${crypto.randomUUID()}`
const message=(e:unknown)=>{const raw=e instanceof Error?e.message:String(e);const labels:Record<string,string>={browser_busy_wait_for_current_action:'页面正在执行操作，请稍后重试。',browser_busy_finish_action_first:'请先完成当前操作或退出批注。',browser_manual_control:'页面已由用户接管，请点击恢复 AI 操作。',annotation_draft_conflict:'草稿已在其他窗口更新，请先载入最新草稿。',annotation_draft_store_invalid:'草稿文件无法读取，原文件已保留。',annotation_page_changed_select_again:'截图期间页面发生变化，请重新选择批注位置。',annotation_revision_conflict:'批注已在其他位置更新，请从对话中的批注卡片重新编辑。',annotation_storage_limit_100MB:'此对话的批注图片已达到 100 MB 上限。',annotation_limit_200:'此对话最多保存 200 条批注。',sent_annotation_cannot_be_deleted:'已加入对话的批注需要保留历史证据。',url_not_allowed:'此网址不在允许访问的范围内。'};return Object.entries(labels).find(([key])=>raw.includes(key))?.[1]||raw}
async function run(command:Parameters<typeof api.command>[1],value?:unknown){if(!id.value)return false;if(['navigate','back','forward','reload','stop'].includes(command)&&selecting.value){await cancelCapture();if(selecting.value)return false}try{error.value='';await api.command(id.value,command,value);return true}catch(e){await refresh();if(!failure.value&&!String(e).includes('browser_navigation_failed'))error.value=message(e);return false}}
async function retry(){
  if(retrying.value)return
  retrying.value=true
  const failedUrl=loadError.value?.url
  try{
    if(isNavigating.value)await stopNavigation()
    await run(failedUrl?'navigate':'reload',failedUrl)
  }finally{retrying.value=false}
}
const findListening=ref(false)
const findContext=computed(()=>`${props.chatId}:${props.tabKey||props.pageId||''}:${id.value}:${automation.value?.documentEpoch??''}:${pageUrl.value}`)
const findBlocked=computed(()=>!desktop?'此窗口暂不支持网页查找':!id.value||!findListening.value?'正在连接页面，请稍后查找':isStart.value?'请先打开网页后再查找':failure.value?'页面尚未载入，暂时无法查找':isNavigating.value?'页面正在载入，请稍后查找':selecting.value?'请先结束批注选择，再查找页面':automation.value?.activeOperations?'页面正在执行操作，请稍后查找':'')
let findPageId=''
function openFind(){openWindowFind('workspace')}
async function closeFind(focusPage=false,forget=false){
  findGeneration++;clearTimeout(findTimer);const token=findToken,pageId=findPageId;findToken='';findDocument='';findPageId='';findPending.value=false;findMatches.value=0;findOrdinal.value=0;findFailure.value=''
  if(forget){findQuery.value='';findOpen.value=false}
  if(token&&desktop)await api.stopFind(pageId,token).catch(()=>{})
  if(focusPage&&props.active&&!disposed)await run('focus')
}
async function setFindQuery(query:string){
  findOpen.value=true;findQuery.value=query
  const clearing=closeFind(),generation=findGeneration,context=findContext.value
  await clearing
  if(disposed||!props.active||generation!==findGeneration||context!==findContext.value||findBlocked.value||!query.trim())return
  findPending.value=true
  findTimer=setTimeout(()=>{if(generation===findGeneration&&context===findContext.value)void search(false,true)},150)
}
async function search(next=false,forward=true){
  clearTimeout(findTimer)
  if(!findOpen.value||!props.active||disposed||findBlocked.value||!findQuery.value.trim())return
  if(next&&(!findToken||findDocument!==findContext.value||findPending.value||!findMatches.value))return
  if(!findToken){findToken=crypto.randomUUID();findDocument=findContext.value;findPageId=id.value}
  const token=findToken,context=findDocument;findPending.value=true;findFailure.value=''
  try{await api.find(findPageId,findQuery.value,{token,next,forward})}catch(e){if(token===findToken&&context===findContext.value){findPending.value=false;findFailure.value=message(e)}}
}
const findState=computed<WindowFindState>(()=>({status:findBlocked.value?'blocked':findFailure.value?'error':!findQuery.value.trim()?'idle':findPending.value?'searching':'ready',total:findMatches.value,ordinal:findOrdinal.value,notice:findBlocked.value||findFailure.value||undefined}))
const unregisterFind=registerWindowFindTarget({
  target:()=>props.active&&!disposed?{key:findContext.value,scope:'workspace',kind:'browser',label:pageTitle.value||pageUrl.value||'当前网页',sourcePageId:id.value||undefined,supportsCaseSensitive:false}:null,
  state:()=>findState.value,setQuery:query=>setFindQuery(query),step:direction=>search(true,direction===1),stop:()=>closeFind(false,true),
})
watch([findContext,findBlocked],()=>{if(findOpen.value&&props.active)void setFindQuery(findQuery.value)})
function overlayCoversPage(){
  // Only application-owned, explicitly registered business confirmations may
  // replace the live guest. Ordinary DOM menus never trigger this path.
  return browserConfirmationActive.value
}
async function layout(){
  if(!id.value||!layoutOwner||!desktop||disposed||!props.active)return
  if(layingOut){layoutAgain=true;return}layingOut=true
  const version=layoutVersion
  try{
    const el=slotArea.value,area=viewportArea.value,covered=overlayCoversPage()
    const shown=!!panelArea.value?.isConnected&&panelArea.value.checkVisibility()&&!panelArea.value.closest('[inert]')&&getComputedStyle(panelArea.value).visibility!=='hidden'
    const r=el?.getBoundingClientRect(),clip=area?.getBoundingClientRect()
    const available=!!(shown&&!isStart.value&&!failure.value&&r&&clip&&r.width>0&&r.height>0)
    reportBrowserViewport(surfaceKey,available&&clip?clip:null)
    const x=clip?Math.max(0,clip.x,Math.min(browserDockRight.value,clip.right-120)):0
    const bounds=available&&clip&&!covered?{x,y:Math.max(0,clip.y),width:clip.right-x,height:clip.height,scrollLeft:area!.scrollLeft,scrollTop:area!.scrollTop}:null
    const key=JSON.stringify([id.value,bounds]);if(key===lastLayout)return
    if(shown&&!isStart.value&&!failure.value&&covered&&!frozenFrame.value){
      const request=++previewRequest,pageId=id.value,owner=layoutOwner
      const current=()=>!disposed&&request===previewRequest&&version===layoutVersion&&props.active&&id.value===pageId&&layoutOwner===owner&&overlayCoversPage()
      const ready=await prepareBrowserOverlayFrame({capture:()=>api.preview(pageId),decode:async frame=>{const image=new Image();image.src=frame;await image.decode()},paint:async frame=>{if(!current())return;frozenFrame.value=frame;await nextTick();await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))},current})
      if(current())frozenUnavailable.value=!ready&&!frozenFrame.value
    }
    if(disposed||version!==layoutVersion||!props.active||covered!==overlayCoversPage()){layoutAgain=true;return}
    const pageId=id.value,owner=layoutOwner,generation=++layoutGeneration
    const result=await api.layout(pageId,bounds,owner,generation)
    if(disposed||version!==layoutVersion||id.value!==pageId||layoutOwner!==owner||generation!==layoutGeneration)return
    hostGeneration=Math.max(hostGeneration,result.hostGeneration)
    if(result.status!=='applied'||result.owner!==owner||result.generation!==generation){
      lastLayout=''
      if(result.status==='stale'&&result.owner===owner)layoutGeneration=Math.max(layoutGeneration,result.generation)
      if(result.reason==='apply-failed')error.value='网页显示区域暂未就绪，请重试。'
      return
    }
    lastLayout=key
    reportBrowserLayout(surfaceKey,bounds&&result.visible?bounds:null)
    if(bounds&&result.visible&&!covered&&version===layoutVersion){previewRequest++;await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));if(version===layoutVersion&&!overlayCoversPage()){frozenFrame.value='';frozenUnavailable.value=false}}
  }catch(e){lastLayout='';if(!disposed)error.value=message(e)}
  finally{layingOut=false;if(layoutAgain&&!disposed){layoutAgain=false;void layout()}}
}
async function claimPresentation(){
  reportBrowserLayout(surfaceKey,null)
  if(!id.value||!desktop||disposed||!props.active)return
  const pageId=id.value,claim=++layoutClaimVersion
  // Selection and geometry are separate intents: an old panel's late layout
  // must never activate its page over the user's current tab.
  await api.tabAction({chatId:props.chatId,action:'activate',pageId})
  if(disposed||claim!==layoutClaimVersion||!props.active||id.value!==pageId)return
  const owner=await api.claimLayout(pageId)
  if(disposed||claim!==layoutClaimVersion||!props.active||id.value!==pageId)return
  layoutOwner=owner;layoutGeneration=0;hostGeneration=-1;lastLayout=''
}
function scheduleLayout(){if(disposed||!props.active||layoutFrame)return;layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;void layout()})}
function resized(){closeNativeMore();annotationMeasure.value++;layoutVersion++;previewRequest++;lastLayout='';scheduleLayout()}
function viewportScrolled(){annotationMeasure.value++;scheduleLayout()}
async function refresh(){
  if(polling||disposed||!props.active||!desktop)return
  polling=true
  const version=layoutVersion
  try{
    await layout()
    const state=await api.state(),p=state.pages.flatMap(s=>s.windows).find(p=>p.windowId===id.value)
    if(disposed||!props.active||version!==layoutVersion)return
    if(p){
      applyPageChrome(p)
      const viewportKey=JSON.stringify(p.viewport||null)
      appliedViewport.value=p.viewport||null
      if(viewportKey!==lastViewport){lastViewport=viewportKey;if(p.viewport){const preset=`${p.viewport.width}x${p.viewport.height}`;viewport.value=['390x844','1280x800'].includes(preset)?preset:'custom';customWidth.value=p.viewport.width;customHeight.value=p.viewport.height}else viewport.value='auto'}
      emit('changed',p.url==='about:blank'?'新标签页':p.title,p.url,p.windowId,p.faviconUrl,p.loading)
    }
    if(selecting.value&&!selectionStarting.value){
      const editorVersion=annotationEditVersion
      const result=await api.collectAnnotation(props.chatId,id.value)
      if(disposed||!props.active||version!==layoutVersion)return
      if(result.phase)annotationPhase.value=result.phase
      if(result.manualControl!==undefined)manual.value=result.manualControl
      if(result.cancelled){selecting.value=false;annotationActive.value=false;await clearFloatingEditor()}
      else if(result.target&&!annotationEditorClosing&&editorVersion===annotationEditVersion&&floatingTarget.value?.id!==result.target.id&&!floatingNote.value)await openTargetEditor(result.target)
    }
  }catch(e){if(!disposed&&props.active&&version===layoutVersion){if(selecting.value)annotationPhase.value='stale';error.value=message(e)}}finally{polling=false}
}
async function setViewport(){
  const size=viewport.value==='auto'?null:{...fixedSize.value}
  if(size&&(!Number.isInteger(size.width)||size.width<1||size.width>7680||!Number.isInteger(size.height)||size.height<1||size.height>4320)){error.value='请输入有效尺寸：宽度 1–7680，高度 1–4320，使用整数。';return}
  if(!await run('viewport',size))return
  appliedViewport.value=size;lastLayout='';await nextTick();await layout()
}
async function move(){try{await api.tabAction({chatId:props.chatId,pageId:id.value,action:props.detached?'attach':'detach'})}catch(e){error.value=message(e)}}
async function begin(kind:'auto'|'element'|'region'){
  if(selecting.value||selectionStarting.value)return
  singleAnnotation=false;selectionStarting.value=true;selecting.value=true;selectionKind.value=kind
  try{error.value='';annotationPhase.value='armed';await closeFind();await nextTick();await layout();await api.beginAnnotation(props.chatId,id.value,kind);if(disposed||!props.active){await api.cancelAnnotation(props.chatId,id.value);selecting.value=false;return}manual.value=true;annotationActive.value=true;await run('focus')}
  catch(e){selecting.value=false;error.value=message(e)}finally{selectionStarting.value=false}
}
async function controlCommand(command:Exclude<typeof controlPending.value,''>){
  if(!id.value||controlPending.value)return
  const pageId=id.value,chatId=props.chatId,version=layoutVersion
  controlPending.value=command;error.value=''
  try{
    await api.command(pageId,command)
    if(disposed||pageId!==id.value||chatId!==props.chatId||version!==layoutVersion)return
    if(selecting.value){selecting.value=false;annotationActive.value=false;await clearFloatingEditor()}
  }catch(e){if(!disposed&&pageId===id.value&&chatId===props.chatId&&props.active&&version===layoutVersion)error.value=message(e)}
  finally{if(pageId===id.value&&chatId===props.chatId)controlPending.value='';if(!disposed&&props.active&&pageId===id.value&&version===layoutVersion)await refresh()}
}
async function agentCommand(action:BrowserAgentAction){
  if(!id.value||!props.chatId||!props.active||controlPending.value||selectionStarting.value)return
  if(action==='reload'){if(cleanupCanReload.value)await retry();return}
  await controlCommand(action)
}
async function clearFloatingEditor(){
  const editorKey=floatingTarget.value?.id||floatingNote.value?.id
  annotationEditVersion++;await targetWriteChain
  if((floatingTarget.value?.id||floatingNote.value?.id)!==editorKey)return false
  if(floatingTarget.value&&targetDraftError.value&&!targetBufferRetained(floatingTarget.value.id))return false
  if(floatingNote.value){try{await drafts.flush(floatingNote.value.id)}catch(cause){targetDraftError.value=message(cause);return false}}
  if((floatingTarget.value?.id||floatingNote.value?.id)!==editorKey)return false
  floatingTarget.value=null;floatingNote.value=null;targetDraftError.value='';return true
}
async function cancelCapture(){try{if(!await clearFloatingEditor())return;manual.value=await api.cancelAnnotation(props.chatId,id.value);selecting.value=false;annotationActive.value=false;await loadTargetDrafts();await nextTick();await layout()}catch(e){error.value=message(e)}}
function rememberDraft(note:BrowserAnnotation,text:string){void drafts.remember(note,text);const draft=drafts.read(note);draftConflicts.value[note.id]=!!draft&&draft.baseComment!==note.comment}
async function resolveDraft(note:BrowserAnnotation,copy:BrowserDraftCopy,text:string){
  if(noteBusy.value)return
  noteBusy.value=note.id
  try{comments.value[note.id]=await drafts.resolve(note,copy,text);draftConflicts.value[note.id]=false;error.value=''}catch(e){error.value=String(e).includes('annotation_draft_copy_changed')?'副本刚刚发生变化，请检查最新内容后重试。':message(e);await loadNotes()}finally{noteBusy.value=''}
}
async function useLatest(note:BrowserAnnotation){try{await drafts.clear(note);comments.value[note.id]=note.comment;draftConflicts.value[note.id]=false;error.value=''}catch(e){error.value=message(e)}}
async function loadNotes(){
  const request=++notesRequest;notesLoading=true
  try{
    const [rows,stored,recovery]=await Promise.all([api.annotations(props.chatId),desktop?api.annotationDrafts(props.chatId):Promise.resolve([]),desktop?api.annotationDraftRecovery(props.chatId):Promise.resolve({copies:[],issues:[]})])
    if(disposed||request!==notesRequest)return
    const previousNotes=new Map(notes.value.map(note=>[note.id,note]))
    notes.value=rows
    drafts.sync(stored,floatingNote.value?.id)
    drafts.syncRecovery(recovery)
    for(const note of rows){
      const draft=drafts.read(note),buffer=comments.value[note.id],previous=previousNotes.get(note.id)
      const text=draft?.text??(buffer===undefined||buffer===previous?.comment?note.comment:buffer)
      comments.value[note.id]=text;draftConflicts.value[note.id]=draft?.baseComment!==undefined?draft.baseComment!==note.comment:text!==note.comment
    }
  }catch(e){if(!disposed&&request===notesRequest)error.value=message(e)}finally{if(request===notesRequest){notesLoading=false}}
}
async function save(note:BrowserAnnotation){const text=comments.value[note.id]||'';if(!text.trim()||text.length>ANNOTATION_COMMENT_LIMIT)throw Error('批注请填写 1–4000 字，超出内容会保留为草稿。');await drafts.flush(note.id);const draft=drafts.read(note),updated=await api.updateAnnotation(props.chatId,note.id,draft?.baseRevision??note.revision,{comment:comments.value[note.id]||''});Object.assign(note,updated);await drafts.clear(note);draftConflicts.value[note.id]=false;await loadNotes();return updated}
function closeChrome(){closeNativeMore();agentControl.value?.hide();downloadsMenu.value?.hide();moreMenu.value?.hide();addressInput.value?.close()}
watch([id,pageUrl,selecting,()=>automation.value?.documentEpoch],()=>{if(moreNativeOpen.value&&moreMenuContextCurrent&&!moreMenuContextCurrent())closeNativeMore()})
function keydown(e:KeyboardEvent){if(!props.active||e.defaultPrevented||e.altKey||e.shiftKey||e.isComposing)return;const target=e.target instanceof Node?e.target:null;if(target&&target!==document.body&&!panelArea.value?.contains(target)&&!props.toolbarTarget?.contains(target))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='l'){e.preventDefault();e.stopPropagation();closeChrome();addressInput.value?.focus();addressInput.value?.select()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'&&!hasVisibleUi('[data-browser-chrome-overlay],.v-overlay--active,.sidebar-ctx-panel')){e.preventDefault();void openFind()}}
watch(()=>props.active,async active=>{const version=++layoutVersion;layoutClaimVersion++;previewRequest++;lastLayout='';frozenFrame.value='';if(active){void loadStart();layoutOwner='';try{await claimPresentation();await nextTick();void refresh();void editChatAnnotation()}catch(cause){if(!disposed&&version===layoutVersion)error.value=message(cause)}}else{closeChrome();noticeVisible.value=false;void closeFind();if(selecting.value)await cancelCapture();const owner=layoutOwner;layoutOwner='';if(id.value&&owner&&desktop)await api.layout(id.value,null,owner,++layoutGeneration).catch(()=>{})}})
watch([browserConfirmationActive,browserDockRight,isStart,failure],async()=>{if(failure.value||isStart.value){frozenFrame.value='';void closeFind()}await nextTick();void layout()})
watch(()=>props.active,active=>{if(!active)reportBrowserViewport(surfaceKey,null)},{flush:'sync'})
watch(error,value=>{clearTimeout(noticeTimer);noticeVisible.value=!!value&&props.active;if(value)noticeTimer=setTimeout(()=>noticeVisible.value=false,6000)})
watch(()=>automation.value?.error,(value,previous)=>{if(value!==previous&&controlFault.value&&props.active)error.value=cleanupCanReload.value?'输入清理尚未确认，请打开 Agent 面板重新加载页面。':'控制状态尚未确认，请打开 Agent 面板重试解除控制。'})
watch(isNavigating,loading=>{if(loading)void closeFind()})
onMounted(async()=>{
  if(!desktop)return
  const applyConfig=(config:import('@shared/config').AppConfig)=>{automationSettings.value=normalizeBrowserAutomation(config.browser.automation);feedbackEnabled.value=automationSettings.value.show_control_feedback}
  offConfig=window.navora!.config.onChanged(config=>{configRevision++;applyConfig(config)})
  const initialConfigRevision=configRevision
  void window.navora!.config.get().then(config=>{if(!disposed&&initialConfigRevision===configRevision)applyConfig(config)}).catch(()=>{})
  try{id.value=props.pageId||await api.ensure(props.chatId,props.tabKey||`browser:${props.pageId}`,props.url);if(disposed)return
    await loadStart();await loadNotes();await loadTargetDrafts()
    offFiles=window.navora!.workspace.onChanged(event=>{if(event.chatId===props.chatId&&!disposed&&props.active&&!notesLoading)void loadNotes()})
    offStart=api.onStartChanged(chatId=>{if(chatId===undefined||chatId===props.chatId)void loadStart()})
    await claimPresentation();if(disposed)return
    unlayout=api.onLayoutInvalidated(value=>{
      if(disposed||!props.active||value.pageId!==id.value||value.owner!==layoutOwner||value.hostGeneration<=hostGeneration)return
      hostGeneration=value.hostGeneration
      // Main may have invalidated an unchanged CSS rectangle. Do not reuse the
      // renderer's old deduplication key, and never replay an activation intent.
      layoutVersion++;previewRequest++;lastLayout='';void nextTick(()=>{if(!disposed&&props.active&&value.owner===layoutOwner)scheduleLayout()})
    })
    observer=new ResizeObserver(()=>{annotationMeasure.value++;scheduleLayout()});if(viewportArea.value)observer.observe(viewportArea.value);if(panelArea.value)observer.observe(panelArea.value)
    window.addEventListener(ANNOTATION_CHAT_EDIT,editChatAnnotation);window.addEventListener('resize',resized);window.addEventListener('keydown',keydown);viewportArea.value?.addEventListener('scroll',viewportScrolled)
    unfocus=api.onAddressFocus(pageId=>{if(pageId===id.value&&props.active){closeChrome();addressInput.value?.focus();addressInput.value?.select()}})
    offFindFocus=api.onFindShortcut(value=>{if(value.pageId===id.value&&props.active&&value.action!=='close')openFind()})
    offPageMenu=api.onPageMenuAction?.(value=>{if(disposed||value.pageId!==id.value||!props.active)return;if(value.action==='error')error.value=/browser_page_address_changed|external_open_failed/.test(value.message||'')?browserPageAddressError(value.message):message(value.message||'browser_context_changed');else if(value.action==='annotate'&&value.target)void openContextAnnotation(value.target)})
    offFindResult=api.onFindResult(result=>{if(!disposed&&props.active&&findOpen.value&&findDocument===findContext.value&&!findBlocked.value&&result.pageId===findPageId&&result.token===findToken){findMatches.value=result.matches;findOrdinal.value=result.activeMatchOrdinal;if(result.finalUpdate)findPending.value=false}})
    findListening.value=true
    void editChatAnnotation()
    unpresent=api.onPresent(payload=>{if(payload.pageId===id.value&&!payload.hidden&&props.active){lastLayout='';void refresh()}})
    unsubscribe=window.navora!.browser.onTreeUpdated(payload=>{if(payload.chatId===props.chatId){const page=payload.tree.flatMap(session=>session.windows).find(page=>page.windowId===id.value);if(page)acceptControlState(page);void refresh()}})
    timer=setInterval(()=>{
      if(selecting.value)void refresh()
      if(browserDockRight.value)void layout()
    },250)
    await refresh()
  }catch(e){error.value=message(e)}
})
onBeforeUnmount(unregisterFind)
onBeforeUnmount(()=>{disposed=true;reportBrowserViewport(surfaceKey,null);cancelAnimationFrame(layoutFrame);layoutFrame=0;layoutVersion++;layoutClaimVersion++;previewRequest++;startRequest++;clearTimeout(noticeTimer);closeChrome();offStart?.();offConfig?.();offFiles?.();void closeFind();if(selecting.value&&desktop)void api.cancelAnnotation(props.chatId,id.value).catch(()=>{});void clearFloatingEditor();offFindFocus?.();offFindResult?.();offPageMenu?.();observer?.disconnect();clearInterval(timer);unsubscribe?.();unfocus?.();unpresent?.();unlayout?.();window.removeEventListener(ANNOTATION_CHAT_EDIT,editChatAnnotation);window.removeEventListener('resize',resized);window.removeEventListener('keydown',keydown);viewportArea.value?.removeEventListener('scroll',viewportScrolled);if(props.active&&layoutOwner&&desktop)void api.layout(id.value,null,layoutOwner,++layoutGeneration).catch(()=>{})})
</script>
<style scoped>
.browser-blocker-notice{display:flex;align-items:center;gap:9px;flex-shrink:0;padding:8px 12px;border-bottom:1px solid var(--navora-stroke);background:var(--control-selected);color:var(--navora-ink)}.browser-blocker-notice>svg{width:17px;height:17px;color:var(--navora-accent);flex:none}.browser-blocker-notice>span{flex:1;min-width:0}.browser-blocker-notice strong,.browser-blocker-notice small{display:block}.browser-blocker-notice strong{font-size:12px;font-weight:600}.browser-blocker-notice small{font-size:11px;color:var(--navora-muted);margin-top:2px}.browser-blocker-notice button{font-size:11px;white-space:nowrap}@media(max-width:900px){.browser-blocker-notice{flex-wrap:wrap}.browser-blocker-notice>span{flex-basis:calc(100% - 32px)}}
.browser-tab-panel{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;background:var(--navora-surface);container-type:inline-size}
.browser-view-frame{display:flex;flex:1;min-width:0;min-height:74px;box-sizing:border-box;border:2px solid transparent;background:var(--navora-surface);transition:border-color 140ms ease}
.browser-view-frame[data-feedback=true].is-active{border-color:var(--navora-accent)}
.browser-view-frame.is-handoff{border-color:color-mix(in srgb,var(--navora-accent) 50%,transparent)}
.browser-view-frame.is-user{border-color:color-mix(in srgb,var(--navora-muted) 35%,transparent)}
.browser-view-frame.is-error{border-color:var(--control-danger,#b65045)}
.browser-tab-toolbar,.browser-view-options{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--navora-stroke);background:var(--navora-background);flex-shrink:0;min-width:0}
.browser-tab-toolbar{flex-wrap:nowrap}
.browser-tab-toolbar{background:var(--navora-surface)}
.browser-navigation{display:flex;align-items:center;gap:2px;flex:0 0 auto;padding:3px;border:1px solid var(--navora-stroke);border-radius:10px;background:var(--navora-background)}
.browser-tab-toolbar .browser-navigation .browser-nav-action{width:32px;height:32px;min-height:32px;border-radius:7px;color:var(--navora-muted);transition:background-color 140ms ease,color 140ms ease}
.browser-tab-toolbar .browser-navigation .browser-nav-action>.app-icon{width:16px;height:16px}
.browser-tab-toolbar .browser-navigation .browser-nav-action:hover:not(:disabled){background:var(--control-hover);color:var(--navora-ink)}
.browser-tab-toolbar .browser-navigation .browser-nav-action:disabled{color:var(--navora-muted);opacity:.58}
.browser-tab-toolbar .browser-navigation .browser-reload.loading{background:var(--control-selected);color:var(--navora-accent)}
.browser-tab-toolbar .browser-navigation .browser-reload.loading:hover:not(:disabled){background:var(--control-hover);color:var(--navora-ink)}
.browser-tab-toolbar .ui-button{border-color:transparent;background:transparent;color:var(--navora-muted);font-weight:400}
.browser-tab-toolbar .ui-button:hover:not(:disabled){background:var(--control-hover);color:var(--navora-ink)}
.browser-tab-toolbar .browser-control.primary{background:var(--control-selected);color:var(--navora-accent)}
.browser-selecting-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--navora-muted)}
.browser-tab-toolbar input{flex:1;width:0;min-width:40px;height:32px;padding:5px 10px;border:1px solid var(--navora-stroke);border-radius:8px;background:var(--navora-surface);color:var(--navora-ink);font-size:13px}
.browser-tab-toolbar input{border-color:transparent;background:var(--navora-background)}
.browser-tab-toolbar input:focus{border-color:var(--navora-accent);background:var(--navora-surface)}
.browser-tab-toolbar{--browser-toolbar-height:44px;--browser-address-height:36px;box-sizing:border-box;height:var(--browser-toolbar-height);min-height:var(--browser-toolbar-height);padding:0 8px;gap:6px;background:var(--navora-surface);border-bottom-color:var(--navora-stroke)}
.browser-tab-toolbar .browser-navigation{box-sizing:border-box;height:36px;gap:1px;padding:2px;border-color:var(--navora-stroke);border-radius:9px;background:var(--navora-background)}
.browser-tab-toolbar .browser-navigation .browser-nav-action{width:30px;height:30px;min-height:30px;border-radius:7px}
.browser-tab-toolbar :deep(.browser-address-bar){height:var(--browser-address-height);min-height:var(--browser-address-height);border:1px solid var(--navora-stroke);border-radius:var(--browser-address-radius,10px);background:var(--navora-background)}
.browser-tab-toolbar :deep(.browser-address-bar:hover:not(.is-focused)){border-color:color-mix(in srgb,var(--navora-ink) 28%,var(--navora-stroke));background:var(--navora-surface)}
.browser-tab-toolbar :deep(.browser-address-bar.is-focused){border-color:var(--navora-accent);background:var(--navora-surface)}
.browser-tab-toolbar :deep(button.ui-icon-button),.browser-tab-toolbar :deep(.ui-action-menu-trigger){width:30px;min-width:30px;height:30px;min-height:30px;border-radius:8px}
.browser-tab-toolbar>.ui-button{height:30px;min-height:30px;padding:0 8px;border-radius:8px}
.browser-view-options{flex-wrap:wrap;font-size:12px;gap:6px}
.browser-view-options select{min-height:32px;max-width:100%;padding:4px 8px;border:1px solid var(--navora-stroke);border-radius:6px;background:var(--navora-surface);color:var(--navora-ink);font-size:12px}
.browser-option-label{color:var(--navora-muted)}
.browser-view-options input{width:64px;min-height:32px;padding:4px;border:1px solid var(--navora-stroke);border-radius:6px;background:var(--navora-surface)}
.browser-view-options button:not(.ui-icon-button){min-height:32px;padding:4px 8px;border:1px solid var(--navora-stroke);border-radius:6px}
.browser-view-options>.ui-icon-button{margin-left:auto}
.browser-viewport-area{flex:1;min-height:70px;overflow:auto;display:flex;background:var(--navora-background)}
.browser-viewport-area.is-start{display:block;background:var(--navora-surface)}
.browser-viewport-area.has-failure{align-items:center;justify-content:center;padding:clamp(16px,4vw,40px);background:var(--navora-background)}
.has-failure .browser-native-slot{display:none}
.browser-page-failure{box-sizing:border-box;width:min(100%,480px);margin:auto;padding:clamp(22px,4vw,34px);border:1px solid var(--navora-stroke);border-radius:18px;background:var(--navora-surface);color:var(--navora-ink);box-shadow:0 12px 36px rgba(28,43,62,.07);text-align:center}
.browser-failure-icon{display:grid;place-items:center;width:52px;height:52px;margin:0 auto 18px;border:1px solid #f0e3c9;border-radius:16px;background:#fff9ee;color:#b17d36}
.browser-failure-icon:has(.app-icon[data-icon="browser"]){border-color:#e6dfe0;background:#fff5f4;color:#b35858}
.browser-failure-icon .app-icon{width:24px;height:24px}
.browser-page-failure h3{margin:0 0 8px;font-size:18px;font-weight:650;letter-spacing:-.2px}
.browser-page-failure p{max-width:360px;margin:0 auto;color:var(--navora-muted);font-size:13px;line-height:1.7}
.browser-failure-url{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:16px 0 0;padding:9px 11px;border:1px solid var(--navora-stroke);border-radius:8px;background:var(--navora-background);font-size:12px;color:var(--navora-muted);text-align:left}
.browser-failure-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:9px;margin-top:20px}
.browser-failure-actions .ui-button{min-height:38px;padding-inline:15px}
.browser-failure-actions .ui-button.primary{background:#376fae;border-color:#376fae;color:#fff;filter:none}
.browser-failure-actions .ui-button.primary:hover:not(:disabled){background:#2e6099;border-color:#2e6099;color:#fff;filter:none}
.browser-failure-actions .ui-button.primary:disabled{background:#e9edf3;border-color:#dbe2eb;color:#718096;opacity:1}
.browser-manual-status{display:flex;align-items:center;gap:6px;flex-shrink:0;padding:5px 12px;border-bottom:1px solid var(--navora-stroke);color:var(--navora-muted);font-size:11px}
.browser-manual-dot{width:5px;height:5px;border-radius:50%;background:var(--navora-accent)}
.browser-native-slot{position:relative;flex:1;min-height:70px;background:var(--navora-surface)}
.browser-frozen-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;user-select:none}
.browser-preview-unavailable{position:absolute;inset:0;display:grid;place-items:center;padding:24px;background:var(--navora-background);color:var(--navora-muted);font-size:12px;text-align:center}
.browser-tab-notice{padding:8px 12px;color:var(--control-danger);font-size:12px;background:var(--navora-background)}
.browser-selection-status{display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--navora-stroke);font-size:12px;color:var(--navora-muted);flex-shrink:0;flex-wrap:wrap}
.browser-selection-status>span{flex:1}
@media(prefers-reduced-motion:reduce){.browser-view-frame{transition:none}}
@container(max-width:320px){.browser-tab-toolbar{padding-inline:6px}.browser-notes-toggle{padding-inline:8px}.browser-option-label{display:none}}
@media(pointer:coarse){.browser-view-options input,.browser-view-options select{min-height:44px}}
.browser-tab-toolbar{position:relative}.browser-tab-toolbar :deep(.browser-address-bar){min-width:100px;padding:0 3px 0 6px}.browser-tab-toolbar :deep(.browser-address-bar .browser-agent-trigger){width:28px;height:28px;min-height:28px;flex-basis:28px;border-radius:7px}.browser-tab-toolbar :deep(.browser-address-bar:hover:not(.is-focused)),.browser-tab-toolbar :deep(.browser-address-bar.is-focused){background:var(--navora-surface)}
.browser-tab-toolbar .browser-navigation{background:var(--navora-background);border-color:var(--navora-stroke)}.browser-tab-toolbar .browser-navigation .browser-nav-action{color:var(--navora-muted)}.browser-tab-toolbar .browser-navigation .browser-nav-action>.app-icon{width:16px;height:16px}.browser-tab-toolbar .browser-navigation .browser-nav-action:hover:not(:disabled){background:var(--control-hover);color:var(--navora-ink)}.browser-tab-toolbar .browser-navigation .browser-reload.loading{background:var(--control-selected);color:var(--navora-accent)}
.browser-control-announcement{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}.browser-operation-notice{position:absolute;z-index:3;left:8px;right:39px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:5px;min-width:0;padding:4px;border:1px solid var(--navora-stroke);border-radius:6px;background:var(--navora-surface);color:var(--navora-ink);font-size:11px;line-height:16px}.browser-operation-notice .app-icon{width:14px;height:14px}.browser-operation-message{display:flex;align-items:center;gap:6px;flex:1;min-width:0;text-align:left}.browser-operation-message>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.browser-operation-dismiss{display:grid;place-items:center;width:20px;min-width:20px;height:20px;border-radius:4px}.browser-operation-notice button:focus-visible{outline:2px solid var(--control-focus,var(--navora-accent));outline-offset:1px}
@container(max-width:420px){.browser-operation-message>span,.browser-operation-dismiss{display:none}}
.browser-page-tools{display:flex;align-items:center;gap:4px;flex-shrink:0}.browser-page-tools>.ui-icon-button{width:30px;height:30px;min-width:30px}.browser-page-tools>.ui-icon-button svg{width:16px;height:16px}
.browser-annotation-toggle,.browser-notes-count{display:inline-flex;align-items:center;justify-content:center;gap:5px;flex:0 0 auto;height:30px;padding:0 9px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--navora-muted);font-size:12px;white-space:nowrap}
.browser-annotation-toggle:hover:not(:disabled),.browser-notes-count:hover{background:var(--control-hover);color:var(--navora-ink)}
.browser-annotation-toggle[aria-pressed=true],.browser-notes-count[aria-expanded=true]{background:var(--control-selected);color:var(--navora-accent)}
.browser-annotation-toggle:disabled{opacity:.5}.browser-annotation-toggle:focus-visible,.browser-notes-count:focus-visible{outline:2px solid var(--navora-accent);outline-offset:2px}
@container(max-width:420px){.browser-annotation-toggle>span{display:none}.browser-annotation-toggle{width:30px;padding:0}.browser-tab-toolbar :deep(.browser-address-bar){min-width:40px}}
</style>
<style>
.browser-automation-settings-dialog{height:min(780px,90vh);overflow:hidden}.browser-automation-settings-dialog>.settings-page{min-height:0;height:100%;overflow:hidden;border-radius:12px;background:var(--navora-surface)}
.browser-annotation-toggle,.browser-notes-count{display:inline-flex;align-items:center;justify-content:center;gap:5px;flex:0 0 auto;height:30px;padding:0 9px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--navora-muted);font-size:12px;white-space:nowrap}
.browser-annotation-toggle:hover:not(:disabled),.browser-notes-count:hover{background:var(--control-hover);color:var(--navora-ink)}
.browser-annotation-toggle[aria-pressed=true],.browser-notes-count[aria-expanded=true]{background:var(--control-selected);color:var(--navora-accent)}
.browser-annotation-toggle:disabled{opacity:.5}.browser-annotation-toggle:focus-visible,.browser-notes-count:focus-visible{outline:2px solid var(--navora-accent);outline-offset:2px}
@container(max-width:420px){.browser-annotation-toggle>span{display:none}.browser-annotation-toggle{width:30px;padding:0}.browser-tab-toolbar :deep(.browser-address-bar){min-width:40px}}
</style>
