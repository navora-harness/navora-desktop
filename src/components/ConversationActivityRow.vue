<template>
  <section class="transcript-activity" :class="{'is-open':expanded,'is-error':state==='error','is-stopped':state==='aborted'}" :data-msg-id="message.id">
    <button type="button" class="transcript-activity-trigger" :aria-expanded="expanded" :aria-controls="detailId" :title="label||summary" @click="$emit('toggle')">
      <AppIcon :icon="state==='error'?'circle-exclamation':state==='aborted'?'stop':icon||'terminal'" />
      <span>{{ label||summary }}</span><AppIcon class="activity-chevron" icon="chevron-right" />
    </button>
    <slot />
    <div v-if="expanded" :id="detailId" class="transcript-activity-detail">
      <div v-if="message.meta?.args" class="tool-section"><span class="tool-sec-label">参数</span><pre>{{ argsText }}</pre></div>
      <div class="tool-section"><span class="tool-sec-label">{{ state==='error'?'错误与结果':'结果' }}</span><pre :key="output.start" :data-find-offset="output.start">{{ output.text||'暂无输出' }}</pre><p v-if="output.truncated" class="output-truncated">正在显示第 {{(output.start+1).toLocaleString()}}–{{(output.start+output.text.length).toLocaleString()}} 字，共 {{ output.total.toLocaleString() }} 字。</p><div v-if="output.total>24000" class="activity-output-pages"><button type="button" class="ui-button" :disabled="output.start===0" @click="pageStart=Math.max(0,output.start-24000)">上一段</button><button type="button" class="ui-button" :disabled="output.start+output.text.length>=output.total" @click="pageStart=output.start+output.text.length">下一段</button><button v-if="reveal&&pageStart!==null" type="button" class="ui-button" @click="pageStart=null">返回匹配处</button></div></div>
      <button type="button" class="ui-button activity-copy" @click="copy"><AppIcon icon="copy" />{{ copied?'已复制':'复制完整输出' }}</button>
      <span v-if="copyError" role="status">复制失败，请重试。</span>
    </div>
  </section>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,ref,useId,watch} from 'vue'
import type {ChatMessage} from '@shared/types'
import {boundedToolOutput,revealedToolOutput,toolActivityLabel} from '@shared/conversation-output'
import AppIcon from './icons/AppIcon.vue'
const props=defineProps<{message:ChatMessage;label?:string;icon?:string;status?:string;expanded?:boolean;reveal?:{from:number;to:number}}>()
defineEmits<{toggle:[]}>()
const detailId=`activity-${useId()}`,copied=ref(false),copyError=ref(false),pageStart=ref<number|null>(null)
const state=computed(()=>props.status||String(props.message.meta?.status||'unconfirmed'))
const summary=computed(()=>toolActivityLabel(props.message,state.value)),output=computed(()=>{if(pageStart.value===null)return revealedToolOutput(props.message.content,props.reveal);const start=Math.max(0,Math.min(pageStart.value,Math.max(0,props.message.content.length-1)));return {text:props.message.content.slice(start,start+24000),start,total:props.message.content.length,truncated:start>0||start+24000<props.message.content.length}})
watch(()=>[props.message.id,props.reveal],()=>{pageStart.value=null})
const argsText=computed(()=>{try{return boundedToolOutput(JSON.stringify(props.message.meta?.args,null,2)||'').text}catch{return '参数不可用'}})
let timer:ReturnType<typeof setTimeout>|undefined
async function copy(){try{await navigator.clipboard.writeText(props.message.content);copyError.value=false;copied.value=true;clearTimeout(timer);timer=setTimeout(()=>{copied.value=false},1800)}catch{copyError.value=true}}
onBeforeUnmount(()=>clearTimeout(timer))
</script>
<style>
.transcript-activity{color:var(--navora-muted);margin:12px 0;min-width:0;font-size:14px;line-height:1.65}.transcript-activity-trigger{display:flex;align-items:center;gap:9px;max-width:100%;min-height:30px;padding:2px 0;border:0;background:none;color:inherit;text-align:left;cursor:pointer}.transcript-activity-trigger>.app-icon{width:18px;height:18px;flex:none}.transcript-activity-trigger>span{min-width:0;overflow-wrap:anywhere}.transcript-activity-trigger:hover>span{text-decoration:underline;text-underline-offset:3px}.transcript-activity-trigger .activity-chevron{width:13px;height:13px;transition:transform 140ms ease}.transcript-activity.is-open .activity-chevron{transform:rotate(90deg)}.transcript-activity-trigger:focus-visible{outline:2px solid var(--control-focus,var(--navora-accent));outline-offset:3px;border-radius:5px}.transcript-activity-detail{margin:9px 0 16px 27px;padding:12px 14px;border-left:1px solid var(--navora-stroke);background:var(--navora-background);border-radius:0 8px 8px 0;color:var(--navora-ink);font-size:12px;max-height:460px;overflow:auto}.transcript-activity-detail pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;font-size:12px;line-height:1.65}.transcript-activity.is-error>.transcript-activity-trigger{color:rgb(var(--v-theme-error))}.transcript-activity-detail .tool-sec-label,.output-truncated{color:var(--navora-muted);font-size:11px}.activity-output-pages{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.activity-output-pages button{font-size:11px}.activity-copy{margin-top:8px;font-size:12px}.activity-copy .app-icon{width:14px;height:14px}@media(prefers-reduced-motion:reduce){.transcript-activity-trigger .activity-chevron{transition:none}}
</style>
