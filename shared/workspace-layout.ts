export const WORKSPACE_CHAT_MIN=480
export const WORKSPACE_CONTENT_MIN=400
export const WORKSPACE_SPLIT_MIN=WORKSPACE_CHAT_MIN+WORKSPACE_CONTENT_MIN+1
export const WORKSPACE_RECOVERY_GAP=80
export type WorkspaceExpansionReason='viewport'|'divider'|null
export function workspaceLayoutDecision(input:{available:number;visible:boolean;mobile:boolean;manualExpanded:boolean;automatic:WorkspaceExpansionReason;dividerBudget?:number}){
  const available=Math.max(0,Number.isFinite(input.available)?input.available:0)
  if(!input.visible)return {expanded:false,automatic:null as WorkspaceExpansionReason,canSplit:available>=WORKSPACE_SPLIT_MIN}
  if(input.manualExpanded)return {expanded:true,automatic:input.automatic,canSplit:available>=WORKSPACE_SPLIT_MIN}
  if(input.mobile||available<WORKSPACE_SPLIT_MIN)return {expanded:true,automatic:'viewport' as WorkspaceExpansionReason,canSplit:false}
  if(input.automatic){
    const threshold=Math.max(WORKSPACE_SPLIT_MIN,input.automatic==='divider'?input.dividerBudget||0:0)+WORKSPACE_RECOVERY_GAP
    if(available<threshold)return {expanded:true,automatic:input.automatic,canSplit:true}
  }
  return {expanded:false,automatic:null as WorkspaceExpansionReason,canSplit:true}
}
export function workspacePreferredWidth(available:number,preferred:number){
  const maximum=Math.max(WORKSPACE_CONTENT_MIN,available-WORKSPACE_CHAT_MIN-1)
  return Math.max(WORKSPACE_CONTENT_MIN,Math.min(maximum,Number.isFinite(preferred)?preferred:540))
}
