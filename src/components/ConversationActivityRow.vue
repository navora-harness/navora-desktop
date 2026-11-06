<template>
  <section class="transcript-activity" :class="{'is-open':expanded,'is-error':state==='error','is-stopped':state==='aborted'}" :data-msg-id="message.id">
    <button type="button" class="transcript-activity-trigger" :aria-expanded="expanded" :aria-controls="detailId" :title="label||summary" @click="$emit('toggle')">
      <AppIcon :icon="state==='error'?'circle-exclamation':state==='aborted'?'stop':icon||'terminal'" />
      <span>{{ label||summary }}</span><AppIcon class="activity-chevron" icon="chevron-right" />
    </button>
    <slot />
    <QuestionnaireChatCard v-if="questionnaireId" :questionnaire-id="questionnaireId" />
    <div v-if="expanded" :id="detailId" class="transcript-activity-detail">
      <div v-if="subchatResult" class="activity-subchat-results">
        <p class="activity-result-count">{{ subchatResult.total }} 个子对话<span v-if="subchatResult.running">，{{ subchatResult.running }} 个仍在进行</span></p>
        <ul v-if="subchatResult.rows.length" class="activity-result-list">
          <li v-for="(result,index) in subchatResult.rows" :key="`${result.id}-${index}`" class="activity-result-row">
            <img v-if="result.id" :src="subchatGlyphUrl(result.id)" alt="" aria-hidden="true" />
            <AppIcon v-else icon="comments" aria-hidden="true" />
            <div class="activity-result-copy">
              <div class="activity-result-heading"><span class="activity-result-title" :title="result.title">{{ result.title }}</span><span class="activity-result-status">{{ result.status }}</span></div>
              <p class="activity-result-summary" :title="result.fullSummary">{{ result.summary }}</p>
            </div>
          </li>
        </ul>
        <p v-else class="activity-result-empty">没有待收集的子对话结果。</p>
        <p v-if="subchatResult.total>subchatResult.rows.length" class="output-truncated">其余结果可在原始输出中查看。</p>
      </div>
      <div v-else-if="askResult" class="activity-ask-result">
        <div class="activity-ask-heading"><span class="activity-ask-label">问题</span><span class="activity-ask-status">{{ askResult.status }}</span></div>
        <p class="activity-ask-question">{{ askResult.question }}</p>
        <div v-if="askResult.answer" class="activity-ask-answer"><span class="activity-ask-label">你的回答</span><p>{{ askResult.answer }}</p></div>
        <p v-else class="activity-ask-outcome">{{ askResult.outcome }}</p>
      </div>

      <details v-if="subchatResult||askResult" ref="rawOutputDetails" class="activity-disclosure activity-raw-output" :open="!!reveal">
        <summary>原始输出</summary>
        <pre :key="output.start" :data-find-offset="output.start">{{ output.text||'暂无输出' }}</pre>
        <p v-if="output.truncated" class="output-truncated">正在显示第 {{(output.start+1).toLocaleString()}}–{{(output.start+output.text.length).toLocaleString()}} 字，共 {{ output.total.toLocaleString() }} 字。</p>
        <div v-if="output.total>24000" class="activity-output-pages">
          <button type="button" class="ui-button" :disabled="output.start===0" @click="pageStart=Math.max(0,output.start-24000)">上一段</button>
          <button type="button" class="ui-button" :disabled="output.start+output.text.length>=output.total" @click="pageStart=output.start+output.text.length">下一段</button>
          <button v-if="reveal&&pageStart!==null" type="button" class="ui-button" @click="pageStart=null">返回匹配处</button>
        </div>
      </details>
      <div v-else class="activity-readable-output">
        <span class="tool-sec-label">{{ state==='error'?'错误与结果':'结果' }}</span>
        <pre :key="output.start" :data-find-offset="output.start">{{ output.text||'暂无输出' }}</pre>
        <p v-if="output.truncated" class="output-truncated">正在显示第 {{(output.start+1).toLocaleString()}}–{{(output.start+output.text.length).toLocaleString()}} 字，共 {{ output.total.toLocaleString() }} 字。</p>
        <div v-if="output.total>24000" class="activity-output-pages">
          <button type="button" class="ui-button" :disabled="output.start===0" @click="pageStart=Math.max(0,output.start-24000)">上一段</button>
          <button type="button" class="ui-button" :disabled="output.start+output.text.length>=output.total" @click="pageStart=output.start+output.text.length">下一段</button>
          <button v-if="reveal&&pageStart!==null" type="button" class="ui-button" @click="pageStart=null">返回匹配处</button>
        </div>
      </div>

      <details v-if="message.meta?.args" class="activity-disclosure activity-arguments">
        <summary>调用参数</summary>
        <pre>{{ argsText }}</pre>
      </details>
      <div class="activity-detail-footer">
        <button type="button" class="activity-copy" @click="copy"><AppIcon icon="copy" />{{ copied?'已复制':'复制完整输出' }}</button>
        <span v-if="copyError" class="activity-copy-error" role="status">复制失败，请重试。</span>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,ref,useId,watch} from 'vue'
import type {ChatMessage,SubChatRunStatus} from '@shared/types'
import {boundedToolOutput,revealedToolOutput,toolActivityLabel} from '@shared/conversation-output'
import {subchatStatusLabels} from '@shared/subchat-presentation'
import {useSubchatGlyph} from '@/composables/useSubchatGlyph'
import AppIcon from './icons/AppIcon.vue'
import QuestionnaireChatCard from './QuestionnaireChatCard.vue'
const props=defineProps<{message:ChatMessage;label?:string;icon?:string;status?:string;expanded?:boolean;reveal?:{from:number;to:number}}>()
const {glyphUrl:subchatGlyphUrl}=useSubchatGlyph()
defineEmits<{toggle:[]}>()
const detailId=`activity-${useId()}`,copied=ref(false),copyError=ref(false),pageStart=ref<number|null>(null)
const rawOutputDetails=ref<HTMLDetailsElement|null>(null)
const state=computed(()=>props.status||String(props.message.meta?.status||'unconfirmed'))
const questionnaireId=computed(()=>props.message.meta?.toolName==='agent_ask_form'&&typeof props.message.meta?.questionnaireId==='string'?props.message.meta.questionnaireId:'')
const summary=computed(()=>toolActivityLabel(props.message,state.value)),output=computed(()=>{if(pageStart.value===null)return revealedToolOutput(props.message.content,props.reveal);const start=Math.max(0,Math.min(pageStart.value,Math.max(0,props.message.content.length-1)));return {text:props.message.content.slice(start,start+24000),start,total:props.message.content.length,truncated:start>0||start+24000<props.message.content.length}})
watch(()=>[props.message.id,props.reveal],()=>{pageStart.value=null})
watch(()=>[props.reveal,props.expanded],()=>{if(props.reveal&&rawOutputDetails.value)rawOutputDetails.value.open=true},{flush:'post'})
const argsText=computed(()=>{try{return boundedToolOutput(JSON.stringify(props.message.meta?.args,null,2)||'').text}catch{return '参数不可用'}})
function isRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)}
const subchatResult=computed(()=>{
  if(!['agent_await_subchats','agent_subchat_status'].includes(String(props.message.meta?.toolName||'')))return null
  // A compact view is optional; oversized or unfamiliar output keeps its complete plain-text presentation.
  if(props.message.content.length>500_000)return null
  let parsed:unknown
  try{parsed=JSON.parse(props.message.content)}catch{return null}
  if(!isRecord(parsed)||parsed.ok===false||!Array.isArray(parsed.results)||!parsed.results.every(isRecord))return null
  const results=parsed.results
  const rows=results.slice(0,80).map((result,index)=>{
    const id=typeof result.subChatId==='string'?result.subChatId:''
    const title=typeof result.title==='string'&&result.title.trim()?result.title.trim():typeof result.goal==='string'&&result.goal.trim()?result.goal.trim():`子对话 ${index+1}`
    const resultState=typeof result.status==='string'?result.status:''
    const status=result.ok===false?'未完成':Object.prototype.hasOwnProperty.call(subchatStatusLabels,resultState)?subchatStatusLabels[resultState as SubChatRunStatus]:'状态待确认'
    const rawSummary=typeof result.summary==='string'?result.summary.trim():''
    const fullSummary=rawSummary==='await_timeout'?'任务仍在运行，稍后可继续查看结果。':rawSummary||(typeof result.error==='string'?`错误：${result.error}`:resultState==='running'?'任务仍在运行。':'暂无文字摘要。')
    const compactSummary=fullSummary.replace(/\s+/g,' ')
    return {id,title,status,fullSummary,summary:compactSummary.length>260?`${compactSummary.slice(0,260)}…`:compactSummary}
  })
  return {total:results.length,running:results.filter(result=>result.status==='running').length,rows}
})
const askResult=computed(()=>{
  if(props.message.meta?.toolName!=='agent_ask_user'||props.message.content.length>500_000)return null
  let parsed:unknown
  try{parsed=JSON.parse(props.message.content)}catch{return null}
  if(!isRecord(parsed)||typeof parsed.ok!=='boolean')return null
  const args=isRecord(props.message.meta?.args)?props.message.meta.args:null
  const question=typeof args?.question==='string'&&args.question.trim()?args.question.trim():'问题内容未记录。'
  const answer=parsed.ok===true&&typeof parsed.answer==='string'?parsed.answer.trim():''
  if(answer)return {question,answer,status:parsed.remembered===true?'沿用此前回答':'已回答',outcome:''}
  const errors:Record<string,{status:string;outcome:string}>={
    timeout:{status:'等待超时',outcome:'未在等待时限内收到回答。'},
    user_denied:{status:'已跳过',outcome:'本次询问未作答。'},
    aborted:{status:'已取消',outcome:'本次询问已随任务取消。'},
    fork_decision_disabled:{status:'未发起',outcome:'询问功能已关闭。'},
    question_required:{status:'未发起',outcome:'缺少问题内容。'},
    options_need_at_least_2:{status:'未发起',outcome:'可选项不足，未发起询问。'},
  }
  const error=typeof parsed.error==='string'?parsed.error:''
  const knownError=parsed.ok===false&&Object.prototype.hasOwnProperty.call(errors,error)?errors[error]:undefined
  return {question,answer:'',status:knownError?.status||(parsed.ok===false?'未完成':'状态待确认'),outcome:knownError?.outcome||(error?`错误：${error}`:'没有记录到有效回答，可展开原始输出查看。')}
})
let timer:ReturnType<typeof setTimeout>|undefined
async function copy(){try{await navigator.clipboard.writeText(props.message.content);copyError.value=false;copied.value=true;clearTimeout(timer);timer=setTimeout(()=>{copied.value=false},1800)}catch{copyError.value=true}}
onBeforeUnmount(()=>clearTimeout(timer))
</script>
<style>
.transcript-activity{color:var(--navora-muted);margin:12px 0;min-width:0;font-size:14px;line-height:1.65}
.transcript-activity-trigger{display:flex;align-items:center;gap:9px;max-width:100%;min-height:30px;padding:2px 0;border:0;background:none;color:inherit;text-align:left;cursor:pointer}
.transcript-activity-trigger>.app-icon{width:18px;height:18px;flex:none}
.transcript-activity-trigger>span{min-width:0;overflow-wrap:anywhere}
.transcript-activity-trigger:hover>span{text-decoration:underline;text-underline-offset:3px}
.transcript-activity-trigger .activity-chevron{width:13px;height:13px;transition:transform 140ms ease}
.transcript-activity.is-open .activity-chevron{transform:rotate(90deg)}
.transcript-activity-trigger:focus-visible{outline:2px solid var(--control-focus,var(--navora-accent));outline-offset:3px;border-radius:5px}
.transcript-activity-detail{box-sizing:border-box;max-width:100%;min-width:0;margin:6px 0 13px 27px;padding:3px 0 3px 15px;border-left:1px solid var(--navora-stroke);color:var(--navora-ink);font-size:12px}
.transcript-activity-detail pre{box-sizing:border-box;max-width:100%;max-height:300px;overflow:auto;margin:7px 0 0;padding:10px 12px;border-radius:7px;background:color-mix(in srgb,var(--navora-ink) 3%,transparent);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2;overscroll-behavior:contain}
.transcript-activity.is-error>.transcript-activity-trigger{color:rgb(var(--v-theme-error))}
.transcript-activity-detail .tool-sec-label,.transcript-activity-detail .output-truncated{color:var(--navora-muted);font-size:11px}
.transcript-activity-detail .output-truncated{margin:6px 0}
.activity-disclosure{margin-top:9px;color:var(--navora-muted);font-size:11px}
.activity-disclosure>summary{width:fit-content;padding:2px 0;cursor:pointer;user-select:none;list-style:none}
.activity-disclosure>summary::-webkit-details-marker{display:none}
.activity-disclosure>summary::before{content:'›';display:inline-block;width:14px;color:var(--navora-muted);transform-origin:4px center}
.activity-disclosure[open]>summary::before{transform:rotate(90deg)}
.activity-disclosure>summary:hover{color:var(--navora-ink)}
.activity-disclosure>summary:focus-visible,.activity-copy:focus-visible{outline:2px solid var(--control-focus,var(--navora-accent));outline-offset:3px;border-radius:3px}
.activity-disclosure pre{color:var(--navora-muted)}
.activity-arguments pre{max-height:180px}
.activity-readable-output{min-width:0}
.activity-output-pages{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}
.activity-output-pages button{font-size:11px}
.activity-detail-footer{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px}
.activity-copy{display:inline-flex;align-items:center;gap:5px;padding:3px 0;border:0;background:transparent;color:var(--navora-muted);font:inherit;font-size:11px;cursor:pointer}
.activity-copy:hover{color:var(--navora-ink)}
.activity-copy .app-icon{width:13px;height:13px}
.activity-copy-error{font-size:11px;color:var(--control-danger,var(--navora-muted))}
.activity-result-count{margin:0 0 9px;color:var(--navora-muted);font-size:11px}
.activity-result-list{display:flex;flex-direction:column;gap:13px;max-height:360px;overflow:auto;overscroll-behavior:contain;margin:0!important;padding:0 6px 0 0!important;list-style:none}
.activity-result-row{display:flex;align-items:flex-start;gap:9px;min-width:0}
.activity-result-row>img,.activity-result-row>.app-icon{width:18px;height:18px;flex:0 0 18px;margin-top:1px}
.activity-result-copy{flex:1;min-width:0}
.activity-result-heading{display:flex;align-items:baseline;gap:10px;min-width:0}
.activity-result-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.activity-result-status{flex:none;color:var(--navora-muted);font-size:10px;white-space:nowrap}
.activity-result-summary{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:3px 0 0;color:var(--navora-muted);font-size:11px;line-height:1.65;overflow-wrap:anywhere}
.activity-result-empty{margin:0;color:var(--navora-muted);font-size:12px}
.activity-ask-result{max-width:640px}
.activity-ask-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
.activity-ask-label,.activity-ask-status{color:var(--navora-muted);font-size:11px}
.activity-ask-status{flex:none;white-space:nowrap}
.activity-ask-question,.activity-ask-answer p{max-height:200px;overflow:auto;margin:4px 0 0;color:var(--navora-ink);font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;overscroll-behavior:contain}
.activity-ask-answer{margin-top:12px}
.activity-ask-answer p{padding:8px 11px;border-radius:7px;background:color-mix(in srgb,var(--navora-ink) 3%,transparent)}
.activity-ask-outcome{margin:9px 0 0;color:var(--navora-muted);font-size:12px}
@media(max-width:480px){.transcript-activity-detail{margin-left:13px;padding-left:12px}.activity-result-heading{flex-wrap:wrap;gap:1px 8px}.activity-result-title{flex:1 1 150px}}
@media(prefers-reduced-motion:reduce){.transcript-activity-trigger .activity-chevron{transition:none}}
</style>
