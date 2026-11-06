<template><main><h1>对话批注检查</h1><div class="tools"><ConversationAnnotationsMenu :chat-id="chatId" :entries="entries" @action="(entry,action)=>actions.push({key:entry.key,action,chatId})"/><button type="button" class="chat-resource-button" aria-label="当前对话摘要">摘要</button></div><p>隔离界面，不连接网页或模型。</p></main></template>
<script setup lang="ts">
import {ref} from 'vue'
import ConversationAnnotationsMenu from '../../src/components/ConversationAnnotationsMenu.vue'
import {annotationChatEntries,type AnnotationChatEntry} from '../../shared/browser-annotation-chat'
import type {BrowserAnnotation,BrowserAnnotationTarget} from '../../shared/browser-workspace'
import {createDefaultConfig} from '../../shared/config'
import {useAppearance} from '../../src/composables/useAppearance'
import type {NavoraApi} from '../../electron/preload'
const config=createDefaultConfig(),listeners=new Set<(value:typeof config)=>void>()
window.navora={app:{platform:'web'},config:{get:async()=>config,onChanged:(callback:(value:typeof config)=>void)=>{listeners.add(callback);return()=>listeners.delete(callback)}}} as unknown as NavoraApi
useAppearance()
const chatId=ref('empty'),entries=ref<AnnotationChatEntry[]>([]),actions=ref<unknown[]>([])
function populate(){entries.value=annotationChatEntries([
  {id:'saved',createdAt:2,revision:1,comment:'点击这里可以直接下载 😀',taskState:'pending',selection:{title:'QQ Windows 版下载',url:'https://example.test/qq',text:'Windows 64位 版下载'}} as BrowserAnnotation,
  {id:'resolved',createdAt:1,revision:2,comment:'已经核对的说明',taskState:'resolved',selection:{title:'说明页面',url:'https://example.test/guide'}} as BrowserAnnotation,
],[{id:'target',createdAt:3,comment:'还没有保存的意见',selection:{title:'选中的页面'}} as BrowserAnnotationTarget])}
Object.assign(window,{annotationFixture:{actions,populate,switchChat(){chatId.value='other';entries.value=[]},dark(){config.app.appearance_mode='dark';listeners.forEach(listener=>listener(config))}}})
</script>
<style>body{margin:0;background:var(--navora-surface);color:var(--navora-ink);font:13px 'Segoe UI',sans-serif}main{padding:18px}h1{font-size:16px;margin:0}.tools{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:12px}.chat-resource-button{display:flex;align-items:center;gap:4px;min-height:30px;border-radius:7px;padding:5px;color:var(--navora-ink)}main>p{color:var(--navora-muted);margin-top:40px}</style>
