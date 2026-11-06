export type WorkspaceFileAction='inspect'|'system'|'openWith'|'reveal'|'saveAs'|'copyPath'|'copyRelativePath'|'copyContent'
export type WorkspaceFileActionOptions={revision?:string}
export type WorkspaceFileCapabilities={revision:string;directory:boolean;openWith:boolean;copyContent:boolean;copyContentReason?:string}
export type WorkspaceFileActionResult={ok:boolean;canceled?:boolean;error?:string;capabilities?:WorkspaceFileCapabilities}
