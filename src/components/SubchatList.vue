<template>
  <section class="subchat-list">
    <header class="subchat-list-header"><div><h2>子对话 <span>{{items.length}}</span></h2><p>查看委派任务的进展与结果</p></div><slot name="tools"/></header>
    <div class="subchat-list-filters"><label><AppIcon icon="magnifying-glass"/><input ref="searchInput" v-model="view.query" type="search" placeholder="搜索名称或任务说明" aria-label="搜索子对话"/></label><select v-model="view.filter" aria-label="筛选子对话状态"><option value="all">全部状态</option><option value="attention">需要处理</option><option value="running">进行中</option><option value="done">已完成</option><option value="unfinished">未完成</option></select></div>
    <p v-if="error" class="subchat-state" role="alert">{{error}} <button type="button" @click="emit('refresh')">重试</button></p>
    <p v-else-if="loading&&!items.length" class="subchat-state" role="status">正在读取子对话…</p>
    <p v-else-if="!items.length" class="subchat-state">还没有子对话。聊天中的 Agent 委派任务后，会在这里显示。</p>
    <p v-else-if="!filtered.length" class="subchat-state">没有匹配的子对话。<button type="button" @click="view.query='';view.filter='all'">清除筛选</button></p>
    <div ref="scroller" class="subchat-list-scroll" @scroll="saveScroll" @keydown="rowKey">
      <section v-for="group in groups" :key="group.id" class="subchat-group"><h3>{{group.label}} <span>{{group.items.length}}</span></h3><button v-for="item in group.items" :key="item.id" type="button" class="subchat-list-row" :data-subchat-id="item.id" @click="emit('select',item.id)"><img :src="subchatGlyphUrl(item.id)" alt=""/><span class="subchat-list-copy"><span class="subchat-list-name" :title="item.title"><i v-if="item.unread" class="subchat-unread" title="有未读进展" aria-label="有未读进展"/>{{item.title}}</span><span class="subchat-list-summary" :title="item.purpose">{{item.summary||item.purpose||'暂无进展记录'}}</span></span><span class="subchat-list-meta"><span :class="['subchat-status',item.status]">{{item.pendingCount?`需要处理 · ${item.pendingCount}`:subchatStatusLabels[item.status]}}</span><time>{{subchatTime(item,now)}}</time><span v-if="item.resourceCount">{{item.resourcesTruncated?'至少 ' : ''}}{{item.resourceCount}} 项资源</span></span></button></section>
    </div>
  </section>
</template>
<script lang="ts">
const subchatListViews=new Map<string,{query:string;filter:string;scrollTop:number}>()
</script>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,reactive,ref,watch} from 'vue'
import type {SubchatIndexItem} from '@shared/types'
import {subchatGlyphUrl,subchatGroup,subchatStatusLabels,subchatTime} from '@shared/subchat-presentation'
import AppIcon from './icons/AppIcon.vue'
const props=defineProps<{parentChatId:string;items:SubchatIndexItem[];loading:boolean;error?:string}>()
const emit=defineEmits<{select:[id:string];refresh:[]}>()
type View={query:string;filter:string;scrollTop:number}
const views=subchatListViews,view=reactive<View>({query:'',filter:'all',scrollTop:0}),searchInput=ref<HTMLInputElement>(),scroller=ref<HTMLElement>(),now=ref(Date.now())
let timer:ReturnType<typeof setInterval>|undefined
function saveView(id=props.parentChatId){views.set(id,{...view})}
function saveScroll(){view.scrollTop=scroller.value?.scrollTop||0;saveView()}
watch(()=>props.parentChatId,(id,old)=>{if(old)saveView(old);Object.assign(view,views.get(id)||{query:'',filter:'all',scrollTop:0});void nextTick(()=>{if(scroller.value)scroller.value.scrollTop=view.scrollTop})},{immediate:true})
watch(()=>[view.query,view.filter],()=>saveView())
const filtered=computed(()=>{const q=view.query.trim().toLocaleLowerCase();return props.items.filter(item=>(view.filter==='all'||subchatGroup(item)===view.filter)&&(!q||`${item.title}\n${item.purpose}`.toLocaleLowerCase().includes(q)))})
const groups=computed(()=>[{id:'attention',label:'需要处理'},{id:'running',label:'进行中'},{id:'done',label:'已完成'},{id:'unfinished',label:'未完成'}].map(group=>({...group,items:filtered.value.filter(item=>subchatGroup(item)===group.id)})).filter(group=>group.items.length))
function rowKey(event:KeyboardEvent){if(event.isComposing||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;const rows=[...(scroller.value?.querySelectorAll<HTMLButtonElement>('.subchat-list-row')||[])],at=rows.indexOf(document.activeElement as HTMLButtonElement);if(at<0||!rows.length)return;event.preventDefault();rows[event.key==='Home'?0:event.key==='End'?rows.length-1:(at+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus()}
onMounted(()=>{if(scroller.value)scroller.value.scrollTop=view.scrollTop;timer=setInterval(()=>{now.value=Date.now()},1000)})
onBeforeUnmount(()=>{saveView();clearInterval(timer)})
defineExpose({focusSearch:()=>searchInput.value?.focus()})
</script>
<style scoped>
.subchat-list{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0}.subchat-list-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 22px 14px}.subchat-list-header h2{font-size:17px;font-weight:650;margin:0}.subchat-list-header h2 span,.subchat-group h3 span{margin-left:5px;color:var(--navora-muted);font-weight:400}.subchat-list-header p{font-size:12px;color:var(--navora-muted);margin:5px 0 0}.subchat-list-filters{display:flex;gap:8px;padding:0 22px 14px}.subchat-list-filters label{display:flex;align-items:center;gap:8px;flex:1;min-width:0;padding:7px 9px;border:1px solid var(--navora-stroke);border-radius:8px}.subchat-list-filters label svg{width:15px;height:15px;color:var(--navora-muted)}.subchat-list-filters input{width:100%;min-width:0;outline:none;background:transparent;font-size:12px}.subchat-list-filters select{max-width:120px;padding:6px;border:1px solid var(--navora-stroke);border-radius:8px;font-size:12px;background:var(--navora-surface);color:var(--navora-ink)}.subchat-list-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:0 10px 20px 22px;overscroll-behavior:contain}.subchat-group h3{position:sticky;top:0;z-index:1;margin:0;padding:12px 2px 8px;background:var(--navora-surface);color:var(--navora-muted);font-size:12px;font-weight:500}.subchat-list-row{width:100%;display:flex;align-items:center;gap:12px;padding:13px 10px;border-radius:9px;text-align:left;min-width:0;color:var(--navora-ink)}.subchat-list-row:hover{background:var(--control-hover)}.subchat-list-row img{width:30px;height:30px;flex:none}.subchat-list-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px}.subchat-list-name,.subchat-list-summary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.subchat-list-name{font-size:14px}.subchat-unread{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--navora-accent);vertical-align:middle;margin-right:6px}.subchat-list-summary{font-size:12px;color:var(--navora-muted)}.subchat-list-meta{display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex:none;font-size:11px;color:var(--navora-muted)}.subchat-status.failed,.subchat-status.interrupted{color:var(--navora-danger,#a64c3d)}.subchat-status.running{color:var(--navora-accent)}.subchat-state{font-size:13px;color:var(--navora-muted);padding:28px 22px;line-height:1.8}.subchat-state button{color:var(--navora-accent)}@media(max-width:500px){.subchat-list-header{padding:14px}.subchat-list-filters{padding:0 14px 10px;flex-wrap:wrap}.subchat-list-scroll{padding-left:8px}.subchat-list-meta{max-width:96px}.subchat-list-filters label{flex-basis:180px}}
</style>
