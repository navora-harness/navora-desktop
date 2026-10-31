import {computed,onBeforeUnmount,onMounted,ref,type Ref} from 'vue'

/** Keep a readable conversation beside the card; sidebar size counts as occupied space. */
export function useResourceCardLayout(main:Ref<HTMLElement|null>,width:Ref<number>,mobile:Ref<boolean>,reserve?:Ref<number>){
  const mainWidth=ref(0)
  const availableWidth=computed(()=>Math.max(0,mainWidth.value-(reserve?.value||0)))
  const overlay=computed(()=>mobile.value||availableWidth.value<width.value+624)
  let observer:ResizeObserver|undefined
  onMounted(()=>{
    const element=main.value
    if(!element)return
    mainWidth.value=element.clientWidth
    observer=new ResizeObserver(()=>{mainWidth.value=element.clientWidth})
    observer.observe(element)
  })
  onBeforeUnmount(()=>observer?.disconnect())
  return {overlay,availableWidth}
}
