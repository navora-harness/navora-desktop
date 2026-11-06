<template>
  <section v-if="record" class="questionnaire-chat-card" :data-questionnaire-id="record.id" :aria-label="`问卷：${record.title}`">
    <div class="questionnaire-chat-heading"><AppIcon icon="list-ul" /><strong>{{record.title}}</strong><span>{{statusLabel}}</span></div>
    <p v-if="record.status==='pending'">{{record.questions.length}} 个问题，已填写 {{answeredCount}} 项<template v-if="record.parentChatId"> · 子任务</template></p>
    <details v-else-if="record.submission"><summary>查看已提交的回答</summary><pre>{{summary}}</pre></details>
    <p v-else>{{record.status==='stale'?'原任务已结束，填写内容已保留。':'这份问卷已结束，填写内容已保留。'}}</p>
    <button type="button" class="ui-button" @click="requestOpenQuestionnaire(record.id,record.chatId)">{{record.status==='pending'?'打开填写':'查看问卷'}}</button>
  </section>
  <p v-else-if="error" class="questionnaire-chat-error" role="status">{{error}} <button type="button" @click="load">重试</button></p>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import {formatQuestionnaireAnswers,type QuestionnaireRecord} from '@shared/questionnaire'
import {requestOpenQuestionnaire} from '@/utils/questionnaire-events'
import AppIcon from './icons/AppIcon.vue'
const props=defineProps<{questionnaireId:string}>()
const record=ref<QuestionnaireRecord|null>(null),error=ref('')
let generation=0,off:(()=>void)|undefined
const statusLabel=computed(()=>record.value?({pending:'待填写',submitted:'已提交',cancelled:'已取消',stale:'已失效'}[record.value.status]):'')
const answeredCount=computed(()=>Object.values(record.value?.draft.answers||{}).filter(answer=>answer.state!=='unanswered').length)
const summary=computed(()=>record.value?formatQuestionnaireAnswers(record.value):'')
async function load(){
  const id=props.questionnaireId,request=++generation
  error.value=''
  try{const next=await window.navora?.questionnaires?.get(id);if(request===generation)record.value=next||null}
  catch{if(request===generation)error.value='暂时无法读取问卷。'}
}
watch(()=>props.questionnaireId,()=>{record.value=null;void load()},{immediate:true})
off=window.navora?.questionnaires?.onChanged(next=>{if(next.id===props.questionnaireId){generation++;record.value=next;error.value=''}})
onBeforeUnmount(()=>{generation++;off?.()})
</script>
<style scoped>
.questionnaire-chat-card{margin:10px 0;padding:12px 14px;border:1px solid var(--navora-stroke);border-radius:10px;background:var(--appearance-well,var(--navora-surface));color:var(--navora-ink);font-size:13px;line-height:1.6;min-width:0}
.questionnaire-chat-heading{display:flex;align-items:center;gap:8px;min-width:0}.questionnaire-chat-heading>svg{color:var(--navora-accent);flex:none}.questionnaire-chat-heading strong{font-weight:600;overflow-wrap:anywhere}.questionnaire-chat-heading>span{margin-left:auto;flex:none;color:var(--navora-muted);font-size:12px}.questionnaire-chat-card p{margin:5px 0 9px;color:var(--navora-muted)}.questionnaire-chat-card details{margin:7px 0 10px}.questionnaire-chat-card summary{cursor:pointer;color:var(--navora-muted)}.questionnaire-chat-card pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:8px 0;max-height:240px;overflow:auto}.questionnaire-chat-card .ui-button{color:var(--navora-accent)}.questionnaire-chat-error{font-size:12px;color:var(--control-danger)}.questionnaire-chat-error button{color:inherit;text-decoration:underline}
</style>
