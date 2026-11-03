export type FileTab={key:string;chatId:string;path:string;kind?:'browser';url?:string;pageId?:string;faviconUrl?:string;loading?:boolean}
export type FileTabs={tabs:FileTab[];active:string;open:boolean}
export const emptyFileTabs=():FileTabs=>({tabs:[],active:'',open:false})
export function workspaceLinkPath(href:string,baseFile?:string):string|null{
  if(!href||/^(?:[a-z][a-z\d+.-]*:|[/#])/i.test(href.trim()))return null
  try{
    const path=decodeURIComponent(href.trim().split(/[?#]/)[0]!).replace(/\\/g,'/')
    if(!path||path.startsWith('/')||/[:\0-\x1f\x7f]/.test(path))return null
    const parts=baseFile?makeFileTab('link',baseFile).path.split('/').slice(0,-1):[]
    for(const part of path.split('/')){
      if(!part||part==='.')continue
      if(part==='..'){if(!parts.length)return null;parts.pop()}else parts.push(part)
    }
    return makeFileTab('link',parts.join('/')).path
  }catch{return null}
}
export function makeFileTab(chatId:string,path:string):FileTab{
  const raw=path.replace(/\\/g,'/')
  if(raw.startsWith('/'))throw Error('invalid_file_tab')
  const normalized=raw.split('/').filter(part=>part&&part!=='.').join('/')
  if(!chatId||chatId.length>200||!normalized||normalized.length>2048||normalized.startsWith('/')||normalized.split('/').some(part=>part==='..')||/[:\0]/.test(normalized))throw Error('invalid_file_tab')
  return {key:JSON.stringify([chatId,normalized]),chatId,path:normalized}
}
export function openFileTab(state:FileTabs,chatId:string,path:string):FileTabs{
  const tab=makeFileTab(chatId,path)
  if(state.tabs.length>=32&&!state.tabs.some(item=>item.key===tab.key))throw Error('标签页已达上限，请先关闭部分文件')
  return {tabs:state.tabs.some(item=>item.key===tab.key)?state.tabs:[...state.tabs,tab],active:tab.key,open:true}
}
export function openBrowserTab(state:FileTabs,chatId:string):FileTabs{
  if(state.tabs.length>=32)throw Error('标签页已达上限，请先关闭部分标签页')
  const tab:FileTab={key:`browser:${crypto.randomUUID()}`,chatId,path:'新标签页',kind:'browser',url:'about:blank'}
  return {tabs:[...state.tabs,tab],active:tab.key,open:true}
}
export function showFileWorkspace(state:FileTabs,chatId:string):FileTabs{
  if(!state.tabs.length)return openBrowserTab(state,chatId)
  return {...state,open:true,active:state.tabs.some(tab=>tab.key===state.active)?state.active:state.tabs[0]!.key}
}
export function removeFileOwner(state:FileTabs,owner:string):FileTabs{
  return state.tabs.filter(tab=>tab.chatId===owner).reduce((next,tab)=>closeFileTab(next,tab.key),state)
}
export function closeFileTab(state:FileTabs,key:string):FileTabs{
  const index=state.tabs.findIndex(tab=>tab.key===key)
  if(index<0)return state
  const tabs=state.tabs.filter(tab=>tab.key!==key)
  return {tabs,active:state.active===key?tabs[Math.min(index,tabs.length-1)]?.key||'':state.active,open:state.open&&tabs.length>0}
}
export function restoreFileTabs(value:unknown):FileTabs{
  if(!value||typeof value!=='object')return emptyFileTabs()
  const raw=value as Partial<FileTabs>,tabs:FileTab[]=[]
  if(Array.isArray(raw.tabs))for(const item of raw.tabs.slice(0,32)){
    try{if(typeof item?.chatId!=='string'||typeof item?.path!=='string')continue;const tab=item.kind==='browser'&&/^browser:[\w-]{1,80}$/.test(item.key)&&/^[\w-]{1,128}$/.test(item.chatId)?{key:item.key,chatId:item.chatId,path:item.path.slice(0,160)||'新标签页',kind:'browser' as const,url:typeof item.url==='string'&&/^https?:\/\//i.test(item.url)?item.url:'about:blank'}:makeFileTab(item.chatId,item.path);if(!tabs.some(existing=>existing.key===tab.key))tabs.push(tab)}catch{/* Discard invalid stored metadata. */}
  }
  return {tabs,active:tabs.find(tab=>tab.key===raw.active)?.key||tabs[0]?.key||'',open:raw.open===true&&tabs.length>0}
}
