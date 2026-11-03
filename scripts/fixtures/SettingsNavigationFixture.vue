<template>
  <v-app class="navora-app"><header class="fixture-top"><ApplicationMenuBar :command-state="menuMode==='main'?{'help.about':true}:{}" :mode="menuMode" :context-key="'chat-a'" @command="command" @error="notice=$event"/><ActionMenu ref="navigationMenu" label="检查浏览器设置菜单" :items="[{id:'settings',label:'浏览器设置',icon:'gear'}]" @select="navigationSettings"/><button id="settingsGear" type="button" @click="toggle">{{ open?'返回来源':'设置' }}</button><button id="openBrowserSettings" type="button" @click="show('browser')">浏览器设置</button><span role="status">{{ notice }}</span></header>
  <section class="fixture-shell shell"><div class="fixture-surface content-surface"><aside class="sidebar"><div v-show="open" id="fixture-settings-nav"/></aside><main class="main">
    <section v-show="!open" class="fixture-origin"><h1>来源对话</h1><input id="sourceDraft" v-model="draft"><div id="sourceReading" class="fixture-reading"><p v-for="n in 50" :key="n">第 {{ n }} 段阅读位置</p></div></section>
    <SettingsPage class="settings-workspace" v-if="open" ref="settings" embedded navigation-target="#fixture-settings-nav" :initial-tab="section" return-label="返回来源对话" :focus-on-entry="true" @navigate="section=$event" @close="close" />
  </main></div></section></v-app>
</template>
<script setup lang="ts">
import {nextTick,ref} from 'vue'
import {useAppearance} from '../../src/composables/useAppearance'
import SettingsPage from '../../src/pages/SettingsPage.vue'
import ActionMenu from '../../src/components/ActionMenu.vue'
import ApplicationMenuBar from '../../src/components/ApplicationMenuBar.vue'
import {createDefaultConfig,type AppConfig} from '../../shared/config'
import {applySettingsCommit,type SettingsCommit} from '../../shared/settings-commit'
import type {AppMenuMode,AppCommandId} from '../../shared/app-commands'
import type {NavoraApi} from '../../electron/preload'
const navigationMenu=ref<InstanceType<typeof ActionMenu>>()
async function navigationSettings(){await navigationMenu.value?.hideAndWait();await show('browser')}
const open=ref(false),section=ref('basic'),settings=ref<InstanceType<typeof SettingsPage>|null>(null),draft=ref('保留来源草稿'),notice=ref(''),menuMode=ref<AppMenuMode>('main')
let saved=createDefaultConfig(),mode='success',release:(()=>void)|undefined,commits=0,closed=0,confirmCount=0,confirmAnswer=true,bridgeResult=true
const bridgeCalls:string[]=[],writes:SettingsCommit[]=[],listeners=new Set<(config:AppConfig)=>void>()
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value))
window.confirm=()=>{confirmCount++;return confirmAnswer}
window.navora={app:{platform:'win32',nativeTitleBar:false,info:async()=>({version:'fixture-current',electron:'fixture',chrome:'fixture',dataRoot:'isolated-fixture',portable:false}),openSettings:async(value:string)=>{bridgeCalls.push(value);return bridgeResult?{ok:true}:{ok:false,error:'主窗口暂不可用，请重试。'}}},config:{get:async()=>clone(saved),commit:async(request:SettingsCommit)=>{commits++;writes.push(clone(request));if(mode==='hold')await new Promise<void>(done=>release=done);if(mode==='fail')throw Error('示例保存失败');saved=applySettingsCommit(saved,request);for(const listener of listeners)listener(clone(saved));return clone(saved)},onChanged:(callback:(config:AppConfig)=>void)=>{listeners.add(callback);return()=>listeners.delete(callback)},uaPresets:async()=>[]},secrets:{hasApiKey:async()=>false,previewApiKey:async()=>'',setApiKey:async()=>({ok:true})},remote:{status:async()=>({enabled:false,running:false})},skills:{list:async()=>[],listProposals:async()=>[],onProposalsChanged:()=>()=>{}},browser:{workspace:{onApplicationMenu:()=>()=>{},state:async()=>({pages:[]})}},plugins:{list:async()=>[]}} as unknown as NavoraApi
useAppearance()
async function show(value?:string){if(value)section.value=value;open.value=true;await nextTick()}
async function toggle(){if(!open.value)await show();else if(await settings.value?.canClose())close()}
function close(){open.value=false;closed++;void nextTick(()=>window.document.querySelector<HTMLInputElement>('#sourceDraft')?.focus({preventScroll:true}))}
function command(id:AppCommandId){if(id==='help.about')void show('about')}
;(window as any).settingsFixture={get open(){return open.value},get section(){return section.value},get saved(){return clone(saved)},get commits(){return commits},get closed(){return closed},get confirms(){return confirmCount},get listeners(){return listeners.size},get bridgeCalls(){return [...bridgeCalls]},get writes(){return clone(writes)},setMode(value:string){mode=value},release(){release?.();release=undefined},confirm(value:boolean){confirmAnswer=value},menu(value:AppMenuMode){menuMode.value=value},bridge(value:boolean){bridgeResult=value},get draft(){return draft.value}}
</script>
<style>
:root{--navora-ink:#293d52;--navora-muted:#788a9c;--navora-stroke:#d7e2ed;--navora-accent:#47779d;--navora-surface:#fff;--navora-hover:#edf3f8;--control-selected:#e3eef7;--control-hover:#edf3f8;--control-danger:#b34b50;--appearance-stroke:#d7e2ed;--appearance-ink:#293d52;--appearance-muted:#788a9c;--appearance-accent:#47779d;--appearance-surface:#fff;--appearance-well:#f4f7fa;--appearance-selection:#e3eef7;--appearance-composer-edge:#99b1c5}html,body,#app{height:100%;margin:0;overflow:hidden;font-family:'Segoe UI','Microsoft YaHei UI',sans-serif}button,input{font:inherit}.fixture-top{height:44px;display:flex;align-items:center;gap:14px;padding:0 12px;border-bottom:1px solid var(--navora-stroke);flex-shrink:0}.fixture-top>button{padding:5px 9px;border:1px solid var(--navora-stroke);border-radius:5px;background:var(--appearance-well,#fff);color:var(--appearance-ink)}.fixture-top>span{font-size:12px}.navora-app .fixture-shell{display:flex;flex:1;min-height:0;width:100%;max-width:none;padding:0;margin:0;gap:0;overflow:hidden}.fixture-surface{display:flex;flex:1;min-width:0;min-height:0}.fixture-surface>aside{display:flex;flex-direction:column;min-height:0;overflow:hidden;padding:8px}#fixture-settings-nav{display:flex;flex:1;min-height:0}.fixture-surface>aside{width:240px;flex-shrink:0;background:#f2f6fa}.fixture-surface>main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}.fixture-origin{padding:30px}.fixture-origin h1{font-size:20px}.fixture-reading{height:300px;overflow:auto;border:1px solid #c8d7e5;margin-top:20px;padding:12px}.fixture-reading p{margin:14px 0}.fixture-origin input{padding:8px;border:1px solid #bdcede}.settings-page{flex:1;min-height:0}.v-application__wrap{height:100%;min-height:0!important}@media(max-width:600px){.fixture-shell>aside{width:145px}.fixture-top{gap:5px;padding:0 5px}.fixture-top>span{display:none}}
</style>
