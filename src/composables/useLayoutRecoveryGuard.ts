import {onBeforeUnmount,onMounted} from 'vue'
/** Delay optional reflow while someone is typing, composing or using a popup. */
export function useLayoutRecoveryGuard(){
  let composing=false,lastInput=-Infinity
  const start=()=>{composing=true},end=()=>{composing=false;lastInput=performance.now()},input=(event:Event)=>{if(event.target instanceof Element&&event.target.matches('input,textarea,[contenteditable=true]'))lastInput=performance.now()}
  onMounted(()=>{document.addEventListener('compositionstart',start);document.addEventListener('compositionend',end);document.addEventListener('input',input,true)})
  onBeforeUnmount(()=>{document.removeEventListener('compositionstart',start);document.removeEventListener('compositionend',end);document.removeEventListener('input',input,true)})
  return {blocked:()=>composing||performance.now()-lastInput<700||[...document.querySelectorAll('.v-overlay--active,.ui-action-menu,.sidebar-ctx-panel:not([data-browser-tab-preview])')].some(element=>element.checkVisibility())}
}
