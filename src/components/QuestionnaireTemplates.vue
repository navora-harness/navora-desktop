<template>
  <details class="questionnaire-templates" @toggle="onToggle">
    <summary>模板与复用</summary>
    <div class="template-save"><input v-model="title" class="questionnaire-input" aria-label="模板名称" maxlength="200" placeholder="模板名称" /><button class="ui-button" type="button" :disabled="busy||!title.trim()" @click="save">保存为模板</button></div>
    <p class="template-hint">模板只保留题目。复用时重新填写，不带入本次答案或附件。</p>
    <p v-if="error" class="template-error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <ul><li v-for="template in templates" :key="template.id"><span><strong>{{ template.title }}</strong><small>{{ template.questions.length }} 题{{ template.builtin?' · 内置':'' }}</small></span><button class="ui-button" type="button" :disabled="busy||record.status==='pending'" @click="use(template.id)">使用模板</button><button class="ui-button" type="button" :disabled="busy" @click="exportTemplate(template)">导出</button><button v-if="!template.builtin" class="ui-button" type="button" :disabled="busy" @click="remove(template.id)">删除</button></li></ul>
    <p v-if="record.status==='pending'" class="template-hint">提交或取消当前问卷后，可以在此使用另一份模板。</p>
  </details>
</template>
<script setup lang="ts">
import {ref,watch} from 'vue'
import type {QuestionnaireRecord,QuestionnaireTemplate} from '@shared/questionnaire'
const props=defineProps<{record:QuestionnaireRecord}>(),emit=defineEmits<{open:[record:QuestionnaireRecord]}>()
const title=ref(props.record.title),templates=ref<QuestionnaireTemplate[]>([]),busy=ref(false),error=ref(''),notice=ref('')
watch(()=>props.record.id,()=>{title.value=props.record.title;error.value='';notice.value=''})
async function perform(action:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';notice.value='';try{await action()}catch(e){error.value=e instanceof Error?e.message:'模板操作失败，请重试。'}finally{busy.value=false}}
async function refresh(){templates.value=await window.navora!.questionnaires.listTemplates()}
function onToggle(event:Event){if((event.target as HTMLDetailsElement).open)void perform(refresh)}
function save(){void perform(async()=>{await window.navora!.questionnaires.saveTemplate(props.record.id,title.value.trim());await refresh();notice.value='模板已保存，可在其他任务中复用。'})}
function use(id:string){void perform(async()=>emit('open',await window.navora!.questionnaires.useTemplate(id,props.record.chatId)))}
function remove(id:string){void perform(async()=>{await window.navora!.questionnaires.deleteTemplate(id);await refresh();notice.value='模板已删除。'})}
function exportTemplate(template:QuestionnaireTemplate){const url=URL.createObjectURL(new Blob([JSON.stringify({title:template.title,description:template.description,questions:template.questions},null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=template.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
</script>
<style scoped>
.questionnaire-templates{margin-top:18px;font-size:12px;color:var(--navora-muted)}summary{cursor:pointer;width:fit-content;padding:5px 0}summary:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--navora-accent);outline-offset:3px}.template-save{display:flex;gap:8px;margin-top:10px;align-items:center}.questionnaire-input{box-sizing:border-box;min-width:0;flex:1;padding:8px 10px;border:1px solid var(--navora-stroke);border-radius:8px;background:var(--navora-background);color:var(--navora-ink);font:inherit}.ui-button{font:inherit;white-space:nowrap}.template-hint{line-height:1.7}ul{list-style:none;margin:12px 0;padding:0}li{display:flex;flex-wrap:wrap;align-items:center;gap:7px;padding:10px 0;border-top:1px solid var(--navora-stroke)}li>span{flex:1;min-width:120px;overflow-wrap:anywhere}strong{display:block;color:var(--navora-ink);font-weight:550}small{display:block;margin-top:4px}.template-error{color:var(--control-danger)}
</style>
