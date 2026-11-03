<template>
  <NodeViewWrapper class="composer-context-block" :class="{'is-selected':selected,'is-collapsed':node.attrs.collapsed,'is-invalid':block.status==='missing'||block.status==='error'}" :data-context-id="block.id">
    <div class="composer-context-head" contenteditable="false">
      <button type="button" class="composer-context-drag" data-drag-handle :draggable="writable" :disabled="!writable" aria-label="拖动上下文块" title="拖动上下文块"><AppIcon icon="bars" /></button>
      <AppIcon :icon="icon" />
      <input :value="block.label" class="composer-context-label" aria-label="上下文显示名称" :readonly="!writable" maxlength="512" @input="rename" @keydown.enter="titleEnter" />
      <span v-if="stateLabel" class="composer-context-status">{{ stateLabel }}</span>
      <button type="button" class="composer-context-action" :disabled="!writable" :aria-label="node.attrs.collapsed?'展开上下文':'折叠上下文'" @mousedown.prevent @click="toggleCollapsed"><AppIcon :icon="node.attrs.collapsed?'chevron-right':'chevron-down'" /></button>
      <button type="button" class="composer-context-action" aria-label="上下文操作" title="上下文操作" @mousedown.prevent @click="showMenu"><AppIcon icon="ellipsis" /></button>
    </div>
    <div class="composer-context-source" contenteditable="false"><span>{{ sourceSummary }}</span><span>{{ block.mode==='excerpt'?'可编辑摘录':'引用原资源' }}{{ rangeLabel }}</span></div>
    <img v-if="preview&&!node.attrs.collapsed" class="composer-context-preview" :src="preview" :alt="block.label" contenteditable="false" draggable="false" />
    <NodeViewContent v-show="!node.attrs.collapsed" class="composer-context-content" :data-placeholder="block.mode==='excerpt'?'编辑这段摘录…':'添加使用说明…'" />
    <SidebarContextMenu ref="menu"><template v-for="item in actions" :key="item.id"><div v-if="item.separator" class="composer-context-menu-separator" role="separator" /><button type="button" role="menuitem" class="sidebar-more-item" :disabled="item.disabled" @click="act(item.id)"><AppIcon :icon="item.icon" /><span>{{ item.label }}</span></button></template></SidebarContextMenu>
  </NodeViewWrapper>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref} from 'vue'
import {NodeViewContent,NodeViewWrapper,nodeViewProps} from '@tiptap/vue-3'
import {Fragment} from '@tiptap/pm/model'
import {TextSelection} from '@tiptap/pm/state'
import {closeHistory} from '@tiptap/pm/history'
import type {ComposerContextBlock} from '@shared/composer-document'
import SidebarContextMenu from './sidebar/SidebarContextMenu.vue'
import AppIcon from './icons/AppIcon.vue'
const props=defineProps(nodeViewProps),menu=ref<InstanceType<typeof SidebarContextMenu>>()
const editVersion=ref(0),writable=computed(()=>{void editVersion.value;return props.editor.isEditable})
function editStateChanged(){editVersion.value++}
onMounted(()=>props.editor.on('update',editStateChanged))
onBeforeUnmount(()=>props.editor.off('update',editStateChanged))
const block=computed(()=>props.node.attrs.block as ComposerContextBlock)
const preview=computed(()=>{const value=props.extension.options.preview?.(block.value);return typeof value==='string'&&/^(?:data:image\/(?:png|jpeg|webp|gif);base64,|blob:)/i.test(value)?value:undefined})
const icon=computed(()=>({file:'file-lines',image:'image',page:'globe',url:'link',session:'browser',annotation:'annotate',message:'comments',text:'align-left'}[block.value.source.kind]))
const stateLabel=computed(()=>({loading:'正在提取',missing:'来源已失效',stale:'来源已变化',error:'提取失败',ready:''}[block.value.status||'ready']))
const sourceSummary=computed(()=>{const source=block.value.source;if(source.identity.startsWith('skill:'))return '技能说明资料副本';if(source.identity.startsWith('plugin:'))return '插件说明资料副本';if(source.path)return source.path;if(source.url)try{return new URL(source.url).host}catch{return source.url}return {session:'浏览器会话',message:'历史消息',annotation:'网页批注',text:'手工摘录',file:'对话文件',image:'图片',page:'浏览器页面',url:'网址'}[source.kind]})
const rangeLabel=computed(()=>{const range=block.value.range;if(range?.startLine)return ` · 第 ${range.startLine}${range.endLine&&range.endLine!==range.startLine?`–${range.endLine}`:''} 行`;if(range?.pageStart)return ` · 第 ${range.pageStart}${range.pageEnd?`–${range.pageEnd}`:''} 页`;return ''})
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
function toggleCollapsed(){if(!writable.value)return;const {view}=props.editor;view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory',false));props.updateAttributes({collapsed:!props.node.attrs.collapsed});view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory',false))}
function editContent(){const pos=props.getPos();if(typeof pos==='number'){if(props.node.attrs.collapsed&&writable.value)toggleCollapsed();props.editor.chain().focus().setTextSelection(pos+2).run()}}
function showMenu(event:MouseEvent){event.preventDefault();event.stopPropagation();menu.value?.show(event)}
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
.composer-context-block{margin:9px 0;border:1px solid var(--navora-stroke,#dbe1e9);border-radius:10px;background:var(--appearance-well,#f8f9fb);overflow:hidden}
.composer-context-block.is-selected{border-color:var(--appearance-composer-edge,#a8bdd6)}
.composer-context-block.is-invalid{border-color:var(--control-danger,#b65045)}
.composer-context-head{display:flex;align-items:center;gap:7px;padding:7px 8px 2px;color:var(--navora-ink,#263b55)}
.composer-context-head>.app-icon{width:16px;height:16px;flex:0 0 16px;color:var(--navora-muted,#788695)}
.composer-context-label{flex:1;min-width:0;padding:1px 0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:550}
.composer-context-label:focus{box-shadow:0 1px var(--navora-accent,#3269ac)}
.composer-context-action,.composer-context-drag{display:grid;place-items:center;flex:0 0 24px;width:24px;height:24px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--navora-muted,#788695);cursor:default}
.composer-context-action>.app-icon,.composer-context-drag>.app-icon{width:15px;height:15px}
.composer-context-action:hover,.composer-context-drag:hover{background:var(--control-hover,#eaf0f6)}
.composer-context-status{font-size:11px;color:var(--navora-muted,#788695);white-space:nowrap}
.composer-context-source{display:flex;gap:10px;justify-content:space-between;padding:0 12px 7px 47px;color:var(--navora-muted,#788695);font-size:11px;line-height:1.5}
.composer-context-source>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.composer-context-source>span:last-child{flex:0 0 auto}
.composer-context-content{padding:8px 12px;border-top:1px solid var(--navora-stroke,#dbe1e9);font-size:13px;line-height:1.6}
.composer-context-content p{margin:0 0 5px}.composer-context-content p:last-child{margin-bottom:0}
.composer-richtext .composer-context-content pre{border:0;margin:0;padding:0;background:transparent}
.composer-context-preview{display:block;max-width:calc(100% - 24px);max-height:160px;object-fit:contain;margin:0 12px 8px;border-radius:6px}
.composer-context-content:has(p:only-child:empty)::before{position:absolute;content:attr(data-placeholder);color:var(--navora-muted,#788695);pointer-events:none}
.composer-context-menu-separator{height:1px;margin:5px 4px;background:var(--navora-stroke,#dbe1e9)}
</style>

