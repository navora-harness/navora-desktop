<template><v-app class="navora-app"><main class="fixture-tab-sizing">
  <h1>标签宽度检查</h1>
  <section v-for="host in hosts" :key="host.id" :class="host.className" :data-host="host.id"><header class="sizing-header">
    <BrowserTabStrip :ref="value=>strips[host.id]=value as InstanceType<typeof BrowserTabStrip>" :count="tabs.length" :pinned-count="tabs.filter(tab=>tab.pinned).length" :active-key="selected[host.id]">
      <WorkspaceTabItem v-for="tab in tabs" :key="tab.key" :file-key="tab.key" :page-id="tab.kind==='browser'?tab.key:undefined" :kind="tab.kind" :label="tab.label" :selected="selected[host.id]===tab.key" :closable="tab.key!=='conversation'" :pinned="tab.pinned" :audible="tab.audible" :muted="tab.muted" :loading="tab.loading" @select="selected[host.id]=tab.key" @close="close(host.id,tab.key)"/>
    </BrowserTabStrip>
    <button class="ui-icon-button sizing-plus" aria-label="新建标签页">+</button>
    <BrowserTabList :available="!!strips[host.id]?.overflowing" :tabs="tabs.map(tab=>({id:tab.key,title:tab.label}))" :active-id="selected[host.id]" @select="selected[host.id]=$event"/>
    <div class="sizing-context-tools" :style="{width:`${toolbarWidth(host.id)}px`}" aria-label="当前标签页工具"><button v-for="index in Math.floor(toolbarWidth(host.id)/32)" :key="index" class="ui-icon-button">⋯</button></div>
    <button v-if="running&&selected[host.id]==='conversation'" class="ui-icon-button sizing-stop" aria-label="停止任务">■</button>
    <button class="ui-icon-button" aria-label="工作区">▣</button>
  </header></section>
</main></v-app></template>
<script setup lang="ts">
import {nextTick,reactive,ref} from 'vue'
import BrowserTabStrip from '../../src/components/BrowserTabStrip.vue'
import WorkspaceTabItem from '../../src/components/WorkspaceTabItem.vue'
import BrowserTabList from '../../src/components/BrowserTabList.vue'
type WorkspaceTabKind='conversation'|'file'|'browser'|'subchats'|'questionnaire'
const hosts=[{id:'workspace',className:'file-workspace'},{id:'browser',className:'browser-host-page'},{id:'file',className:'file-host-page'}]
const initial=()=>[{key:'conversation',kind:'conversation' as WorkspaceTabKind,label:'打开爱马仕官网随意看看'},{key:'browser',kind:'browser' as WorkspaceTabKind,label:'新标签页'},{key:'long',kind:'file' as WorkspaceTabKind,label:'02_bag_hermes_sabot_完整长标题_👩🏽‍💻_العربية.jpg'},{key:'pinned',kind:'browser' as WorkspaceTabKind,label:'固定标签',pinned:true},{key:'audio',kind:'browser' as WorkspaceTabKind,label:'播放声音',audible:true}]
type Tab=ReturnType<typeof initial>[number]&{loading?:boolean;muted?:boolean}
const tabs=ref<Tab[]>(initial()),selected=reactive<Record<string,string>>({workspace:'browser',browser:'browser',file:'browser'}),strips=reactive<Record<string,InstanceType<typeof BrowserTabStrip>|null>>({}),running=ref(false)
function toolbarWidth(host:string){if(host!=='workspace')return 32;return selected[host]==='browser'?64:selected[host]==='conversation'?128:192}
let addedSequence=5
function close(host:string,key:string){strips[host]?.freezeForClose();tabs.value=tabs.value.filter(tab=>tab.key!==key);if(selected[host]===key)selected[host]=tabs.value[0]?.key||''}
;(window as any).tabSizing={get selected(){return {...selected}},get tabs(){return tabs.value},select(host:string,key:string){selected[host]=key},set(key:string,patch:Partial<Tab>){Object.assign(tabs.value.find(tab=>tab.key===key)!,patch)},running(value:boolean){running.value=value},swap(){const [a,b]=tabs.value;tabs.value.splice(0,2,b!,a!)},single(){tabs.value=initial().filter(tab=>tab.key==='browser');for(const host of hosts)selected[host.id]='browser'},add(){tabs.value.push({key:'added-'+addedSequence++,kind:'file',label:'新增文档.md'})},many(){tabs.value.push(...Array.from({length:18},(_,index)=>({key:'more-'+index,kind:'file' as WorkspaceTabKind,label:`归档文档 ${index}.md`})))},close,async reset(){tabs.value=initial();for(const host of hosts)selected[host.id]='browser';running.value=false;for(const strip of Object.values(strips))strip?.releaseWidths();await nextTick()},release(){for(const strip of Object.values(strips))strip?.releaseWidths()}}
</script>
<style>
html,body,#app{margin:0;height:100%;font-family:'Segoe UI','Microsoft YaHei UI',sans-serif}body{overflow:hidden}.v-application__wrap{min-height:0!important}.fixture-tab-sizing{padding:20px;background:#f4f7f6;min-height:100%;color:#345148}.fixture-tab-sizing h1{font-size:16px;margin:0 0 20px}.fixture-tab-sizing>section{position:relative!important;inset:auto!important;width:100%!important;max-width:none;height:88px;margin-bottom:20px;border:1px solid #cfddd5;background:#fff}.sizing-header{display:flex;align-items:center;gap:4px;padding:0 12px;height:48px;box-sizing:border-box;background:#f7faf8}.sizing-header>.ui-icon-button{flex:0 0 32px;width:32px;height:32px}.sizing-context-tools{display:flex;align-items:center;flex:0 0 auto;gap:0;margin-left:auto}.sizing-context-tools>.ui-icon-button{width:32px;height:32px;flex:0 0 32px}.sizing-plus{margin-right:auto}.sizing-header button{font:inherit;border:0;background:transparent;color:inherit}.sizing-header .workspace-tab-item{height:36px}.fixture-tab-sizing>section::after{content:attr(data-host);font-size:12px;color:#70847a;padding:8px 12px;display:block}
</style>
