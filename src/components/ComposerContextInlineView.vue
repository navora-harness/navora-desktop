<template>
  <NodeViewWrapper as="span" class="composer-context-inline" :class="{'is-selected':selected,'is-invalid':block.status==='missing'||block.status==='error'}" :data-context-id="block.id" contenteditable="false">
    <button type="button" :title="`${block.label} · ${sourceLabel}，点击查看引用操作`" :aria-label="`引用 ${block.label}`" @mousedown.prevent @click.stop="showMenu"><AppIcon :icon="icon" /><span>{{ block.label || '未命名来源' }}</span><AppIcon v-if="block.status==='missing'||block.status==='error'" icon="circle-exclamation" /></button>
    <SidebarContextMenu ref="menu"><template v-for="item in actions" :key="item.id"><div v-if="item.separator" class="composer-context-menu-separator" role="separator" /><button type="button" role="menuitem" class="sidebar-more-item" :disabled="item.disabled" @click="act(item.id)"><AppIcon :icon="item.icon" /><span>{{ item.label }}</span></button></template></SidebarContextMenu>
    <Teleport to="body"><div v-if="renaming" class="composer-inline-rename-scrim" @pointerdown.self="renaming=false"><form data-browser-chrome-overlay class="composer-inline-rename" role="dialog" aria-modal="true" aria-label="重命名引用" @submit.prevent="rename" @keydown.esc.stop.prevent="renaming=false"><label>显示名称<input ref="nameInput" v-model="name" maxlength="512" @keydown.enter="nameKey" /></label><p>只更改本条引用的名称。</p><div><button type="button" @click="renaming=false">取消</button><button type="submit" :disabled="!name.trim()">保存</button></div></form></div></Teleport>
  </NodeViewWrapper>
</template>
<script setup lang="ts">
import {computed,nextTick,ref} from 'vue'
import {NodeViewWrapper,nodeViewProps} from '@tiptap/vue-3'
import {closeHistory} from '@tiptap/pm/history'
import type {ComposerContextBlock} from '@shared/composer-document'
import SidebarContextMenu from './sidebar/SidebarContextMenu.vue'
import AppIcon from './icons/AppIcon.vue'
const props=defineProps(nodeViewProps),menu=ref<InstanceType<typeof SidebarContextMenu>>(),renaming=ref(false),name=ref(''),nameInput=ref<HTMLInputElement>()
const block=computed(()=>props.node.attrs.block as ComposerContextBlock)
const icon=computed(()=>({file:'file-lines',image:'image',page:'globe',url:'link',session:'browser',annotation:'annotate',message:'comments',text:'align-left'}[block.value.source.kind]))
const sourceLabel=computed(()=>block.value.source.path||block.value.source.url||({session:'浏览器会话',message:'历史消息',annotation:'网页批注',text:'文字',file:'对话文件',image:'图片',page:'浏览器页面',url:'网址'}[block.value.source.kind]))
const actions=computed(()=>[
  {id:'open',label:'查看来源',icon:'arrow-up-right-from-square',disabled:false},
  {id:'rename',label:'重命名此引用…',icon:'pen-to-square',disabled:!props.editor.isEditable},
  {id:'range',label:'更换来源或范围…',icon:'sliders',disabled:!props.editor.isEditable},
  {id:'excerpt',label:'转为可编辑摘录…',icon:'align-left',disabled:!props.editor.isEditable||['image','session'].includes(block.value.source.kind)},
  {id:'copy',label:'复制引用',icon:'copy',disabled:false,separator:true},
  {id:'plain',label:'转为普通文字',icon:'align-left',disabled:!props.editor.isEditable},
  {id:'remove',label:'移除此引用',icon:'xmark',disabled:!props.editor.isEditable},
])
function showMenu(event:MouseEvent){menu.value?.show(event)}
function signal(action:string,value=block.value){props.editor.view.dom.dispatchEvent(new CustomEvent('composer-context-action',{bubbles:true,detail:{action,block:JSON.parse(JSON.stringify(value))}}))}
function nameKey(event:KeyboardEvent){if(event.isComposing||event.keyCode===229)event.preventDefault()}
function rename(){if(!name.value.trim()||!props.editor.isEditable)return;props.updateAttributes({block:{...block.value,label:name.value.trim()}});renaming.value=false;props.editor.commands.focus()}
function act(action:string){
  if(action==='open'||action==='range'){signal(action);return}
  if(action==='excerpt'){signal('range',{...block.value,mode:'excerpt'});return}
  const pos=props.getPos();if(typeof pos!=='number')return
  if(action==='copy'){props.editor.chain().focus().setNodeSelection(pos).run();document.execCommand('copy');return}
  if(!props.editor.isEditable)return
  if(action==='rename'){name.value=block.value.label;renaming.value=true;void nextTick(()=>nameInput.value?.focus());return}
  const {state,view}=props.editor
  const tr=action==='plain'?state.tr.replaceWith(pos,pos+props.node.nodeSize,state.schema.text(block.value.label||'来源')):action==='remove'?state.tr.delete(pos,pos+props.node.nodeSize):null
  if(tr){view.dispatch(closeHistory(tr));view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory',false));view.focus()}
}
</script>
<style>
.composer-context-inline{display:inline-flex;vertical-align:baseline;max-width:min(250px,100%);margin:0 2px;white-space:nowrap;line-height:1.5}
.composer-context-inline>button{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:1px 6px;border:1px solid var(--navora-stroke);border-radius:5px;background:var(--control-selected);color:var(--navora-accent);font:inherit;font-size:12px;vertical-align:baseline}
.composer-context-inline>button>span{overflow:hidden;text-overflow:ellipsis}.composer-context-inline svg{width:13px;height:13px;flex-shrink:0}.composer-context-inline.is-invalid>button{border-color:var(--control-danger);color:var(--control-danger)}
.composer-inline-rename-scrim{position:fixed;inset:0;z-index:12002;display:grid;place-items:center;padding:12px;background:#0002}.composer-inline-rename{width:min(340px,100%);padding:18px;border:1px solid var(--navora-stroke);border-radius:12px;background:var(--navora-surface);color:var(--navora-ink);font-size:13px;box-shadow:0 8px 30px #0002}.composer-inline-rename input{display:block;width:100%;margin-top:8px;padding:8px;border:1px solid var(--navora-stroke);border-radius:6px;color:inherit;background:var(--appearance-well)}.composer-inline-rename p{font-size:12px;color:var(--navora-muted);margin:10px 0}.composer-inline-rename>div{display:flex;justify-content:flex-end;gap:10px}.composer-inline-rename button{padding:6px 12px;border:1px solid var(--navora-stroke);border-radius:6px}
</style>
