import {computed,onBeforeUnmount,onMounted,ref,watch,type Ref} from 'vue'
import {WORKSPACE_CHAT_MIN,WORKSPACE_SPLIT_MIN,workspaceLayoutDecision,workspacePreferredWidth,type WorkspaceExpansionReason} from '@shared/workspace-layout'
import {useLayoutRecoveryGuard} from './useLayoutRecoveryGuard'
export function useFileWorkspaceLayout(main:Ref<HTMLElement|null>,visible:Ref<boolean>,mobile:Ref<boolean>,manualExpanded:Ref<boolean>,contextKey?:Ref<string|null>){
  const mainWidth=ref(innerWidth),preferredWidth=ref(540),preferredRatio=ref<number|null>(null)
  const automatic=ref<WorkspaceExpansionReason>(null),dividerBudget=ref(0),previewWidth=ref<number|null>(null),expandPreview=ref(false),conversationPreview=ref(false)
  try{const raw=JSON.parse(localStorage.getItem('navora.workspace.layout.v2')||'null');if(raw?.version===2&&Number.isFinite(raw.ratio)&&raw.ratio>=.1&&raw.ratio<=.9)preferredRatio.value=raw.ratio;const old=Number(localStorage.getItem('navora.file-workspace.width'));if(old>=320&&old<=7680)preferredWidth.value=old}catch{/* Optional layout preference. */}
  let recovery:ReturnType<typeof setTimeout>|undefined,observer:ResizeObserver|undefined
  let dragging=false
  const guard=useLayoutRecoveryGuard(),recoveryBlocked=()=>dragging||guard.blocked()
  function recover(){const latest=decision();if(latest.automatic)return;if(recoveryBlocked()){recovery=setTimeout(recover,250);return}automatic.value=null}
  const decision=()=>workspaceLayoutDecision({available:mainWidth.value,visible:visible.value,mobile:mobile.value,manualExpanded:manualExpanded.value,automatic:automatic.value,dividerBudget:dividerBudget.value})
  function reconcile(){
    clearTimeout(recovery)
    const next=decision()
    if(automatic.value&&!next.automatic&&visible.value&&!manualExpanded.value){recovery=setTimeout(recover,250)}
    else automatic.value=next.automatic
  }
  watch([mainWidth,mobile,visible,manualExpanded],reconcile,{immediate:true})
  if(contextKey)watch(contextKey,()=>{automatic.value=null;dividerBudget.value=0;previewWidth.value=null;expandPreview.value=false;conversationPreview.value=false;dragging=false;reconcile()},{flush:'sync'})
  const expanded=computed(()=>visible.value&&(manualExpanded.value||!!automatic.value))
  const overlay=computed(()=>mobile.value)
  const maximum=computed(()=>Math.max(400,mainWidth.value-WORKSPACE_CHAT_MIN-1))
  const width=computed(()=>expanded.value||overlay.value?mainWidth.value:workspacePreferredWidth(mainWidth.value,previewWidth.value??(preferredRatio.value===null?preferredWidth.value:preferredRatio.value*mainWidth.value)))
  const reserve=computed(()=>visible.value&&!overlay.value&&!expanded.value?width.value:0)
  function persist(){try{localStorage.setItem('navora.workspace.layout.v2',JSON.stringify({version:2,ratio:preferredRatio.value}));localStorage.setItem('navora.file-workspace.width',String(preferredWidth.value))}catch{/* Optional preference. */}}
  function resize(value:number,phase:'preview'|'commit'|'cancel'='commit'){
    if(!Number.isFinite(value))return
    dragging=phase==='preview'
    if(phase==='cancel'){previewWidth.value=null;expandPreview.value=false;conversationPreview.value=false;return}
    conversationPreview.value=value<400-24
    expandPreview.value=value>maximum.value+24||conversationPreview.value
    if(phase==='preview'){previewWidth.value=value;return}
    previewWidth.value=null
    const target=conversationPreview.value?'conversation':'workspace'
    if(expandPreview.value&&!mobile.value){automatic.value='divider';dividerBudget.value=Math.max(WORKSPACE_SPLIT_MIN,conversationPreview.value?mainWidth.value:value+WORKSPACE_CHAT_MIN+1);manualExpanded.value=false}
    else{automatic.value=null;manualExpanded.value=false;preferredWidth.value=workspacePreferredWidth(mainWidth.value,value);preferredRatio.value=preferredWidth.value/Math.max(1,mainWidth.value);persist()}
    const didExpand=expandPreview.value&&!mobile.value
    expandPreview.value=false;conversationPreview.value=false;reconcile()
    return didExpand?target:undefined
  }
  function requestSplit(){clearTimeout(recovery);manualExpanded.value=false;automatic.value=null;dividerBudget.value=0;reconcile();return !expanded.value}
  function toggleExpanded(){if(expanded.value)return requestSplit();manualExpanded.value=true;return true}
  onMounted(()=>{if(!main.value)return;const element=main.value;mainWidth.value=element.clientWidth;observer=new ResizeObserver(()=>{mainWidth.value=element.clientWidth});observer.observe(element)})
  onBeforeUnmount(()=>{observer?.disconnect();clearTimeout(recovery)})
  return {mainWidth,overlay,expanded,automatic,expandPreview,conversationPreview,maximum,width,reserve,resize,requestSplit,toggleExpanded}
}
