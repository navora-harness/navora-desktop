import {defineAsyncComponent,defineComponent,h,shallowRef,type Component} from 'vue'
import AsyncPanelState from '@/components/AsyncPanelState.vue'

/** Local panel recovery never reloads the transcript or changes the running Agent. */
export function lazyPanel(loader:()=>Promise<{default:Component}>,label:string,overlay=false){
  return defineComponent({
    name:'Lazy'+label,
    inheritAttrs:false,
    setup(_,{attrs,slots}){
      const close=()=>{const update=attrs['onUpdate:modelValue'];if(typeof update==='function')update(false);else if(typeof attrs.onClose==='function')attrs.onClose()}
      const state=(error=false)=>defineComponent({setup:()=>()=>h(AsyncPanelState,{label,error,overlay,onRetry:retry,onClose:close})})
      const create=()=>defineAsyncComponent({loader,delay:120,timeout:15000,loadingComponent:state(),errorComponent:state(true)})
      const panel=shallowRef<Component>(create())
      function retry(){panel.value=create()}
      return ()=>h(panel.value,attrs,slots)
    },
  })
}
