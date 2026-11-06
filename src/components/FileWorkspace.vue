<template>
  <aside ref="panel" class="file-workspace" :class="{overlay,'full-page':fullPage,'is-conversation':conversation?.active,'expand-preview':expandPreview}" :aria-label="fullPage?'浏览器内容区':'工作区'" :style="[fullPage?undefined:{width:`${width}px`},{'--workspace-tab-count':tabs.length+(conversation?1:0)}]" @keydown="onWorkspaceKey" @dblclick="tabDoubleClick" @dragstart.capture="recordTabDrag">
    <div v-if="!overlay && !fullPage && !expanded" class="file-workspace-resizer" role="separator" aria-label="调整工作区宽度" aria-orientation="vertical" :aria-valuenow="width" aria-valuemin="400" :aria-valuemax="maximum" tabindex="0" @pointerdown="beginResize" @dblclick="emit('resize',540)" @keydown="resizeKey" />
    <header v-if="tabs.length||!fullPage||conversation" class="file-workspace-head" @dragover="dragOver" @dragleave="fileDrag.leave" @drop="dropTab($event)" @contextmenu="blankTabMenu">
      <BrowserTabStrip ref="tabStrip" :count="tabs.length+(conversation?1:0)" :pinned-count="tabs.filter(tab=>tab.pinned).length" :active-key="conversation?.active?'conversation':active?.key" aria-label="对话、文件与网页" @keydown="onTabsKey"><WorkspaceTabItem v-if="conversation" key="conversation" kind="conversation" :closable="false" icon="comments" :label="conversation.title" :status="conversation.status" :selected="conversation.active" controls="conversation-panel" file-key="conversation" class="unified-conversation-tab" :draggable="desktop" @select="selectConversation" @dragstart="startConversationDrag" @dragend="endConversationDrag" />
        <WorkspaceTabItem v-for="(tab,index) in tabs" :key="tab.key" class="file-workspace-tab" :tab-id="`${uid}-${index}`" :file-key="tab.key" :page-id="tab.pageId" :controls="`${uid}-content`" :kind="tab.kind||'file'" :label="tabLabel(tab)" :label-suffix="presentation(tab).suffix" :full-title="presentation(tab).fullTitle" :description="presentation(tab).description" :icon="presentation(tab).icon" :hover-url="tab.desiredUrl||tab.url" :selected="!conversation?.active&&active?.key===tab.key" :pinned="browserMeta(tab)?.pinned" :muted="browserMeta(tab)?.muted" :manual-muted="tab.manualMuted" :mute-reason="tab.muteReason" :audible="browserMeta(tab)?.audible" :multi-selected="multiSelected.length>1&&multiSelected.includes(tab.key)" :context-target="contextTargets.includes(tab.key)" :draggable="tab.kind==='browser'?!!tab.pageId&&!menuPending&&tabController.canDrag(tab.key):tab.kind==='questionnaire'?false:desktop" :failure="tab.loadFailure" :favicon-url="tab.faviconUrl" :loading="tab.loading" close-label="关闭标签页" @pointerenter="!tab.kind?fileDrag.prepare(tab):undefined" @pointerdown="prepareTabDrag($event,tab)" @dragstart="startTabDrag($event,tab)" @dragend="endTabDrag($event,tab)" @dragover="dragOver" @drop="dropTab($event,tab.kind==='browser'?tab.pageId:tab.key)" @auxclick="closeOnMiddle($event,tab.key)" @contextmenu.stop="showTabMenu($event,tab)" @keydown="onTabContextKey($event,tab)" @select="selectWorkspaceTab(tab,$event)" @toggle-mute="tabController.toggleMute(tab.key)" @close="closeTab(tab.key)" />
      </BrowserTabStrip>
      <button type="button" class="file-workspace-close file-workspace-new-tab" aria-label="新建浏览器标签页" title="新建浏览器标签页" @click="newBrowser()"><AppIcon icon="plus" /></button>
      <BrowserTabList :available="!!tabStrip?.overflowing" scope-label="工作区" :tabs="overflowTabs" :active-id="active?.key||''" @select="selectFile" />
      <div v-if="expanded||fullPage" ref="contextTools" class="workspace-context-tools" aria-label="当前标签页工具" />
      <span class="workspace-controls-divider" aria-hidden="true" />
      <button v-if="!fullPage && !overlay" type="button" class="ui-icon-button workspace-expand" :aria-label="expanded?'收起工作区（恢复分栏）':'展开工作区'" :title="expanded?'收起工作区（恢复分栏）':'展开工作区'" @click="emit('expand')"><AppIcon :icon="expanded?'workspace-restore':'workspace-expand'" /></button>
      <button v-if="running&&conversation?.active" type="button" class="ui-icon-button" title="停止当前任务" aria-label="停止当前任务" @click="emit('stop')"><AppIcon icon="stop"/></button><WorkspaceLauncher :count="workspaceCount ?? tabs.length" :open="true" @activate="hidePanel" />
    </header>
    <div v-if="expandPreview" class="workspace-expand-preview" role="status">{{ conversationPreview?'松开后展开对话':'松开后展开工作区' }}</div>
    <div v-if="!conversation?.active && active && active.chatId!==viewerChatId" class="file-workspace-owner">来自 {{ ownerLabel(active.chatId) }}</div>
    <div v-show="!conversation?.active" :id="`${uid}-content`" class="file-workspace-content" role="tabpanel" :aria-labelledby="active?`${uid}-${tabs.findIndex(tab=>tab.key===active?.key)}`:undefined">
      <div v-if="!tabs.length" class="workspace-empty" :class="{'browser-empty':fullPage}">
        <template v-if="fullPage"><span class="browser-empty-icon"><AppIcon icon="globe" /></span><strong>当前没有打开的网页</strong><p>从左侧选择已有页面，或新建网页开始浏览。</p><button type="button" class="ui-button primary" @click="emit('openBrowser')"><AppIcon icon="plus" />新建网页</button></template>
        <template v-else><AppIcon icon="workspace" /><strong>工作区</strong><p>在这里查看文件和网页</p><button type="button" class="ui-button" @click="emit('openBrowser')">新建网页</button><button type="button" class="ui-button" @click="pickerOpen=true">打开对话文件</button></template>
      </div>
      <KeepAlive :max="4"><FilePreviewPanel v-if="active && !active.kind" :key="active.key" tabbed embedded :active="presented!==false&&!conversation?.active" :toolbar-target="!conversation?.active?contextTools:undefined" :chat-id="active.chatId" :path="active.path" :width="width" @close="hidePanel" @open-file="emit('openFile',{path:$event,chatId:active.chatId})" @notify="notify" /></KeepAlive>
      <KeepAlive :max="8"><SubchatWorkspace v-if="active?.kind==='subchats'" :key="active.key" ref="subchatWorkspace" :parent-chat-id="active.parentChatId" :selected-id="active.selectedSubchatId" :active="presented!==false&&!conversation?.active" :toolbar-target="!conversation?.active?contextTools:undefined" @select="emit('selectSubchat',active!.key,$event)" @locate-parent="emit('locateParent',$event)" @open-file="emit('openFile',$event)" @creator="emit('creator',$event)" @notify="notify" /></KeepAlive>
      <QuestionnairePanel v-if="questionnaireTab?.kind==='questionnaire'" v-show="!conversation?.active&&active?.key===questionnaireTab.key" ref="questionnairePanel" :questionnaire-id="questionnaireTab.questionnaireId" :chat-id="questionnaireTab.chatId" :owner-title="ownerLabel(questionnaireTab.chatId)" @submitted="emit('questionnaireSubmitted',$event)" @cancelled="emit('questionnaireCancelled',$event)" @return-to-chat="emit('questionnaireReturnToChat',$event)" @notify="notify" />
      <BrowserTabPanel v-for="tab in tabs.filter(item=>item.kind==='browser')" v-show="!conversation?.active&&active?.key===tab.key" :key="tab.key" :chat-id="tab.chatId" :tab-key="tab.key" :active="presented!==false&&!conversation?.active&&active?.key===tab.key" :toolbar-target="!conversation?.active&&active?.key===tab.key?contextTools:undefined" :expanded="expanded" :url="tab.url" @open-file="emit('openFile',{path:$event,chatId:tab.chatId})" @expand="emit('expand')" @changed="(title,url,pageId,faviconUrl,loading)=>emit('browserChanged',tab.key,title,url,pageId,faviconUrl,loading)" />
    </div>
    <BrowserTabContextMenu ref="browserMenu" :items="browserMenuItems" @action="tabController.execute" @closed="tabController.closeMenu" />
    <SidebarContextMenu ref="tabMenu"><template v-for="item in workspaceActions" :key="item.id"><div v-if="item.divider" class="sidebar-ctx-label with-sep" /><button type="button" role="menuitem" class="sidebar-more-item" :disabled="item.disabled" @click="workspaceAction(item.id)"><AppIcon :icon="item.icon" /><span>{{ item.label }}</span></button></template></SidebarContextMenu>
    <WorkspaceFilePickerDialog v-model="pickerOpen" :active="presented!==false" :chat-id="viewerChatId" title="选择工作区文件" @open="chooseFile" @locate="locateFile" @error="emit('notify',$event,'warning')" @after-leave="finishLocate" />
  </aside>
</template>
<script setup lang="ts">
import AppIcon from './icons/AppIcon.vue'
import WorkspaceTabItem from './WorkspaceTabItem.vue'
import WorkspaceLauncher from './WorkspaceLauncher.vue'
import BrowserTabStrip from './BrowserTabStrip.vue'
import BrowserTabContextMenu from './BrowserTabContextMenu.vue'
import BrowserTabList from './BrowserTabList.vue'
import {computed,nextTick,onBeforeUnmount,onMounted,ref,useId,watch} from 'vue'
import {browserTabShortcut,type BrowserTabAction} from '@shared/browser-workspace'
import type {FileTab} from '@shared/file-tabs'
import {workspaceTabPresentation} from '@shared/workspace-tab-presentation'
import {showTabDrop,tabDropBefore,startTabFeedback,endTabFeedback} from '@/composables/tabDragFeedback'
import FilePreviewPanel from './FilePreviewPanel.vue'
import BrowserTabPanel from './BrowserTabPanel.vue'
import SubchatWorkspace from './SubchatWorkspace.vue'
import QuestionnairePanel from './QuestionnairePanel.vue'
import type {QuestionnaireRecord} from '@shared/questionnaire'
import {useFileDrag,fileTabMime} from '@/composables/useFileDrag'
import {useBrowserDrag} from '@/composables/useBrowserDrag'
import WorkspaceFilePickerDialog from './WorkspaceFilePickerDialog.vue'
import SidebarContextMenu from './sidebar/SidebarContextMenu.vue'
import {useBrowserTabController,browserTabError} from '@/composables/useBrowserTabController'
import {openWindowFind} from '@/composables/useWindowFind'
import {useWorkspaceFileActions} from '@/composables/useWorkspaceFileActions'
const props=defineProps<{conversation?:{title:string;active:boolean;status:string};running?:boolean;tabs:FileTab[];workspaceCount?:number;active:FileTab|null;viewerChatId:string;width:number;maximum:number;overlay:boolean;expanded?:boolean;expandPreview?:boolean;conversationPreview?:boolean;fullPage?:boolean;presented?:boolean;ownerLabel:(id:string)=>string;resolveBrowser?:(key:string,chatId?:string)=>Promise<string>}>()
const emit=defineEmits<{conversation:[];conversationDetach:[];questionnaireSubmitted:[record:QuestionnaireRecord];questionnaireCancelled:[record:QuestionnaireRecord];questionnaireReturnToChat:[payload:{chatId:string;questionnaireId:string;message?:string}];creator:[kind:'skill'|'plugin'];toolsTarget:[target:HTMLElement|null];stop:[];openBrowser:[afterKey?:string];browserChanged:[key:string,title:string,url:string,pageId:string,faviconUrl?:string,loading?:boolean];expand:[];tabExpand:[kind:'conversation'|'workspace'];reorder:[pageId:string,before?:string,pageIds?:string[]];select:[key:string];selectSubchat:[key:string,id:string|null];locateParent:[target:{chatId:string;toolCallId?:string}];close:[key:string];hide:[];resize:[width:number,phase?:'preview'|'commit'|'cancel'];openFile:[file:{path:string;chatId:string}];notify:[text:string,color?:string];locate:[payload:{chatId:string;messageId:string}]}>()
const desktop=window.navora?.app.platform!=='web',fileDrag=useFileDrag(message=>emit('notify',message,'warning'),()=>props.viewerChatId)
const fileActions=useWorkspaceFileActions({open:(path,chatId)=>emit('openFile',{path,chatId}),notify:text=>emit('notify',text,'warning'),isCurrent:target=>props.presented!==false&&target.contextKey===props.viewerChatId&&props.tabs.some(tab=>!tab.kind&&tab.chatId===target.chatId&&tab.path===target.path)})
const workspaceTabMime='application/x-navora-workspace-tab'
function dragOver(event:DragEvent){if(event.dataTransfer?.types.some(type=>type===conversationMime||type===workspaceTabMime)){event.preventDefault();event.dataTransfer.dropEffect='move';if(event.dataTransfer.types.includes(workspaceTabMime))showTabDrop(event);return}browserDrag.over(event);fileDrag.over(event)}
function dropTab(event:DragEvent,before?:string){if(event.dataTransfer?.types.includes(conversationMime)){event.preventDefault();event.stopPropagation();conversationDropped=true;return}if(event.dataTransfer?.types.includes(workspaceTabMime)){event.preventDefault();event.stopPropagation();try{const data=JSON.parse(event.dataTransfer.getData(workspaceTabMime));if(data.source===uid&&props.tabs.some(tab=>tab.key===data.key&&tab.kind==='subchats'))emit('reorder',data.key,tabDropBefore(event,before))}catch{/* Invalid or foreign tab. */}endTabFeedback();return}if(event.dataTransfer?.types.includes(fileTabMime))void fileDrag.drop(event,before);else void browserDrag.drop(event,before)}
const browserDrag=useBrowserDrag(message=>emit('notify',browserTabError(message),'warning'),(id,before,ids)=>emit('reorder',id,before,ids),()=>tabController.refresh(),id=>{const ids=multiSelected.value.flatMap(key=>{const page=props.tabs.find(tab=>tab.key===key)?.pageId;return page?[page]:[]});return ids.includes(id)?ids:[id]})
const uid='file-workspace-'+useId(),panel=ref<HTMLElement|null>(null),tabStrip=ref<InstanceType<typeof BrowserTabStrip>|null>(null)
const contextTools=ref<HTMLElement|null>(null)
const subchatWorkspace=ref<InstanceType<typeof SubchatWorkspace>|null>(null)
const questionnairePanel=ref<InstanceType<typeof QuestionnairePanel>|null>(null)
const questionnaireTab=computed(()=>props.tabs.find(tab=>tab.kind==='questionnaire'))
async function flushQuestionnaireDraft():Promise<boolean>{return questionnairePanel.value?.flushDraft()??true}
async function beforeTabChange():Promise<boolean>{return props.active?.kind==='questionnaire'?flushQuestionnaireDraft():true}
watch(contextTools,target=>emit('toolsTarget',target),{flush:'post'})
const tabBar=computed(()=>tabStrip.value?.element||null)
let lastTabDrag=-Infinity
function recordTabDrag(event:DragEvent){if((event.target as Element)?.closest('.workspace-tab-item'))lastTabDrag=performance.now()}
function tabDoubleClick(event:MouseEvent){
  const target=event.target instanceof Element?event.target:null,tab=target?.closest<HTMLElement>('[role="tab"]')
  if(!tab||!tabBar.value?.contains(tab)||event.button!==0)return
  event.preventDefault();event.stopPropagation()
  if(props.fullPage||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||conversationDragging||performance.now()-lastTabDrag<600)return
  emit('tabExpand',tab.dataset.conversationTab!==undefined?'conversation':'workspace')
}
const conversationMime='application/x-navora-conversation-tab'
let conversationDragging=false,conversationDropped=false,conversationDragCancelled=false
function startConversationDrag(event:DragEvent){if(!props.conversation||!event.dataTransfer){event.preventDefault();return}conversationDragging=true;conversationDropped=false;conversationDragCancelled=false;event.dataTransfer.setData(conversationMime,uid);event.dataTransfer.setData('text/plain',props.conversation.title);event.dataTransfer.effectAllowed='move'}
function endConversationDrag(event:DragEvent){if(!conversationDragging)return;conversationDragging=false;const rect=tabBar.value?.getBoundingClientRect();const hasPoint=event.clientX!==0||event.clientY!==0||event.screenX!==0||event.screenY!==0;const outside=!!rect&&hasPoint&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom);if(outside&&!conversationDropped&&!conversationDragCancelled){emit('conversationDetach');void nextTick(()=>document.querySelector<HTMLElement>('.composer-input .composer-richtext')?.focus({preventScroll:true}))}}
function cancelConversationDrag(event:KeyboardEvent){if(conversationDragging&&event.key==='Escape'){conversationDragCancelled=true;event.preventDefault();event.stopImmediatePropagation()}}
const browserTabs=computed(()=>props.tabs.filter(tab=>tab.kind==='browser'))
const tabController=useBrowserTabController({chatId:()=>props.active?.kind==='browser'?props.active.chatId:props.viewerChatId,tabs:()=>browserTabs.value.map(tab=>({id:tab.key,pageId:tab.pageId,chatId:tab.chatId,title:tabLabel(tab),url:tab.desiredUrl||tab.url,pinned:tab.pinned,muted:tab.muted,audible:tab.audible,loading:tab.loading})),activeId:()=>props.conversation?.active?'':props.active?.key||'',detached:()=>false,select:key=>{void selectFile(key)},newTab:newBrowser,resolvePageId:(key,chatId)=>props.resolveBrowser?props.resolveBrowser(key,props.viewerChatId):window.navora!.browser.workspace.ensure(chatId,key,props.tabs.find(tab=>tab.key===key)?.url),beforeClose:()=>tabStrip.value?.freezeForClose(),notify:message=>emit('notify',message,'warning')})
const {menuRef:browserMenu,menuItems:browserMenuItems,selectedIds:multiSelected,contextIds:contextTargets,pending:menuPending}=tabController
const browserApplicationState=computed(()=>{const tab=props.active?.kind==='browser'&&!props.conversation?.active?tabController.tabs.value.find(tab=>tab.id===props.active?.key):undefined;return tab?{key:tab.id,pageId:tab.pageId,muted:!!tab.muted,addressState:tab.addressState}:null})
function browserMeta(tab:FileTab){return tab.kind==='browser'?tabController.tabs.value.find(item=>item.id===tab.key):undefined}
async function selectWorkspaceTab(tab:FileTab,event:MouseEvent){if(tab.key!==props.active?.key&&!await beforeTabChange())return;if(tab.kind==='browser')tabController.selectTab(tab.key,event);else await selectFile(tab.key)}
async function selectFile(key:string){if(key!==props.active?.key&&!await beforeTabChange())return;tabController.clearSelection();emit('select',key)}
async function selectConversation(){if(!await beforeTabChange())return;tabController.clearSelection();emit('conversation')}
async function newBrowser(afterKey?:string){if(!await beforeTabChange())return;emit('openBrowser',afterKey);await nextTick();const input=[...panel.value?.querySelectorAll<HTMLInputElement>('[aria-label="浏览器地址"]')||[]].find(input=>input.checkVisibility());input?.focus();input?.select()}
function prepareTabDrag(event:PointerEvent,tab:FileTab){if(event.button!==0||(event.target as Element)?.closest('.workspace-tab-close,.workspace-tab-audio'))return;if(tab.kind==='browser'&&tabController.canDrag(tab.key))void browserDrag.prepare(tab.pageId);else if(!tab.kind)void fileDrag.prepare(tab)}
function startTabDrag(event:DragEvent,tab:FileTab){if(tab.kind==='questionnaire'){event.preventDefault();return}if(tab.kind==='browser')browserDrag.start(event,tab.pageId);else if(!tab.kind)fileDrag.start(event,tab);else if(event.dataTransfer){event.dataTransfer.setData(workspaceTabMime,JSON.stringify({source:uid,key:tab.key}));event.dataTransfer.effectAllowed='move';startTabFeedback(event)}}
function endTabDrag(event:DragEvent,tab:FileTab){if(tab.kind==='browser')browserDrag.end(event);else if(!tab.kind)fileDrag.end(event);else endTabFeedback()}
function blankTabMenu(event:MouseEvent){if((event.target as Element)?.closest('button,.workspace-tab-item'))return;tabMenu.value?.hide();tabController.showMenu(event,null)}
const pickerOpen=ref(false)
const tabMenu=ref<InstanceType<typeof SidebarContextMenu>>()
const contextKey=ref<string|null>(null)
let workspaceMenuSnapshot:FileTab|null=null
const contextTab=computed(()=>props.tabs.find(tab=>tab.key===contextKey.value)||null)
function showTabMenu(event:MouseEvent|KeyboardEvent,tab:FileTab|null){
  if(tab?.kind==='browser'){tabMenu.value?.hide();tabController.showMenu(event,tab.key);return}
  tabController.closeMenu();contextKey.value=tab?.key||null;workspaceMenuSnapshot=tab?{...tab}:null
  if(tab&&!tab.kind){
    tabMenu.value?.hide();const captured={...tab},viewer=props.viewerChatId
    void fileActions.show({chatId:captured.chatId,path:captured.path,contextKey:viewer},event,'context',{items:[
      {id:'new-browser',label:'新建浏览器标签页',icon:'plus'},
      ...(!props.fullPage?[{id:'choose-file',label:'打开对话文件…',icon:'folder-open'}]:[]),
      {id:'detach-tab',label:'移至独立窗口',icon:'arrow-up-right-from-square',enabled:desktop},
      {id:'close-tab',label:'关闭标签页',icon:'xmark'},
    ],run:async action=>{
      if(action==='new-browser')await newBrowser(captured.key)
      else if(action==='choose-file')pickerOpen.value=true
      else if(action==='detach-tab')await window.navora!.fileTabs.detach(captured,viewer)
      else if(action==='close-tab')await closeTab(captured.key)
    }});return
  }
  tabMenu.value?.show(event)
}
function onTabContextKey(event:KeyboardEvent,tab:FileTab){if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))showTabMenu(event,tab)}
const workspaceActions=computed(()=>[
  {id:'new',label:'新建浏览器标签页',icon:'plus',disabled:false,divider:false},
  ...(!props.fullPage?[{id:'file',label:'打开对话文件…',icon:'folder-open',disabled:false,divider:false}]:[]),
  ...(contextTab.value?.kind==='subchats'?[{id:'list',label:'返回子对话列表',icon:'list-ul',disabled:false,divider:true},{id:'parent',label:'定位父对话',icon:'comments',disabled:false,divider:false}]:[]),
  ...(contextTab.value?.kind==='questionnaire'?[{id:'questionnaire-chat',label:'返回所属对话',icon:'comments',disabled:false,divider:true}]:[]),
  ...(contextTab.value?[...(contextTab.value.kind!=='subchats'&&contextTab.value.kind!=='questionnaire'?[{id:'detach',label:'移至独立窗口',icon:'arrow-up-right-from-square',disabled:!desktop||(contextTab.value.kind==='browser'&&!contextTab.value.pageId),divider:true}]:[]),
    {id:'close',label:'关闭标签页',icon:'xmark',disabled:false,divider:false}]:[]),
])
function workspaceAction(action:string){
  const tab=workspaceMenuSnapshot,current=tab&&props.tabs.find(item=>item.key===tab.key&&item.chatId===tab.chatId&&item.kind===tab.kind)
  if(tab&&(!current||tab.kind==='questionnaire'&&(current.kind!=='questionnaire'||current.questionnaireId!==tab.questionnaireId))){emit('notify','标签内容已变化，请重新打开菜单。','warning');return}
  if(action==='new')void newBrowser(tab?.key)
  else if(action==='file')pickerOpen.value=true
  else if(action==='close'&&tab)closeTab(tab.key)
  else if(action==='list'&&tab?.kind==='subchats')emit('selectSubchat',tab.key,null)
  else if(action==='parent'&&tab?.kind==='subchats')emit('locateParent',{chatId:tab.parentChatId})
  else if(action==='questionnaire-chat'&&tab?.kind==='questionnaire')emit('questionnaireReturnToChat',{chatId:tab.chatId,questionnaireId:tab.questionnaireId})
  else if(action==='detach'&&tab&&tab.kind!=='subchats'&&tab.kind!=='questionnaire'){const run=tab.kind==='browser'?window.navora!.browser.workspace.detach(tab.pageId!):window.navora!.fileTabs.detach({...tab},props.viewerChatId);void run.catch(e=>emit('notify',String(e),'warning'))}
}
let pendingLocate:{chatId:string;messageId:string}|undefined
function locateFile(messageId:string){pendingLocate={chatId:props.viewerChatId,messageId};pickerOpen.value=false}
function finishLocate(){const target=pendingLocate;pendingLocate=undefined;if(target)emit('locate',target)}
watch(pickerOpen,value=>{if(value)pendingLocate=undefined})
function chooseFile(path:string){pickerOpen.value=false;emit('openFile',{path,chatId:props.viewerChatId})}
watch(()=>props.viewerChatId,()=>{pendingLocate=undefined;pickerOpen.value=false;tabMenu.value?.hide();contextKey.value=null})
watch(()=>props.presented,value=>{if(value===false){pendingLocate=undefined;pickerOpen.value=false}})
function presentation(tab:FileTab){return workspaceTabPresentation(tab,props.tabs,props.ownerLabel)}
function tabLabel(tab:FileTab){return presentation(tab).label}
const overflowTabs=computed(()=>props.tabs.map(tab=>({id:tab.key,title:[tabLabel(tab),presentation(tab).suffix].filter(Boolean).join(" · "),url:tab.kind==='browser'?tab.desiredUrl||tab.url:tab.path,description:presentation(tab).description,icon:presentation(tab).icon,pinned:tab.pinned})))
const notify=(text:string,color?:string)=>emit('notify',text,color)
function selectedButton(){return tabBar.value?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')}
function closeOnMiddle(event:MouseEvent,key:string){if(event.button===1){event.preventDefault();if(!props.tabs.find(tab=>tab.key===key)?.pinned)void closeTab(key)}}
watch(()=>props.active?.key,()=>void nextTick(()=>selectedButton()?.scrollIntoView({block:'nearest',inline:'nearest'})))
// The conversation view collapses this aside to its header. Browsers keep their
// native state; a hidden file scroller needs an explicit position because its
// temporary zero height can otherwise clamp the DOM's scrollTop.
const fileScrollPositions=new Map<string,{top:number;left:number}>()
watch([()=>props.active?.key,()=>props.conversation?.active],([key,chat],[previousKey,previousChat])=>{
  if(previousKey&&!previousChat){const scroller=panel.value?.querySelector<HTMLElement>('.file-preview .preview-content');if(scroller)fileScrollPositions.set(previousKey,{top:scroller.scrollTop,left:scroller.scrollLeft})}
  if(key&&!chat)void nextTick(()=>{const scroller=panel.value?.querySelector<HTMLElement>('.file-preview .preview-content'),position=fileScrollPositions.get(key);if(scroller&&position){scroller.scrollTop=position.top;scroller.scrollLeft=position.left}})
})
function restoreLauncher(){void nextTick(()=>{const target=[...document.querySelectorAll<HTMLButtonElement>('[data-chat-resource=workspace]:not(:disabled),[data-chat-resource=resources],.file-manager .file-manager-row.selected .file-manager-entry,[data-resource-kind=files] [role=treeitem][aria-selected=true]')].filter(el=>el.checkVisibility()).sort((a,b)=>Number(b.dataset.chatResource==='workspace')-Number(a.dataset.chatResource==='workspace'))[0];target?.focus({preventScroll:true})})}
async function hidePanel(){if(!await beforeTabChange())return;emit('hide');restoreLauncher()}
async function closeTab(key:string){const tab=props.tabs.find(tab=>tab.key===key),restore=tabBar.value?.contains(document.activeElement);if(tab?.kind==='questionnaire'&&!await flushQuestionnaireDraft())return;tabStrip.value?.freezeForClose();if(tab?.kind==='browser'&&desktop)await tabController.closeTabs([key]);else emit('close',key);await nextTick();if(props.tabs.some(tab=>tab.key===key)){tabStrip.value?.releaseWidths();return}if(!props.tabs.length&&!props.fullPage)restoreLauncher();else if(restore)selectedButton()?.focus({preventScroll:true})}
async function onTabsKey(event:KeyboardEvent){
  if(event.isComposing||event.keyCode===229||event.repeat)return
  if(!['ArrowLeft','ArrowRight','Home','End','Delete'].includes(event.key)||!(event.target as Element).matches('[role=tab]'))return
  event.preventDefault();event.stopPropagation()
  const focused=(event.target as HTMLElement).dataset.fileKey||props.active?.key
  if(event.key==='Delete'){if(focused==='conversation')emit('expand');else if(focused)void closeTab(focused);return}
  const keys=[...(props.conversation?['conversation']:[]),...props.tabs.map(tab=>tab.key)],current=keys.indexOf(focused||'');const index=event.key==='Home'?0:event.key==='End'?keys.length-1:(current+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length;const key=keys[index];if(key){if(key==='conversation')await selectConversation();else await selectFile(key);void nextTick(()=>selectedButton()?.focus({preventScroll:true}))}
}
async function shortcut(action:BrowserTabAction,pageId?:string){
  const source=pageId?props.tabs.find(t=>t.pageId===pageId):props.active
  if(pageId&&(!source||props.conversation?.active||source.key!==props.active?.key))return
  if(action==='new'){await newBrowser();return}
  if(action==='reopen'){await tabController.reopen();return}
  if(['next','previous','last'].includes(action)||action.startsWith('index')){
    const keys=[...(props.conversation?['conversation']:[]),...props.tabs.map(tab=>tab.key)]
    if(!keys.length)return
    const at=props.conversation?.active?0:keys.indexOf(source?.key||'')
    const key=action==='last'?keys.at(-1):action.startsWith('index')?keys[Number(action.slice(5))-1]:keys[(Math.max(0,at)+(action==='next'?1:-1)+keys.length)%keys.length]
    if(!key)return
    if(key==='conversation')await selectConversation();else await selectFile(key)
    await nextTick()
    const next=props.tabs.find(tab=>tab.key===key)
    if(pageId&&next?.kind==='browser'&&next.pageId){try{await window.navora!.browser.workspace.command(next.pageId,'focus');return}catch{/* Keep keyboard focus on the selected tab when a page moved. */}}
    selectedButton()?.focus({preventScroll:true});return
  }
  if(props.conversation?.active&&action==='close'){emit('expand');return}
  if(!source||props.conversation?.active)return
  if(action==='close'){await closeTab(source.key);return}
  if(source.kind==='browser'&&action==='address'){await nextTick();const input=[...panel.value?.querySelectorAll<HTMLInputElement>('[aria-label="浏览器地址"]')||[]].find(input=>input.checkVisibility());if(input){if(document.activeElement===input)input.blur();input.focus();input.select()}return}
  if(source.kind==='browser'&&action==='mute'){await tabController.toggleMute(source.key);return}
  if(action==='reload'||action==='reloadIgnoringCache'){if(source.kind==='browser')try{await window.navora!.browser.workspace.command(await tabController.pageId(source.key),action)}catch{emit('notify','无法重新加载标签页，请稍后重试。','warning')}return}
}
function onWorkspaceKey(event:KeyboardEvent){
  if(event.defaultPrevented||event.isComposing)return
  if(!props.conversation?.active&&(event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='f'){event.preventDefault();event.stopPropagation();openWindowFind('workspace');return}
  if(event.key==='Escape'){event.stopPropagation();if(!(event.target as Element).closest('input,textarea,select')){event.preventDefault();hidePanel()}return}
  const action=browserTabShortcut({key:event.key,control:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,alt:event.altKey,isAutoRepeat:event.repeat})
  if(action){event.preventDefault();event.stopPropagation();void shortcut(action)}
}
let shortcutUnsub:(()=>void)|undefined
onMounted(()=>{window.addEventListener('keydown',cancelConversationDrag,true);if(window.navora?.app.platform!=='web')shortcutUnsub=window.navora!.browser.workspace.onTabShortcut(payload=>void shortcut(payload.action,payload.pageId));if(!props.conversation?.active&&props.active?.kind==='browser'&&props.active.url==='about:blank')void nextTick(()=>panel.value?.querySelector<HTMLInputElement>('[aria-label="浏览器地址"]')?.focus())})
let stopResize:(()=>void)|undefined
function resizeKey(event:KeyboardEvent){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();emit('resize',event.key==='Home'?540:event.key==='End'?props.maximum:props.width+(event.key==='ArrowLeft'?20:-20))}
function beginResize(event:PointerEvent){
  if(event.button!==0)return
  event.preventDefault();stopResize?.()
  const handle=event.currentTarget as HTMLElement,start=event.clientX,width=props.width
  let latest=width,finished=false
  const move=(next:PointerEvent)=>{if(next.pointerId!==pointerId)return;latest=width+start-next.clientX;emit('resize',latest,'preview')}
  const end=(event?:Event)=>{if(finished||event instanceof PointerEvent&&event.pointerId!==pointerId)return;finished=true;window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',end,true);window.removeEventListener('pointercancel',end,true);handle.removeEventListener('lostpointercapture',end);window.removeEventListener('keydown',cancel,true);emit('resize',latest,event?.type==='pointerup'&&!document.querySelector('.v-overlay--active')?'commit':'cancel');if(handle.hasPointerCapture(pointerId))handle.releasePointerCapture(pointerId);stopResize=undefined}
  const pointerId=event.pointerId,cancel=(key:KeyboardEvent)=>{if(key.key==='Escape'){key.preventDefault();key.stopPropagation();end()}}
  window.addEventListener('keydown',cancel,true)
  // Keep the gesture bound to its pointer even when layout moves the handle
  // away from the release target; capture remains useful across native pages.
  handle.setPointerCapture(event.pointerId);window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',end,true);window.addEventListener('pointercancel',end,true);handle.addEventListener('lostpointercapture',end);stopResize=end
}
watch(()=>[props.overlay,props.expanded],()=>stopResize?.())
watch(()=>props.presented,active=>{if(active===false)stopResize?.()})
onBeforeUnmount(()=>{emit('toolsTarget',null);window.removeEventListener('keydown',cancelConversationDrag,true);stopResize?.();shortcutUnsub?.()})
defineExpose({shortcut,browserApplicationState,flushQuestionnaireDraft,openSubchatFind:()=>subchatWorkspace.value?.openFind(),locateSubchatMessage:(id:string)=>subchatWorkspace.value?.locateMessage(id),locateSubchatPending:(id?:string)=>subchatWorkspace.value?.locatePending(id)})
</script>
<style>
.file-workspace{container-type:inline-size}
.shell:not(.mobile-layout) .browser-primary-return{display:none}
.file-workspace.full-page{inset:0;width:100%;border-left:0;box-shadow:none}
.file-workspace.full-page .file-workspace-head{min-height:44px}
.shell:not(.mobile-layout) .file-workspace.full-page .file-workspace-head{padding-right:12px}
.shell.frameless:not(.mobile-layout) .file-workspace.full-page .file-workspace-head{box-sizing:border-box;height:48px;min-height:48px;background:var(--navora-header,#f8f9fb);-webkit-app-region:no-drag}
.shell.mobile-layout .file-workspace.full-page{top:calc(88px + env(safe-area-inset-top,0px))}
.shell.mobile-layout:not(.frameless) .file-workspace.full-page{top:calc(48px + env(safe-area-inset-top,0px))}
.browser-workspace-heading h1{font-size:14px;font-weight:550}
.browser-workspace-heading .ui-button{margin-left:auto}
.workspace-empty{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--navora-muted);padding:24px;text-align:center}
.workspace-empty>svg{width:28px;height:28px}
.workspace-empty p{margin:0;font-size:13px}
.workspace-empty.browser-empty{gap:10px}
.browser-empty-icon{display:grid;place-items:center;width:44px;height:44px;margin-bottom:4px;border:1px solid #dce4ed;border-radius:13px;background:#fff;color:#74869c;box-shadow:0 2px 7px #25384d0a}
.browser-empty-icon>.app-icon{width:21px;height:21px}
.browser-empty>strong{color:#384c65;font-size:15px;font-weight:600}
.browser-empty>p{max-width:340px;color:#74849a;line-height:1.6}
.browser-empty>.ui-button{margin-top:7px}

/* The parent content area already starts below the window title bar. */
.file-workspace{position:absolute;inset:0 0 0 auto;display:flex;flex-direction:column;min-width:0;min-height:0;max-width:100%;background:#f7f8fa;border-left:1px solid #d8dee7;z-index:7;isolation:isolate}.file-workspace.overlay{box-shadow:-8px 0 30px #243b5814}
.file-workspace-head :is(button,[role=tab],.workspace-tab-item,.file-workspace-tabs,.file-workspace-tab-list){-webkit-app-region:no-drag;pointer-events:auto}
.file-workspace-head{display:flex;align-items:center;min-height:44px;gap:6px;padding:4px 8px;border-bottom:1px solid #e0e5ec;background:#fff;flex-shrink:0}.file-workspace-tabs{display:flex;align-items:center;gap:5px;overflow-x:auto;scrollbar-width:thin;min-width:0;flex:1}.file-tab-close,.file-workspace-close{display:grid;place-items:center;width:25px;height:25px;border:1px solid transparent;border-radius:6px;flex-shrink:0;color:#51657e}.file-tab-close{margin:0 4px 0 1px;opacity:.82;transition:opacity 120ms ease,background-color 120ms ease,color 120ms ease}.file-tab-close svg,.file-workspace-close svg{width:13px;height:13px}.file-tab-close:hover{background:#e5ebf2;color:#263b55}.file-workspace-close:hover{background:#e8edf3;border-color:#d5dce6;color:#344c68}.file-workspace button:focus-visible,.file-workspace-resizer:focus-visible{outline:2px solid #537ab9;outline-offset:-2px}.file-workspace-owner{padding:5px 12px;border-bottom:1px solid #e0e5ec;background:#fff;color:#748194;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.file-workspace-content{display:flex;flex:1;min-height:0;min-width:0}.navora-app .shell .file-workspace .file-workspace-content>.file-preview.embedded{border-radius:0;top:auto;width:100%}.file-workspace-resizer{position:absolute;inset:0 auto 0 -4px;width:8px;cursor:col-resize;touch-action:none;z-index:2}.file-workspace-resizer:hover{background:#537ab929}
/* Firefox-like tab strip: quiet inactive tabs and a raised white active tab. */
.file-workspace-head{background:#f1f3f6;border-bottom-color:#cbd3dd}
.file-workspace-tabs{gap:2px}
.file-workspace-head .workspace-expand{border-radius:9px;color:#7b838d}
.file-workspace-head .workspace-expand>.app-icon{width:15px;height:15px}
.file-workspace-head .workspace-expand:hover:not(:disabled){background:#e6e8eb;color:#535c67}
.file-workspace{border-left:0}
.file-workspace-resizer{left:-6px;width:12px;background:transparent;z-index:6}
.file-workspace-resizer::before{content:'';position:absolute;left:5px;top:8px;bottom:8px;width:1px;border-radius:1px;background:linear-gradient(180deg,transparent,#c8d2de 12%,#c8d2de 88%,transparent);transition:width 140ms ease,background 140ms ease}
.file-workspace-resizer::after{content:'';position:absolute;left:3px;top:calc(50% - 18px);width:5px;height:36px;border-radius:4px;background:#7892ae;opacity:0;transform:scale(.85);transition:opacity 140ms ease,transform 140ms ease}
.file-workspace-resizer:hover::before,.file-workspace-resizer:active::before,.file-workspace-resizer:focus-visible::before{left:4px;width:3px;background:#6f92b8}
.file-workspace-resizer:hover::after,.file-workspace-resizer:active::after,.file-workspace-resizer:focus-visible::after{opacity:.72;transform:scale(1)}
.file-workspace-enter-active,.file-workspace-leave-active{transition:opacity 180ms ease,transform 180ms ease}.file-workspace-enter-from,.file-workspace-leave-to{opacity:0;transform:translateX(12px)}
.file-workspace-picker{width:min(360px,calc(100vw - 24px));max-height:420px;display:flex;flex-direction:column;padding:8px 12px 12px;background:#fff;border:1px solid #d8dee7;border-radius:12px;color:#58677b;box-shadow:0 8px 24px #243b581a;font-size:12px}.file-workspace-picker>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.file-workspace-picker>.sidebar-panel{margin:0;border:0;padding:0;min-height:0;overflow:auto}.file-workspace-picker .res-body{padding:0;max-height:310px;overflow:auto}.file-workspace-picker .ws-root{font-size:10px;color:#7e8a9a}.file-workspace-picker .res-head{display:none}.file-workspace-picker .res-tree{max-height:none}.file-workspace-picker .tree-row{color:#53657b}.file-workspace-picker .res-empty{padding:20px;color:#7e8a9a}
.navora-app .main.file-workspace-open{padding-right:var(--file-workspace-reserve)}
.navora-app .shell.frameless:not(.mobile-layout)>.content-surface>.main.file-workspace-open .main-top{padding-right:12px}
.navora-app .main>.conversation-resource-card{right:calc(var(--file-workspace-reserve,0px) + 12px);max-width:calc(100% - var(--file-workspace-reserve,0px) - 24px)}
.navora-app .shell.frameless.mobile-layout .file-workspace{top:calc(88px + env(safe-area-inset-top,0px))}.navora-app .shell.mobile-layout:not(.frameless) .file-workspace{top:calc(48px + env(safe-area-inset-top,0px))}
@media(prefers-reduced-motion:reduce){.file-workspace-enter-active,.file-workspace-leave-active{transition:none}}
.v-dialog.v-overlay>.v-overlay__content.file-picker-dialog{padding:0;border:0!important;border-radius:12px;background:transparent!important;box-shadow:none!important;backdrop-filter:none!important;overflow:visible}
.file-workspace-picker{width:100%;min-height:0;max-height:min(420px,calc(100dvh - 48px));overflow:hidden}.file-workspace-picker>header{flex-shrink:0}.file-workspace-picker>.workspace-file-picker{flex:1;min-height:0;overflow:hidden}.file-workspace-picker .workspace-picker-results{flex:1}
.file-workspace button{cursor:default}
.file-workspace .file-workspace-tabs{gap:5px}
.file-workspace .file-workspace-head{background:#fff;border-bottom-color:#e0e5ec}
.file-workspace .file-workspace-tabs{display:flex;width:max(0px,calc(var(--workspace-tab-count,0)*225px - 5px));max-width:100%;flex:0 1 auto;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;scrollbar-color:transparent transparent;overscroll-behavior-x:contain;margin-right:0}
.file-workspace .file-workspace-tabs::-webkit-scrollbar{display:none;width:0;height:0}
.file-workspace .file-workspace-tab-list{display:flex;align-items:center;gap:5px;width:100%;min-width:0}
.file-workspace .file-workspace-new-tab{width:32px;min-width:32px;height:32px;min-height:32px;margin-right:auto;border-radius:7px;color:#65778d;background:transparent;border-color:transparent;transition:background-color 140ms ease,border-color 140ms ease,color 140ms ease}
.file-workspace .file-workspace-new-tab>svg{width:18px;height:18px}
.file-workspace .file-workspace-new-tab:hover{color:#3e5874;background:#e7edf4;border-color:#d2dce7}
.file-workspace .file-workspace-new-tab:active{color:#304b68;background:#dce5ee;border-color:#c7d4e2}
.file-workspace .workspace-tab-enter-active{transition:opacity 170ms ease,transform 170ms ease,flex-basis 170ms ease,max-width 170ms ease,margin 170ms ease}
.file-workspace .workspace-tab-leave-active{display:none;transition:none;pointer-events:none}
.file-workspace .workspace-tab-move{transition:transform 170ms ease}
.file-workspace.full-page .file-workspace-head{height:44px;min-height:44px;padding:4px 10px;background:var(--navora-chrome,var(--navora-background));border-bottom-color:#e4e8ee}
.file-workspace.full-page .file-workspace-new-tab{width:32px;min-width:32px;height:32px;min-height:32px;border-radius:8px}
.file-workspace.full-page .file-workspace-head>.ui-icon-button:not(.workspace-launcher){width:32px;min-width:32px;height:32px;min-height:32px;border-radius:8px}
@media(prefers-reduced-motion:reduce){.file-workspace .workspace-tab-enter-active,.file-workspace .workspace-tab-leave-active,.file-workspace .workspace-tab-move{transition:none}}

.navora-app .file-workspace .file-workspace-head{box-sizing:border-box;height:48px;min-height:48px;gap:4px;padding:0 12px;background:var(--navora-header,#f8f9fb);border-bottom-color:var(--navora-stroke,#d8dee7)}
</style>

<style>
.file-workspace.is-conversation{height:48px;bottom:auto;overflow:visible}.main.workspace-chat-active>.conversation-content{display:contents}.main.workspace-chat-active .conversation-title-header{margin-top:0;height:48px;min-height:48px;visibility:hidden;pointer-events:none}.main.workspace-chat-active .conversation-title-header .main-top-text{display:none}
</style>

<style>
.workspace-context-tools{display:flex;align-items:center;flex:0 0 auto;gap:2px;min-width:0;margin-left:auto}.workspace-context-tools:empty{display:none}.workspace-context-tools .conversation-title-actions{margin:0!important;position:static!important}.workspace-context-tools .workspace-chat-tools{display:flex;align-items:center;gap:2px}
</style>
