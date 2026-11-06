import {makeFileTab} from './file-tabs'

/** Display only. File navigation continues to use the validated workspace-relative path. */
export function workspaceFileDisplayPath(root:string|undefined,relative:string):string{
  let path:string
  try{path=makeFileTab('display',relative).path}catch{return relative}
  if(!root||/[\0-\x1f\x7f]/.test(root))return path
  if(/^[a-z]:[\\/]/i.test(root)||/^(?:\\\\|\/\/)[^\\/]/.test(root))return root.replace(/\//g,'\\').replace(/\\+$/,'')+'\\'+path.replace(/\//g,'\\')
  if(root.startsWith('/'))return root.replace(/\/+$/,'')+'/'+path
  return path
}
