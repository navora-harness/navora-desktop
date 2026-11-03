import type {FileTab} from './file-tabs'
export function fileWindowError(error:unknown):string{
  const text=String(error)
  if(text.includes('file_window_busy'))return '窗口正在处理标签，请稍后重试。'
  if(/file_tab_limit|标签页已达上限/.test(text))return '标签页已达上限，请先关闭部分标签页。'
  if(text.includes('file_drag_expired'))return '此次拖动已失效，请重新拖动标签。'
  if(/main_window_unavailable|工作区没有响应/.test(text))return '工作区暂时无法接收，标签仍保留在原窗口。'
  if(/file_tab_not_found|ENOENT/.test(text))return '文件或标签已移走，请重新打开。'
  return '文件操作未完成，请重试。'
}
export type FileTransfer={kind:'open'|'remove';tab:FileTab;viewerChatId:string;before?:string;requestId?:string}
export type FileWindowsApi={
  state:()=>Promise<FileTab[]>
  open:(chatId:string,path:string)=>Promise<void>
  detach:(tab:FileTab,viewerChatId:string)=>Promise<void>
  close:(key:string)=>Promise<void>
  attach:(key:string)=>Promise<void>
  beginDrag:(tab:FileTab,viewerChatId:string)=>Promise<string>
  drop:(token:string,viewerChatId?:string,before?:string)=>Promise<void>
  endDrag:(token:string,outside:boolean,point?:{x:number;y:number})=>Promise<void>
  completeTransfer:(requestId:string,error?:string)=>Promise<void>
  onChanged:(cb:(tabs:FileTab[])=>void)=>()=>void
  onTransfer:(cb:(event:FileTransfer)=>void)=>()=>void
}
