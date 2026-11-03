import type {SelectionBookmark} from '@tiptap/pm/state'
import type {ComposerContextBlock} from '@shared/composer-document'

export type ComposerEditorCommand='undo'|'redo'|'cut'|'copy'|'copy-link'|'paste'|'paste-plain'|'delete'|'select-all'|'link'|'unlink'|'attach'
export type ComposerSelectionBookmark={documentId:string;chatId:string;revision:number;from:number;to:number;bookmark:SelectionBookmark;valid:boolean;label?:{element:HTMLInputElement;start:number;end:number}}
export type ComposerEditorHandle={
  focus:()=>void;select:()=>void;insertText:(text:string)=>boolean;insertContext:(block:ComposerContextBlock,text?:string)=>boolean
  replaceRange:(from:number,to:number,text:string)=>boolean;replaceTextRange:(from:number,to:number,text:string)=>boolean
  saveSelection:()=>ComposerSelectionBookmark|null;restoreSelection:(bookmark?:ComposerSelectionBookmark)=>boolean
  getTextSelection:()=>{from:number;to:number;text:string;empty:boolean};canUndo:()=>boolean;canRedo:()=>boolean
  getCommandState:()=>Record<ComposerEditorCommand,boolean>;executeCommand:(command:ComposerEditorCommand)=>Promise<boolean>
  openLinkEditor:()=>boolean;removeLink:()=>boolean;updateContext:(id:string,patch:{block?:ComposerContextBlock;text?:string})=>boolean
  /** Remove only the most recent live slash command; cancellation leaves it literal. */
  consumeAttachmentTrigger:()=>boolean
  cancelAttachmentTrigger:()=>void
}
const editors=new Map<HTMLElement,ComposerEditorHandle>()
let active:ComposerEditorHandle|null=null
export function registerComposerEditor(element:HTMLElement,handle:ComposerEditorHandle){editors.set(element,handle);return ()=>{editors.delete(element);if(active===handle)active=null}}
export function activateComposerEditor(handle:ComposerEditorHandle){active=handle}
export function getActiveComposerEditor(){
  const focused=document.activeElement
  for(const [element,handle] of editors)if(focused&&element.contains(focused)){active=handle;return handle}
  // A plain input elsewhere must never send edit commands to an old draft.
  // Captured menu targets are kept by the caller while its own controls focus.
  if(focused&&focused!==document.body&&!focused.closest('.sidebar-ctx-panel,.application-menu-panel,.application-menu-bar'))return null
  return active
}
export function captureActiveComposerEditor(){const handle=getActiveComposerEditor();handle?.saveSelection();return handle}
