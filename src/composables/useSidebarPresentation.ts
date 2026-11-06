import {computed,onBeforeUnmount,ref,watch,type Ref} from 'vue'
import {useLayoutRecoveryGuard} from './useLayoutRecoveryGuard'
export function useSidebarPresentation(panel:Ref<{active:string}>,width:Ref<number>,mobile:Ref<boolean>,floatingDisabled?:Ref<boolean>){
  const mode=ref<'fixed'|'floating'>('fixed'),lastPanel=ref('chats'),viewport=ref(innerWidth),temporary=ref(false)
  try{const saved=JSON.parse(localStorage.getItem('navora.sidebar.presentation.v1')||'null');if(saved?.version===1){if(saved.mode==='floating')mode.value='floating';if(typeof saved.lastPanel==='string')lastPanel.value=saved.lastPanel}}catch{/* Optional layout preference. */}
  watch(()=>panel.value.active,id=>{if(id)lastPanel.value=id})
  let recovery:ReturnType<typeof setTimeout>|undefined
  const guard=useLayoutRecoveryGuard()
  // The saved width already includes the 52px icon rail.
  function recover(){if(viewport.value<width.value+480+24+64)return;if(guard.blocked()){recovery=setTimeout(recover,250);return}temporary.value=false}
  function measure(){viewport.value=innerWidth;clearTimeout(recovery);const threshold=width.value+480+24;if(mobile.value){temporary.value=false;return}if(viewport.value<threshold)temporary.value=true;else if(viewport.value>=threshold+64)recovery=setTimeout(recover,250)}
  watch([width,mobile],measure,{immediate:true})
  window.addEventListener('resize',measure)
  const floating=computed(()=>!mobile.value&&!floatingDisabled?.value&&(mode.value==='floating'||temporary.value))
  function persist(){try{localStorage.setItem('navora.sidebar.presentation.v1',JSON.stringify({version:1,mode:mode.value,lastPanel:lastPanel.value}))}catch{/* Optional preference. */}}
  watch([mode,lastPanel],persist)
  function togglePin(){if(floatingDisabled?.value)return;mode.value=mode.value==='fixed'?'floating':'fixed'}
  onBeforeUnmount(()=>{clearTimeout(recovery);window.removeEventListener('resize',measure);persist()})
  return {mode,lastPanel,floating,temporary,togglePin}
}
