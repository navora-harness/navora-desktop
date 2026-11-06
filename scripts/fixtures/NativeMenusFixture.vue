<template><v-app><main><h1>原生菜单组件接入检查</h1><ApplicationMenuBar :command-state="commands" :context-key="context" @command="(id,context)=>actions.push({kind:'command',id,context})"/><textarea id="edit" value="alpha beta gamma"/><div id="editable" contenteditable="true">editable text here</div><section>
<ActionMenu class="action-menu-fixture-trigger" label="测试操作菜单" :items="actionItems" @select="id=>actions.push({kind:'action',id})" @open="value=>openEvents.push(value)" @dom-open="value=>domEvents.push(value)"/>
<button id="context" @contextmenu="slotMenu?.show($event)">侧栏右键</button><SidebarContextMenu ref="slotMenu"><div class="sidebar-ctx-label">检查分组</div><button role="menuitemcheckbox" :aria-checked="checked" @click="checked=!checked;actions.push({kind:'slot',id:'toggle'})"><AppIcon icon="thumbtack"/><span>{{slotLabel}}</span><span aria-hidden="true">✓</span></button><div role="separator"/><button role="menuitem" disabled title="此操作不可用"><span>禁用动作</span></button><button role="menuitem" @click="actions.push({kind:'slot',id:'copy'})"><AppIcon icon="copy"/><span>复制内容</span><span class="test-shortcut">Ctrl+C</span></button></SidebarContextMenu>
<button id="tabs" @contextmenu="tabMenu?.show($event)">标签右键</button><BrowserTabContextMenu ref="tabMenu" :items="tabItems" @action="id=>actions.push({kind:'tab',id})"/>
<SidebarMoreMenu label="资料侧栏" @hide="actions.push({kind:'more',id:'hide'})"><button role="menuitem" @click="actions.push({kind:'more',id:'refresh'})"><AppIcon icon="arrow-rotate-right"/><span>刷新资料</span></button></SidebarMoreMenu>
</section><TextContextMenuHost/><output>{{actions.length}}</output></main></v-app></template>
<script setup lang="ts">
import {computed,ref} from 'vue'
import ActionMenu from '../../src/components/ActionMenu.vue'
import ApplicationMenuBar from '../../src/components/ApplicationMenuBar.vue'
import BrowserTabContextMenu from '../../src/components/BrowserTabContextMenu.vue'
import SidebarContextMenu from '../../src/components/sidebar/SidebarContextMenu.vue'
import SidebarMoreMenu from '../../src/components/sidebar/SidebarMoreMenu.vue'
import TextContextMenuHost from '../../src/components/TextContextMenuHost.vue'
import {createDefaultConfig} from '../../shared/config'
import type {NativeMenuResult,NativeUiApi} from '../../shared/native-ui'
import type {NavoraApi} from '../../electron/preload'
import {reportBrowserViewport} from '../../src/composables/useBrowserSurfaceLayout'
const actions=ref<any[]>([]),openEvents=ref<boolean[]>([]),domEvents=ref<boolean[]>([]),checked=ref(true),slotLabel=ref('固定侧栏'),context=ref('chat-a'),slotMenu=ref<InstanceType<typeof SidebarContextMenu>>(),tabMenu=ref<InstanceType<typeof BrowserTabContextMenu>>()
const actionItems=ref([{id:'one',label:'首个动作',icon:'copy'},{id:'blocked',label:'不能使用',disabled:true,reason:'任务执行中'},{id:'last',label:'最后动作',icon:'xmark',divider:true}])
const tabItems=ref([{id:'mute',label:'静音页面',icon:'tab-audio',shortcut:'Ctrl+M'},{id:'move',label:'移动到窗口',children:[{id:'target-2',label:'窗口二'},{id:'target-3',label:'窗口三',disabled:true}]},{id:'close',label:'关闭标签页',separatorBefore:true}])
const commands=computed(()=>({'edit.copy':{enabled:true},'view.sidebar':{enabled:true,checked:checked.value},'view.sidebarPinned':{enabled:false,reason:'此处不可固定'}}))
const config=createDefaultConfig(),requests:any[]=[],pending=new Map<string,(result:NativeMenuResult)=>void>();let chrome=0,nativeOpens=0,clipboard='',rejectNextMenu=false
window.addEventListener('navora:browser-chrome-open',()=>chrome++);window.addEventListener('navora:native-ui-open',()=>nativeOpens++)
const fixtureMode=new URL(location.href).searchParams.get('mode')||'native'
const notices:string[]=[]
window.addEventListener('navora:ui-notice',event=>notices.push((event as CustomEvent<{message:string}>).detail.message))
const api:NativeUiApi={capabilities:async()=>({menus:fixtureMode==='native',panels:false,pageInfo:false,distributionVersion:'fixture'}),popupMenu:input=>{if(rejectNextMenu){rejectNextMenu=false;throw Error('controlled native menu failure')}requests.push(structuredClone(input));return new Promise(resolve=>pending.set(input.requestId,resolve))},closeMenu:async id=>{const resolve=pending.get(id);pending.delete(id);resolve?.({supported:true,reason:'closed'})},updateMenu:async()=>false,onMenuOpened:()=>()=>{},onMenuControl:()=>()=>{},showPanel:async()=>({supported:false,id:'',session:''}),updatePanel:async()=>false,hidePanel:async()=>{},destroyPanel:async()=>{},showPageInfo:async()=>false,onPanelEvent:()=>()=>{}}
window.navora={app:{platform:fixtureMode==='remote'?'web':'win32'},nativeUi:api,config:{get:async()=>config,onChanged:()=>()=>{}},browser:{workspace:{onApplicationMenu:()=>()=>{},command:async()=>({ok:true})}}} as unknown as NavoraApi
;(window as any).failNextNativeMenu=()=>{rejectNextMenu=true}
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{clipboard=text},readText:async()=>clipboard}})
;(window as any).menuFixture={get requests(){return requests},get actions(){return actions.value},get checked(){return checked.value},get chrome(){return chrome},get nativeOpens(){return nativeOpens},get openEvents(){return openEvents.value},get domEvents(){return domEvents.value},get clipboard(){return clipboard},get pending(){return [...pending.keys()]},choose(id?:string,requestId=[...pending.keys()].at(-1),reason?:'dismissed'|'superseded'|'closed'){const resolve=pending.get(requestId!);pending.delete(requestId!);resolve?.({supported:true,...(id?{selectedId:id}:{}),...(reason?{reason}:{})})},label(value:string){slotLabel.value=value},context(value:string){context.value=value},setItems(){actionItems.value=[...actionItems.value,{id:'added',label:'新增动作'}]},setClipboard(value:string){clipboard=value}}
;(window as any).menuFixture.setView=(left:number|null)=>reportBrowserViewport('fixture-view',left===null?null:{left,top:50,right:innerWidth,bottom:innerHeight,width:innerWidth-left,height:innerHeight-50})
;(window as any).menuFixture.notices=notices
</script>
<style>html,body,#app{margin:0;height:100%;font-family:'Segoe UI','Microsoft YaHei UI',sans-serif}main{padding:20px}section{display:flex;align-items:center;gap:16px;margin-top:20px}textarea{border:1px solid #bbb;padding:10px;width:320px;height:80px;display:block}#editable{padding:10px;border:1px solid #bbb;margin-top:10px}h1{font-size:18px}output{display:block;margin-top:24px}</style>
