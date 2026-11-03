<template>
  <div class="browser-start-page" aria-label="新标签页首页">
    <div class="start-content">
      <header class="start-heading"><span class="start-mark"><AppIcon icon="browser" /></span><h1>新标签页</h1><p>在上方输入网址或搜索</p></header>
      <section aria-label="推荐访问" class="start-section">
        <h2>推荐访问</h2>
        <div class="start-recommendations"><button v-for="site in browserRecommendations" :key="site.url" type="button" :title="site.url" @click="$emit('navigate',site.url)"><AppIcon :icon="site.icon" /><span>{{ site.title }}</span><AppIcon icon="arrow-up-right-from-square" class="start-open-icon" /></button></div>
      </section>
      <section aria-label="快捷访问" class="start-section">
        <div class="start-section-title"><h2>快捷访问</h2><button type="button" class="start-text-button" :disabled="busy || state.links.length>=12" @click="edit()"><AppIcon icon="plus" />添加网址</button></div>
        <form v-if="editing" class="start-link-editor" @submit.prevent="save" @keydown.esc.stop.prevent="editing=false">
          <input ref="urlInput" v-model="url" aria-label="快捷访问网址" placeholder="网址，如 example.com" required maxlength="8192" autocomplete="url" autofocus />
          <input v-model="title" aria-label="快捷访问名称" placeholder="名称（选填）" maxlength="80" />
          <div><span v-if="error" role="alert">{{ error }}</span><button type="button" class="ui-button" :disabled="busy" @click="editing=false">取消</button><button type="submit" class="ui-button primary" :disabled="busy || !url.trim()">{{ busy?'保存中…':'保存' }}</button></div>
        </form>
        <div v-if="state.links.length" class="start-shortcuts">
          <div v-for="link in state.links" :key="link.id" class="start-shortcut">
            <button type="button" class="start-shortcut-open" :title="link.url" @click="$emit('navigate',link.url)"><span class="start-site-icon"><AppIcon icon="globe" /></span><span>{{ link.title }}</span><small>{{ browserSiteLabel(link.url) }}</small></button>
            <ActionMenu :label="`管理 ${link.title}`" :disabled="busy" :items="[{id:'edit',label:'编辑网址',icon:'pen-to-square'},{id:'remove',label:'移除快捷访问',icon:'trash',danger:true}]" @select="$event==='edit'?edit(link):remove(link.id)" />
          </div>
        </div>
        <button v-else-if="!editing" type="button" class="start-add-empty" @click="edit()"><span class="start-add-empty-icon"><AppIcon icon="plus" /></span><span class="start-add-empty-copy"><strong>添加常用网站</strong><small>保存后可在新标签页快速打开</small></span><AppIcon icon="chevron-right" class="start-add-empty-arrow" /></button>
        <p v-if="error && !editing" class="start-error" role="alert">{{ error }}</p>
      </section>
      <section aria-label="最近访问" class="start-section">
        <div class="start-section-title"><h2>最近访问</h2><button v-if="state.history.length" type="button" class="start-text-button" :disabled="busy" title="清空当前对话的访问历史，保留快捷访问" @click="clear()">清空</button></div>
        <p v-if="!state.history.length" class="start-history-empty"><AppIcon icon="clock" />访问过的网页会显示在这里</p>
        <ul v-else class="start-history"><li v-for="visit in state.history.slice(0,historyLimit)" :key="visit.url"><button type="button" class="start-visit" :title="visit.url" @click="$emit('navigate',visit.url)"><AppIcon icon="clock" /><span><strong>{{ visit.title || browserSiteLabel(visit.url) }}</strong><small>{{ browserSiteLabel(visit.url) }}</small></span><time>{{ dateLabel(visit.visitedAt) }}</time></button><button type="button" class="ui-icon-button start-remove-visit" :disabled="busy" :aria-label="`移除访问记录 ${visit.title}`" title="移除此条记录" @click="clear(visit.url)"><AppIcon icon="xmark" /></button></li></ul>
        <button v-if="state.history.length>historyLimit" type="button" class="start-text-button start-more" @click="historyLimit+=6">显示更多</button>
      </section>
    </div>
  </div>
</template>
<script setup lang="ts">
import {nextTick,ref} from 'vue'
import AppIcon from './icons/AppIcon.vue'
import ActionMenu from './ActionMenu.vue'
import {browserRecommendations,browserSiteLabel,type BrowserQuickLink,type BrowserStartState} from '@shared/browser-start'
const props=defineProps<{state:BrowserStartState;chatId:string}>()
const emit=defineEmits<{navigate:[url:string];changed:[]}>()
const api=window.navora!.browser.workspace,editing=ref(false),editingId=ref(''),title=ref(''),url=ref(''),busy=ref(false),error=ref(''),historyLimit=ref(6),urlInput=ref<HTMLInputElement>()
async function edit(link?:BrowserQuickLink){editingId.value=link?.id||'';title.value=link?.title||'';url.value=link?.url||'';error.value='';editing.value=true;await nextTick();urlInput.value?.focus()}
function friendly(error:unknown){const text=String(error);return text.includes('quick_link_limit')?'最多添加 12 个快捷访问。':text.includes('quick_link_exists')?'这个网址已在快捷访问中。':text.includes('invalid')?'请输入有效的 http 或 https 网址。':'操作未完成，请重试。'}
async function action(run:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';try{await run();emit('changed')}catch(e){error.value=friendly(e)}finally{busy.value=false}}
async function save(){await action(async()=>{await api.saveQuickLink(props.chatId,{id:editingId.value||undefined,title:title.value,url:url.value});editing.value=false})}
async function remove(id:string){await action(()=>api.removeQuickLink(props.chatId,id))}
async function clear(url?:string){await action(()=>api.clearBrowserHistory(props.chatId,url))}
function dateLabel(time:number){const date=new Date(time);return date.toDateString()===new Date().toDateString()?date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):date.toLocaleDateString([],{month:'short',day:'numeric'})}
</script>
<style scoped>
.browser-start-page{box-sizing:border-box;width:100%;min-width:0;padding:clamp(24px,3cqw,36px) clamp(14px,4cqw,32px);color:var(--navora-ink);background:var(--navora-surface);-webkit-user-select:none;user-select:none}
.start-content{width:100%;max-width:760px;min-width:0;margin:0 auto}.start-heading{display:grid;grid-template-columns:48px minmax(0,1fr);grid-template-rows:auto auto;align-items:center;column-gap:14px;margin-bottom:24px}.start-mark{grid-column:1;grid-row:1 / 3;display:grid;place-items:center;width:48px;height:48px;border:1px solid #dfe7f0;border-radius:15px;color:var(--navora-accent);background:linear-gradient(145deg,#f8fbff,#eef4fb);margin:0}.start-mark svg{width:22px;height:22px}.start-heading h1{grid-column:2;grid-row:1;font-size:23px;font-weight:650;letter-spacing:-.45px;line-height:1.25;margin:0}.start-heading p{grid-column:2;grid-row:2;font-size:13px;color:var(--navora-muted);margin:4px 0 0;line-height:1.45}
.start-section+.start-section{margin-top:22px}h2{font-size:12px;font-weight:600;margin:0 0 10px;color:var(--navora-muted)}.start-section-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}.start-section-title h2{margin:0}
.start-recommendations{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:8px;min-width:0}.start-recommendations button{display:flex;align-items:center;gap:10px;min-width:0;padding:10px;border:1px solid var(--navora-stroke);border-radius:10px;font-size:12px;text-align:left;overflow:hidden}.start-recommendations button>svg{width:16px;height:16px;flex:0 0 16px;color:var(--navora-muted)}.start-recommendations button>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.start-recommendations .start-open-icon{width:12px;height:12px;margin-left:auto;opacity:.45}
.start-text-button{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--navora-muted);border-radius:5px;padding:3px 0}.start-text-button svg{width:13px;height:13px}.start-text-button:hover{color:var(--navora-accent)}.start-text-button:disabled{opacity:.45;cursor:default}
.start-shortcuts{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}.start-shortcut{position:relative;min-width:0;border:1px solid var(--navora-stroke);border-radius:10px}.start-shortcut-open{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:14px 12px;width:100%;min-width:0;text-align:left;font-size:12px;border-radius:10px}.start-shortcut-open>span:not(.start-site-icon),.start-shortcut-open small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.start-shortcut-open small{font-size:10px;color:var(--navora-muted)}.start-site-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--control-selected);color:var(--navora-accent)}.start-site-icon svg{width:15px;height:15px}.start-shortcut>:deep(.ui-icon-button){position:absolute;top:4px;right:4px;width:26px;height:26px;min-height:26px;opacity:0}.start-shortcut:is(:hover,:focus-within)>:deep(.ui-icon-button){opacity:1}
.start-add-empty{display:flex;align-items:center;gap:10px;min-height:54px;width:100%;padding:8px 11px;border:1px solid var(--navora-stroke);border-radius:10px;background:#fafbfd;color:var(--navora-ink);text-align:left}.start-add-empty:hover{border-color:#cbd7e4}.start-add-empty-icon{display:grid;place-items:center;width:30px;height:30px;flex:0 0 30px;border-radius:8px;background:var(--control-selected);color:var(--navora-accent)}.start-add-empty-icon svg{width:14px;height:14px}.start-add-empty-copy{display:grid;gap:2px;min-width:0}.start-add-empty-copy strong{font-size:12px;font-weight:550}.start-add-empty-copy small{font-size:10px;color:var(--navora-muted)}.start-add-empty-arrow{width:13px;height:13px;margin-left:auto;color:var(--navora-muted)}
.start-link-editor{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;border:1px solid var(--navora-stroke);border-radius:10px;padding:12px;margin-bottom:12px}.start-link-editor input{min-width:0;width:100%;padding:8px 10px;border:1px solid var(--navora-stroke);border-radius:6px;font-size:12px;color:var(--navora-ink);background:var(--navora-surface);-webkit-user-select:text;user-select:text}.start-link-editor>div{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}.start-link-editor>div>span,.start-error{color:var(--control-danger);font-size:11px;flex:1}
.start-history-empty{display:flex;align-items:center;gap:8px;color:var(--navora-muted);font-size:12px;margin:0;padding:12px 0}.start-history-empty svg{width:15px;height:15px}.start-history{padding:0;margin:0;list-style:none}.start-history li{display:flex;align-items:center;gap:4px;border-radius:8px}.start-visit{display:flex;align-items:center;gap:12px;min-width:0;flex:1;padding:10px 4px;text-align:left}.start-visit>svg{width:15px;height:15px;color:var(--navora-muted)}.start-visit>span{flex:1;min-width:0;display:grid;gap:3px}.start-visit strong,.start-visit small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.start-visit strong{font-weight:400;font-size:12px}.start-visit small,time{font-size:10px;color:var(--navora-muted)}time{white-space:nowrap}.start-remove-visit{opacity:0}.start-history li:is(:hover,:focus-within) .start-remove-visit{opacity:1}.start-more{margin-top:8px}
.start-recommendations button:hover,.start-shortcut-open:hover,.start-add-empty:hover,.start-history li:hover{background:var(--control-hover)}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--control-focus);outline-offset:2px}
.browser-start-page button{cursor:default}
@container(max-width:460px){.start-heading{grid-template-columns:42px minmax(0,1fr);column-gap:11px;margin-bottom:20px}.start-mark{width:42px;height:42px;border-radius:13px}.start-heading h1{font-size:21px}.start-shortcuts{grid-template-columns:repeat(2,minmax(0,1fr))}.start-recommendations{grid-template-columns:minmax(0,1fr)}.start-recommendations button{padding:9px 10px;gap:8px}.start-recommendations .start-open-icon{display:none}.start-section+.start-section{margin-top:18px}}
@media(hover:none){.start-shortcut>:deep(.ui-icon-button),.start-remove-visit{opacity:1}}
</style>
