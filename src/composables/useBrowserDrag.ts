import {onBeforeUnmount} from 'vue'
import {startTabFeedback,endTabFeedback,showTabDrop,tabDropBefore,leaveTabDrop} from './tabDragFeedback'
const mime='application/x-navora-browser-tab'
export function useBrowserDrag(onError:(message:string)=>void,onReorder?:(pageId:string,before?:string)=>void){
  let prepared:{id:string;token:string}|null=null,dragged:{token:string;id:string}|null=null,cancelled=false
  const api=window.navora!.browser.workspace
  let generation=0
  async function prepare(id?:string){if(!id)return;const request=++generation;try{const token=await api.beginDrag(id);if(request===generation)prepared={id,token}}catch(e){onError(String(e))}}
  function start(event:DragEvent,id?:string){if(!id||!prepared||prepared.id!==id){event.preventDefault();return}cancelled=false;dragged={...prepared};event.dataTransfer?.setData(mime,prepared.token);event.dataTransfer?.setData('text/plain','Navora 浏览器标签');if(event.dataTransfer)event.dataTransfer.effectAllowed='move';startTabFeedback(event)}
  function over(event:DragEvent){if(event.dataTransfer?.types.includes(mime)){event.preventDefault();event.dataTransfer.dropEffect='move';showTabDrop(event)}}
  async function drop(event:DragEvent,before?:string){const token=event.dataTransfer?.getData(mime);if(!token)return;event.preventDefault();event.stopPropagation();const placement=tabDropBefore(event,before);endTabFeedback();try{const pageId=await api.drop(token);onReorder?.(pageId,placement)}catch(e){onError(String(e))}}
  async function end(event:DragEvent){endTabFeedback();if(!dragged)return;const token=dragged.token;dragged=null;prepared=null
    const hasPoint=(event.clientX!==0||event.clientY!==0)&&(event.screenX!==0||event.screenY!==0)
    const list=(event.currentTarget as Element|null)?.closest<HTMLElement>('[role="tablist"]')
    const rect=list?.getBoundingClientRect()
    const outsideList=!!rect&&hasPoint&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)
    const outsideWindow=hasPoint&&(event.screenX<window.screenX||event.screenX>window.screenX+window.outerWidth||event.screenY<window.screenY||event.screenY>window.screenY+window.outerHeight)
    const outside=!cancelled&&(rect?outsideList:outsideWindow)
    try{await api.endDrag(token,outside,{x:event.screenX,y:event.screenY})}catch(e){onError(String(e))}
  }
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&dragged){e.preventDefault();e.stopImmediatePropagation();cancelled=true;const token=dragged.token;dragged=null;prepared=null;endTabFeedback();void api.endDrag(token,false).catch(error=>onError(String(error)))}}
  window.addEventListener('keydown',escape,true);onBeforeUnmount(()=>{window.removeEventListener('keydown',escape,true);endTabFeedback()})
  return {prepare,start,over,drop,end,leave:leaveTabDrop}
}
