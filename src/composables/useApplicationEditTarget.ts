import {ref} from 'vue'
import type {BrowserEditCommand,BrowserEditState} from '@shared/browser-workspace'
import {copyTextToClipboard,editableCut,editableDeleteSelection,editableSelectAll,editableSelection,findEditable,type EditableTarget} from '@/utils/editable-context'

type Bookmark={kind:'native';pageId:string}|{kind:'editable';target:EditableTarget;value:string;start:number;end:number;selected:string;range?:Range}|{kind:'selection';text:string;range?:Range;container:HTMLElement|null}
const emptyState=():BrowserEditState=>({undo:false,redo:false,cut:false,copy:false,paste:false,pastePlain:false,delete:false,selectAll:false})
/** Menu focus is separate from its editing target. A native page is addressed
 * explicitly; DOM fields and readonly previews retain their own selection. */
export function useApplicationEditTarget(options:{nativePage?:()=>string|undefined;preview?:()=>HTMLElement|null}){
  const state=ref<BrowserEditState>(emptyState())
  let generation=0
  function capture(nativePageId?:string):Bookmark{
    const request=++generation,target=findEditable(document.activeElement),selection=window.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0).cloneRange():undefined
    state.value=emptyState()
    if(nativePageId){
      void window.navora!.browser.workspace.editState(nativePageId).then(next=>{if(request===generation)state.value=next}).catch(()=>{})
      return {kind:'native',pageId:nativePageId}
    }
    if(target){
      const data=editableSelection(target),password=target.kind==='input'&&target.el.type==='password',writable=!data.readonly
      const enabled=(name:string)=>{try{return document.queryCommandEnabled(name)}catch{return false}}
      state.value={undo:writable&&enabled('undo'),redo:writable&&enabled('redo'),cut:writable&&!!data.selected&&!password,copy:!!data.selected&&!password,paste:writable,pastePlain:writable,delete:writable&&!!data.selected,selectAll:true}
      return {kind:'editable',target,value:target.kind==='contenteditable'?target.el.textContent||'':target.el.value,start:data.start,end:data.end,selected:data.selected,...(range?{range}:{})}
    }
    const text=selection?.toString()||'',native=options.nativePage?.()
    if(!text&&native){
      void window.navora!.browser.workspace.editState(native).then(next=>{if(request===generation)state.value=next}).catch(()=>{})
      return {kind:'native',pageId:native}
    }
    const container=options.preview?.()||null
    state.value={...emptyState(),copy:!!text,selectAll:!!container?.textContent}
    return {kind:'selection',text,...(range?{range}:{}),container}
  }
  function restore(raw:unknown){
    const target=raw as Bookmark|undefined
    if(!target||target.kind==='native')return false
    if(target.kind==='editable'){
      if(!target.target.el.isConnected)return false
      target.target.el.focus({preventScroll:true})
      if(target.target.kind==='input'||target.target.kind==='textarea'){try{target.target.el.setSelectionRange(target.start,target.end)}catch{/* Some native field types have no text selection. */}}
      else if(target.range?.startContainer.isConnected&&target.range.endContainer.isConnected){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(target.range)}
      return true
    }
    if(target.range?.startContainer.isConnected&&target.range.endContainer.isConnected){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(target.range)}
    return true
  }
  async function execute(command:BrowserEditCommand,raw:unknown){
    const target=raw as Bookmark|undefined
    if(!target)throw Error('请先选择可编辑内容。')
    if(target.kind==='native'){await window.navora!.browser.workspace.edit(target.pageId,command);return}
    if(target.kind==='selection'){
      if(command==='copy'){if(!await copyTextToClipboard(target.text))throw Error('无法复制文本。');return}
      if(command==='selectAll'&&target.container?.isConnected){const range=document.createRange();range.selectNodeContents(target.container);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);return}
      throw Error('当前内容为只读预览。')
    }
    const editable=target.target
    const valid=()=>editable.el.isConnected&&(editable.kind==='contenteditable'?editable.el.textContent||'':editable.el.value)===target.value
    if(!valid())throw Error('编辑内容已变化，请重新选择后操作。')
    restore(target)
    if(command==='copy'){if(!await copyTextToClipboard(target.selected))throw Error('无法复制文本。');return}
    if(command==='selectAll'){editableSelectAll(editable);return}
    if(editable.kind!=='contenteditable'&&editable.el.readOnly)throw Error('当前输入框为只读。')
    if(command==='cut'){editableCut(editable,target.start,target.end,target.selected);return}
    if(command==='delete'){editableDeleteSelection(editable,target.start,target.end);return}
    if(command==='paste'||command==='pastePlain'){
      const text=await navigator.clipboard.readText()
      if(!valid())throw Error('编辑内容已变化，请重新选择后操作。')
      restore(target);if(!document.execCommand('insertText',false,text))throw Error('无法粘贴到当前输入框。');return
    }
    if(!document.execCommand(command))throw Error('当前输入框无法执行此操作。')
  }
  return {state,capture,restore,execute}
}
