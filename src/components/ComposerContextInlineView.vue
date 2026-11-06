<template>
  <NodeViewWrapper as="span" class="composer-context-inline-node" :data-context-id="block.id" contenteditable="false">
    <ComposerContextPopover ref="popover" :block="block" :editor="editor.view.dom" :selected="selected" :preview="preview" @opened="loadDescription" @closed="closed">
      <form v-if="renaming" class="composer-inline-rename" aria-label="重命名引用" @submit.prevent="rename" @keydown.esc.stop.prevent="renaming=false"><label>显示名称<input ref="nameInput" v-model="name" maxlength="512" @keydown.enter="nameKey" /></label><div><button type="button" @click="renaming=false">取消</button><button type="submit" :disabled="!validName">保存</button></div></form>
      <p v-if="loading" class="composer-context-description" role="status">正在读取描述信息…</p>
      <p v-else-if="error" class="composer-context-description" role="status">{{ error }} <button type="button" @click="loadDescription">重试</button></p>
      <p v-else class="composer-context-description">{{ description||fallbackDescription }}</p>
      <template #actions><button type="button" @mousedown.prevent @click="act('open')">查看来源</button><button type="button" :disabled="!editor.isEditable" @mousedown.prevent @click="act('rename')">重命名</button><button type="button" :disabled="!editor.isEditable" @mousedown.prevent @click="act('remove')">移除</button><details><summary>更多操作</summary><div><button v-for="item in actions" :key="item.id" type="button" :disabled="item.disabled" @mousedown.prevent @click="act(item.id)">{{ item.label }}</button></div></details></template>
    </ComposerContextPopover>
  </NodeViewWrapper>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import {NodeViewWrapper,nodeViewProps} from '@tiptap/vue-3'
import {closeHistory} from '@tiptap/pm/history'
import type {ComposerContextBlock} from '@shared/composer-document'
import ComposerContextPopover from './ComposerContextPopover.vue'
const props=defineProps(nodeViewProps),popover=ref<InstanceType<typeof ComposerContextPopover>>(),renaming=ref(false),name=ref(''),nameInput=ref<HTMLInputElement>()
const block=computed(()=>props.node.attrs.block as ComposerContextBlock)
const identity=computed(()=>JSON.stringify([block.value.id,block.value.source,block.value.version]))
const validName=computed(()=>!!name.value.trim()&&name.value.trim().length<=512)
const description=ref(''),thumbnail=ref(''),loading=ref(false),error=ref('')
const preview=computed(()=>thumbnail.value||props.extension.options.preview?.(block.value))
const fallbackDescription=computed(()=>block.value.source.kind==='session'?'引用此浏览器会话及其页面。':block.value.source.kind==='url'?'链接已附加到本条消息。':block.value.source.kind==='image'?'图片已附加到本条消息。':'来源已附加到本条消息。')
let generation=0,renameOwner=''
const actions=computed(()=>[
  {id:'range',label:'更换来源或范围…',disabled:!props.editor.isEditable},
  {id:'excerpt',label:'转为可编辑摘录…',disabled:!props.editor.isEditable||['image','session'].includes(block.value.source.kind)},
  {id:'copy',label:'复制引用',disabled:false},
  {id:'plain',label:'转为普通文字',disabled:!props.editor.isEditable},
])
async function loadDescription(){
  const source=block.value.source,api=window.navora?.composer
  if(!api||!source.chatId||!['file','image','page','annotation'].includes(source.kind))return
  const ticket=++generation,owner=identity.value;loading.value=true;error.value=''
  try{
    const result=await api.contextExcerpt(source.chatId,{kind:source.kind==='file'||source.kind==='image'?'file':source.kind==='annotation'?'annotation':'page',path:source.path,pageId:source.browserRef?.windowId||source.identity,annotationId:source.browserRef?.annotationId||source.identity,range:block.value.range})
    if(ticket!==generation||owner!==identity.value)return
    description.value=result.text||result.reason||''
    if(result.thumbnail)thumbnail.value=`data:${result.thumbnail.mime};base64,${result.thumbnail.base64}`
  }catch{if(ticket===generation)error.value='暂时无法读取描述信息，来源引用仍保留。'}finally{if(ticket===generation)loading.value=false}
}
function closed(){generation++;loading.value=false;renaming.value=false}
function signal(action:string,value=block.value){props.editor.view.dom.dispatchEvent(new CustomEvent('composer-context-action',{bubbles:true,detail:{action,block:JSON.parse(JSON.stringify(value))}}))}
function nameKey(event:KeyboardEvent){if(event.isComposing||event.keyCode===229)event.preventDefault()}
function rename(){const pos=props.getPos(),current=typeof pos==='number'?props.editor.state.doc.nodeAt(pos)?.attrs.block as ComposerContextBlock|undefined:undefined;if(!validName.value||!props.editor.isEditable||renameOwner!==identity.value||current?.id!==block.value.id)return;props.updateAttributes({block:{...block.value,label:name.value.trim()}});renaming.value=false}
watch(identity,()=>{closed();description.value='';thumbnail.value='';error.value=''})
onBeforeUnmount(()=>{generation++})
function act(action:string){
  if(action==='open'||action==='range'){popover.value?.close();signal(action);return}
  if(action==='excerpt'){popover.value?.close();signal('range',{...block.value,mode:'excerpt'});return}
  const pos=props.getPos();if(typeof pos!=='number')return
  if(action==='copy'){props.editor.chain().focus().setNodeSelection(pos).run();document.execCommand('copy');return}
  if(!props.editor.isEditable)return
  if(action==='rename'){name.value=block.value.label;renameOwner=identity.value;renaming.value=true;void nextTick(()=>nameInput.value?.focus({preventScroll:true}));return}
  const {state,view}=props.editor
  const tr=action==='plain'?state.tr.replaceWith(pos,pos+props.node.nodeSize,state.schema.text(block.value.label||'来源')):action==='remove'?state.tr.delete(pos,pos+props.node.nodeSize):null
  if(tr){popover.value?.close();view.dispatch(closeHistory(tr));view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory',false));view.focus()}
}
</script>
<style>
.composer-context-inline-node{display:inline;max-width:100%}.composer-inline-rename{margin:0 0 10px;font-size:12px}.composer-inline-rename input{display:block;width:100%;box-sizing:border-box;margin-top:5px}.composer-inline-rename>div{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}.composer-inline-rename button{padding:4px 8px;color:var(--navora-accent);font:inherit}
</style>
