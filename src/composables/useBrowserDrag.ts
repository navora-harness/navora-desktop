import {onBeforeUnmount} from 'vue'
import {startTabFeedback,endTabFeedback,showTabDrop,tabDropBefore,leaveTabDrop} from './tabDragFeedback'
const mime='application/x-navora-browser-tab'
export function useBrowserDrag(onError:(message:string)=>void,onReorder?:(pageId:string,before?:string,pageIds?:string[])=>void|Promise<void>,onSettled?:()=>void|Promise<void>,selectedPages?:(pageId:string)=>string[]){
  let prepared:{id:string;token:string}|null=null,dragged:{token:string;id:string}|null=null,cancelled=false
  const api=window.navora!.browser.workspace
  let generation=0,disposed=false
  async function settled(){if(!disposed)await onSettled?.()}
  async function prepare(id?:string){if(!id||disposed||dragged)return;prepared=null;const request=++generation;try{const token=await api.beginDrag(id,selectedPages?.(id));if(!disposed&&request===generation)prepared={id,token}}catch(e){if(!disposed&&request===generation){onError(String(e));await settled()}}}
  function start(event:DragEvent,id?:string){if(!id||!prepared||prepared.id!==id){event.preventDefault();return}cancelled=false;dragged={...prepared};event.dataTransfer?.setData(mime,prepared.token);event.dataTransfer?.setData('text/plain','Navora 浏览器标签');if(event.dataTransfer)event.dataTransfer.effectAllowed='move';startTabFeedback(event)}
  function over(event:DragEvent){if(event.dataTransfer?.types.includes(mime)){event.preventDefault();event.dataTransfer.dropEffect='move';showTabDrop(event)}}
  async function drop(event:DragEvent,before?:string){const token=event.dataTransfer?.getData(mime);if(!token)return;event.preventDefault();event.stopPropagation();const placement=tabDropBefore(event,before);endTabFeedback();try{const result=await api.dropTabs(token);if(!disposed)await onReorder?.(result.pageId,placement,result.pageIds)}catch(e){if(!disposed)onError(String(e))}finally{await settled()}}
  async function end(event:DragEvent){endTabFeedback();if(!dragged)return;const token=dragged.token;dragged=null;prepared=null
    generation++
    // Only the receiver consumes a token after a confirmed HTML drop.
    if(!cancelled&&event.dataTransfer?.dropEffect==='move')return
    const hasPoint=(event.clientX!==0||event.clientY!==0)&&(event.screenX!==0||event.screenY!==0)
    const list=(event.currentTarget as Element|null)?.closest<HTMLElement>('[role="tablist"]')
    const rect=list?.getBoundingClientRect()
    const outsideList=!!rect&&hasPoint&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)
    const outsideWindow=hasPoint&&(event.screenX<window.screenX||event.screenX>window.screenX+window.outerWidth||event.screenY<window.screenY||event.screenY>window.screenY+window.outerHeight)
    const outside=!cancelled&&(rect?outsideList:outsideWindow)
    try{await api.endDrag(token,outside,{x:event.screenX,y:event.screenY})}catch(e){if(!disposed)onError(String(e))}finally{await settled()}
  }
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&dragged){e.preventDefault();e.stopImmediatePropagation();cancelled=true;const token=dragged.token;dragged=null;prepared=null;generation++;endTabFeedback();void api.endDrag(token,false).catch(error=>onError(String(error)))}}
  window.addEventListener('keydown',escape,true);onBeforeUnmount(()=>{disposed=true;generation++;prepared=null;window.removeEventListener('keydown',escape,true);endTabFeedback()})
  return {prepare,start,over,drop,end,leave:leaveTabDrop}
}
