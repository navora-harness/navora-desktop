<template><v-app class="navora-app"><main class="fixture-tab-chrome"><h1>工作区标签 · 实际组件检查</h1><p>隔离来源组件；页面内容与操作均为检查资料，不连接浏览器或模型。</p>
<header class="fixture-tabs"><BrowserTabStrip ref="strip" :count="tabs.length+(showConversation?1:0)" :pinned-count="tabs.filter(tab=>tab.pinned).length" :active-key="active" aria-label="混合工作区标签" @dragover="over" @drop="drop" @dragleave="leaveTabDrop"><WorkspaceTabItem v-if="showConversation" kind="conversation" file-key="conversation" label="界面检查" :closable="false" :selected="active==='conversation'" @select="active='conversation'"/><WorkspaceTabItem v-for="tab in tabs" :key="tab.key" :file-key="tab.key" :page-id="tab.pageId" :kind="tab.kind||'file'" :label="presentation(tab).label" :label-suffix="presentation(tab).suffix" :title="presentation(tab).description" :full-title="presentation(tab).fullTitle" :icon="presentation(tab).icon" :selected="active===tab.key" :pinned="tab.pinned" :muted="tab.muted" :manual-muted="tab.manualMuted" :mute-reason="tab.muteReason" :audible="tab.audible" :hover-url="tab.url" :failure="tab.loadFailure" :favicon-url="tab.faviconUrl" :loading="tab.loading" :draggable="true" @dragstart="start" @dragend="endTabFeedback" @select="active=tab.key" @close="close(tab.key)" @toggle-mute="tab.muted=!tab.muted;tab.muteReason=tab.muted?'manual':undefined"/></BrowserTabStrip><BrowserTabList :available="!!strip?.overflowing" scope-label="工作区" :tabs="overflowTabs" :active-id="active" @select="active=$event"/></header>
<BrowserTabPanel chat-id="fixture" page-id="fixture-page" tab-key="fixture" url="https://example.test/sensor/protocol?q=界面" :active="true"/>
</main></v-app></template>
<script setup lang="ts">
import {computed,ref} from 'vue'
import BrowserTabStrip from '../../src/components/BrowserTabStrip.vue'
import WorkspaceTabItem from '../../src/components/WorkspaceTabItem.vue'
import BrowserTabList from '../../src/components/BrowserTabList.vue'
import BrowserTabPanel from '../../src/components/BrowserTabPanel.vue'
import {useAppearance} from '../../src/composables/useAppearance'
import {createDefaultConfig} from '../../shared/config'
import {workspaceTabPresentation} from '../../shared/workspace-tab-presentation'
import {makeFileTab,type FileTab} from '../../shared/file-tabs'
import {startTabFeedback,endTabFeedback,showTabDrop,tabDropBefore,leaveTabDrop} from '../../src/composables/tabDragFeedback'
import type {NavoraApi} from '../../electron/preload'
let config=createDefaultConfig();const listeners=new Set<Function>()
window.navora={app:{platform:'web'},config:{get:async()=>config,onChanged:(cb:Function)=>{listeners.add(cb);return()=>listeners.delete(cb)}},browser:{workspace:{},onTreeUpdated:()=>()=>{}}} as unknown as NavoraApi
useAppearance()
const initial=():FileTab[]=>[{kind:'browser',key:'pinned',pageId:'pinned',chatId:'a',path:'已固定页面',url:'https://example.test/pin',pinned:true,muted:true,manualMuted:true,muteReason:'manual'},{kind:'browser',key:'page',pageId:'page',chatId:'a',path:'Sensor protocol 👩🏽‍💻 '+ '完整标题 العربية שלום '.repeat(20),url:'https://example.test/sensor',faviconUrl:'file:///C:/not-permitted.ico'},makeFileTab('a','docs/README.md'),makeFileTab('a','reports/2026/README.md'),{kind:'subchats',key:'hub',chatId:'a',parentChatId:'a',title:'子对话'}]
const showConversation=ref(true),tabs=ref(initial()),active=ref('page'),strip=ref<InstanceType<typeof BrowserTabStrip>>();let commits=0,dragged=''
const presentation=(tab:FileTab)=>workspaceTabPresentation(tab,tabs.value,()=> '界面检查')
const overflowTabs=computed(()=>tabs.value.map(tab=>({id:tab.key,title:presentation(tab).label,description:presentation(tab).description,icon:presentation(tab).icon})))
function close(key:string){strip.value?.freezeForClose();tabs.value=tabs.value.filter(tab=>tab.key!==key);if(active.value===key)active.value=tabs.value[0]?.key||'conversation'}
function start(event:DragEvent){dragged=(event.currentTarget as Element).querySelector<HTMLElement>('[role=tab]')?.dataset.fileKey||'';event.dataTransfer?.setData('application/x-navora-workspace-tab',dragged);startTabFeedback(event)}
function over(event:DragEvent){if(event.dataTransfer?.types.includes('application/x-navora-workspace-tab')){event.preventDefault();showTabDrop(event)}}
function drop(event:DragEvent){if(!dragged)return;event.preventDefault();const before=tabDropBefore(event),tab=tabs.value.find(tab=>tab.key===dragged);endTabFeedback();if(!tab)return;const rest=tabs.value.filter(tab=>tab.key!==dragged),at=before?rest.findIndex(tab=>tab.key===before):rest.length;rest.splice(at<0?rest.length:at,0,tab);tabs.value=rest;commits++;dragged=''}
;(window as any).tabFixture={get tabs(){return tabs.value},get order(){return tabs.value.map(tab=>tab.key)},get commits(){return commits},get overflowing(){return strip.value?.overflowing},set(key:string,patch:object){Object.assign(tabs.value.find(tab=>tab.key===key)!,patch)},reset(){endTabFeedback();tabs.value=initial();active.value='page';commits=0},pair(){showConversation.value=false;tabs.value=[initial().at(-1)!,makeFileTab('a','docs/pair.md')];active.value='hub'},many(){tabs.value.push(...Array.from({length:16},(_,n)=>makeFileTab('a','archive/'+n+'.md')))},reverse(){const pinned=tabs.value.filter(tab=>tab.pinned);tabs.value=[...pinned,...tabs.value.filter(tab=>!tab.pinned).reverse()]},theme(mode:string,palette='mist'){config.app.appearance_mode=mode as any;config.app.appearance_theme=palette as any;for(const cb of listeners)cb(config)}}
</script>
<style>
html,body,#app{height:100%;margin:0;font-family:'Segoe UI','Microsoft YaHei UI',sans-serif}body{overflow:hidden}.v-application__wrap{min-height:0!important;height:100%}.fixture-tab-chrome{padding:16px;display:flex;flex:1;min-height:0;flex-direction:column;color:var(--navora-ink);background:var(--navora-background)}.fixture-tab-chrome h1{font-size:17px;margin:0 0 4px}.fixture-tab-chrome>p{font-size:12px;margin:0 0 20px;color:var(--navora-muted)}.fixture-tabs{display:flex;align-items:center;gap:6px;min-height:48px;border-bottom:1px solid var(--navora-stroke);padding:0 8px;background:var(--navora-surface)}.fixture-tab-chrome>.browser-tab-panel{height:360px;flex:0 0 360px}.browser-tab-notice{padding:40px;font-size:14px}
</style>
