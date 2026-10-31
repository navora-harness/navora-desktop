import {computed,onBeforeUnmount,onMounted,ref,type Ref} from 'vue'
export function useFileWorkspaceLayout(main:Ref<HTMLElement|null>,visible:Ref<boolean>,mobile:Ref<boolean>){
  const mainWidth=ref(innerWidth),preferredWidth=ref(540)
  try{const saved=Number(localStorage.getItem('navora.file-workspace.width'));if(saved>=320&&saved<=1000)preferredWidth.value=saved}catch{/* Optional preference. */}
  const overlay=computed(()=>mobile.value||mainWidth.value<900)
  const maximum=computed(()=>Math.max(320,Math.min(1000,mainWidth.value-480)))
  const width=computed(()=>overlay.value?Math.min(mainWidth.value,preferredWidth.value):Math.min(preferredWidth.value,maximum.value))
  const reserve=computed(()=>visible.value&&!overlay.value?width.value:0)
  function resize(value:number){preferredWidth.value=Math.max(320,Math.min(maximum.value,value));try{localStorage.setItem('navora.file-workspace.width',String(preferredWidth.value))}catch{/* Optional preference. */}}
  let observer:ResizeObserver|undefined
  onMounted(()=>{if(!main.value)return;const element=main.value;mainWidth.value=element.clientWidth;observer=new ResizeObserver(()=>{mainWidth.value=element.clientWidth});observer.observe(element)})
  onBeforeUnmount(()=>observer?.disconnect())
  return {mainWidth,overlay,maximum,width,reserve,resize}
}
