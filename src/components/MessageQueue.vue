<template>
  <section v-if="entries.length" class="message-queue" aria-label="待发送消息">
    <header><span>待发送 <b>{{ entries.length }}</b></span><button v-if="paused" type="button" :disabled="busy" @click="emit('resume')">继续队列</button><span v-else class="queue-hint">当前任务结束后发送</span></header>
    <ol>
      <li v-for="entry in entries" :key="entry.id" :data-queue-id="entry.id">
        <template v-if="editing === entry.id"><textarea v-model="text" rows="2" :maxlength="maxChars" aria-label="编辑待发送消息" @keydown.esc.prevent="editing=''" @keydown.ctrl.enter.prevent="save(entry.id)" /><div class="queue-edit-actions"><button type="button" @click="editing=''">取消</button><button type="button" :disabled="busy||(!text.trim()&&!entry.refs?.length)" @click="save(entry.id)">保存</button></div></template>
        <template v-else><p :title="entry.content">{{ entry.content || '附带浏览器上下文' }}</p><div class="queue-item-actions"><button type="button" title="编辑" aria-label="编辑队列消息" :disabled="busy" @click="editing=entry.id;text=entry.content"><font-awesome-icon icon="pen-to-square" /></button><button type="button" title="直接插入" aria-label="直接插入队列消息" :disabled="busy" @click="emit('insert',entry.id)"><font-awesome-icon icon="arrow-up" /></button><button type="button" title="删除" aria-label="删除队列消息" :disabled="busy" @click="emit('remove',entry.id)"><font-awesome-icon icon="xmark" /></button></div><span v-if="entry.error" class="queue-error">发送失败，可编辑后继续</span></template>
      </li>
    </ol>
  </section>
</template>
<script setup lang="ts">
import {ref,watch} from 'vue'
import type {QueuedMessage} from '@shared/types'
const props=defineProps<{entries:QueuedMessage[];paused:boolean;busy:boolean;maxChars:number}>()
const emit=defineEmits<{edit:[id:string,content:string];insert:[id:string];remove:[id:string];resume:[]}>()
const editing=ref(''),text=ref(''),saving=ref(false)
function save(id:string){saving.value=true;emit('edit',id,text.value)}
watch([()=>props.entries,()=>props.busy],()=>{
  const entry=props.entries.find(entry=>entry.id===editing.value)
  if(!entry)editing.value=''
  if(saving.value&&!props.busy){if(entry?.content===text.value)editing.value='';saving.value=false}
})
</script>
<style scoped>
.message-queue{width:min(720px,100%);min-width:0;box-sizing:border-box;border:1px solid #d9e1eb;border-radius:12px;background:#f8fafc;margin-bottom:8px;padding:8px 10px;color:#56677e;font-size:11px;overflow:hidden;max-height:230px;display:flex;flex-direction:column}
header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px 5px;flex-shrink:0}header b{font-weight:500;margin-left:4px;color:#7e90a5}.queue-hint{color:#8793a3;font-size:10px}header>button{color:#3e6c9b;padding:2px 5px;border-radius:5px}
ol{list-style:none;margin:0;padding:0;overflow:auto;min-height:0}li{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-height:32px;border-top:1px solid #e4e9f0}li>p{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0}.queue-item-actions{display:flex;gap:2px}.queue-item-actions button{width:26px;height:26px;display:grid;place-items:center;border:1px solid transparent;border-radius:6px;color:#6e8097;cursor:pointer}.queue-item-actions svg{width:12px;height:12px}button:hover{background:#e9eef5;color:#345576}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:2px solid #537ab9;outline-offset:-2px}
textarea{resize:vertical;width:100%;outline:none;border:1px solid #c5d2e1;border-radius:7px;background:white;padding:6px;color:#394e68;margin-top:6px;font:inherit;max-height:110px}.queue-edit-actions{display:flex;justify-content:flex-end;width:100%;gap:6px;padding-bottom:5px}.queue-edit-actions button{padding:3px 8px;border-radius:5px;color:#416a96}.queue-error{flex-basis:100%;padding-bottom:4px;font-size:10px;color:#b46760}
button{transition:background-color 140ms ease,color 140ms ease}@media(prefers-reduced-motion:reduce){button{transition:none}}
</style>
