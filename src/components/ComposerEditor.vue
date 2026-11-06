<template>
  <div ref="root" class="composer-document-editor" :class="{'is-disabled':disabled,'is-readonly':readonly}" data-composer-editor data-ctx-menu="composer" @focusin="markActive" @keydown.capture="containerKey" @composer-context-action="contextAction">
    <p v-if="modelUnsupported" class="composer-document-unreadable" role="alert">此文档格式暂不支持，原始内容已保留。请使用兼容版本恢复编辑。</p>
    <div v-if="declarationItems.length" class="composer-task-declarations" aria-label="本条任务声明"><div v-for="item in declarationItems" :key="item.id" class="composer-task-declaration"><button type="button" class="composer-task-meaning" :title="item.description" :aria-expanded="selectedDeclarationDetail===item.id" @click="selectedDeclarationDetail=selectedDeclarationDetail===item.id?null:item.id" @keydown.esc.stop.prevent="selectedDeclarationDetail=null"><AppIcon :icon="item.icon" />本条：{{ item.label }}</button><button type="button" :disabled="disabled||readonly" :aria-label="`移除${item.label}声明`" @click="toggleDeclaration(item.id)"><AppIcon icon="xmark" /></button></div></div>
    <p v-if="declarationDetail" class="composer-task-meaning-text" role="status">{{ declarationDetail.description }}</p>
    <p v-if="!declarationsSupported" class="composer-document-unreadable" role="alert">此任务声明暂不支持，内容已保留，发送前请使用兼容版本处理。</p>
    <EditorContent :editor="editor||undefined" />
    <ComposerSelectionToolbar v-if="editor" :key="editorGeneration" ref="selectionToolbar" :editor="editor" :blocked="disabled||readonly||linkOpen||textMenu?.open" @link="saveSelection();openLinkEditor()" @notify="emit('notify',$event)" />
    <SidebarContextMenu ref="textMenu"><template v-for="item in contextActions" :key="item.id"><div v-if="item.separator" class="composer-editor-menu-separator" role="separator" /><button type="button" role="menuitem" class="sidebar-more-item" :disabled="!item.enabled" @click.stop="menuCommand(item.id)"><AppIcon :icon="item.icon" /><span>{{ item.label }}</span><span v-if="item.shortcut" class="composer-editor-menu-shortcut">{{ item.shortcut }}</span></button></template></SidebarContextMenu>
    <Teleport to="body">
      <template v-if="linkOpen">
        <div class="composer-link-scrim" @pointerdown="cancelLink" />
        <form ref="linkPanel" popover="manual" data-browser-chrome-overlay class="sidebar-ctx-panel composer-link-panel" :style="{left:`${linkPosition.x}px`,top:`${linkPosition.y}px`,maxWidth:`${linkWidth}px`,maxHeight:`${linkHeight}px`}" role="dialog" aria-modal="true" aria-label="编辑文本链接" @submit.prevent="saveLink" @keydown.esc.stop.prevent="cancelLink" @keydown="linkKey" @compositionstart="linkComposing=true" @compositionend="finishLinkComposition">
          <label>显示文字<textarea ref="linkTextInput" v-model="linkText" rows="2" maxlength="20000" /></label>
          <label>链接地址<input ref="linkInput" v-model="linkUrl" type="text" autocomplete="off" placeholder="https://example.com" @input="linkError=''" /></label>
          <p v-if="linkError" class="composer-link-error" role="alert">{{ linkError }}</p>
          <p v-else class="composer-link-hint">普通单击编辑文字，Ctrl / ⌘ 单击打开链接。</p>
          <div class="composer-link-actions"><button v-if="linkExisting" type="button" class="composer-link-remove" @click="removePanelLink">移除链接</button><span /><button type="button" @click="cancelLink">取消</button><button type="submit" class="primary">保存</button></div>
        </form>
      </template>
    </Teleport>
  </div>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,shallowRef,watch} from 'vue'
import {Editor,EditorContent} from '@tiptap/vue-3'
import {getMarkRange,type JSONContent} from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Document from '@tiptap/extension-document'
import {normalizeTaskDeclarations,taskDeclarationsSupported,taskDeclarationDefinitions,type TaskDeclarationId} from '@shared/task-declarations'
import {composerDocumentContentIdentity} from '@shared/composer-document'
import {DOMSerializer,Slice,type Node as ProseMirrorNode} from '@tiptap/pm/model'
import {TextSelection,type Transaction} from '@tiptap/pm/state'
import {closeHistory} from '@tiptap/pm/history'
import DOMPurify from 'dompurify'
import {normalizeComposerDocument,createComposerDocument,composerLinkUrl,type ComposerContextBlock,type ComposerDocument,type ComposerNode} from '@shared/composer-document'
import {ComposerContextBlockNode,ComposerContextInlineNode} from '@/editor/composer-extensions'
import {activateComposerEditor,registerComposerEditor,type ComposerEditorCommand,type ComposerEditorHandle,type ComposerSelectionBookmark} from '@/editor/composer-editor-registry'
import SidebarContextMenu from './sidebar/SidebarContextMenu.vue'
import AppIcon from './icons/AppIcon.vue'
import ComposerSelectionToolbar from './ComposerSelectionToolbar.vue'
import {editableCut,editableDeleteSelection,editablePaste,editableSelectAll,copyTextToClipboard} from '@/utils/editable-context'
import {composerOverlayBoundary,composerOverlayBounds} from '@/utils/composer-overlay'

const props=withDefaults(defineProps<{modelValue:ComposerDocument;chatId?:string;placeholder?:string;disabled?:boolean;readonly?:boolean;submitOnEnter?:boolean;contextPreviews?:Record<string,string>}>(),{placeholder:'描述任务，输入 / 附加内容或使用工具…',disabled:false,readonly:false,submitOnEnter:true})
const emit=defineEmits<{'update:modelValue':[document:ComposerDocument];submit:[];attach:[request?:{source?:string;files?:File[]}];'open-source':[block:ComposerContextBlock];'refresh-source':[block:ComposerContextBlock];'change-source':[block:ComposerContextBlock];notify:[message:string]}>()
const root=ref<HTMLElement>(),editor=shallowRef<Editor|null>(null),textMenu=ref<InstanceType<typeof SidebarContextMenu>>()
const selectionToolbar=ref<InstanceType<typeof ComposerSelectionToolbar>>(),editorGeneration=ref(0),modelUnsupported=ref(false)
const metadata=ref(props.modelValue),linkOpen=ref(false),linkText=ref(''),linkUrl=ref(''),linkError=ref(''),linkExisting=ref(false),linkPosition=ref({x:8,y:8}),linkInput=ref<HTMLInputElement>(),linkTextInput=ref<HTMLTextAreaElement>()
const linkPanel=ref<HTMLElement>()
const linkWidth=ref(360),linkHeight=ref(300)
const transactionVersion=ref(0),bookmarks=new Set<ComposerSelectionBookmark>()
let saved:ComposerSelectionBookmark|null=null,linkBookmark:ComposerSelectionBookmark|null=null,unregister:(()=>void)|undefined,mounted=false,applying=false,lastContent=''
let linkComposing=false,compositionTimer:ReturnType<typeof setTimeout>|undefined
let linkResize:ResizeObserver|undefined
let composing=false,compositionGuard:ReturnType<typeof setTimeout>|undefined,slashTrigger:ComposerSelectionBookmark|null=null
const DeclarationDocument=Document.extend({addAttributes(){return {taskDeclarations:{default:null,rendered:false}}}})
const selectedDeclarationDetail=ref<TaskDeclarationId|null>(null)
const declarationDetail=computed(()=>declarationItems.value.find(item=>item.id===selectedDeclarationDetail.value))
const declarationsSupported=computed(()=>taskDeclarationsSupported(metadata.value.declarations))
const declarationItems=computed(()=>{try{return taskDeclarationDefinitions.filter(item=>normalizeTaskDeclarations(metadata.value.declarations).ids.includes(item.id))}catch{return []}})
const owner=()=>props.chatId||props.modelValue.chatId
const editable=()=>!!editor.value?.isEditable&&!props.disabled&&!props.readonly&&!modelUnsupported.value
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T
function normalized(content:ComposerNode[],base=metadata.value){return normalizeComposerDocument({...base,chatId:owner(),content},owner())}
function currentContent(){return normalized((editor.value?.getJSON().content||[{type:'paragraph'}]) as ComposerNode[]).content}
function markActive(){activateComposerEditor(handle)}
function saveSelection():ComposerSelectionBookmark|null{
  const current=editor.value;if(!current)return null
  const selection=current.state.selection,record:ComposerSelectionBookmark={documentId:metadata.value.id,chatId:owner(),revision:metadata.value.revision,from:selection.from,to:selection.to,bookmark:selection.getBookmark(),valid:true}
  const label=document.activeElement
  if(label instanceof HTMLInputElement&&root.value?.contains(label)&&label.classList.contains('composer-context-label')){
    record.label={element:label,start:label.selectionStart||0,end:label.selectionEnd||0}
    const id=label.closest<HTMLElement>('[data-context-id]')?.dataset.contextId,context=id?findContext(id):undefined
    if(context){const inside=TextSelection.create(current.state.doc,context.pos+2);record.bookmark=inside.getBookmark();record.from=inside.from;record.to=inside.to}
  }
  bookmarks.add(record);saved=record
  while(bookmarks.size>40){const first=bookmarks.values().next().value as ComposerSelectionBookmark|undefined;if(first){first.valid=false;bookmarks.delete(first)}}
  return record
}
function resolveBookmark(record:ComposerSelectionBookmark|null|undefined){
  const current=editor.value;if(!current||!record||!record.valid||record.chatId!==owner()||record.documentId!==metadata.value.id)return null
  try{return record.bookmark.resolve(current.state.doc)}catch{record.valid=false;return null}
}
function restoreSelection(record:ComposerSelectionBookmark|null=saved){const selection=resolveBookmark(record);if(!selection||!editor.value)return false;saved=record;editor.value.view.dispatch(editor.value.state.tr.setSelection(selection));if(record?.label?.element.isConnected){const label=record.label;label.element.focus();label.element.setSelectionRange(Math.min(label.start,label.element.value.length),Math.min(label.end,label.element.value.length))}else editor.value.view.focus();return true}
function mapBookmarks(transaction:Transaction){
  if(!transaction.docChanged)return
  for(const record of bookmarks){
    if(!record.valid)continue
    const from=transaction.mapping.mapResult(record.from,1),to=transaction.mapping.mapResult(record.to,-1)
    if(record.from!==record.to&&(from.pos>=to.pos||from.deletedAcross&&to.deletedAcross)){record.valid=false;continue}
    record.bookmark=record.bookmark.map(transaction.mapping);record.from=from.pos;record.to=to.pos;record.revision=metadata.value.revision+1
  }
}
function dispatchUnit(transaction:Transaction){const current=editor.value;if(!current||!editable())return false;current.view.dispatch(closeHistory(transaction));current.view.dispatch(closeHistory(current.state.tr).setMeta('addToHistory',false));current.view.focus();return true}
function focus(){editor.value?.commands.focus()}
function select(){editor.value?.chain().focus().selectAll().run();saveSelection()}
function getTextSelection(){const current=editor.value;if(!current)return {from:0,to:0,text:'',empty:true};const selection=resolveBookmark(saved)||current.state.selection;return {from:selection.from,to:selection.to,text:current.state.doc.textBetween(selection.from,selection.to,'\n','\n'),empty:selection.empty}}
function replaceRange(from:number,to:number,text:string){const current=editor.value;if(!current||!editable()||from<0||to<from||to>current.state.doc.content.size)return false;return dispatchUnit(current.state.tr.insertText(text,from,to))}
function textOffsetPosition(offset:number){
  const current=editor.value;if(!current)return 0
  let consumed=0,result=current.state.doc.content.size,found=false,first=true
  current.state.doc.descendants((node,pos)=>{if(found)return false;if(node.isTextblock){if(!first)consumed++;first=false}if(node.isText&&typeof node.text==='string'){if(consumed+node.text.length>=offset){result=pos+Math.max(0,offset-consumed);found=true;return false}consumed+=node.text.length}if(node.type.name==='hardBreak')consumed++;return true})
  return result
}
function replaceTextRange(from:number,to:number,text:string){return replaceRange(textOffsetPosition(from),textOffsetPosition(to),text)}
function insertText(text:string){const current=editor.value;if(!current||!editable())return false;const selection=resolveBookmark(saved)||current.state.selection;return replaceRange(selection.from,selection.to,text)}
function paragraphs(text=''):JSONContent[]{return text.split('\n').map(line=>({type:'paragraph',...(line?{content:[{type:'text',text:line}]}:{})}))}
function findContext(id:string){let result:{pos:number;node:ProseMirrorNode}|undefined;editor.value?.state.doc.descendants((node,pos)=>{if((node.type.name==='contextBlock'||node.type.name==='contextInline')&&node.attrs.block?.id===id){result={node,pos};return false}return !result});return result}
function insertContext(block:ComposerContextBlock,text=''){
  const current=editor.value;if(!current||!editable())return false
  if(saved&&!restoreSelection(saved)){emit('notify','插入位置已变化，请重新选择附加位置。');return false}
  if(block.mode==='reference'&&!text){
    try{const node={type:'contextInline',attrs:{block:clone(block)}};normalized([{type:'paragraph',content:[node]}]);const selection=current.state.selection;let position=selection.to,inside=false
      for(let depth=selection.$to.depth;depth>0;depth--)if(selection.$to.node(depth).type.name==='contextBlock'||selection.$to.node(depth).type.name==='codeBlock'){position=selection.$to.after(depth);inside=true;break}
      const content=inside?[{type:'paragraph',content:[node,...(text?[{type:'text',text:' '+text}]:[])]}]:[node,...(text?[{type:'text',text:' '+text}]:[])]
      current.view.dispatch(closeHistory(current.state.tr).setMeta('addToHistory',false));const result=current.chain().focus().setTextSelection(position).insertContent(content).run();current.view.dispatch(closeHistory(current.state.tr).setMeta('addToHistory',false));saved=null;return result
    }catch{emit('notify','无法插入此引用，请重新选择来源。');return false}
  }
  const node={type:'contextBlock',attrs:{block:clone(block),collapsed:true},content:paragraphs(text)}
  try{normalized([node as ComposerNode]);const selection=current.state.selection;let position=selection.to
    // A source is a whole block. Attaching from its editable body inserts after
    // it instead of nesting a source or replacing the selected user text.
    for(let depth=selection.$to.depth;depth>0;depth--)if(selection.$to.node(depth).type.name==='contextBlock'){position=selection.$to.after(depth);break}
    current.view.dispatch(closeHistory(current.state.tr).setMeta('addToHistory',false));const inserted=current.chain().focus().setTextSelection(position).insertContent([node,{type:'paragraph'}]).run();current.view.dispatch(closeHistory(current.state.tr).setMeta('addToHistory',false));saved=null;return inserted
  }catch{emit('notify','无法加入这份上下文，请重新选择来源。');return false}
}
function updateContext(id:string,patch:{block?:ComposerContextBlock;text?:string}){
  const current=editor.value,found=findContext(id);if(!current||!found||!editable())return false
  if(found.node.type.name==='contextInline'||patch.block?.mode==='reference'){
    try{const block=patch.block?{...clone(patch.block),id}:found.node.attrs.block as ComposerContextBlock
      const text=patch.text??found.node.textContent
      if(block.mode==='reference'&&!text){
        const inline=current.schema.nodes.contextInline!.create({block}),node=found.node.type.name==='contextInline'?inline:current.schema.nodes.paragraph!.create(null,[inline,...(patch.text?[current.schema.text(' '+patch.text)]:[])])
        normalized([{type:'paragraph',content:[{type:'contextInline',attrs:{block}}]}]);return dispatchUnit(current.state.tr.replaceWith(found.pos,found.pos+found.node.nodeSize,node))
      }
      const node={type:'contextBlock',attrs:{block,collapsed:true},content:paragraphs(text)};normalized([node as ComposerNode]);current.view.dispatch(closeHistory(current.state.tr).setMeta('addToHistory',false));const ok=current.chain().focus().setTextSelection({from:found.pos,to:found.pos+found.node.nodeSize}).insertContent([node,{type:'paragraph'}]).run();current.view.dispatch(closeHistory(current.state.tr).setMeta('addToHistory',false));saved=null;return ok
    }catch{emit('notify','来源已改变，请重新选择。');return false}
  }
  try{const block=patch.block?{...clone(patch.block),id}:found.node.attrs.block;normalized([{type:'contextBlock',attrs:{block},content:paragraphs(patch.text??found.node.textContent)} as ComposerNode]);let tr=current.state.tr
    if(patch.text!==undefined){const body=found.node.firstChild?.type.name==='codeBlock'?[current.schema.nodes.codeBlock!.create(found.node.firstChild.attrs,patch.text?current.schema.text(patch.text):undefined)]:paragraphs(patch.text).map(item=>current.schema.nodeFromJSON(item));const next=current.schema.nodes.contextBlock!.create({...found.node.attrs,block},body);tr=tr.replaceWith(found.pos,found.pos+found.node.nodeSize,next)}else tr=tr.setNodeMarkup(found.pos,undefined,{...found.node.attrs,block})
    return dispatchUnit(tr)
  }catch{emit('notify','上下文已改变，请重新选择来源。');return false}
}
function selectionInfo(){
  const current=editor.value;if(!current)return {canAdd:false,canEdit:false,hasLink:false,range:undefined as {from:number;to:number}|undefined,href:''}
  const selection=resolveBookmark(saved)||current.state.selection,{from,to,$from,$to}=selection,type=current.schema.marks.link
  const range=type?getMarkRange($from,type):undefined
  const single=range&&range.from<=from&&range.to>=to?range:undefined
  let hasLink=false,hasOther=false,hasCode=$from.marks().some(mark=>mark.type.name==='code')
  if(!selection.empty&&type)current.state.doc.nodesBetween(from,to,node=>{if(node.isText){if(node.marks.some(mark=>mark.type.name==='code'))hasCode=true;if(node.marks.some(mark=>mark.type===type))hasLink=true;else hasOther=true}})
  if(selection.empty)hasLink=!!single
  let hasAtom=false;if(!selection.empty)current.state.doc.nodesBetween(from,to,node=>{if(node.type.name==='contextInline')hasAtom=true})
  const ordinary=$from.sameParent($to)&&['paragraph','heading'].includes($from.parent.type.name)&&!hasCode&&!hasAtom
  const href=single?current.state.doc.resolve(single.from).nodeAfter?.marks.find(mark=>mark.type===type)?.attrs.href||'':''
  return {canAdd:ordinary&&!selection.empty&&!hasLink,canEdit:ordinary&&!!single&&!hasOther,hasLink,range:single,href}
}
function canUndo(){return editable()&&!!editor.value?.can().undo()}
function canRedo(){return editable()&&!!editor.value?.can().redo()}
function getCommandState():Record<ComposerEditorCommand,boolean>{const current=editor.value,selection=current&&(resolveBookmark(saved)||current.state.selection),info=selectionInfo(),write=editable(),label=saved?.valid&&saved.label?.element.isConnected?saved.label:undefined,hasSelection=label?label.end>label.start:!!selection&&!selection.empty;return {undo:canUndo(),redo:canRedo(),cut:write&&hasSelection,copy:hasSelection,'copy-link':!label&&!!info.href,paste:write,'paste-plain':write,delete:write&&hasSelection,'select-all':!!current,link:!label&&write&&(info.canAdd||info.canEdit),unlink:!label&&write&&info.hasLink,attach:write}}
const contextActions=computed(()=>{void transactionVersion.value;const state=getCommandState(),info=selectionInfo();return [
  {id:'undo' as const,label:'撤销',icon:'arrow-left',enabled:state.undo,shortcut:'Ctrl+Z'},
  {id:'redo' as const,label:'重做',icon:'arrow-rotate-right',enabled:state.redo,shortcut:'Ctrl+Shift+Z'},
  {id:'cut' as const,label:'剪切',icon:'scissors',enabled:state.cut,shortcut:'Ctrl+X',separator:true},
  {id:'copy' as const,label:'复制',icon:'copy',enabled:state.copy,shortcut:'Ctrl+C'},
  {id:'paste' as const,label:'粘贴',icon:'paste',enabled:state.paste,shortcut:'Ctrl+V'},
  {id:'paste-plain' as const,label:'粘贴为纯文本',icon:'align-left',enabled:state['paste-plain'],shortcut:'Ctrl+Shift+V'},
  {id:'delete' as const,label:'删除选区',icon:'xmark',enabled:state.delete},
  {id:'select-all' as const,label:'全选',icon:'checkbox-checked',enabled:state['select-all'],shortcut:'Ctrl+A'},
  {id:'link' as const,label:info.canEdit?'编辑链接…':'添加链接…',icon:'link',enabled:state.link,separator:true,shortcut:'Ctrl+Shift+K'},
  {id:'unlink' as const,label:getTextSelection().empty?'移除链接':'移除选区链接',icon:'xmark',enabled:state.unlink},
  {id:'copy-link' as const,label:'复制链接地址',icon:'copy',enabled:state['copy-link']},
  {id:'attach' as const,label:'附加…',icon:'paperclip',enabled:state.attach,separator:true},
]})
function openLinkEditor(){
  const current=editor.value;if(!current||!editable())return false
  if(!saved)saveSelection()
  const info=selectionInfo();if(!info.canAdd&&!info.canEdit){emit('notify','请选中一段普通文字，或将光标放到单个链接内。');return false}
  if(info.canEdit&&info.range)current.view.dispatch(current.state.tr.setSelection(TextSelection.create(current.state.doc,info.range.from,info.range.to)))
  else restoreSelection(saved)
  linkBookmark=saveSelection();if(!linkBookmark)return false
  linkText.value=current.state.doc.textBetween(linkBookmark.from,linkBookmark.to,'\n','\n');linkUrl.value=info.href;linkExisting.value=info.canEdit;linkError.value=''
  const bounds=composerOverlayBounds(current.view.dom)
  linkWidth.value=Math.min(360,bounds.width);linkHeight.value=bounds.height
  linkPosition.value={x:bounds.left,y:bounds.top};linkOpen.value=true;textMenu.value?.hide();void nextTick(()=>{linkPanel.value?.showPopover();clampLinkPanel();linkInput.value?.focus({preventScroll:true})});return true
}
function validLink(value:string){const url=composerLinkUrl(value);if(!url||!/^https?:\/\//i.test(url)&&!/^mailto:[^?\s@]+@[^?\s@]+/i.test(url))return null;return url}
function closeLink(restore=true){linkOpen.value=false;if(restore)restoreSelection(linkBookmark);linkBookmark=null;linkError.value=''}
function cancelLink(){closeLink()}
function saveLink(){
  if(linkComposing)return
  const current=editor.value,selection=resolveBookmark(linkBookmark),href=validLink(linkUrl.value)
  if(!current||!selection||!editable()){linkError.value='原选区已经变化，请取消后重新选择。';return}
  if(!href){linkError.value='请输入有效的 HTTP、HTTPS 或邮件地址。';return}
  if(href!==linkUrl.value.trim()&&!/^https?:|^mailto:/i.test(linkUrl.value.trim())){linkUrl.value=href;linkError.value='已补全 HTTPS 地址，请确认后再次保存。';return}
  if(!linkText.value){linkError.value='显示文字不能为空。';return}
  const old=current.state.doc.textBetween(selection.from,selection.to,'\n','\n'),type=current.schema.marks.link!
  let tr=current.state.tr
  if(old===linkText.value)tr=tr.removeMark(selection.from,selection.to,type).addMark(selection.from,selection.to,type.create({href}))
  else{const marks=current.state.doc.resolve(selection.from).nodeAfter?.marks.filter(mark=>mark.type!==type)||[];tr=tr.replaceWith(selection.from,selection.to,current.schema.text(linkText.value,[...marks,type.create({href})]))}
  linkOpen.value=false;dispatchUnit(tr);linkBookmark=null;saved=null
}
function removeLink(){const current=editor.value;if(!current||!editable())return false;const info=selectionInfo(),selection=resolveBookmark(saved)||current.state.selection;if(!info.hasLink)return false;const from=selection.empty?info.range?.from:selection.from,to=selection.empty?info.range?.to:selection.to;if(from===undefined||to===undefined)return false;return dispatchUnit(current.state.tr.removeMark(from,to,current.schema.marks.link))}
function removePanelLink(){if(linkBookmark){saved=linkBookmark;linkOpen.value=false;removeLink();linkBookmark=null;saved=null}}
function linkKey(event:KeyboardEvent){
  if(event.isComposing||event.keyCode===229||linkComposing)return
  if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();event.stopPropagation();saveLink();return}
  if(event.key!=='Tab')return
  const panel=event.currentTarget as HTMLElement,items=[...panel.querySelectorAll<HTMLElement>('input,textarea,button:not(:disabled)')],at=items.indexOf(document.activeElement as HTMLElement)
  if(event.shiftKey&&at===0){event.preventDefault();items.at(-1)?.focus()}else if(!event.shiftKey&&at===items.length-1){event.preventDefault();items[0]?.focus()}
}
function finishLinkComposition(){clearTimeout(compositionTimer);compositionTimer=setTimeout(()=>{linkComposing=false},0)}
function clampLinkPanel(event?:Event){
  const current=editor.value,panel=linkPanel.value,selection=resolveBookmark(linkBookmark)
  if(!linkOpen.value||!current||!panel||!selection||event?.type==='scroll'&&panel.contains(event.target as Node))return
  if(!current.view.dom.checkVisibility()){closeLink(false);return}
  const bounds=composerOverlayBounds(current.view.dom)
  linkWidth.value=Math.min(360,bounds.width);linkHeight.value=bounds.height
  panel.style.maxWidth=`${linkWidth.value}px`;panel.style.maxHeight=`${linkHeight.value}px`
  const rect=panel.getBoundingClientRect(),a=current.view.coordsAtPos(selection.from),b=current.view.coordsAtPos(selection.to),top=Math.min(a.top,b.top),bottom=Math.max(a.bottom,b.bottom)
  const above=top-bounds.top-8,under=bounds.bottom-bottom-8,below=above<rect.height&&under>=rect.height
  linkPosition.value={x:Math.max(bounds.left,Math.min(a.left,bounds.right-rect.width)),y:Math.max(bounds.top,Math.min(below?bottom+8:top-rect.height-8,bounds.bottom-rect.height))}
}
async function executeCommand(command:ComposerEditorCommand){
  const current=editor.value;if(!current||!getCommandState()[command])return false
  const label=saved?.valid&&saved.label?.element.isConnected?saved.label:undefined
  if(label&&!['undo','redo','attach'].includes(command)){
    const target={kind:'input' as const,el:label.element},text=label.element.value.slice(label.start,label.end);textMenu.value?.hide()
    if(command==='copy')return copyTextToClipboard(text)
    if(command==='cut'){editableCut(target,label.start,label.end,text);return true}
    if(command==='paste'||command==='paste-plain')return editablePaste(target,label.start,label.end)
    if(command==='delete'){editableDeleteSelection(target,label.start,label.end);return true}
    if(command==='select-all'){editableSelectAll(target);label.start=0;label.end=label.element.value.length;return true}
    return false
  }
  if(command==='link')return openLinkEditor()
  textMenu.value?.hide()
  if(command==='copy-link')return copyTextToClipboard(selectionInfo().href)
  if(command==='attach'){saveSelection();emit('attach');return true}
  if(command==='select-all'){select();return true}
  if(command==='undo'||command==='redo'){restoreSelection();const result=current.chain().focus()[command]().run();if(label)void nextTick(()=>{if(label.element.isConnected){label.element.focus();label.element.setSelectionRange(Math.min(label.start,label.element.value.length),Math.min(label.end,label.element.value.length))}});return result}
  if(command==='unlink')return removeLink()
  if(command==='copy'||command==='cut'){
    restoreSelection();const ok=document.execCommand('copy');if(!ok)try{await navigator.clipboard.writeText(getTextSelection().text)}catch{emit('notify','无法访问剪贴板。');return false}
    if(editor.value!==current||current.isDestroyed)return false
    if(command==='cut'){const selection=resolveBookmark(saved)||current.state.selection;dispatchUnit(current.state.tr.setSelection(selection).deleteSelection())}
    return true
  }
  if(command==='delete'){restoreSelection();return dispatchUnit(current.state.tr.deleteSelection())}
  try{
    const bookmark=saveSelection(),text=await navigator.clipboard.readText();if(!resolveBookmark(bookmark)){emit('notify','粘贴位置已变化，请重新选择。');return false}
    if(command==='paste'&&navigator.clipboard.read){
      try{for(const item of await navigator.clipboard.read()){
        const custom=item.types.find(type=>type==='web application/x-navora-composer-fragment'||type==='application/x-navora-composer-fragment')
        if(custom){const payload=await (await item.getType(custom)).text();if(!resolveBookmark(bookmark)){emit('notify','粘贴位置已变化，请重新选择。');return false}restoreSelection(bookmark);return pasteFragment(payload,text)}
        if(item.types.includes('text/html')){const html=cleanHtml(await (await item.getType('text/html')).text());if(!resolveBookmark(bookmark)){emit('notify','粘贴位置已变化，请重新选择。');return false}restoreSelection(bookmark);return current.chain().focus().insertContent(html).run()}
      }}catch{/* Plain text remains available when rich clipboard access is unavailable. */}
    }
    if(!resolveBookmark(bookmark)){emit('notify','粘贴位置已变化，请重新选择。');return false}restoreSelection(bookmark);return insertText(text)
  }catch{emit('notify','无法读取剪贴板，请使用系统粘贴快捷键。');return false}
}
function menuCommand(command:ComposerEditorCommand){void executeCommand(command)}
function cleanHtml(html:string){const container=document.createElement('div');container.innerHTML=DOMPurify.sanitize(html,{ALLOWED_TAGS:['p','br','a','blockquote','pre','code','strong','em','b','i','s','del','u','h1','h2','h3','ul','ol','li','hr'],ALLOWED_ATTR:['href','start'],ALLOW_DATA_ATTR:false});for(const anchor of container.querySelectorAll('a')){const url=validLink(anchor.getAttribute('href')||'');if(url)anchor.setAttribute('href',url);else anchor.removeAttribute('href')}return container.innerHTML}
function handlePaste(event:ClipboardEvent){
  if(!editable())return true
  const files=[...event.clipboardData?.files||[]];if(files.length){event.preventDefault();saveSelection();emit('attach',{source:'import',files});return true}
  const payload=event.clipboardData?.getData('application/x-navora-composer-fragment')||event.clipboardData?.getData('web application/x-navora-composer-fragment')
  if(!payload)return false
  event.preventDefault();pasteFragment(payload,event.clipboardData?.getData('text/plain')||'');return true
}
function pasteFragment(payload:string,text:string){
  try{const parsed=JSON.parse(payload) as {chatId:string;slice:Record<string,unknown>};if(parsed.chatId!==owner()){insertText(text);emit('notify','跨对话粘贴已转换为普通文字，请重新选择需要引用的来源。');return true}
    const fragment=clone(parsed.slice),renew=(nodes:ComposerNode[])=>{for(const node of nodes){if((node.type==='contextBlock'||node.type==='contextInline')&&node.attrs?.block){const block=node.attrs.block as ComposerContextBlock;block.id=crypto.randomUUID()}if(node.content)renew(node.content)}};renew((fragment.content||[]) as ComposerNode[])
    const fragmentContent=(fragment.content||[]) as ComposerNode[];normalized(fragmentContent.every(node=>['text','hardBreak','contextInline'].includes(node.type))?[{type:'paragraph',content:fragmentContent}]:fragmentContent)
    const slice=Slice.fromJSON(editor.value!.schema,fragment);return dispatchUnit(editor.value!.state.tr.replaceSelection(slice))
  }catch{return insertText(text)}
}
function plainNode(node:ProseMirrorNode):string{if(node.type.name==='contextInline')return String(node.attrs.block?.label||'来源');if(node.isText)return node.text||'';if(node.type.name==='hardBreak')return '\n';const parts:string[]=[];node.forEach(child=>parts.push(plainNode(child)));const body=parts.join(node.isTextblock?'':'\n');return node.type.name==='contextBlock'?`${String(node.attrs.block?.label||'上下文')}\n${body}`:body}
function handleCopy(event:ClipboardEvent){
  const current=editor.value;if(!current||current.state.selection.empty||!event.clipboardData)return false
  const slice=current.state.selection.content(),container=document.createElement('div'),parts:string[]=[];slice.content.forEach(node=>parts.push(plainNode(node)));container.append(DOMSerializer.fromSchema(current.schema).serializeFragment(slice.content))
  const text=parts.join('\n'),html=container.innerHTML,payload=JSON.stringify({chatId:owner(),slice:slice.toJSON()})
  event.clipboardData.setData('text/plain',text);event.clipboardData.setData('text/html',html);event.clipboardData.setData('application/x-navora-composer-fragment',payload);event.preventDefault()
  // Web custom formats let the explicit Paste menu retain the same structured
  // fragment as Ctrl+V, without reconstructing identities from ordinary HTML.
  if(typeof ClipboardItem!=='undefined'&&ClipboardItem.supports?.('web application/x-navora-composer-fragment'))void navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([text],{type:'text/plain'}),'text/html':new Blob([html],{type:'text/html'}),'web application/x-navora-composer-fragment':new Blob([payload],{type:'application/x-navora-composer-fragment'})})]).catch(()=>{})
  return true
}
function contextAction(event:Event){const detail=(event as CustomEvent<{action:string;block:ComposerContextBlock}>).detail;if(!detail)return;event.stopPropagation();saveSelection();if(detail.action==='open')emit('open-source',detail.block);else if(detail.action==='refresh')emit('refresh-source',detail.block);else if(detail.action==='range')emit('change-source',detail.block)}
function exitContext(id?:string){const current=editor.value;if(!current)return;const selected=id?findContext(id):undefined;let end=selected?selected.pos+selected.node.nodeSize:undefined;if(end===undefined){const at=current.state.selection.$from;for(let depth=at.depth;depth>0;depth--)if(at.node(depth).type.name==='contextBlock'){end=at.after(depth);break}}if(end!==undefined){current.view.dispatch(current.state.tr.setSelection(TextSelection.near(current.state.doc.resolve(Math.min(end,current.state.doc.content.size)),1)));current.view.focus()}}
function containerKey(event:KeyboardEvent){if(!(event.target as Element)?.closest('.composer-context-label'))return;if(event.key==='Escape'){if((event.target as Element).closest('.composer-context-card'))return;event.preventDefault();event.stopPropagation();exitContext((event.target as Element).closest<HTMLElement>('[data-context-id]')?.dataset.contextId);return}if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.isComposing&&(event.key.toLowerCase()==='z'||event.key.toLowerCase()==='y')){event.preventDefault();event.stopPropagation();saveSelection();const command=event.key.toLowerCase()==='y'||event.shiftKey?'redo':'undo';void executeCommand(command)}}
function keyDown(event:KeyboardEvent){
  const current=editor.value;if(!current||event.isComposing||event.keyCode===229||current.view.composing||composing)return false
  if(event.altKey&&event.key==='F10'){if(selectionToolbar.value?.focus()){event.preventDefault();return true}}
  if((event.ctrlKey||event.metaKey)&&event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='k'){event.preventDefault();saveSelection();openLinkEditor();return true}
  if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();saveSelection();textMenu.value?.show(event);return true}
  if(event.key==='Escape'){for(let depth=current.state.selection.$from.depth;depth>0;depth--)if(current.state.selection.$from.node(depth).type.name==='contextBlock'){event.preventDefault();event.stopPropagation();exitContext();return true}}
  if(!editable())return false
  if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&current.state.selection.empty){
    const {$from,from}=current.state.selection,marks=$from.marks(),before=$from.parent.textBetween(0,$from.parentOffset,'','\ufffc')
    if(['paragraph','heading'].includes($from.parent.type.name)&&!marks.some(mark=>mark.type.name==='code'||mark.type.name==='link')&&(!before||/\s$/.test(before))){
      event.preventDefault();current.view.dispatch(current.state.tr.insertText('/',from));const selection=TextSelection.create(current.state.doc,from,from+1)
      slashTrigger={documentId:metadata.value.id,chatId:owner(),revision:metadata.value.revision,from,to:from+1,bookmark:selection.getBookmark(),valid:true};bookmarks.add(slashTrigger);saveSelection();emit('attach');return true
    }
  }
  if(event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.metaKey||!props.submitOnEnter)return false
  for(let depth=current.state.selection.$from.depth;depth>0;depth--){const name=current.state.selection.$from.node(depth).type.name;if(name==='contextBlock'||name==='codeBlock')return false}
  event.preventDefault();emit('submit');return true
}
function createEditor(){
  selectedDeclarationDetail.value=null
  bookmarks.forEach(record=>{record.valid=false});bookmarks.clear();saved=null;linkBookmark=null;linkOpen.value=false;textMenu.value?.hide();editor.value?.destroy()
  try{metadata.value=normalizeComposerDocument(clone(props.modelValue),owner());modelUnsupported.value=false}catch{metadata.value=createComposerDocument(owner());modelUnsupported.value=true}
  lastContent=composerDocumentContentIdentity(metadata.value);slashTrigger=null;editorGeneration.value++
  editor.value=new Editor({content:{type:'doc',attrs:{taskDeclarations:metadata.value.declarations??null},content:metadata.value.content as JSONContent[]},editable:!props.disabled&&!props.readonly&&!modelUnsupported.value,
    extensions:[StarterKit.configure({link:false,document:false}),DeclarationDocument,Link.configure({openOnClick:false,autolink:false,linkOnPaste:false,isAllowedUri:url=>!!validLink(url),HTMLAttributes:{rel:'noopener noreferrer',target:null}}),ComposerContextBlockNode.configure({preview:block=>props.contextPreviews?.[block.id]}),ComposerContextInlineNode.configure({preview:block=>props.contextPreviews?.[block.id]})],
    editorProps:{attributes:{class:'composer-richtext',role:'textbox','aria-multiline':'true','aria-label':'消息编辑器','data-placeholder':props.placeholder},handleKeyDown:(_view,event)=>keyDown(event),transformPastedHTML:cleanHtml,handlePaste:(_view,event)=>handlePaste(event),handleDOMEvents:{
      contextmenu:(_view,event)=>{if((event.target as Element)?.closest('input,textarea,button'))return false;event.preventDefault();saveSelection();textMenu.value?.show(event);return true},
      copy:(_view,event)=>handleCopy(event),
      compositionstart:()=>{composing=true;clearTimeout(compositionGuard);selectionToolbar.value?.close();return false},
      compositionend:()=>{clearTimeout(compositionGuard);compositionGuard=setTimeout(()=>{composing=false},0);return false},
      drop:(_view,event)=>{const files=[...event.dataTransfer?.files||[]];if(!files.length)return false;event.preventDefault();if(!editable())return true;saveSelection();emit('attach',{source:'import',files});return true},
      click:(_view,event)=>{const anchor=(event.target as Element)?.closest<HTMLAnchorElement>('a[href]');if(!anchor||!event.ctrlKey&&!event.metaKey)return false;const url=validLink(anchor.href);event.preventDefault();if(url)void window.navora?.app.openExternal(url);return true},
    }},
    onTransaction:({transaction})=>{mapBookmarks(transaction);transactionVersion.value++},
    onSelectionUpdate:()=>{if(editor.value?.isFocused&&!linkOpen.value&&!textMenu.value?.open)saveSelection();transactionVersion.value++},
    onUpdate:()=>{if(applying||modelUnsupported.value)return;try{const content=currentContent(),declarations=editor.value?.state.doc.attrs.taskDeclarations??undefined,next=normalizeComposerDocument({...metadata.value,content,declarations}),signature=composerDocumentContentIdentity(next);if(signature===lastContent)return;metadata.value={...next,revision:Math.max(metadata.value.revision,props.modelValue.revision)+1,updatedAt:Date.now()};lastContent=signature;emit('update:modelValue',clone(metadata.value))}catch{emit('notify','编辑内容超出可保存范围，请缩小上下文。')}},
  })
}
function consumeAttachmentTrigger(){const record=slashTrigger;slashTrigger=null;const current=editor.value,selection=resolveBookmark(record);if(!current||!selection||current.state.doc.textBetween(selection.from,selection.to)!=='/')return false;return dispatchUnit(current.state.tr.delete(selection.from,selection.to))}
function toggleDeclaration(id:TaskDeclarationId){const current=editor.value;if(!current||!editable()||!declarationsSupported.value)return false;const active=normalizeTaskDeclarations(current.state.doc.attrs.taskDeclarations??undefined).ids,ids=active.includes(id)?active.filter(value=>value!==id):[...active,id];let tr=current.state.tr;const trigger=resolveBookmark(slashTrigger);if(trigger&&tr.doc.textBetween(trigger.from,trigger.to)==='/')tr=tr.delete(trigger.from,trigger.to);cancelAttachmentTrigger();return dispatchUnit(tr.setDocAttribute('taskDeclarations',ids.length?normalizeTaskDeclarations({version:1,ids}):null))}
function cancelAttachmentTrigger(){if(slashTrigger){slashTrigger.valid=false;bookmarks.delete(slashTrigger);slashTrigger=null}}
const handle:ComposerEditorHandle={focus,select,insertText,insertContext,replaceRange,replaceTextRange,saveSelection,restoreSelection,getTextSelection,canUndo,canRedo,getCommandState,executeCommand,openLinkEditor,removeLink,updateContext,toggleDeclaration,consumeAttachmentTrigger,cancelAttachmentTrigger}
watch(()=>props.modelValue,value=>{if(!mounted)return;let next:ComposerDocument;try{next=normalizeComposerDocument(value,owner())}catch{createEditor();return}if(modelUnsupported.value||next.id!==metadata.value.id||next.chatId!==metadata.value.chatId){createEditor();return}metadata.value=next;if(composerDocumentContentIdentity(next)!==lastContent){bookmarks.forEach(record=>{record.valid=false});saved=null;linkOpen.value=false;applying=true;editor.value?.commands.setContent({type:'doc',attrs:{taskDeclarations:next.declarations??null},content:next.content as JSONContent[]},{emitUpdate:false});lastContent=composerDocumentContentIdentity(next);applying=false}})
watch(()=>[props.disabled,props.readonly],()=>editor.value?.setEditable(!props.disabled&&!props.readonly&&!modelUnsupported.value))
watch(()=>props.placeholder,placeholder=>{const current=editor.value;if(current)current.setOptions({editorProps:{...current.options.editorProps,attributes:{class:'composer-richtext',role:'textbox','aria-multiline':'true','aria-label':'消息编辑器','data-placeholder':placeholder}}})})
watch(()=>textMenu.value?.open,(value,previous)=>{if(previous&&!value&&!linkOpen.value)restoreSelection()})
watch(linkOpen,async value=>{linkResize?.disconnect();if(!value)return;await nextTick();if(!linkOpen.value||!editor.value||!linkPanel.value)return;linkResize||=new ResizeObserver(()=>clampLinkPanel());linkResize.observe(composerOverlayBoundary(editor.value.view.dom));linkResize.observe(linkPanel.value)})
onMounted(()=>{mounted=true;createEditor();window.addEventListener('resize',clampLinkPanel);window.addEventListener('scroll',clampLinkPanel,true);if(root.value)unregister=registerComposerEditor(root.value,handle)})
onBeforeUnmount(()=>{clearTimeout(compositionTimer);clearTimeout(compositionGuard);linkResize?.disconnect();window.removeEventListener('resize',clampLinkPanel);window.removeEventListener('scroll',clampLinkPanel,true);unregister?.();bookmarks.forEach(record=>{record.valid=false});editor.value?.destroy()})
defineExpose(handle)
</script>
<style>
.composer-document-editor{position:relative;width:100%;min-width:0;color:var(--navora-ink,#263b55);font-size:14px;line-height:1.6}
.composer-task-declarations{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 6px}
.composer-task-declaration{display:flex;align-items:center;gap:2px;max-width:100%;padding:2px 4px;border:1px solid var(--navora-stroke);border-radius:7px;background:var(--control-selected);font-size:11px;transition:background-color 120ms ease,border-color 120ms ease;user-select:none}
.composer-task-declaration:hover,.composer-task-declaration:focus-within,.composer-task-declaration:has(.composer-task-meaning[aria-expanded=true]){border-color:var(--navora-accent);background:color-mix(in srgb,var(--control-selected) 88%,var(--navora-accent))}
.composer-task-declaration>button{display:grid;place-items:center;flex-shrink:0;width:22px;height:22px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--navora-muted);font:inherit;cursor:pointer}
.composer-task-declaration>.composer-task-meaning{display:flex;align-items:center;gap:5px;min-width:0;flex-shrink:1;width:auto;height:24px;padding:2px 4px;white-space:nowrap;color:var(--navora-accent);background:transparent}
.composer-task-declaration>.composer-task-meaning:hover{background:transparent}
.composer-task-declaration>button:not(.composer-task-meaning):hover:not(:disabled){background:color-mix(in srgb,var(--control-danger) 12%,transparent);color:var(--control-danger)}
.composer-task-declaration>button:disabled{opacity:.4;cursor:default}
.composer-task-declaration>button:focus-visible{outline:2px solid var(--navora-accent);outline-offset:1px}
.composer-task-meaning-text{font-size:11px;line-height:1.5;color:var(--navora-muted);margin:0 0 6px}
.composer-task-declaration svg{width:13px;height:13px;flex-shrink:0}
@media(prefers-reduced-motion:reduce){.composer-task-declaration{transition:none}}
.composer-document-unreadable{font-size:12px;color:var(--control-danger,#ad4239);margin:0 0 8px}
.composer-document-editor .composer-richtext{min-height:60px;max-height:32dvh;overflow:auto;overscroll-behavior:contain;outline:none;padding:6px 4px;white-space:pre-wrap;overflow-wrap:anywhere;cursor:text}
.composer-document-editor .composer-richtext:focus-visible{outline:none;box-shadow:none}
.composer-document-editor .composer-richtext>p{margin:0 0 6px}.composer-document-editor .composer-richtext>p:last-child{margin-bottom:0}
.composer-richtext:has(>p:only-child:empty)::before,.composer-richtext:has(>p:only-child>br.ProseMirror-trailingBreak:only-child)::before{position:absolute;color:var(--navora-muted,#929ca8);content:attr(data-placeholder);pointer-events:none}
.composer-richtext a{color:var(--navora-accent,#3269ac);text-decoration:underline;cursor:text}
.composer-richtext blockquote{border-left:3px solid var(--navora-stroke,#dbe1e9);padding-left:12px;margin:8px 0}
.composer-richtext :is(h1,h2,h3,h4,h5,h6){font-weight:600;line-height:1.5;margin:8px 0 4px}.composer-richtext h1{font-size:1.5em}.composer-richtext h2{font-size:1.28em}.composer-richtext h3{font-size:1.14em}
.composer-richtext :is(ul,ol){margin:6px 0;padding-left:22px}.composer-richtext li>p{margin:0}
.composer-richtext pre{padding:10px;border:1px solid var(--navora-stroke,#dbe1e9);border-radius:8px;background:var(--appearance-well,#f8f9fb);white-space:pre-wrap}
.composer-richtext code{font-family:ui-monospace,Consolas,monospace;font-size:.92em}
.composer-richtext .ProseMirror-selectednode{outline:2px solid var(--navora-accent,#3269ac);outline-offset:1px}
.composer-document-editor.is-disabled{opacity:.65}.composer-document-editor.is-readonly .composer-richtext{cursor:default}
.composer-editor-menu-separator{height:1px;margin:5px 4px;background:var(--navora-stroke,#dbe1e9)}
.composer-editor-menu-shortcut{margin-left:auto;padding-left:20px;color:var(--navora-muted,#788695);font-size:12px}
.composer-link-scrim{position:fixed;inset:0;z-index:12000}
.composer-link-panel{position:fixed;inset:auto;margin:0;box-sizing:border-box;width:min(360px,calc(100vw - 16px));max-height:calc(100dvh - 16px);overflow:auto;z-index:12001;padding:14px;border:1px solid var(--navora-stroke,#dbe1e9);border-radius:12px;background:var(--navora-surface,#fff);color:var(--navora-ink,#263b55);box-shadow:0 8px 28px #18203029;font-size:13px}
.composer-link-panel>label{display:block;margin-bottom:10px;font-size:12px;color:var(--navora-muted,#788695)}
.composer-link-panel input,.composer-link-panel textarea{display:block;box-sizing:border-box;width:100%;padding:7px 9px;margin-top:5px;border:1px solid var(--navora-stroke,#dbe1e9);border-radius:7px;background:var(--appearance-well,#f8f9fb);color:var(--navora-ink,#263b55);font:inherit;font-size:13px;resize:vertical;outline-color:var(--navora-accent,#3269ac)}
.composer-link-hint,.composer-link-error{font-size:11px;line-height:1.5;margin:8px 0}.composer-link-hint{color:var(--navora-muted,#788695)}.composer-link-error{color:var(--control-danger,#b65045)}
.composer-link-actions{display:flex;align-items:center;gap:7px;margin-top:12px}.composer-link-actions>span{flex:1}
.composer-link-actions>button{padding:6px 10px;min-height:30px;border:1px solid var(--navora-stroke,#dbe1e9);border-radius:7px;background:transparent;color:inherit;font:inherit;cursor:default}
.composer-link-actions>.primary{background:var(--navora-accent,#3269ac);border-color:var(--navora-accent,#3269ac);color:white}
.composer-link-actions>.composer-link-remove{border-color:transparent;color:var(--control-danger,#b65045);padding-left:0}
</style>

