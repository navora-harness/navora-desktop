import {onBeforeUnmount} from 'vue'
import type {WorkspaceFileTab as FileTab} from '@shared/file-tabs'
import {fileWindowError} from '@shared/file-windows'
import {startTabFeedback,endTabFeedback,showTabDrop,tabDropBefore,leaveTabDrop} from './tabDragFeedback'
export const fileTabMime='application/x-navora-file-tab'
export function useFileDrag(onError:(message:string)=>void,viewer:()=>string){
  const reportError=(error:unknown)=>{if(!disposed)onError(fileWindowError(error))}
  const api=window.navora!.fileTabs
  let prepared:{key:string;token:string;expires:number}|null=null,dragged:string|null=null,cancelled=false,generation=0,disposed=false
  async function prepare(tab:FileTab){if(disposed||dragged||tab.kind!==undefined||window.navora?.app.platform==='web'||(prepared?.key===tab.key&&prepared.expires>Date.now()))return;const request=++generation;try{const token=await api.beginDrag({...tab},viewer());if(!disposed&&request===generation)prepared={key:tab.key,token,expires:Date.now()+20000}}catch(e){if(!disposed&&request===generation)reportError(e)}}
  function start(event:DragEvent,tab:FileTab){if(disposed||!prepared||prepared.key!==tab.key||prepared.expires<=Date.now()){event.preventDefault();return}cancelled=false;dragged=prepared.token;event.dataTransfer?.setData(fileTabMime,dragged);event.dataTransfer?.setData('text/plain',tab.path);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';startTabFeedback(event)}
  function over(event:DragEvent){if(event.dataTransfer?.types.includes(fileTabMime)){event.preventDefault();event.dataTransfer.dropEffect='move';showTabDrop(event)}}
  async function drop(event:DragEvent,before?:string){const token=event.dataTransfer?.getData(fileTabMime);if(!token)return;event.preventDefault();event.stopPropagation();const placement=tabDropBefore(event,before);endTabFeedback();try{await api.drop(token,viewer(),placement)}catch(e){reportError(e)}}
  async function end(event:DragEvent){endTabFeedback();if(!dragged)return;const token=dragged;dragged=null;prepared=null;generation++
    // A successful drop belongs to the receiver. Its IPC may arrive after this
    // renderer's dragend; consuming the token here would race the transfer.
    if(!cancelled&&event.dataTransfer?.dropEffect==='move')return
    const outside=!cancelled&&(event.screenX!==0||event.screenY!==0)&&(event.screenX<window.screenX||event.screenX>window.screenX+window.outerWidth||event.screenY<window.screenY||event.screenY>window.screenY+window.outerHeight)
    try{await api.endDrag(token,outside,{x:event.screenX,y:event.screenY})}catch(e){reportError(e)}
  }
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&dragged){event.preventDefault();event.stopImmediatePropagation();cancelled=true;const token=dragged;dragged=null;prepared=null;generation++;endTabFeedback();void api.endDrag(token,false).catch(e=>reportError(e))}}
  window.addEventListener('keydown',escape,true);onBeforeUnmount(()=>{disposed=true;generation++;prepared=null;dragged=null;window.removeEventListener('keydown',escape,true);endTabFeedback()})
  return {prepare,start,over,drop,end,leave:leaveTabDrop}
}
