<template>
  <article class="annotation-chat-card" :data-annotation-id="note?.id" :data-target-id="entry.target?.id" :aria-label="note?'网页批注':'未保存的网页批注'">
    <header><AppIcon icon="annotate"/><strong>{{note?'网页批注':'批注草稿'}}</strong><span>{{note?labels[note.taskState]:'未保存'}}</span><time :title="new Date(entry.createdAt).toLocaleString()">{{new Date(entry.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}}</time></header>
    <div class="annotation-chat-source" :title="selection?.url">{{selection?.title||selection?.url||'网页'}}</div>
    <p class="annotation-chat-comment">{{note?.comment||entry.target?.comment||'尚未填写意见'}}</p>
    <p v-if="entry.draft&&entry.draft.text!==note?.comment" class="annotation-chat-notice">有未保存的修改，可继续编辑。</p>
    <div class="annotation-chat-actions">
      <button type="button" class="ui-button" :disabled="busy" @click="emit('action','edit')">{{note?'编辑':'继续填写'}}</button>
      <button v-if="note" type="button" class="ui-button" :disabled="busy" @click="emit('action','send')">加入输入框</button>
      <button type="button" class="ui-icon-button" title="查看创建时证据" aria-label="查看创建时证据" :disabled="busy" @click="emit('action','evidence')"><AppIcon icon="image"/></button>
      <details>
        <summary aria-label="批注详情与更多操作">详情</summary>
        <div class="annotation-chat-details">
          <p>{{selection?.url}}</p><blockquote v-if="selection?.text">{{selection.text}}</blockquote>
          <div v-if="note" class="annotation-chat-actions"><button type="button" class="ui-button" :disabled="busy" @click="emit('action','locate')">定位原位置</button><button type="button" class="ui-button" :disabled="busy||note.taskState==='draft'" @click="emit('action','resolve')">{{note.taskState==='resolved'?'重新打开':'标记已解决'}}</button></div>
          <div v-for="copy in entry.copies" :key="copy.id" class="annotation-chat-copy"><p>{{copy.text||'空白冲突副本'}}</p><button type="button" class="ui-button" :disabled="busy" @click="emit('action','copy',copy.id)">恢复此副本</button></div>
          <button v-if="entry.draft&&entry.draft.text!==note?.comment" type="button" class="ui-button" :disabled="busy" @click="emit('action','latest')">使用已保存的意见</button>
          <div v-if="deleting" class="annotation-chat-actions" role="group" aria-label="确认移除批注"><span>{{note?'移除此批注？历史引用的证据仍保留。':'放弃这份草稿？'}}</span><button type="button" class="ui-button" :disabled="busy" @click="emit('action',note?'delete':'discard')">确认移除</button><button type="button" class="ui-button" :disabled="busy" @click="deleting=false">保留</button></div>
          <button v-else type="button" class="ui-button" :disabled="busy" @click="deleting=true">{{note?'移除批注…':'放弃草稿…'}}</button>
        </div>
      </details>
    </div>
  </article>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue'
import type {AnnotationChatAction,AnnotationChatEntry} from '@shared/browser-annotation-chat'
import AppIcon from './icons/AppIcon.vue'
const props=defineProps<{entry:AnnotationChatEntry;busy?:boolean}>()
const emit=defineEmits<{action:[action:AnnotationChatAction,copyId?:string]}>()
const note=computed(()=>props.entry.note),selection=computed(()=>note.value?.selection||props.entry.target?.selection),deleting=ref(false)
const labels={draft:'已保存',pending:'待处理',review:'待核对',resolved:'已解决'}
</script>
<style scoped>
.annotation-chat-card{max-width:680px;margin:14px 0;padding:12px 14px;border:1px solid var(--navora-stroke);border-radius:10px;background:var(--navora-surface);color:var(--navora-ink);font-size:13px;min-width:0}.annotation-chat-card header{display:flex;align-items:center;gap:7px;font-size:12px}.annotation-chat-card header>.app-icon{width:16px;height:16px;color:var(--navora-accent)}.annotation-chat-card header strong{font-weight:600}.annotation-chat-card header span,.annotation-chat-card time{font-size:11px;color:var(--navora-muted)}.annotation-chat-card time{margin-left:auto}.annotation-chat-source{margin-top:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--navora-muted)}.annotation-chat-comment{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;max-height:280px;overflow:auto;margin:8px 0}.annotation-chat-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px}.annotation-chat-actions>.ui-button{font-size:12px;min-height:28px;padding:3px 8px}.annotation-chat-actions>.ui-icon-button{width:28px;height:28px}.annotation-chat-card details{flex:1;min-width:0}.annotation-chat-card summary{cursor:pointer;color:var(--navora-muted);font-size:12px;padding:5px;list-style-position:inside}.annotation-chat-details{padding:8px 0 0;font-size:12px}.annotation-chat-details p{overflow-wrap:anywhere;white-space:pre-wrap;max-height:180px;overflow:auto;margin:4px 0 8px}.annotation-chat-details blockquote{margin:6px 0 10px;padding-left:10px;border-left:2px solid var(--navora-stroke);color:var(--navora-muted);max-height:100px;overflow:auto;white-space:pre-wrap}.annotation-chat-notice{color:var(--navora-muted);font-size:12px}.annotation-chat-copy{padding:8px 0;border-top:1px solid var(--navora-stroke);margin-top:8px}summary:focus-visible{outline:2px solid var(--navora-accent);outline-offset:2px}
</style>
<style scoped>
.annotation-chat-card details[open]{flex-basis:100%}
</style>
