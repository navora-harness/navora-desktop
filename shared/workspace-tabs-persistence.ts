import {persistedFileTabs,restoreFileTabs,type FileTabs} from './file-tabs'
export const WORKSPACE_TABS_STORAGE='navora.workspace-tabs.v2'
export function restoreWorkspaces(value:unknown,legacy:unknown):Map<string,FileTabs>{
  const current=value&&typeof value==='object'?value as {version?:unknown;workspaces?:unknown}:null
  const rows=current?.version===2&&Array.isArray(current.workspaces)?current.workspaces:Array.isArray(legacy)?legacy:[]
  const result=new Map<string,FileTabs>()
  for(const row of rows.slice(-40))if(Array.isArray(row)&&typeof row[0]==='string'&&/^[\w-]{1,200}$/.test(row[0])){
    const state=restoreFileTabs(row[1]);state.tabs=state.tabs.filter(tab=>tab.kind!=='subchats'||tab.parentChatId===row[0])
    if(!state.tabs.some(tab=>tab.key===state.active))state.active=state.tabs[0]?.key||''
    state.open=state.open&&state.tabs.length>0;result.set(row[0],state)
  }
  return result
}
export function persistWorkspaces(workspaces:Map<string,FileTabs>){return {version:2,workspaces:[...workspaces].slice(-40).map(([id,state])=>[id,persistedFileTabs(state)])}}
