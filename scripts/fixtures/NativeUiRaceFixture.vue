<template><main><h1>原生界面并发回归</h1><input id="focus-target" value="草稿与焦点保持"/><output>{{status}}</output></main></template>
<script setup lang="ts">
import {ref} from 'vue'
import {useNativePanel,useNativeUi} from '../../src/composables/useNativeUi'
import {getUiIcon} from '../../shared/ui-icons'
import type {NativePanelContent,NativePanelEvent,NativePanelHandle,NativeUiApi} from '../../shared/native-ui'
import type {NavoraApi} from '../../electron/preload'

const status=ref('等待回归'),calls:Array<{kind:string;id?:string;session?:string;content?:NativePanelContent}>=[],states=new Map<string,{session:string;content:NativePanelContent;open:boolean}>(),events=new Set<(event:NativePanelEvent)=>void>()
type Gate={started:boolean;resolve:()=>void;promise:Promise<void>;path?:string}
const gate=():Gate=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {started:false,resolve,promise}}
const imageGates:Gate[]=[],originalDecode=Image.prototype.decode
let holdShow:Gate|undefined,sessionSequence=0
Image.prototype.decode=async function(){
 const svg=this.src.startsWith('data:image/svg+xml;base64,')?atob(this.src.slice('data:image/svg+xml;base64,'.length)):''
 const pending=imageGates.find(item=>item.path&&svg.includes(`d="${item.path}"`))
 if(pending){pending.started=true;await pending.promise}
 return originalDecode.call(this)
}
const api:NativeUiApi={
 capabilities:async()=>({menus:true,panels:true,pageInfo:false,distributionVersion:'controlled-source-regression'}),
 popupMenu:async input=>{calls.push({kind:'menu',id:input.requestId});return {supported:true,reason:'dismissed'}},closeMenu:async id=>{calls.push({kind:'close-menu',id})},
 showPanel:async input=>{const handle:NativePanelHandle={supported:true,id:input.id,session:'session-'+ ++sessionSequence};calls.push({kind:'show',id:input.id,session:handle.session,content:structuredClone(input.content)});states.set(input.id,{session:handle.session,content:structuredClone(input.content),open:true});const pending=holdShow;holdShow=undefined;if(pending){pending.started=true;await pending.promise}return handle},
 updatePanel:async(id,session,patch)=>{const row=states.get(id);if(!row||row.session!==session)return false;if(patch.content)row.content=structuredClone(patch.content);calls.push({kind:'update',id,session,...(patch.content?{content:structuredClone(patch.content)}:{})});return true},
 hidePanel:async(id,session)=>{const row=states.get(id);if(row?.session===session){row.open=false;calls.push({kind:'hide',id,session})}},destroyPanel:async(id,session)=>{if(states.get(id)?.session===session){states.delete(id);calls.push({kind:'destroy',id,session})}},showPageInfo:async()=>false,
 onPanelEvent:callback=>{events.add(callback);return()=>events.delete(callback)},
}
window.navora={app:{platform:'win32'},nativeUi:api} as unknown as NavoraApi
const panel=useNativePanel({key:'async-regression',contextKey:()=> 'stable-chat',onAction:()=>{}}),menu=useNativeUi(),anchor={x:30,y:50,width:160,height:30}
const content=(id:string,icon?:string):NativePanelContent=>({id:'root',type:'column',children:[{id,type:'button',text:id,...(icon?{icon}:{})}]})
function blockIcon(name:string){const pending=gate();pending.path=getUiIcon(name,16).paths[0]!.d;imageGates.push(pending);return pending}
async function until(check:()=>boolean,label:string){for(let n=0;n<100;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5))}throw Error('Gate not reached: '+label)}
function assert(value:unknown,label:string){if(!value)throw Error(label)}
;(window as any).nativeUiRace={get calls(){return calls},async run(){
 const checks:string[]=[]
 status.value='检查并发状态';await panel.ready();await panel.show(content('initial'),anchor,{focusMode:'none'});const first=states.get(panel.id)!,firstSession=first.session
 const updateStart=calls.length,oldGate=blockIcon('folder'),oldUpdate=panel.update(content('older-update','folder'));await until(()=>oldGate.started,'old update icon decode')
 const newestResult=await panel.update(content('newest-update'));assert(newestResult,'Newest update must reach the bridge');oldGate.resolve();const oldResult=await oldUpdate
 assert(oldResult===false,'Older delayed update must report cancellation');assert(states.get(panel.id)?.session===firstSession,'The test must compare updates in the same display session');assert(states.get(panel.id)?.content.children?.[0]?.id==='newest-update','Older decoded content must not overwrite the newest content');assert(!calls.slice(updateStart).some(call=>call.kind==='update'&&call.content?.children?.[0]?.id==='older-update'),'Obsolete update must never cross the bridge');checks.push('same-session-late-icon-decode-cannot-overwrite-the-newest-update')
 await panel.hide();const showGate=blockIcon('paperclip'),showStart=calls.length,showing=panel.show(content('initial-show-icons','paperclip'),anchor,{focusMode:'none'});await until(()=>showGate.started,'show icon decode');assert(await panel.update(content('latest-during-show-icons'))===false,'Update during initial decode must remain pending');showGate.resolve();assert(await showing,'Show must finish');assert(states.get(panel.id)?.content.children?.[0]?.id==='latest-during-show-icons','Latest content during show must replay after acquiring the display session');assert(calls.slice(showStart).some(call=>call.kind==='show'&&call.content?.children?.[0]?.id==='initial-show-icons')&&calls.slice(showStart).some(call=>call.kind==='update'&&call.content?.children?.[0]?.id==='latest-during-show-icons'),'Replay must follow a real show bridge roundtrip');checks.push('state-changing-during-show-icon-decode-replays-after-show')
 await panel.hide();const replyGate=gate();holdShow=replyGate;const replying=panel.show(content('initial-show-reply'),anchor,{focusMode:'none'});await until(()=>replyGate.started,'native show reply');await panel.update(content('latest-during-native-reply'));replyGate.resolve();assert(await replying,'Delayed native show must complete');assert(states.get(panel.id)?.content.children?.[0]?.id==='latest-during-native-reply','Newest state while native show RPC waits must replay');checks.push('state-changing-during-native-show-reply-replays-after-session-arrives')
 await panel.hide();const menuGate=blockIcon('puzzle-piece'),menuBefore=calls.filter(call=>call.kind==='menu').length,canceled=menu.popupMenu([{id:'old-menu',label:'旧菜单',icon:'puzzle-piece'}],anchor)
 await until(()=>menuGate.started,'menu icon decode');assert(await panel.show(content('replacement-panel'),anchor,{focusMode:'none'}),'Replacement panel must show');menuGate.resolve();const canceledResult=await canceled
 assert(canceledResult.supported&&canceledResult.reason==='closed','Canceled icon-decode menu must return an explicit closed reason');assert(calls.filter(call=>call.kind==='menu').length===menuBefore,'Canceled menu must never call popupMenu on the bridge');assert(panel.open.value&&states.get(panel.id)?.content.children?.[0]?.id==='replacement-panel','Canceling the old menu must not close or replace the new panel');checks.push('new-native-panel-cancels-icon-decoding-menu-with-explicit-closed-reason')
 await panel.destroy();Image.prototype.decode=originalDecode;status.value='全部通过';return {ok:true,checks,calls:calls.map(call=>({kind:call.kind,id:call.id,session:call.session,contentId:call.content?.children?.[0]?.id})),boundary:'Actual useNativeUi/useNativePanel source executes in Vue and Chromium with real PNG rasterization. Only icon decode and bridge reply timing are controlled; this does not claim OS panel rendering or physical input.'}
}}
</script>
<style>body{font-family:'Segoe UI',sans-serif;margin:24px}h1{font-size:18px}output{display:block;margin-top:16px}</style>
