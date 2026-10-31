export type FileTab={key:string;chatId:string;path:string}
export type FileTabs={tabs:FileTab[];active:string;open:boolean}
export const emptyFileTabs=():FileTabs=>({tabs:[],active:'',open:false})
export function workspaceLinkPath(href:string):string|null{
  if(!href||/^(?:[a-z][a-z\d+.-]*:|[/#])/i.test(href))return null
  try{return makeFileTab('link',decodeURIComponent(href.split(/[?#]/)[0]!)).path}catch{return null}
}
export function makeFileTab(chatId:string,path:string):FileTab{
  const normalized=path.replace(/\\/g,'/').replace(/^(\.\/)+/,'')
  if(!chatId||chatId.length>200||!normalized||normalized.length>2048||normalized.startsWith('/')||normalized.split('/').some(part=>part==='..')||/[:\0]/.test(normalized))throw Error('invalid_file_tab')
  return {key:JSON.stringify([chatId,normalized]),chatId,path:normalized}
}
export function openFileTab(state:FileTabs,chatId:string,path:string):FileTabs{
  const tab=makeFileTab(chatId,path)
  return {tabs:state.tabs.some(item=>item.key===tab.key)?state.tabs:[...state.tabs,tab],active:tab.key,open:true}
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
    try{if(typeof item?.chatId!=='string'||typeof item?.path!=='string')continue;const tab=makeFileTab(item.chatId,item.path);if(!tabs.some(existing=>existing.key===tab.key))tabs.push(tab)}catch{/* Discard invalid stored metadata. */}
  }
  return {tabs,active:tabs.find(tab=>tab.key===raw.active)?.key||tabs[0]?.key||'',open:raw.open===true&&tabs.length>0}
}
