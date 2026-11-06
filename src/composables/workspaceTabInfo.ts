export const WORKSPACE_TAB_INFO_REQUEST='navora:workspace-tab-info-request'
export const WORKSPACE_TAB_INFO_LEAVE='navora:workspace-tab-info-leave'
export type WorkspaceTabInfoRequest={owner:string;identity:string;anchor:HTMLElement;title:string;detail:string;status:string;delay:number}
export type WorkspaceTabInfoLeave={owner:string;immediate:boolean}
export function requestWorkspaceTabInfo(detail:WorkspaceTabInfoRequest){window.dispatchEvent(new CustomEvent(WORKSPACE_TAB_INFO_REQUEST,{detail}))}
export function leaveWorkspaceTabInfo(owner:string,immediate=true){window.dispatchEvent(new CustomEvent(WORKSPACE_TAB_INFO_LEAVE,{detail:{owner,immediate}}))}
