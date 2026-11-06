<template>
  <NodeViewWrapper as="span" class="composer-context-block" :data-context-id="block.id">
    <ComposerContextPopover ref="popover" :block="block" :editor="editor.view.dom" :selected="selected" :preview="preview" @closed="closed">
      <template #title><input :value="block.label" class="composer-context-label" aria-label="上下文显示名称" :readonly="!writable" maxlength="512" @input="rename" @keydown.enter="titleEnter" /></template>
      <NodeViewContent class="composer-context-content" :data-placeholder="block.mode==='excerpt'?'编辑这段摘录…':'添加使用说明…'" />
      <template #actions><button type="button" :disabled="block.source.kind==='text'" @mousedown.prevent @click="act('open')">查看来源</button><button type="button" :disabled="!writable" @mousedown.prevent @click="act('remove')">移除</button><details><summary>更多操作</summary><div><button v-for="item in actions.filter(item=>!['open','remove'].includes(item.id))" :key="item.id" type="button" :disabled="item.disabled" @mousedown.prevent @click="act(item.id)">{{ item.label }}</button></div></details></template>
    </ComposerContextPopover>
  </NodeViewWrapper>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref} from 'vue'
import {NodeViewContent,NodeViewWrapper,nodeViewProps} from '@tiptap/vue-3'
import {Fragment} from '@tiptap/pm/model'
import {NodeSelection,TextSelection} from '@tiptap/pm/state'
import {closeHistory} from '@tiptap/pm/history'
import type {ComposerContextBlock} from '@shared/composer-document'
import ComposerContextPopover from './ComposerContextPopover.vue'
const props=defineProps(nodeViewProps),popover=ref<InstanceType<typeof ComposerContextPopover>>()
const editVersion=ref(0),writable=computed(()=>{void editVersion.value;return props.editor.isEditable})
function editStateChanged(){editVersion.value++}
onMounted(()=>props.editor.on('update',editStateChanged))
onBeforeUnmount(()=>props.editor.off('update',editStateChanged))
const block=computed(()=>props.node.attrs.block as ComposerContextBlock)
const preview=computed(()=>{const value=props.extension.options.preview?.(block.value);return typeof value==='string'&&/^(?:data:image\/(?:png|jpeg|webp|gif);base64,|blob:)/i.test(value)?value:undefined})
const actions=computed(()=>[
  {id:'open',label:'打开来源',icon:'arrow-up-right-from-square',disabled:block.value.source.kind==='text'},
  {id:'edit',label:'编辑说明或摘录',icon:'pen-to-square',disabled:!writable.value},
  {id:'range',label:'修改范围或更换来源…',icon:'sliders',disabled:!writable.value||block.value.source.kind==='text'&&!/^(skill|plugin):/.test(block.value.source.identity)},
  {id:'refresh',label:'刷新来源…',icon:'arrow-rotate-right',disabled:block.value.source.kind==='text'&&!/^(skill|plugin):/.test(block.value.source.identity)||!props.editor.isEditable},
  {id:'copy',label:'复制上下文块',icon:'copy',disabled:false,separator:true},
  ...(block.value.mode==='excerpt'?[{id:'format',label:props.node.firstChild?.type.name==='codeBlock'?'将摘录转为普通段落':'将摘录转为代码片段',icon:'code',disabled:!writable.value}]:[]),
  {id:'up',label:'向上移动',icon:'arrow-up',disabled:!writable.value||!canMove(-1)},
  {id:'down',label:'向下移动',icon:'arrow-down',disabled:!writable.value||!canMove(1)},
  {id:'plain',label:'转换为普通文字（移除来源关联）',icon:'align-left',disabled:!writable.value,separator:true},
  {id:'remove',label:'移除上下文块',icon:'xmark',disabled:!writable.value},
])
function rename(event:Event){if(props.editor.isEditable)props.updateAttributes({block:{...block.value,label:(event.target as HTMLInputElement).value}})}
function titleEnter(event:KeyboardEvent){if(event.isComposing||event.keyCode===229)return;event.preventDefault();editContent()}
function editContent(){const pos=props.getPos();if(typeof pos==='number'){void popover.value?.open();props.editor.chain().focus().setTextSelection(pos+2).run()}}
function closed(){const pos=props.getPos(),{state,view}=props.editor;if(typeof pos!=='number'||state.selection.from<=pos||state.selection.to>=pos+props.node.nodeSize)return;const end=pos+props.node.nodeSize,selection=end<state.doc.content.size?TextSelection.near(state.doc.resolve(end),1):NodeSelection.create(state.doc,pos);view.dispatch(state.tr.setSelection(selection).setMeta('addToHistory',false))}
function signal(action:string){props.editor.view.dom.dispatchEvent(new CustomEvent('composer-context-action',{bubbles:true,detail:{action,block:JSON.parse(JSON.stringify(block.value))}}))}
function canMove(direction:number){const pos=props.getPos();if(typeof pos!=='number')return false;const at=props.editor.state.doc.resolve(pos);return direction<0?at.index()>0:at.index()<at.parent.childCount-1}
function act(action:string){
  if(action==='open'||action==='range'||action==='refresh'){signal(action);return}
  if(action==='edit'){editContent();return}
  const pos=props.getPos();if(typeof pos!=='number')return
  const {state,view}=props.editor,node=state.doc.nodeAt(pos);if(!node)return
  if(action==='copy'){props.editor.chain().focus().setNodeSelection(pos).run();document.execCommand('copy');return}
  if(!props.editor.isEditable)return
  let tr=state.tr
  if(action==='remove')tr=tr.deleteRange(pos,pos+node.nodeSize)
  else if(action==='format'){
    const text=node.textBetween(0,node.content.size,'\n','\n'),code=node.firstChild?.type.name==='codeBlock'
    const content=code?text.split('\n').map(line=>state.schema.nodes.paragraph!.create(null,line?state.schema.text(line):undefined)):[state.schema.nodes.codeBlock!.create(null,text?state.schema.text(text):undefined)]
    tr=tr.replaceWith(pos,pos+node.nodeSize,node.type.create(node.attrs,content))
  }
  else if(action==='plain'){
    const paragraph=state.schema.nodes.paragraph!,label=block.value.label?paragraph.create(null,state.schema.text(block.value.label)):null
    tr=tr.replaceWith(pos,pos+node.nodeSize,Fragment.fromArray([...(label?[label]:[]),...Array.from({length:node.childCount},(_,index)=>node.child(index))]))
  }else if(action==='up'||action==='down'){
    const direction=action==='up'?-1:1;if(!canMove(direction))return
    const at=state.doc.resolve(pos),neighbor=at.parent.child(at.index()+direction)
    tr=direction<0?tr.replaceWith(pos-neighbor.nodeSize,pos+node.nodeSize,Fragment.fromArray([node,neighbor])):tr.replaceWith(pos,pos+node.nodeSize+neighbor.nodeSize,Fragment.fromArray([neighbor,node]))
  }else return
  if(!tr.doc.childCount)tr=tr.insert(0,state.schema.nodes.paragraph!.create())
  tr=tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos,tr.doc.content.size))))
  view.dispatch(closeHistory(tr));view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory',false));view.focus()
}
</script>
<style>
.composer-context-block{display:inline-flex;max-width:100%;vertical-align:baseline;line-height:1.5}
.composer-context-card .composer-context-label{flex:1;min-width:0;font-size:13px;font-weight:550}
.composer-context-content{font-size:13px;line-height:1.6;min-height:28px;white-space:pre-wrap;overflow-wrap:anywhere}
.composer-context-content p{margin:0 0 5px}.composer-context-content p:last-child{margin-bottom:0}
.composer-richtext .composer-context-content pre{border:0;margin:0;padding:0;background:transparent}
.composer-context-content:has(p:only-child:empty)::before{position:absolute;content:attr(data-placeholder);color:var(--navora-muted,#788695);pointer-events:none}
</style>

