import {onBeforeUnmount,onMounted,watch} from 'vue'
import {browserViewports} from '@/composables/useBrowserSurfaceLayout'
import {browserPopupPosition} from '@shared/browser-popup-placement'

export const BROWSER_POPUP_NO_SPACE='当前窗口没有足够空间显示菜单，请调整布局后重试。'
export function browserPopupNotice(message=BROWSER_POPUP_NO_SPACE){window.dispatchEvent(new CustomEvent('navora:ui-notice',{detail:{message}}))}

const properties=['position','left','top','right','bottom','margin','transform'] as const
type SavedStyle={value:string;priority:string}
/** Observe only this popup and explicit View geometry, never the body or guest page. */
export function useSafeBrowserPopup(element:()=>HTMLElement|null|undefined,onBlocked:()=>void){
  let node:HTMLElement|null=null,observer:ResizeObserver|undefined,styles:MutationObserver|undefined,disposed=false
  let saved:Map<string,SavedStyle>|undefined,preferred:{x:number;y:number}|undefined
  function release(){
    if(node&&saved)for(const [property,value] of saved){if(value.value)node.style.setProperty(property,value.value,value.priority);else node.style.removeProperty(property)}
    saved=undefined;preferred=undefined
  }
  function place(){
    if(disposed||!node?.isConnected)return
    if(!browserViewports.value.length){release();return}
    const bounds=node.getBoundingClientRect()
    preferred||={x:bounds.left,y:bounds.top}
    const position=browserPopupPosition({width:node.offsetWidth||bounds.width,height:node.offsetHeight||bounds.height},preferred,{width:window.innerWidth,height:window.innerHeight},browserViewports.value)
    if(!position){onBlocked();browserPopupNotice();return}
    saved||=new Map(properties.map(property=>[property,{value:node!.style.getPropertyValue(property),priority:node!.style.getPropertyPriority(property)}]))
    const values={position:'fixed',left:`${position.x}px`,top:`${position.y}px`,right:'auto',bottom:'auto',margin:'0px',transform:'none'}
    for(const property of properties){
      const current=node.style.getPropertyValue(property),same=current===values[property]||((property==='left'||property==='top')&&Math.abs(parseFloat(current)-parseFloat(values[property]))<0.01)
      if(!same||node.style.getPropertyPriority(property)!=='important')node.style.setProperty(property,values[property],'important')
    }
  }
  const stop=watch([element,browserViewports],([next])=>{
    if(next!==node){observer?.disconnect();styles?.disconnect();release();node=next||null;if(node){observer||=new ResizeObserver(place);observer.observe(node);styles||=new MutationObserver(place);styles.observe(node,{attributes:true,attributeFilter:['style']})}}
    place()
  },{flush:'post'})
  onMounted(()=>{window.addEventListener('resize',place);window.addEventListener('scroll',place,true);place()})
  onBeforeUnmount(()=>{disposed=true;stop();observer?.disconnect();styles?.disconnect();release();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true)})
  return {place}
}
