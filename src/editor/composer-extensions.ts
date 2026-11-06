import {Node} from '@tiptap/core'
import {Plugin} from '@tiptap/pm/state'
import {VueNodeViewRenderer} from '@tiptap/vue-3'
import ComposerContextBlockView from '@/components/ComposerContextBlockView.vue'
import ComposerContextInlineView from '@/components/ComposerContextInlineView.vue'
import type {ComposerContextBlock} from '@shared/composer-document'

export const ComposerContextBlockNode=Node.create<{preview:(block:ComposerContextBlock)=>string|undefined}>({
  name:'contextBlock',group:'block',content:'(paragraph|codeBlock)+',defining:true,isolating:true,draggable:true,
  addAttributes(){return {block:{default:null,rendered:false},collapsed:{default:false,rendered:false}}},
  addOptions(){return {preview:()=>undefined}},
  parseHTML(){return []},
  // Source identities travel only in the validated JSON clipboard format. HTML
  // exports retain readable content, never an executable resource reference.
  renderHTML({node}){return ['section',{'class':'composer-context-export'},['p',{},String(node.attrs.block?.label||'上下文')],['div',{},0]]},
  addNodeView(){return VueNodeViewRenderer(ComposerContextBlockView,{selectedOnTextSelection:true})},
  addProseMirrorPlugins(){return [new Plugin({appendTransaction(transactions,_old,state){
    if(!transactions.some(transaction=>transaction.docChanged))return null
    const ids=new Set<string>(),tr=state.tr
    state.doc.descendants((node,pos)=>{
      if(node.type.name!=='contextBlock'&&node.type.name!=='contextInline')return
      const block=node.attrs.block
      if(!block||typeof block!=='object')return
      if(typeof block.id!=='string'||ids.has(block.id))tr.setNodeMarkup(pos,undefined,{...node.attrs,block:{...block,id:crypto.randomUUID()}})
      ids.add(String(tr.doc.nodeAt(pos)?.attrs.block?.id||block.id))
    })
    return tr.docChanged?tr:null
  }})]},
})

export const ComposerContextInlineNode=Node.create<{preview:(block:ComposerContextBlock)=>string|undefined}>({
  name:'contextInline',group:'inline',inline:true,atom:true,selectable:true,
  addAttributes(){return {block:{default:null,rendered:false}}},
  addOptions(){return {preview:()=>undefined}},
  parseHTML(){return []},
  renderHTML({node}){return ['span',{'class':'composer-context-inline-export'},String(node.attrs.block?.label||'来源')]},
  addNodeView(){return VueNodeViewRenderer(ComposerContextInlineView)},
})
