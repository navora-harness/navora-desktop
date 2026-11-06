<template>
  <v-app class="navora-app"><main>
    <WorkspaceFilePickerDialog v-if="pane==='files'" v-model="opened" :active="active" :chat-id="chatId" @open="path=>events.push(['file',chatId,path])" @locate="id=>events.push(['locate',chatId,id])" @error="message=>errors.push(message)" />
    <KeepAlive v-if="keepSearch"><NativePanelDialog v-if="pane==='search'" v-model="opened" :active="active" :content="searchContent.content" :initial-content="initialSearch" :context-key="chatId" title="搜索对话" focus-mode="input" @action="searchAction" @error="message=>errors.push(message)"><p id="fallback-dialog">原有远程界面</p></NativePanelDialog></KeepAlive>
    <ComposerEditor v-if="pane==='rename'" v-model="document" :chat-id="chatId" />
    <ConversationFind v-if="pane==='find'" ref="find" :chat-id="chatId" :messages="messages" :root="null" :display-text="message=>message.content" :locate="async()=>{}" />
  </main></v-app>
</template>
<script setup lang="ts">
import {computed,nextTick,ref} from 'vue'
import type {NativePanelAction,NativeUiApi} from '../../shared/native-ui'
import type {NavoraApi} from '../../electron/preload'
import type {WorkspaceResource} from '../../shared/workspace-resources'
import type {ChatMessage} from '../../shared/types'
import {chatSearchPanel} from '../../shared/native-dialog-panels'
import {createComposerDocument} from '../../shared/composer-document'
import WorkspaceFilePickerDialog from '../../src/components/WorkspaceFilePickerDialog.vue'
import NativePanelDialog from '../../src/components/NativePanelDialog.vue'
import ComposerEditor from '../../src/components/ComposerEditor.vue'
import ConversationFind from '../../src/components/ConversationFind.vue'
const pane=ref('files'),opened=ref(false),chatId=ref('chat-a'),query=ref('draft'),events:any[]=[],errors:string[]=[],find=ref<InstanceType<typeof ConversationFind>>()
const active=ref(true),keepSearch=ref(true)
const entries:WorkspaceResource[]=Array.from({length:65},(_,index)=>({id:`resource-${index}`,ownerChatId:'chat-a',path:`docs/${index}.md`,name:`${index}.md`,kind:'document',size:1,mtimeMs:index,revision:`revision-${index}`,evidence:{messageId:`message-${index}`,turnId:`turn-${index}`,answerId:`answer-${index}`,operation:'file_write',createdAt:index}}))
const document=ref(createComposerDocument('chat-a'))
document.value.content=[{type:'paragraph',content:[{type:'contextInline',attrs:{block:{id:'reference-a',label:'原引用',mode:'reference',status:'ready',source:{kind:'file',identity:'requirements.md',path:'requirements.md',chatId:'chat-a'}}}}]}]
const messages:ChatMessage[]=[{id:'message',role:'user',content:'Test test',createdAt:1}]
const requests:any[]=[],updates:any[]=[],hides:any[]=[],destroys:any[]=[],resourceCalls:any[]=[],menuRequests:any[]=[],menuPending=new Map<string,(value:any)=>void>(),listeners=new Set<(event:any)=>void>()
let serial=0,failNext=false,holdNext=false,held:(()=>void)|undefined
const nativeUi={capabilities:async()=>({menus:true,panels:true,pageInfo:false,panelItems:true,panelTextarea:true,panelScrollbars:true,distributionVersion:'fixture-.7'}),showPanel:async input=>{const row={...JSON.parse(JSON.stringify(input)),session:`session-${++serial}`};requests.push(row);if(failNext){failNext=false;throw Error('fixture open failure')}if(holdNext){holdNext=false;await new Promise<void>(resolve=>{held=resolve})}return {supported:true,id:input.id,session:row.session}},updatePanel:async(id,session,patch)=>{updates.push({id,session,...JSON.parse(JSON.stringify(patch))});return true},hidePanel:async(id,session)=>{hides.push({id,session})},destroyPanel:async(id,session)=>{destroys.push({id,session})},onPanelEvent:callback=>{listeners.add(callback);return ()=>listeners.delete(callback)},popupMenu:input=>{menuRequests.push(structuredClone(input));return new Promise(resolve=>menuPending.set(input.requestId,resolve))},closeMenu:async id=>{const resolve=menuPending.get(id);menuPending.delete(id);resolve?.({supported:true,reason:'closed'})},updateMenu:async()=>false,onMenuControl:()=>()=>{},onMenuOpened:()=>()=>{},showPageInfo:async()=>false} as NativeUiApi
window.navora={app:{platform:'win32'},nativeUi,workspace:{resources:async(owner,force)=>{resourceCalls.push([owner,force]);return {ok:true,entries:owner==='chat-a'?entries:[],truncated:true,unavailable:1}},onChanged:()=>()=>{}},agent:{onEvent:()=>()=>{}}} as unknown as NavoraApi
const hits=computed(()=>[{id:'chat-a',title:'会话 A',snippet:query.value,relative:'刚刚'},{id:'chat-b',title:'会话 B',snippet:'',relative:'昨天'}])
const searchContent=computed(()=>chatSearchPanel(hits.value,query.value,chatId.value)),initialSearch=computed(()=>chatSearchPanel(hits.value,query.value,chatId.value,true).content)
function searchAction(action:NativePanelAction){events.push(['search-action',action]);if(action.id==='chat-search-query'&&typeof action.value==='string')query.value=action.value;else if(action.id==='chat-search-close')opened.value=false}
;(window as any).simpleDialogFixture={get requests(){return requests},get updates(){return updates},get hides(){return hides},get destroys(){return destroys},get resourceCalls(){return resourceCalls},get menuRequests(){return menuRequests},get menuPending(){return [...menuPending.keys()]},get events(){return events},get errors(){return errors},get opened(){return opened.value},get document(){return document.value},get findState(){return find.value?.snapshot()},async show(value:string){opened.value=false;active.value=true;keepSearch.value=true;if(value==="rename")chatId.value=document.value.chatId;pane.value=value;await nextTick();opened.value=true;if(value==='find'){await nextTick();find.value?.open()}},close(){opened.value=false},switchChat(value='chat-b'){chatId.value=value},deactivate(){pane.value="none"},unmount(){pane.value="none";keepSearch.value=false},setActive(value:boolean){active.value=value},query(value:string){query.value=value},fail(){failNext=true},hold(){holdNext=true},release(){held?.();held=undefined},action(action:NativePanelAction,index=requests.length-1){const row=requests[index];for(const callback of listeners)callback({id:row.id,session:row.session,kind:'action',action})},dismiss(index=requests.length-1){const row=requests[index];for(const callback of listeners)callback({id:row.id,session:row.session,kind:'dismissed',reason:'escape'})},chooseMenu(id:string){const request=menuRequests.at(-1),resolve=menuPending.get(request.requestId);menuPending.delete(request.requestId);resolve?.({supported:true,selectedId:id})}}
</script>
<style>html,body,#app{margin:0;height:100%;font-family:'Segoe UI',sans-serif}main{padding:24px}.composer-richtext{min-height:100px;border:1px solid #aaa;padding:15px}</style>
