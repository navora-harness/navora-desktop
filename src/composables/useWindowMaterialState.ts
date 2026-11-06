import {onMounted,onUnmounted,shallowRef} from 'vue'
import type {WindowMaterialState} from '@shared/window-material'

/** Read capability from the trusted host; never infer it from the current mode. */
export function useWindowMaterialState(){
  const state=shallowRef<WindowMaterialState>()
  let off:(()=>void)|undefined,disposed=false
  onMounted(()=>{
    const app=window.navora?.app
    if(!app||app.platform==='web'||!app.windowMaterial||!app.onWindowMaterial)return
    const accept=(value:WindowMaterialState)=>{
      if(disposed||(state.value&&value.revision<state.value.revision))return
      state.value=value
    }
    off=app.onWindowMaterial(accept)
    void app.windowMaterial().then(accept).catch(()=>{/* Unknown capability stays disabled. */})
  })
  onUnmounted(()=>{disposed=true;off?.()})
  return state
}
