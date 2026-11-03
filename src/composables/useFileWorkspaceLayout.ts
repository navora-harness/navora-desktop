import {computed,onBeforeUnmount,onMounted,ref,watch,type Ref} from 'vue'
export function useFileWorkspaceLayout(main:Ref<HTMLElement|null>,visible:Ref<boolean>,mobile:Ref<boolean>,expanded?:Ref<boolean>){
  const mainWidth=ref(innerWidth),preferredWidth=ref(540)
  try{const saved=Number(localStorage.getItem('navora.file-workspace.width'));if(saved>=320&&saved<=7680)preferredWidth.value=saved}catch{/* Optional preference. */}
  const overlayMode=ref(mobile.value||mainWidth.value<760)
  const overlay=computed(()=>overlayMode.value)
  watch([mainWidth,mobile],([width,isMobile])=>{
    if(isMobile)overlayMode.value=true
    else if(overlayMode.value?width>800:width<760)overlayMode.value=width<760
  })
  const maximum=computed(()=>expanded?.value?mainWidth.value:Math.max(320,mainWidth.value-420))
  const width=computed(()=>expanded?.value?mainWidth.value:overlay.value?Math.min(mainWidth.value,preferredWidth.value):Math.min(preferredWidth.value,maximum.value))
  const reserve=computed(()=>visible.value&&!overlay.value&&!expanded?.value?width.value:0)
  function resize(value:number){if(expanded)expanded.value=false;const max=maximum.value;preferredWidth.value=Math.max(Math.min(320,max),Math.min(max,value));try{localStorage.setItem('navora.file-workspace.width',String(preferredWidth.value))}catch{/* Optional preference. */}}
  let observer:ResizeObserver|undefined
  onMounted(()=>{if(!main.value)return;const element=main.value;mainWidth.value=element.clientWidth;observer=new ResizeObserver(()=>{mainWidth.value=element.clientWidth});observer.observe(element)})
  onBeforeUnmount(()=>observer?.disconnect())
  return {mainWidth,overlay,maximum,width,reserve,resize}
}
