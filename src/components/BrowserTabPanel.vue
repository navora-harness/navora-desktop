<template>
  <section ref="panelArea" class="browser-tab-panel" :aria-busy="isNavigating" aria-label="浏览器标签页" @keydown.esc="cancelSelection">
    <form class="browser-tab-toolbar" @submit.prevent>
      <template v-if="!selecting">
      <div class="browser-navigation" role="group" aria-label="网页导航">
        <button type="button" class="ui-icon-button browser-nav-action browser-back" title="后退" aria-label="浏览器后退" :disabled="!canBack" @click="run('back')"><AppIcon icon="arrow-left" /></button>
        <button type="button" class="ui-icon-button browser-nav-action browser-forward" title="前进" aria-label="浏览器前进" :disabled="!canForward" @click="run('forward')"><AppIcon icon="arrow-right" /></button>
        <button type="button" class="ui-icon-button browser-nav-action browser-reload" :class="{loading:isNavigating}" :title="isNavigating?'停止加载':failure?'重新加载':'刷新'" :aria-label="isNavigating?'停止加载网页':failure?'重新加载网页':'刷新浏览器标签页'" :disabled="!id" @click="isNavigating?stopNavigation():retry()"><AppIcon :icon="isNavigating?'xmark':'arrow-rotate-right'" /></button>
      </div>
      <BrowserAddressBar ref="addressInput" :url="navigationTarget || pageUrl" :state="startState" :active="active" :saved="!!savedLink && !navigationTarget" :saving="savingLink || !!navigationTarget" :load-error="loadError" @navigate="navigate" @focused="editing=$event;if($event)loadStart()" @open="addressOpen=$event" @save="toggleQuickLink" />
      <button v-if="!isStart" type="button" class="ui-button browser-notes-toggle" aria-label="页面批注" title="页面批注" :aria-pressed="notesOpen" :disabled="!id" @click="notesOpen=!notesOpen;loadNotes()"><AppIcon icon="annotate" /><span class="browser-notes-label">批注</span><span v-if="scopedNotes.length" class="annotation-count">{{ scopedNotes.length }}</span></button>
      <button v-if="!isStart || manual" type="button" class="ui-button browser-control" :class="{primary:manual}" :disabled="!id" :aria-label="manual?'恢复 AI 操作':'接管页面'" :title="manual?'当前由你操作，点击恢复 AI 操作':'接管页面，暂停 AI 操作'" @click="manual?resume():takeControl()"><AppIcon :icon="manual?'robot':'eye'" /><span class="browser-control-label">{{ manual?'恢复 AI':'接管' }}</span></button>
      <BrowserDownloadsMenu :chat-id="chatId" only-active-chat location="bottom end" btn-class="ui-icon-button" @open="downloadsOpen=$event" />
      <ActionMenu label="浏览器更多操作" default-cursor :items="browserActions" @select="browserAction" @open="moreOpen=$event" />
      </template>
      <template v-else><span class="browser-selecting-text" role="status">{{ selectionKind==='region'?'拖动框选区域':'点击要批注的元素' }} · Esc 取消</span><button type="button" class="ui-button" :disabled="selectionStarting" @click="cancelCapture">取消选择</button></template>
    </form>
    <div v-if="displayOptions" class="browser-view-options">
      <span class="browser-option-label">网页尺寸</span>
      <select v-model="viewport" aria-label="网页视口尺寸" :disabled="selecting" @change="viewport!=='custom' && setViewport()"><option value="auto">自适应</option><option value="390x844">手机 390 × 844</option><option value="1280x800">桌面 1280 × 800</option><option value="custom">自定义</option></select>
      <template v-if="viewport==='custom'"><input v-model.number="customWidth" :disabled="selecting" type="number" min="1" max="7680" aria-label="视口宽度" /><span>×</span><input v-model.number="customHeight" :disabled="selecting" type="number" min="1" max="4320" aria-label="视口高度" /><button type="button" :disabled="selecting" @click="setViewport">应用</button></template>
      <span class="browser-option-label">缩放</span><select v-model.number="zoom" :disabled="selecting" aria-label="网页缩放" @change="run('zoom',zoom)"><option :value="0.75">75%</option><option :value="1">100%</option><option :value="1.25">125%</option><option :value="1.5">150%</option><option :value="2">200%</option></select>
      <button type="button" class="ui-icon-button" title="收起显示设置" aria-label="收起显示设置" @click="displayOptions=false"><AppIcon icon="xmark" /></button>
    </div>
    <div v-if="findOpen" class="browser-find-bar" role="search" aria-label="页内查找" @keydown.esc.stop.prevent="closeFind(true)">
      <AppIcon icon="magnifying-glass" />
      <input ref="findInput" v-model="findQuery" aria-label="在网页中查找" placeholder="在网页中查找" maxlength="1024" autocomplete="off" @keydown.enter="findEnter" />
      <span class="browser-find-count" role="status" aria-live="polite">{{ !findQuery.trim()?'':findPending?'查找中…':findMatches?`${findOrdinal} / ${findMatches}`:'未找到' }}</span>
      <button type="button" class="ui-icon-button" title="上一个（Shift+Enter）" aria-label="上一个匹配项" :disabled="!findMatches || findPending" @click="search(true,false)"><AppIcon icon="chevron-up" /></button>
      <button type="button" class="ui-icon-button" title="下一个（Enter）" aria-label="下一个匹配项" :disabled="!findMatches || findPending" @click="search(true,true)"><AppIcon icon="chevron-down" /></button>
      <button type="button" class="ui-icon-button" title="关闭查找（Esc）" aria-label="关闭页内查找" @click="closeFind(true)"><AppIcon icon="xmark" /></button>
    </div>
    <div v-if="manual && !selecting && !annotationActive" class="browser-manual-status" role="status"><span class="browser-manual-dot" />你正在操作 · AI 已暂停</div>
    <div v-if="error" class="browser-tab-notice" role="alert">{{ error }}</div>
    <div v-if="desktop" ref="viewportArea" class="browser-viewport-area" :class="{'has-failure':failure,'is-start':isStart}">
      <BrowserStartPage v-if="isStart" :state="startState" :chat-id="chatId" @navigate="navigate" @changed="loadStart" />
      <div v-if="failure" class="browser-page-failure" role="alert">
        <div class="browser-failure-icon"><AppIcon :icon="crashed?'window-restore':'globe'" /></div>
        <h3>{{ crashed?'页面意外退出':'暂时无法打开此网页' }}</h3>
        <p>{{ crashed?'重新加载可恢复浏览，页面中未保存的内容可能已丢失。':browserLoadFailureHint(loadError?.code) }}</p>
        <span v-if="loadError" class="browser-failure-url" :title="loadError.url">{{ loadError.url }}</span>
        <div class="browser-failure-actions"><button type="button" class="ui-button primary" :disabled="retrying" @click="retry"><AppIcon icon="arrow-rotate-right" />{{ retrying?'正在重新加载…':'重新加载' }}</button><button v-if="canBack" type="button" class="ui-button" :disabled="isNavigating" @click="run('back')">返回上一页</button></div>
      </div>
      <div v-show="!isStart" class="browser-native-slot" :style="appliedViewport?{width:`${appliedViewport.width*zoom}px`,height:`${appliedViewport.height*zoom}px`,flex:'none'}:{}" ref="slotArea"><img v-if="frozenFrame" class="browser-frozen-frame" :src="frozenFrame" alt="" aria-hidden="true" draggable="false" /><span v-if="!id">正在连接浏览器…</span></div>
    </div>
    <div v-else class="browser-tab-notice">远程端请使用浏览器资源中的远程查看。</div>
    <section v-if="notesOpen" class="browser-annotations" aria-label="页面批注" :style="{height:renderedNotesHeight+'px'}">
      <div class="annotation-resizer" role="separator" tabindex="0" aria-label="调整批注面板高度" aria-orientation="horizontal" :aria-valuenow="renderedNotesHeight" :aria-valuemin="120" :aria-valuemax="notesMaximum" @pointerdown="resizeNotes" @keydown="resizeNotesKey" />
      <header><strong>页面批注 <small>{{ filteredNotes.length }} / {{ scopedNotes.length }}</small></strong><select v-model="noteScope" aria-label="批注范围"><option value="page">当前页面</option><option value="chat">当前对话</option></select><button type="button" class="ui-icon-button" title="收起批注" aria-label="收起批注" @click="notesOpen=false"><AppIcon icon="chevron-down" /></button></header>
      <div class="annotation-tools"><button type="button" class="ui-button" :disabled="!desktop || selecting || annotationActive || failure" @click="begin('element')"><AppIcon icon="cursor" />选取元素</button><button type="button" class="ui-button" :disabled="!desktop || selecting || annotationActive || failure" @click="begin('region')"><AppIcon icon="region" />框选区域</button><span v-if="!desktop">远程端仅可查看</span></div>
      <div v-if="scopedNotes.length" class="annotation-filters" role="search" aria-label="搜索和筛选批注"><input v-model="noteSearch" type="search" aria-label="搜索批注" placeholder="搜索标题、网址或意见" maxlength="200" autocomplete="off" @keydown="focusAnnotationFromSearch" /><select v-model="noteState" aria-label="按状态筛选批注"><option value="all">所有状态</option><option value="draft">草稿</option><option value="pending">待处理</option><option value="review">待核对</option><option value="resolved">已解决</option></select><select v-model="noteSort" aria-label="批注排序"><option value="newest">最新优先</option><option value="oldest">最早优先</option></select></div>
      <details v-if="draftIssues.length" class="annotation-storage-warning" role="status"><summary>{{ draftIssues.length }} 个草稿文件异常，已隔离并保留原件。其他草稿可继续使用。</summary><ul><li v-for="issue in draftIssues" :key="issue.fileName">{{ issue.fileName }}</li></ul></details>
      <p v-if="!scopedNotes.length">选择元素或框选区域，填写意见后加入对话输入区。</p>
      <p v-else-if="!filteredNotes.length" class="annotation-no-results">没有符合条件的批注。<button type="button" class="ui-button" @click="noteSearch='';noteState='all'">清除筛选</button></p>
      <article v-for="(note,index) in displayedNotes" :key="note.id" :data-annotation-card="note.id" tabindex="0" :aria-label="`批注：${note.selection.title || note.selection.url}`" @keydown.self="moveAnnotationFocus">
        <div class="annotation-caption"><span :title="note.selection.url">{{ note.selection.title || note.selection.url }}</span><span>{{ states[note.taskState] }} · 创建时快照<span v-if="note.selection.url!==pageUrl"> · 与当前页面不同</span></span></div>
        <button v-if="desktop && note.pageId===id" type="button" class="ui-button annotation-compare" aria-label="检查当前页面与创建时快照的差异" :disabled="comparisonBusy===note.id" @click="compareSnapshot(note)">{{ comparisonBusy===note.id?'正在检查…':'检查页面变化' }}</button>
        <p v-if="comparisons[note.id]" class="annotation-comparison" role="status">{{ comparisonSummary(note) }}</p>
        <button v-if="images[note.id]" type="button" class="annotation-preview" :class="{enlarged:preview===note.id}" :aria-label="preview===note.id?'缩小批注截图':'放大批注截图'" :aria-expanded="preview===note.id" @click="preview=preview===note.id?'':note.id"><img :src="images[note.id]" alt="批注创建时的页面截图" /><span class="annotation-region" :style="regionStyle(note)">{{ index+1 }}</span></button>
        <textarea :readonly="!desktop || noteBusy===note.id" v-model="comments[note.id]" :data-annotation-id="note.id" aria-label="批注意见" maxlength="4000" placeholder="描述需要调整的地方" @input="rememberDraft(note,($event.target as HTMLTextAreaElement).value)" />
        <div v-if="draftState(note).error" class="annotation-conflict" role="status"><span>{{ draftState(note).copied?'其他窗口已更新草稿，此处文字已另存为冲突副本。':'草稿暂未保留，请重试。' }}</span><button type="button" class="ui-button" :disabled="!!noteBusy || draftState(note).pending || !draftState(note).copied" @click="reloadDraft(note)">载入其他窗口草稿</button><button v-if="!draftState(note).copied" type="button" class="ui-button" :disabled="!!noteBusy || draftState(note).pending" @click="rememberDraft(note,comments[note.id]||'')">重试保留</button></div>
        <AnnotationDraftRecovery :copies="draftCopies(note.id)" :text="comments[note.id]||''" :disabled="!!noteBusy || draftState(note).pending" @resolve="(copy,text)=>resolveDraft(note,copy,text)" />
        <div v-if="draftConflicts[note.id]" class="annotation-conflict" role="status">意见已在其他位置更新，本地草稿已保留。<button type="button" class="ui-button" @click="useLatest(note)">使用最新意见</button></div>
        <div v-if="desktop" class="annotation-actions"><button type="button" class="ui-button" @click="locate(note)">定位</button><span class="annotation-save-state" role="status">{{ draftState(note).pending?'正在保留草稿…':draftState(note).retained?'草稿已保留':comments[note.id]!==note.comment?'待保存':savedNote===note.id?'已保存':'' }}</span><button v-if="comments[note.id]!==note.comment" type="button" class="ui-button" :disabled="!!noteBusy || !!draftState(note).error" @click="performNote(note,'save')">保存意见</button><button v-if="note.taskState==='draft'" type="button" class="ui-button primary" :disabled="!!noteBusy || !!draftState(note).error || !comments[note.id]?.trim()" title="加入输入区后可编辑，再发送给 AI" @click="performNote(note,'send')">加入对话</button><button v-else-if="note.taskState==='review'" type="button" class="ui-button primary" :disabled="!!noteBusy" @click="performNote(note,'resolve')">确认解决</button><span v-else class="annotation-stage">{{ states[note.taskState] }}</span><ActionMenu label="批注更多操作" :disabled="!!noteBusy" default-cursor :items="noteActions(note)" @select="performNote(note,$event)" @open="noteMenuOpen=$event" /></div>
      </article><button v-if="filteredNotes.length>noteLimit" class="ui-button" @click="noteLimit+=20">显示更早的批注（{{ Math.min(noteLimit,filteredNotes.length) }} / {{ filteredNotes.length }}）</button>
    </section>
  </section>
</template>
<script setup lang="ts">
import AppIcon from './icons/AppIcon.vue'
import BrowserAddressBar from './BrowserAddressBar.vue'
import BrowserStartPage from './BrowserStartPage.vue'
import {browserInputTarget,type BrowserStartState} from '@shared/browser-start'
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {browserLoadFailureHint,type BrowserAnnotation,type BrowserAnnotationComparison,type BrowserDraftCopy,type BrowserLoadError} from '@shared/browser-workspace'
import AnnotationDraftRecovery from './AnnotationDraftRecovery.vue'
import ActionMenu from './ActionMenu.vue'
import BrowserDownloadsMenu from './BrowserDownloadsMenu.vue'
import {createAnnotationDrafts} from '@/composables/annotationDrafts'
const props=withDefaults(defineProps<{chatId:string;tabKey?:string;pageId?:string;url?:string;active?:boolean;detached?:boolean}>(),{active:true})
const emit=defineEmits<{changed:[title:string,url:string,pageId:string,faviconUrl?:string,loading?:boolean];expand:[]}>()
const desktop=window.navora?.app.platform!=='web',api=window.navora!.browser.workspace
const id=ref(props.pageId||''),pageUrl=ref(props.url||''),pageTitle=ref(''),navigationTarget=ref(''),editing=ref(false),error=ref(''),busy=ref(false)
const stopPending=ref(false),isNavigating=computed(()=>!stopPending.value&&(busy.value||!!navigationTarget.value))
const retrying=ref(false)
const frozenFrame=ref('')
const loadError=ref<BrowserLoadError>(),crashed=ref(false),failure=computed(()=>crashed.value||!!loadError.value),downloadsOpen=ref(false)
const isStart=computed(()=>pageUrl.value==='about:blank'&&!navigationTarget.value&&!failure.value),addressOpen=ref(false),startState=ref<BrowserStartState>({links:[],history:[]}),savingLink=ref(false)
const savedLink=computed(()=>startState.value.links.find(link=>link.url===pageUrl.value))
let startRequest=0,navigationRequest=0,offStart:(()=>void)|undefined
async function loadStart(){if(!desktop||!props.active)return;const request=++startRequest;try{const state=await api.startPage(props.chatId);if(!disposed&&request===startRequest)startState.value=state}catch{if(!disposed)error.value='常用网址暂时无法读取，请重试。'}}
async function navigate(input:string){
  if(selecting.value||!id.value)return
  const request=++navigationRequest
  try{const target=browserInputTarget(input);navigationTarget.value=target;if(target==='about:blank'){notesOpen.value=false;await closeFind()}await run('navigate',target)}catch(e){if(request===navigationRequest)error.value=String(e).includes('invalid')?'请输入有效的网址或搜索内容。':message(e)}finally{
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
async function toggleQuickLink(){if(savingLink.value)return;savingLink.value=true;try{if(savedLink.value)await api.removeQuickLink(props.chatId,savedLink.value.id);else await api.saveQuickLink(props.chatId,{title:pageTitle.value.slice(0,80),url:pageUrl.value});await loadStart()}catch(e){error.value=String(e).includes('quick_link_limit')?'快捷访问已满，请在新标签页中整理。':'快捷访问未更新，请重试。'}finally{savingLink.value=false}}
const findOpen=ref(false),findQuery=ref(''),findInput=ref<HTMLInputElement|null>(null),findMatches=ref(0),findOrdinal=ref(0),findPending=ref(false)
let findToken='',findTimer:ReturnType<typeof setTimeout>|undefined,offFindFocus:(()=>void)|undefined,offFindResult:(()=>void)|undefined
const viewport=ref('auto'),zoom=ref(1),customWidth=ref(1024),customHeight=ref(768),manual=ref(false),selecting=ref(false),selectionKind=ref<'element'|'region'>('element')
const annotationActive=ref(false)
const selectionStarting=ref(false),draftEpoch=ref(0)
const drafts=createAnnotationDrafts(api,props.chatId,()=>draftEpoch.value++)
function draftState(note:BrowserAnnotation){void draftEpoch.value;return drafts.state(note)}
function draftCopies(id:string){void draftEpoch.value;return drafts.copies(id)}
const draftIssues=computed(()=>{void draftEpoch.value;return drafts.issues()})
const panelArea=ref<HTMLElement|null>(null),notesMaximum=ref(480)
const renderedNotesHeight=computed(()=>Math.min(notesHeight.value,notesMaximum.value))
const appliedViewport=ref<{width:number;height:number}|null>(null),draftConflicts=ref<Record<string,boolean>>({})
const canBack=ref(false),canForward=ref(false),displayOptions=ref(false),moreOpen=ref(false),noteMenuOpen=ref(false),notesHeight=ref(260),noteBusy=ref(''),savedNote=ref('')
const browserActions=computed(()=>[
  {id:'home',label:'新标签页首页',icon:'house',disabled:selecting.value},
  {id:'display',label:displayOptions.value?'收起显示设置':'网页尺寸与缩放',icon:'sliders'},
  {id:'forward',label:'前进',icon:'arrow-right',disabled:!canForward.value||selecting.value},
  {id:'find',label:'在网页中查找',icon:'magnifying-glass',reason:'Ctrl+F',disabled:!id.value||failure.value||selecting.value||isStart.value||isNavigating.value},
  {id:'control',label:manual.value?'恢复 AI 操作':'接管页面',icon:'eye',disabled:!id.value||selecting.value||isStart.value&&!manual.value},
  {id:'move',label:props.detached?'移回主工作区':'移至独立窗口',icon:'arrow-up-right-from-square',disabled:!id.value||manual.value,reason:manual.value?'请先恢复 AI 操作':undefined,divider:true},
  ...(props.detached?[]:[{id:'expand',label:'展开 / 还原工作区',icon:'window-maximize'}])
])
function browserAction(action:string){if(action==='home')void navigate('about:blank');else if(action==='display')displayOptions.value=!displayOptions.value;else if(action==='find')void openFind();else if(action==='move')void move();else if(action==='expand')emit('expand');else if(action==='forward')void run('forward');else if(action==='control')void (manual.value?resume():takeControl())}
function noteActions(note:BrowserAnnotation){return [
  {id:'send',label:'加入对话输入区',icon:'comments',disabled:!comments.value[note.id]?.trim()},
  {id:'resolve',label:note.taskState==='resolved'?'重新打开':'确认解决',icon:'check',disabled:note.taskState==='draft'},
  {id:'delete',label:'移除批注列表项…',icon:'trash',danger:true,divider:true}
]}
async function performNote(note:BrowserAnnotation,action:string){if(noteBusy.value)return;noteBusy.value=note.id;savedNote.value='';try{if(action==='save'){await save(note);savedNote.value=note.id}else if(action==='send')await send(note);else if(action==='resolve')await status(note,note.taskState==='resolved'?'pending':'resolved');else if(action==='delete'){if(window.confirm('移除此批注列表项？已加入对话的历史快照仍会保留。'))await remove(note)}}catch(e){error.value=message(e)}finally{noteBusy.value=''}}
function cancelSelection(e:KeyboardEvent){if(!selecting.value)return;e.preventDefault();e.stopPropagation();if(!selectionStarting.value)void cancelCapture()}
let stopNotesResize:(()=>void)|undefined
function resizeNotesKey(e:KeyboardEvent){if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();notesHeight.value=e.key==='Home'?120:e.key==='End'?notesMaximum.value:Math.max(120,Math.min(notesMaximum.value,renderedNotesHeight.value+(e.key==='ArrowUp'?20:-20)))}
function resizeNotes(e:PointerEvent){if(e.button!==0)return;e.preventDefault();stopNotesResize?.();const el=e.currentTarget as HTMLElement,start=e.clientY,height=renderedNotesHeight.value;el.setPointerCapture(e.pointerId);const move=(next:PointerEvent)=>notesHeight.value=Math.max(120,Math.min(notesMaximum.value,height+start-next.clientY));const end=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',end);el.removeEventListener('pointercancel',end);el.removeEventListener('lostpointercapture',end);if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);stopNotesResize=undefined};stopNotesResize=end;el.addEventListener('pointermove',move);el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);el.addEventListener('lostpointercapture',end)}
const fixedSize=computed(()=>viewport.value==='custom'?{width:customWidth.value,height:customHeight.value}:{width:Number(viewport.value.split('x')[0])||390,height:Number(viewport.value.split('x')[1])||844})
const slotArea=ref<HTMLElement|null>(null),viewportArea=ref<HTMLElement|null>(null),addressInput=ref<InstanceType<typeof BrowserAddressBar>|null>(null)
const notesOpen=ref(false),notes=ref<BrowserAnnotation[]>([]),comments=ref<Record<string,string>>({}),images=ref<Record<string,string>>({}),preview=ref(''),comparisons=ref<Record<string,BrowserAnnotationComparison>>({}),comparisonBusy=ref('')
const noteLimit=ref(20),noteScope=ref('page'),noteSearch=ref(''),noteState=ref('all'),noteSort=ref<'newest'|'oldest'>('newest')
const scopedNotes=computed(()=>notes.value.filter(note=>noteScope.value==='chat'||note.pageId===id.value))
const filteredNotes=computed(()=>{
  const query=noteSearch.value.trim().toLocaleLowerCase()
  return [...scopedNotes.value]
    .filter(note=>noteState.value==='all'||note.taskState===noteState.value)
    .filter(note=>!query||[note.selection.title,note.selection.url,note.selection.text,note.comment,comments.value[note.id]].some(value=>value?.toLocaleLowerCase().includes(query)))
    .sort((a,b)=>noteSort.value==='newest'?b.createdAt-a.createdAt:a.createdAt-b.createdAt)
})
const displayedNotes=computed(()=>filteredNotes.value.slice(0,noteLimit.value))
watch([noteScope,noteSearch,noteState,noteSort],()=>{noteLimit.value=20})
watch([id,pageUrl],()=>{comparisons.value={}})
function focusAnnotationFromSearch(event:KeyboardEvent){if(event.key!=='ArrowDown')return;const first=panelArea.value?.querySelector<HTMLElement>('[data-annotation-card]');if(first){event.preventDefault();first.focus()}}
function moveAnnotationFocus(event:KeyboardEvent){if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;const cards=[...(panelArea.value?.querySelectorAll<HTMLElement>('[data-annotation-card]')||[])],index=cards.indexOf(event.currentTarget as HTMLElement),next=cards[index+(event.key==='ArrowDown'?1:-1)];if(next){event.preventDefault();next.focus()}}
watch(displayedNotes,async rows=>{
  const request=notesRequest
  for(const note of rows){
    if(images.value[note.id])continue
    const media=await window.navora!.workspace.readMedia(props.chatId,note.screenshotPath)
    if(disposed||request!==notesRequest)return
    if(media.ok&&media.base64)images.value[note.id]=`data:${media.mime};base64,${media.base64}`
  }
},{flush:'post'})
function regionStyle(note:BrowserAnnotation){const r=note.selection.rect,v=note.selection.viewport;return {left:`${r.x/v.width*100}%`,top:`${r.y/v.height*100}%`,width:`${r.width/v.width*100}%`,height:`${r.height/v.height*100}%`}}
async function compareSnapshot(note:BrowserAnnotation){if(!desktop||note.pageId!==id.value||comparisonBusy.value)return;comparisonBusy.value=note.id;try{comparisons.value[note.id]=await api.compareAnnotation(props.chatId,note.id)}catch(e){error.value=message(e)}finally{comparisonBusy.value=''}}
function comparisonSummary(note:BrowserAnnotation){const result=comparisons.value[note.id];if(!result)return '';const changes:string[]=[];if(result.urlChanged)changes.push('网址已变化');if(result.titleChanged)changes.push(`标题已变化（当前：${result.currentTitle||'无标题'}）`);if(result.anchor==='region')changes.push('区域内容需查看创建时截图，未做像素级比较');else if(result.anchor==='missing')changes.push('原批注元素已找不到');else if(result.anchor==='ambiguous')changes.push('原批注定位到多个元素，无法确认');else if(result.anchor==='invalid-selector')changes.push('原批注定位信息无效');else if(result.anchor==='text-changed')changes.push('原批注元素的文字已变化');else if(note.selection.text)changes.push('原批注元素及文字仍匹配');else changes.push('原批注控件仍可定位，输入内容未读取');return changes.length?changes.join('；'):'未发现网址、标题或锚点文字变化（页面其他内容未比较）'}
const states={draft:'草稿',pending:'待处理',review:'待核对',resolved:'已解决'}
let disposed=false,timer:ReturnType<typeof setInterval>|undefined,observer:ResizeObserver|undefined,unsubscribe:(()=>void)|undefined,unfocus:(()=>void)|undefined,unpresent:(()=>void)|undefined,polling=false,lastLayout='',lastViewport='',notesRequest=0,lastNotesRefresh=0,notesLoading=false,layoutOwner='',layoutVersion=0
let overlayObserver:MutationObserver|undefined,lastCovered=false,layingOut=false,layoutAgain=false
const message=(e:unknown)=>{const raw=e instanceof Error?e.message:String(e);const labels:Record<string,string>={browser_busy_wait_for_current_action:'页面正在执行操作，请稍后重试。',browser_busy_finish_action_first:'请先完成当前操作或退出批注。',browser_manual_control:'页面已由用户接管，请点击恢复 AI 操作。',annotation_draft_conflict:'草稿已在其他窗口更新，请先载入最新草稿。',annotation_draft_store_invalid:'草稿文件无法读取，原文件已保留。',annotation_page_changed_select_again:'截图期间页面发生变化，请重新选择批注位置。',annotation_revision_conflict:'批注已在其他位置更新，请重新打开批注列表。',annotation_storage_limit_100MB:'此对话的批注图片已达到 100 MB 上限。',annotation_limit_200:'此对话最多保存 200 条批注。',sent_annotation_cannot_be_deleted:'已加入对话的批注需要保留历史证据。',url_not_allowed:'此网址不在允许访问的范围内。'};return Object.entries(labels).find(([key])=>raw.includes(key))?.[1]||raw}
async function run(command:Parameters<typeof api.command>[1],value?:unknown){if(!id.value)return false;try{error.value='';await api.command(id.value,command,value);return true}catch(e){await refresh();if(!failure.value&&!String(e).includes('browser_navigation_failed'))error.value=message(e);return false}}
async function retry(){
  if(retrying.value)return
  retrying.value=true
  const failedUrl=loadError.value?.url
  try{
    if(isNavigating.value)await stopNavigation()
    await run(failedUrl?'navigate':'reload',failedUrl)
  }finally{retrying.value=false}
}
async function openFind(){if(!id.value||!props.active||selecting.value||failure.value||isStart.value||isNavigating.value)return;findOpen.value=true;await nextTick();findInput.value?.focus();findInput.value?.select();await layout()}
async function closeFind(focusPage=false){
  clearTimeout(findTimer);const token=findToken;findToken='';findPending.value=false;findMatches.value=0;findOrdinal.value=0;findQuery.value='';findOpen.value=false
  if(token&&desktop)await api.stopFind(id.value,token).catch(()=>{})
  if(focusPage&&props.active&&!disposed)await run('focus')
}
async function search(next=false,forward=true){
  clearTimeout(findTimer)
  if(!findOpen.value||!props.active||disposed)return
  if(!findQuery.value.trim()){const token=findToken;findToken='';findMatches.value=0;findOrdinal.value=0;findPending.value=false;if(token)await api.stopFind(id.value,token).catch(()=>{});return}
  if(!findToken)findToken=crypto.randomUUID()
  const token=findToken;findPending.value=true
  try{await api.find(id.value,findQuery.value,{token,next,forward})}catch(e){if(token===findToken){findPending.value=false;error.value=message(e)}}
}
function findEnter(e:KeyboardEvent){if(e.isComposing||e.keyCode===229)return;e.preventDefault();void search(true,!e.shiftKey)}
watch(findQuery,()=>{
  clearTimeout(findTimer);const token=findToken;findToken='';findMatches.value=0;findOrdinal.value=0;findPending.value=!!findQuery.value.trim()
  if(token)void api.stopFind(id.value,token).catch(()=>{})
  if(findOpen.value)findTimer=setTimeout(()=>void search(),150)
})
function overlayCoversPage(){
  if(moreOpen.value||noteMenuOpen.value||downloadsOpen.value||addressOpen.value)return true
  const clip=viewportArea.value?.getBoundingClientRect();if(!clip)return false
  return [...document.querySelectorAll<HTMLElement>('.v-overlay--active .v-overlay__content,.v-overlay--active .v-overlay__scrim,.sidebar-ctx-panel')].some(el=>{
    if(!el.checkVisibility()||getComputedStyle(el).visibility==='hidden')return false
    const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.left<clip.right&&r.right>clip.left&&r.top<clip.bottom&&r.bottom>clip.top
  })
}
async function layout(){
  if(!id.value||!layoutOwner||!desktop||disposed||!props.active)return
  if(layingOut){layoutAgain=true;return}layingOut=true
  const version=layoutVersion
  try{
    const el=slotArea.value,area=viewportArea.value,covered=overlayCoversPage()
    const shown=!!panelArea.value?.isConnected&&panelArea.value.checkVisibility()&&!panelArea.value.closest('[inert]')&&getComputedStyle(panelArea.value).visibility!=='hidden'
    const r=el?.getBoundingClientRect(),clip=area?.getBoundingClientRect()
    const bounds=shown&&!isStart.value&&!failure.value&&r&&clip&&r.width>0&&r.height>0&&!covered?{x:Math.max(0,clip.x),y:Math.max(0,clip.y),width:clip.width,height:clip.height,scrollLeft:area!.scrollLeft,scrollTop:area!.scrollTop}:null
    const key=JSON.stringify([id.value,bounds]);if(key===lastLayout)return
    if(shown&&!isStart.value&&!failure.value&&covered&&!frozenFrame.value){
      try{
        const frame=await api.preview(id.value)
        if(disposed||version!==layoutVersion||!props.active||!overlayCoversPage()){layoutAgain=true;return}
        if(frame){const image=new Image();image.src=frame;await image.decode();if(disposed||version!==layoutVersion||!props.active||!overlayCoversPage()){layoutAgain=true;return}frozenFrame.value=frame;await nextTick();await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))}
      }catch{/* An unavailable preview must not leave the native page above a menu. */}
    }
    if(disposed||version!==layoutVersion||!props.active||covered!==overlayCoversPage()){layoutAgain=true;return}
    lastLayout=key;await api.layout(id.value,bounds,layoutOwner)
    if(!covered&&version===layoutVersion)frozenFrame.value=''
  }catch(e){lastLayout='';if(!disposed)error.value=message(e)}
  finally{layingOut=false;if(layoutAgain&&!disposed){layoutAgain=false;void layout()}}
}
async function refresh(){
  if(polling||disposed||!props.active||!desktop)return
  polling=true
  const version=layoutVersion
  try{
    await layout()
    const state=await api.state(),p=state.pages.flatMap(s=>s.windows).find(p=>p.windowId===id.value)
    if(disposed||!props.active||version!==layoutVersion)return
    if(p){
      crashed.value=!!p.crashed;loadError.value=p.loadError;annotationActive.value=!!p.annotationSelecting
      canBack.value=!!p.canGoBack;canForward.value=!!p.canGoForward;zoom.value=p.zoomFactor||1;manual.value=!!p.manualControl;busy.value=p.loading
      pageUrl.value=p.url;pageTitle.value=p.title
      const viewportKey=JSON.stringify(p.viewport||null)
      appliedViewport.value=p.viewport||null
      if(viewportKey!==lastViewport){lastViewport=viewportKey;if(p.viewport){const preset=`${p.viewport.width}x${p.viewport.height}`;viewport.value=['390x844','1280x800'].includes(preset)?preset:'custom';customWidth.value=p.viewport.width;customHeight.value=p.viewport.height}else viewport.value='auto'}
      emit('changed',p.url==='about:blank'?'新标签页':p.title,p.url,p.windowId,p.faviconUrl,p.loading)
    }
    if(selecting.value&&!selectionStarting.value){const result=await api.collectAnnotation(props.chatId,id.value);if(result.annotation||result.cancelled){selecting.value=false;annotationActive.value=false;manual.value=result.manualControl??manual.value;if(result.annotation)await loadNotes()}}
    if(notesOpen.value&&!notesLoading&&Date.now()-lastNotesRefresh>1500)await loadNotes()
  }catch(e){if(!disposed&&props.active&&version===layoutVersion){if(selecting.value)selecting.value=false;error.value=message(e)}}finally{polling=false}
}
async function setViewport(){
  const size=viewport.value==='auto'?null:{...fixedSize.value}
  if(size&&(!Number.isInteger(size.width)||size.width<1||size.width>7680||!Number.isInteger(size.height)||size.height<1||size.height>4320)){error.value='请输入有效尺寸：宽度 1–7680，高度 1–4320，使用整数。';return}
  if(!await run('viewport',size))return
  appliedViewport.value=size;lastLayout='';await nextTick();await layout()
}
async function move(){try{await (props.detached?api.attach(id.value):api.detach(id.value))}catch(e){error.value=message(e)}}
async function begin(kind:'element'|'region'){
  if(selecting.value||selectionStarting.value)return
  selectionStarting.value=true;selecting.value=true;selectionKind.value=kind
  try{error.value='';await closeFind();await nextTick();await layout();await api.beginAnnotation(props.chatId,id.value,kind);manual.value=true;annotationActive.value=true}
  catch(e){selecting.value=false;error.value=message(e)}finally{selectionStarting.value=false}
}
async function takeControl(){try{await api.command(id.value,'takeControl');manual.value=true}catch(e){error.value=message(e)}}
async function resume(){try{await api.command(id.value,'resume');manual.value=false;selecting.value=false;annotationActive.value=false}catch(e){error.value=message(e)}}
async function cancelCapture(){try{manual.value=await api.cancelAnnotation(props.chatId,id.value);selecting.value=false;annotationActive.value=false}catch(e){error.value=message(e)}}
function rememberDraft(note:BrowserAnnotation,text:string){void drafts.remember(note,text);const draft=drafts.read(note);draftConflicts.value[note.id]=!!draft&&draft.baseComment!==note.comment}
async function reloadDraft(note:BrowserAnnotation){try{comments.value[note.id]=await drafts.reload(note);const draft=drafts.read(note);draftConflicts.value[note.id]=!!draft&&draft.baseComment!==note.comment}catch(e){error.value=message(e)}}
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
    notes.value=rows;lastNotesRefresh=Date.now()
    drafts.sync(stored,document.activeElement?.getAttribute('data-annotation-id')||undefined)
    drafts.syncRecovery(recovery)
    for(const note of rows){
      const draft=drafts.read(note),buffer=comments.value[note.id],previous=previousNotes.get(note.id)
      const text=draft?.text??(buffer===undefined||buffer===previous?.comment?note.comment:buffer)
      comments.value[note.id]=text;draftConflicts.value[note.id]=draft?.baseComment!==undefined?draft.baseComment!==note.comment:text!==note.comment
    }
  }catch(e){if(!disposed&&request===notesRequest)error.value=message(e)}finally{if(request===notesRequest){notesLoading=false;lastNotesRefresh=Date.now()}}
}
async function locate(note:BrowserAnnotation){try{const found=await api.locateAnnotation(props.chatId,note.id);if(!found)error.value='当前页面无法可靠定位此批注，请查看创建时的快照。'}catch(e){error.value=message(e)}}
async function save(note:BrowserAnnotation){await drafts.flush(note.id);const draft=drafts.read(note),updated=await api.updateAnnotation(props.chatId,note.id,draft?.baseRevision??note.revision,{comment:comments.value[note.id]||''});Object.assign(note,updated);await drafts.clear(note);draftConflicts.value[note.id]=false;await loadNotes();return updated}
async function send(note:BrowserAnnotation){try{const saved=await save(note);await api.presentAnnotation(props.chatId,saved.id);await loadNotes()}catch(e){error.value=message(e)}}
async function status(note:BrowserAnnotation,taskState:BrowserAnnotation['taskState']){try{await api.updateAnnotation(props.chatId,note.id,note.revision,{taskState});await loadNotes()}catch(e){error.value=message(e)}}
async function remove(note:BrowserAnnotation){try{await drafts.flush(note.id);await api.removeAnnotation(props.chatId,note.id);drafts.forget(note.id);await loadNotes()}catch(e){error.value=message(e)}}
function keydown(e:KeyboardEvent){if(!props.active||e.altKey||e.shiftKey||e.isComposing)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();void openFind()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='l'){e.preventDefault();addressInput.value?.focus();addressInput.value?.select()}}
watch(()=>props.active,async active=>{layoutVersion++;lastLayout='';frozenFrame.value='';if(active){void loadStart();await nextTick();void refresh()}else{void closeFind();if(id.value&&layoutOwner&&desktop)await api.layout(id.value,null,layoutOwner).catch(()=>{})}})
watch([moreOpen,noteMenuOpen,downloadsOpen,addressOpen,isStart,failure],async()=>{if(failure.value||isStart.value){frozenFrame.value='';void closeFind()}if(isStart.value)notesOpen.value=false;await nextTick();void layout()})
watch(isNavigating,loading=>{if(loading)void closeFind()})
onMounted(async()=>{
  if(!desktop)return
  try{id.value=props.pageId||await api.ensure(props.chatId,props.tabKey||`browser:${props.pageId}`,props.url);if(disposed)return
    await loadStart()
    offStart=api.onStartChanged(chatId=>{if(chatId===undefined||chatId===props.chatId)void loadStart()})
    layoutOwner=await api.claimLayout(id.value);if(disposed)return
    observer=new ResizeObserver(()=>{if(panelArea.value)notesMaximum.value=Math.max(120,Math.min(480,Math.floor(panelArea.value.clientHeight/2)));void layout()});if(viewportArea.value)observer.observe(viewportArea.value);if(panelArea.value)observer.observe(panelArea.value)
    overlayObserver=new MutationObserver(()=>{if(!props.active)return;const covered=overlayCoversPage();if(covered!==lastCovered){lastCovered=covered;void layout()}});overlayObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']})
    window.addEventListener('resize',layout);window.addEventListener('keydown',keydown);viewportArea.value?.addEventListener('scroll',layout)
    unfocus=api.onAddressFocus(pageId=>{if(pageId===id.value&&props.active){addressInput.value?.focus();addressInput.value?.select()}})
    offFindFocus=api.onFindShortcut(value=>{if(value.pageId===id.value&&props.active)void (value.action==='close'?closeFind(true):openFind())})
    offFindResult=api.onFindResult(result=>{if(!disposed&&props.active&&findOpen.value&&result.pageId===id.value&&result.token===findToken){findMatches.value=result.matches;findOrdinal.value=result.activeMatchOrdinal;if(result.finalUpdate)findPending.value=false}})
    unpresent=api.onPresent(payload=>{if(payload.pageId===id.value&&!payload.hidden&&props.active){lastLayout='';void refresh()}})
    unsubscribe=window.navora!.browser.onTreeUpdated(payload=>{if(payload.chatId===props.chatId)void refresh()})
    timer=setInterval(()=>{
      if(selecting.value||notesOpen.value&&Date.now()-lastNotesRefresh>1500)void refresh()
    },250)
    await refresh()
  }catch(e){error.value=message(e)}
})
onBeforeUnmount(()=>{disposed=true;layoutVersion++;startRequest++;offStart?.();void closeFind();offFindFocus?.();offFindResult?.();stopNotesResize?.();observer?.disconnect();overlayObserver?.disconnect();clearInterval(timer);unsubscribe?.();unfocus?.();unpresent?.();window.removeEventListener('resize',layout);window.removeEventListener('keydown',keydown);if(props.active&&layoutOwner&&desktop)void api.layout(id.value,null,layoutOwner).catch(()=>{})})
</script>
<style scoped>
.browser-tab-panel{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;background:var(--navora-surface);container-type:inline-size}
.browser-tab-toolbar,.browser-view-options{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--navora-stroke);background:var(--navora-background);flex-shrink:0;min-width:0}
.browser-tab-toolbar{flex-wrap:nowrap;height:calc(var(--control-height) + 12px)}
.browser-tab-toolbar{background:var(--navora-surface)}
.browser-navigation{display:flex;align-items:center;gap:2px;flex:0 0 auto;padding:3px;border:1px solid var(--navora-stroke);border-radius:10px;background:var(--navora-background)}
.browser-tab-toolbar .browser-navigation .browser-nav-action{width:32px;height:32px;min-height:32px;border-radius:7px;color:#52677e;transition:background-color 140ms ease,color 140ms ease}
.browser-tab-toolbar .browser-navigation .browser-nav-action>.app-icon{width:16px;height:16px}
.browser-tab-toolbar .browser-navigation .browser-nav-action:hover:not(:disabled){background:#e8edf3;color:#344c68}
.browser-tab-toolbar .browser-navigation .browser-nav-action:disabled{color:#a0aab7;opacity:.58}
.browser-tab-toolbar .browser-navigation .browser-reload.loading{background:#e7edf4;color:#3e5874}
.browser-tab-toolbar .browser-navigation .browser-reload.loading:hover:not(:disabled){background:#dce6f0;color:#304b68}
.browser-tab-toolbar .ui-button{border-color:transparent;background:transparent;color:var(--navora-muted);font-weight:400}
.browser-tab-toolbar .ui-button:hover:not(:disabled){background:var(--control-hover);color:var(--navora-ink)}
.browser-tab-toolbar .browser-notes-toggle[aria-pressed=true]{background:#eef0f3;color:#343b45}
.browser-tab-toolbar .browser-control.primary{background:var(--control-selected);color:var(--navora-accent)}
.browser-selecting-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--navora-muted)}
.browser-tab-toolbar input{flex:1;width:0;min-width:40px;height:32px;padding:5px 10px;border:1px solid var(--navora-stroke);border-radius:8px;background:var(--navora-surface);color:var(--navora-ink);font-size:13px}
.browser-tab-toolbar input{border-color:transparent;background:#f5f6f8}
.browser-tab-toolbar input:focus{border-color:#b9c1cc;background:var(--navora-surface)}
.browser-tab-toolbar{height:44px;min-height:44px;padding:5px 10px;gap:6px;background:var(--navora-surface);border-bottom-color:#e5e9ef}
.browser-tab-toolbar .browser-navigation{gap:1px;padding:2px;border-color:#e2e7ee;border-radius:9px;background:#f3f5f8}
.browser-tab-toolbar .browser-navigation .browser-nav-action{width:30px;height:30px;min-height:30px;border-radius:7px}
.browser-tab-toolbar :deep(.browser-address-bar){height:32px;border:1px solid #e8ecf1;border-radius:9px;background:#f5f6f8}
.browser-tab-toolbar :deep(.browser-address-bar:hover:not(.is-focused)){border-color:#dce3eb;background:#fff}
.browser-tab-toolbar :deep(.browser-address-bar.is-focused){background:#fff}
.browser-tab-toolbar :deep(button.ui-icon-button),.browser-tab-toolbar :deep(.ui-action-menu-trigger){width:30px;min-width:30px;height:30px;min-height:30px;border-radius:8px}
.browser-tab-toolbar>.ui-button{height:30px;min-height:30px;padding:0 8px;border-radius:8px}
.browser-view-options{flex-wrap:wrap;font-size:12px;gap:6px}
.browser-view-options select,.browser-annotations select{min-height:32px;max-width:100%;padding:4px 8px;border:1px solid var(--navora-stroke);border-radius:6px;background:var(--navora-surface);color:var(--navora-ink);font-size:12px}
.browser-option-label{color:var(--navora-muted)}
.browser-view-options input{width:64px;min-height:32px;padding:4px;border:1px solid var(--navora-stroke);border-radius:6px;background:var(--navora-surface)}
.browser-view-options button:not(.ui-icon-button){min-height:32px;padding:4px 8px;border:1px solid var(--navora-stroke);border-radius:6px}
.browser-view-options>.ui-icon-button{margin-left:auto}
.browser-viewport-area{flex:1;min-height:70px;overflow:auto;display:flex;background:var(--navora-background)}
.browser-viewport-area.is-start{display:block;background:var(--navora-surface)}
.browser-viewport-area.has-failure{align-items:center;justify-content:center;padding:clamp(16px,4vw,40px);background:#f4f6f8}
.has-failure .browser-native-slot{display:none}
.browser-page-failure{box-sizing:border-box;width:min(100%,480px);margin:auto;padding:clamp(22px,4vw,34px);border:1px solid #e1e6ed;border-radius:18px;background:var(--navora-surface);color:var(--navora-ink);box-shadow:0 12px 36px rgba(28,43,62,.07);text-align:center}
.browser-failure-icon{display:grid;place-items:center;width:52px;height:52px;margin:0 auto 18px;border:1px solid #f0e3c9;border-radius:16px;background:#fff9ee;color:#b17d36}
.browser-failure-icon:has(.app-icon[data-icon="window-restore"]){border-color:#e6dfe0;background:#fff5f4;color:#b35858}
.browser-failure-icon .app-icon{width:24px;height:24px}
.browser-page-failure h3{margin:0 0 8px;font-size:18px;font-weight:650;letter-spacing:-.2px}
.browser-page-failure p{max-width:360px;margin:0 auto;color:var(--navora-muted);font-size:13px;line-height:1.7}
.browser-failure-url{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:16px 0 0;padding:9px 11px;border:1px solid #e9edf2;border-radius:8px;background:#f8f9fb;font-size:12px;color:#637187;text-align:left}
.browser-failure-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:9px;margin-top:20px}
.browser-failure-actions .ui-button{min-height:38px;padding-inline:15px}
.browser-failure-actions .ui-button.primary{background:#376fae;border-color:#376fae;color:#fff;filter:none}
.browser-failure-actions .ui-button.primary:hover:not(:disabled){background:#2e6099;border-color:#2e6099;color:#fff;filter:none}
.browser-failure-actions .ui-button.primary:disabled{background:#e9edf3;border-color:#dbe2eb;color:#718096;opacity:1}
.browser-find-bar{display:flex;align-items:center;gap:4px;padding:5px 8px;border-bottom:1px solid var(--navora-stroke);background:var(--navora-surface);flex-shrink:0;min-width:0}
.browser-find-bar>.app-icon{margin-inline:4px;color:var(--navora-muted);flex-shrink:0}
.browser-find-bar input{flex:1;width:0;min-width:30px;height:32px;padding:4px 6px;color:var(--navora-ink);font-size:13px;outline:none}
.browser-find-bar input:focus-visible{box-shadow:inset 0 -1px var(--navora-accent)}
.browser-find-count{color:var(--navora-muted);font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums;min-width:44px;text-align:right;margin-right:4px}
.browser-manual-status{display:flex;align-items:center;gap:6px;flex-shrink:0;padding:5px 12px;border-bottom:1px solid var(--navora-stroke);color:var(--navora-muted);font-size:11px}
.browser-manual-dot{width:5px;height:5px;border-radius:50%;background:var(--navora-accent)}
.browser-native-slot{position:relative;flex:1;min-height:70px;background:var(--navora-surface)}
.browser-frozen-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;user-select:none}
.browser-tab-notice{padding:8px 12px;color:var(--control-danger);font-size:12px;background:var(--navora-background)}
.browser-selection-status{display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--navora-stroke);font-size:12px;color:var(--navora-muted);flex-shrink:0;flex-wrap:wrap}
.browser-selection-status>span{flex:1}
.browser-annotations{position:relative;flex:0 1 auto;min-height:120px;max-height:50%;overflow:auto;border-top:1px solid var(--navora-stroke);padding:10px 12px;font-size:13px;background:var(--navora-surface)}
.annotation-resizer{position:sticky;top:-10px;height:8px;margin:-10px -12px 2px;cursor:row-resize;touch-action:none;z-index:2;background:var(--navora-background)}
.annotation-resizer:hover{background:var(--control-selected)}
.browser-annotations header{display:flex;gap:6px;align-items:center;min-width:0}
.browser-annotations strong{margin-right:auto;white-space:nowrap}
.browser-annotations strong small,.annotation-count{font-size:11px;font-weight:400;color:var(--navora-muted)}
.annotation-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 0;color:var(--navora-muted)}
.annotation-filters{display:flex;gap:8px;align-items:center;max-width:760px;padding:0 0 8px}
.annotation-filters input{flex:1;min-width:100px;height:34px;padding:6px 9px;border:1px solid var(--navora-stroke);border-radius:7px;background:var(--navora-surface);color:var(--navora-ink)}
.annotation-filters select{width:140px;flex:none}
.annotation-no-results{display:flex;align-items:center;gap:8px;color:var(--navora-muted)}
.browser-annotations article{border-top:1px solid var(--navora-stroke);padding:12px 0}
.browser-annotations article:focus-visible{outline:2px solid var(--navora-accent);outline-offset:2px;border-radius:6px}
.annotation-caption{display:flex;gap:10px;justify-content:space-between;margin-bottom:8px;color:var(--navora-muted);font-size:12px;flex-wrap:wrap}
.annotation-caption span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.annotation-compare{margin:0 0 8px}.annotation-comparison{margin:0 0 8px;padding:7px 9px;border-radius:6px;background:var(--navora-soft);color:var(--navora-muted);font-size:11px;line-height:1.5}
.browser-annotations textarea{width:100%;min-height:64px;border:1px solid var(--navora-stroke);border-radius:8px;padding:8px;resize:vertical;color:var(--navora-ink);background:var(--navora-surface)}
.annotation-preview{position:relative;display:block;overflow:hidden;width:120px;cursor:zoom-in;float:left;margin:0 8px 8px 0;padding:0;border:1px solid var(--navora-stroke);border-radius:6px}
.annotation-preview.enlarged{width:100%;float:none;cursor:zoom-out}
.annotation-preview img{display:block;width:100%;height:auto}
.annotation-region{position:absolute;border:2px solid var(--navora-accent);color:var(--navora-accent);background:var(--control-selected);font-size:11px;pointer-events:none}
.annotation-actions{display:flex;align-items:center;gap:6px;clear:both;flex-wrap:wrap;padding-top:8px}
.annotation-save-state{flex:1;font-size:12px;color:var(--navora-muted)}
.annotation-stage{font-size:12px;color:var(--navora-muted)}
.annotation-conflict{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:8px;color:var(--control-danger);font-size:12px}
.annotation-storage-warning{margin:8px 12px;padding:10px 12px;border:1px solid var(--navora-stroke);border-radius:10px;font-size:12px;line-height:1.6;color:var(--navora-muted)}
.annotation-storage-warning summary{cursor:pointer}
.navora-app .browser-tab-panel button{cursor:default}
.annotation-storage-warning li{overflow-wrap:anywhere}
@container(max-width:360px){.browser-notes-label{display:none}.browser-notes-toggle{padding-inline:8px}}
@container(max-width:520px){.browser-control .browser-control-label{display:none}.browser-control{padding:0;width:var(--control-height)}.browser-forward{display:none}}
@container(max-width:420px){.browser-forward{display:none}.browser-tab-toolbar{padding-inline:6px}.browser-notes-toggle{padding-inline:8px}.browser-option-label{display:none}}
@container(max-width:520px){.annotation-filters{align-items:stretch;flex-direction:column}.annotation-filters select{width:100%}}
@media(pointer:coarse){.browser-tab-toolbar input,.browser-view-options input,.browser-view-options select,.browser-annotations select{min-height:44px}}
</style>
