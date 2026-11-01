<template>
  <section class="browser-tab-panel" aria-label="浏览器标签页">
    <form class="browser-tab-toolbar" @submit.prevent="navigate">
      <button type="button" aria-label="浏览器后退" :disabled="!canBack" @click="guest?.goBack()"><font-awesome-icon icon="arrow-left" /></button>
      <button type="button" aria-label="刷新浏览器标签页" :disabled="!ready" @click="guest?.reload()"><font-awesome-icon icon="arrow-rotate-right" /></button>
      <input v-model="address" aria-label="浏览器地址" placeholder="输入网址，按回车打开" spellcheck="false" autocomplete="off" @focus="editing=true" @blur="editing=false" />
      <button type="submit" aria-label="打开网址"><font-awesome-icon icon="arrow-right" /></button>
    </form>
    <div v-if="error" class="browser-tab-notice" role="alert">{{ error }}</div>
    <div v-if="blank" class="browser-tab-welcome"><font-awesome-icon icon="globe" /><h2>新标签页</h2><p>输入网址，在侧栏中浏览网页</p></div>
    <webview v-if="desktop" ref="guest" :src="initialUrl" :partition="`navora-panel-${chatId}`" webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes" :class="{blank}" @did-start-loading="error=''" @dom-ready="onReady" @did-navigate="onNavigate" @did-navigate-in-page="onNavigate" @page-title-updated="onNavigate" @did-fail-load="onFailure" />
    <div v-else class="browser-tab-notice">浏览器标签页可在桌面端使用。</div>
  </section>
</template>
<script setup lang="ts">
import {ref} from 'vue'
import type {WebviewTag} from 'electron'
const props=defineProps<{chatId:string;url?:string}>()
const emit=defineEmits<{changed:[title:string,url:string]}>()
const initialUrl=props.url&&/^https?:\/\//i.test(props.url)?props.url:'about:blank'
const address=ref(initialUrl==='about:blank'?'':initialUrl),guest=ref<WebviewTag|null>(null)
const ready=ref(false),canBack=ref(false),blank=ref(initialUrl==='about:blank'),error=ref(''),editing=ref(false)
const desktop=window.navora?.app.platform!=='web'
function onReady(){ready.value=true;onNavigate()}
function onNavigate(){if(!ready.value||!guest.value)return;const url=guest.value.getURL();blank.value=url==='about:blank';if(!editing.value)address.value=blank.value?'':url;canBack.value=guest.value.canGoBack();emit('changed',blank.value?'新标签页':guest.value.getTitle()||url,url)}
async function navigate(){
  try{const url=new URL(/^[a-z][a-z\d+.-]*:/i.test(address.value.trim())?address.value.trim():`https://${address.value.trim()}`);if(!['http:','https:'].includes(url.protocol))throw Error();error.value='';await guest.value?.loadURL(url.href)}catch{error.value='无法打开此网址，请检查地址或网络。'}
}
function onFailure(event:Event){const failure=event as Event&{errorCode:number;isMainFrame:boolean};if(failure.isMainFrame&&failure.errorCode!==-3)error.value='页面加载失败，可检查网址后重新加载。'}
</script>
<style scoped>
.browser-tab-panel{position:relative;display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:#fff}.browser-tab-toolbar{display:flex;align-items:center;gap:5px;padding:7px 8px;border-bottom:1px solid #dce3ed;background:#f8f9fb}.browser-tab-toolbar button{display:grid;place-items:center;width:27px;height:29px;flex-shrink:0;color:#64758c;border:1px solid transparent;border-radius:6px}.browser-tab-toolbar button:hover:not(:disabled){background:#e7edf5}.browser-tab-toolbar button:disabled{opacity:.35}.browser-tab-toolbar svg{width:12px;height:12px}.browser-tab-toolbar input{flex:1;min-width:0;padding:6px 9px;border:1px solid #d3dce9;border-radius:7px;background:#fff;color:#4a5d76;font-size:12px}.browser-tab-toolbar input:focus{outline:2px solid #7898be;outline-offset:-1px}.browser-tab-panel webview{flex:1;min-height:0;display:flex;background:#fff}.browser-tab-panel webview.blank{opacity:0;pointer-events:none}.browser-tab-welcome{position:absolute;inset:90px 12px auto;text-align:center;color:#8a97a9;pointer-events:none}.browser-tab-welcome>svg{width:28px;height:28px;margin-bottom:12px}.browser-tab-welcome h2{font-size:17px;font-weight:550;color:#4a607b}.browser-tab-welcome p{font-size:12px;margin-top:8px}.browser-tab-notice{padding:12px 16px;color:#9a6842;font-size:12px;background:#fff8ee}
</style>
