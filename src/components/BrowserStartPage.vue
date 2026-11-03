<template>
  <div class="browser-start-page" aria-label="新标签页首页">
    <div class="start-content">
      <header class="start-heading"><span class="start-mark"><AppIcon icon="browser" /></span><h1>新标签页</h1><p>在上方输入网址或搜索</p></header>
      <section aria-label="推荐访问" class="start-section">
        <h2>推荐访问</h2>
        <div class="start-recommendations"><button v-for="site in browserRecommendations" :key="site.url" type="button" :title="site.url" @click="$emit('navigate',site.url)"><AppIcon :icon="site.icon" /><span>{{ site.title }}</span><AppIcon icon="arrow-up-right-from-square" class="start-open-icon" /></button></div>
      </section>
      <section v-show="hasFiles" aria-label="对话文件" class="start-section start-files-section">
        <h2>对话文件</h2>
        <WorkspaceFilePicker :chat-id="chatId" :page-size="6" :show-locate="false" @availability="hasFiles=$event" @open="emit('openFile',$event)" />
      </section>
      <section aria-label="最近访问" class="start-section">
        <div class="start-section-title"><h2>最近访问</h2><button v-if="state.history.length" type="button" class="start-text-button" :disabled="busy" title="清空当前对话的访问历史" @click="clear()">清空</button></div>
        <p v-if="!state.history.length" class="start-history-empty"><AppIcon icon="clock" />访问过的网页会显示在这里</p>
        <ul v-else class="start-history"><li v-for="visit in state.history.slice(0,historyLimit)" :key="visit.url"><button type="button" class="start-visit" :title="visit.url" @click="$emit('navigate',visit.url)"><AppIcon icon="clock" /><span><strong>{{ visit.title || browserSiteLabel(visit.url) }}</strong><small>{{ browserSiteLabel(visit.url) }}</small></span><time>{{ dateLabel(visit.visitedAt) }}</time></button><button type="button" class="ui-icon-button start-remove-visit" :disabled="busy" :aria-label="`移除访问记录 ${visit.title}`" title="移除此条记录" @click="clear(visit.url)"><AppIcon icon="xmark" /></button></li></ul>
        <p v-if="error" class="start-error" role="alert">{{ error }}</p>
        <button v-if="state.history.length>historyLimit" type="button" class="start-text-button start-more" @click="historyLimit+=6">显示更多</button>
      </section>
    </div>
  </div>
</template>
<script setup lang="ts">
import {ref,watch} from 'vue'
import AppIcon from './icons/AppIcon.vue'
import WorkspaceFilePicker from './WorkspaceFilePicker.vue'
import {browserRecommendations,browserSiteLabel,type BrowserStartState} from '@shared/browser-start'
const props=defineProps<{state:BrowserStartState;chatId:string}>()
const emit=defineEmits<{navigate:[url:string];openFile:[path:string];changed:[]}>()
const api=window.navora!.browser.workspace,busy=ref(false),error=ref(''),historyLimit=ref(6)
const hasFiles=ref(false)
async function clear(url?:string){
  if(busy.value)return
  const chatId=props.chatId
  busy.value=true;error.value=''
  try{await api.clearBrowserHistory(chatId,url);if(props.chatId===chatId)emit('changed')}
  catch{if(props.chatId===chatId)error.value='访问记录未清除，请重试。'}
  finally{busy.value=false}
}
watch(()=>props.chatId,()=>{error.value='';historyLimit.value=6})
function dateLabel(time:number){const date=new Date(time);return date.toDateString()===new Date().toDateString()?date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):date.toLocaleDateString([],{month:'short',day:'numeric'})}
</script>
<style scoped>
.browser-start-page{box-sizing:border-box;width:100%;min-width:0;padding:clamp(24px,3cqw,36px) clamp(14px,4cqw,32px);color:var(--navora-ink);background:var(--navora-surface);-webkit-user-select:none;user-select:none}
.start-content{width:100%;max-width:760px;min-width:0;margin:0 auto}.start-heading{display:grid;grid-template-columns:48px minmax(0,1fr);grid-template-rows:auto auto;align-items:center;column-gap:14px;margin-bottom:24px}.start-mark{grid-column:1;grid-row:1 / 3;display:grid;place-items:center;width:48px;height:48px;border:1px solid #dfe7f0;border-radius:15px;color:var(--navora-accent);background:linear-gradient(145deg,#f8fbff,#eef4fb);margin:0}.start-mark svg{width:22px;height:22px}.start-heading h1{grid-column:2;grid-row:1;font-size:23px;font-weight:650;letter-spacing:-.45px;line-height:1.25;margin:0}.start-heading p{grid-column:2;grid-row:2;font-size:13px;color:var(--navora-muted);margin:4px 0 0;line-height:1.45}
.start-section+.start-section{margin-top:22px}h2{font-size:12px;font-weight:600;margin:0 0 10px;color:var(--navora-muted)}.start-section-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}.start-section-title h2{margin:0}
.start-recommendations{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:8px;min-width:0}.start-recommendations button{display:flex;align-items:center;gap:10px;min-width:0;padding:10px;border:1px solid var(--navora-stroke);border-radius:10px;font-size:12px;text-align:left;overflow:hidden}.start-recommendations button>svg{width:16px;height:16px;flex:0 0 16px;color:var(--navora-muted)}.start-recommendations button>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.start-recommendations .start-open-icon{width:12px;height:12px;margin-left:auto;opacity:.45}
.start-text-button{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--navora-muted);border-radius:5px;padding:3px 0}.start-text-button svg{width:13px;height:13px}.start-text-button:hover{color:var(--navora-accent)}.start-text-button:disabled{opacity:.45;cursor:default}
.start-files-section :deep(.workspace-file-picker){padding:10px;border:1px solid var(--navora-stroke);border-radius:10px;background:#fafbfd;color:var(--navora-ink)}
.start-files-section :deep(.workspace-picker-search){background:var(--navora-surface)}
.start-error{margin-top:8px;color:var(--control-danger);font-size:11px}
.start-history-empty{display:flex;align-items:center;gap:8px;color:var(--navora-muted);font-size:12px;margin:0;padding:12px 0}.start-history-empty svg{width:15px;height:15px}.start-history{padding:0;margin:0;list-style:none}.start-history li{display:flex;align-items:center;gap:4px;border-radius:8px}.start-visit{display:flex;align-items:center;gap:12px;min-width:0;flex:1;padding:10px 4px;text-align:left}.start-visit>svg{width:15px;height:15px;color:var(--navora-muted)}.start-visit>span{flex:1;min-width:0;display:grid;gap:3px}.start-visit strong,.start-visit small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.start-visit strong{font-weight:400;font-size:12px}.start-visit small,time{font-size:10px;color:var(--navora-muted)}time{white-space:nowrap}.start-remove-visit{opacity:0}.start-history li:is(:hover,:focus-within) .start-remove-visit{opacity:1}.start-more{margin-top:8px}
.start-recommendations button:hover,.start-history li:hover{background:var(--control-hover)}button:focus-visible{outline:2px solid var(--control-focus);outline-offset:2px}
.browser-start-page button{cursor:default}
@container(max-width:460px){.start-heading{grid-template-columns:42px minmax(0,1fr);column-gap:11px;margin-bottom:20px}.start-mark{width:42px;height:42px;border-radius:13px}.start-heading h1{font-size:21px}.start-recommendations{grid-template-columns:minmax(0,1fr)}.start-recommendations button{padding:9px 10px;gap:8px}.start-recommendations .start-open-icon{display:none}.start-section+.start-section{margin-top:18px}}
@media(hover:none){.start-remove-visit{opacity:1}}
</style>
