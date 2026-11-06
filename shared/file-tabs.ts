type WorkspaceTabBase={key:string;chatId:string;fullTitle?:string;url?:string;desiredUrl?:string;pageId?:string;faviconUrl?:string;loading?:boolean;persistent?:boolean;pinned?:boolean;muted?:boolean;manualMuted?:boolean;muteReason?:'manual'|'agent';audible?:boolean;order?:number;loadFailure?:string}
export type WorkspaceFileTab=WorkspaceTabBase&{kind?:undefined;path:string}
export type WorkspaceBrowserTab=WorkspaceTabBase&{kind:'browser';path:string}
export type WorkspaceSubchatTab=WorkspaceTabBase&{kind:'subchats';parentChatId:string;selectedSubchatId?:string;title:string;path?:never}
export type WorkspaceQuestionnaireTab=WorkspaceTabBase&{kind:'questionnaire';questionnaireId:string;questionnaireRevision:number;questionnaireTitle?:string;title:string;path?:never}
export type FileTab=WorkspaceFileTab|WorkspaceBrowserTab|WorkspaceSubchatTab|WorkspaceQuestionnaireTab
export type WorkspaceTab=FileTab
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
export function makeFileTab(chatId:string,path:string):WorkspaceFileTab{
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
  const tabs=[...state.tabs],current=tabs.findIndex(item=>item.key===state.active)
  const pinnedEnd=tabs.reduce((end,item,index)=>item.pinned?index+1:end,0)
  const at=current<0?tabs.length:tabs[current]?.pinned?pinnedEnd:Math.max(pinnedEnd,current+1)
  tabs.splice(at,0,tab)
  return {tabs,active:tab.key,open:true}
}
export function makeSubchatTab(parentChatId:string,selectedSubchatId?:string):WorkspaceSubchatTab{
  if(!/^[\w-]{1,200}$/.test(parentChatId)||selectedSubchatId!==undefined&&!/^[\w-]{1,200}$/.test(selectedSubchatId))throw Error('invalid_subchat_tab')
  return {key:`subchats:${parentChatId}`,chatId:parentChatId,parentChatId,kind:'subchats',title:'子对话',...(selectedSubchatId?{selectedSubchatId}:{})}
}
export function openSubchatTab(state:FileTabs,parentChatId:string,selectedSubchatId?:string):FileTabs{
  const tab=makeSubchatTab(parentChatId,selectedSubchatId),existing=state.tabs.find(item=>item.key===tab.key)
  if(!existing&&state.tabs.length>=32)throw Error('标签页已达上限，请先关闭部分标签页')
  return {tabs:existing?state.tabs.map(item=>item.key===tab.key?tab:item):[...state.tabs,tab],active:tab.key,open:true}
}
export type QuestionnaireTabInput={chatId:string;questionnaireId:string;questionnaireRevision?:number;questionnaireTitle?:string}
export function questionnaireTabLabel(value:unknown){const title=typeof value==='string'?value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim():'';return title?`问卷: ${title}`:'问卷'}
/** The singleton key is stable even when a different chat's questionnaire replaces it. */
export function makeQuestionnaireTab(input:QuestionnaireTabInput):WorkspaceQuestionnaireTab{
  if(!/^[\w-]{1,200}$/.test(input.chatId)||!/^[\w-]{1,200}$/.test(input.questionnaireId)||input.questionnaireRevision!==undefined&&(!Number.isSafeInteger(input.questionnaireRevision)||input.questionnaireRevision<0))throw Error('invalid_questionnaire_tab')
  const questionnaireTitle=typeof input.questionnaireTitle==='string'?input.questionnaireTitle.trim():undefined
  return {key:'questionnaire',kind:'questionnaire',chatId:input.chatId,questionnaireId:input.questionnaireId,questionnaireRevision:input.questionnaireRevision||0,...(questionnaireTitle?{questionnaireTitle}:{}),title:questionnaireTabLabel(questionnaireTitle)}
}
export function openQuestionnaireTab(state:FileTabs,input:QuestionnaireTabInput):FileTabs{
  const tab=makeQuestionnaireTab(input),existing=state.tabs.find(item=>item.kind==='questionnaire'||item.key===tab.key)
  if(!existing&&state.tabs.length>=32)throw Error('标签页已达上限，请先关闭部分标签页')
  let replaced=false
  const tabs=state.tabs.flatMap<FileTab>(item=>{if(item.kind!=='questionnaire'&&item.key!==tab.key)return [item];if(replaced)return [];replaced=true;return [tab]})
  if(!replaced)tabs.push(tab)
  return {tabs,active:tab.key,open:true}
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

/** Last submitted navigation also counts while the native page still reports about:blank. */
function browserTarget(value:unknown):string|undefined{
  if(typeof value!=='string'||/[\u0000-\u001f\u007f]/.test(value))return
  try{const url=new URL(value.trim());if(url.protocol==='http:'||url.protocol==='https:')return url.href}catch{/* An invalid target is not restorable. */}
}

function restoredActive(source:unknown[],active:string,tabs:FileTab[]):string{
  const available=new Set(tabs.map(tab=>tab.key))
  if(available.has(active))return active
  const key=(item:unknown)=>item&&typeof item==='object'?(item as {key?:unknown}).key:undefined
  const index=source.findIndex(item=>key(item)===active)
  if(index>=0){
    for(let i=index+1;i<source.length;i++){const candidate=key(source[i]);if(typeof candidate==='string'&&available.has(candidate))return candidate}
    for(let i=index-1;i>=0;i--){const candidate=key(source[i]);if(typeof candidate==='string'&&available.has(candidate))return candidate}
  }
  return tabs[0]?.key||''
}

/** Snapshot only: omitting untouched new pages never closes them in the running workspace. */
export function persistedFileTabs(state:FileTabs):FileTabs{
  return restoreFileTabs(state)
}

/** Pinning changes this host's ordering; file tabs remain in the normal section. */
export function setFileTabPinned(state:FileTabs,key:string,pinned:boolean):FileTabs{
  const index=state.tabs.findIndex(tab=>tab.key===key&&tab.kind==='browser')
  if(index<0||!!state.tabs[index]!.pinned===pinned)return state
  const tabs=state.tabs.filter(tab=>tab.key!==key),tab={...state.tabs[index]!,pinned}
  const pinnedEnd=tabs.reduce((end,item,at)=>item.pinned?at+1:end,0)
  tabs.splice(pinnedEnd,0,tab)
  return {...state,tabs}
}

/** Move within the pinned or normal section without changing the selected tab. */
export function moveFileTab(state:FileTabs,key:string,position:'first'|'last'):FileTabs{
  const index=state.tabs.findIndex(tab=>tab.key===key)
  if(index<0)return state
  const tab=state.tabs[index]!,tabs=state.tabs.filter(item=>item.key!==key)
  const pinnedEnd=tabs.reduce((end,item,at)=>item.pinned?at+1:end,0)
  const at=tab.pinned?(position==='first'?0:pinnedEnd):(position==='first'?pinnedEnd:tabs.length)
  tabs.splice(at,0,tab)
  return {...state,tabs}
}

export function restoreFileTabs(value:unknown):FileTabs{
  if(!value||typeof value!=='object')return emptyFileTabs()
  const raw=value as {tabs?:unknown;active?:unknown;open?:unknown},tabs:FileTab[]=[]
  const source:unknown[]=Array.isArray(raw.tabs)?raw.tabs.slice(0,32):[]
  for(const stored of source){
    try{
      if(!stored||typeof stored!=='object')continue
      const item=stored as Partial<FileTab>
      if(typeof item.chatId!=='string')continue
      let tab:FileTab
      if(item.kind==='questionnaire'){
        if(item.key!=='questionnaire'||typeof item.questionnaireId!=='string')continue
        tab=makeQuestionnaireTab({chatId:item.chatId,questionnaireId:item.questionnaireId,questionnaireRevision:item.questionnaireRevision,questionnaireTitle:item.questionnaireTitle})
      }else if(item.kind==='subchats'){
        if(item.parentChatId!==item.chatId)continue
        tab=makeSubchatTab(item.chatId,typeof item.selectedSubchatId==='string'?item.selectedSubchatId:undefined)
        if(item.key!==tab.key)continue
      }else if(item.kind==='browser'){
        if(typeof item.path!=='string')continue
        if(item.persistent===false)continue
        if(typeof item.key!=='string'||!/^browser:[\w-]{1,80}$/.test(item.key)||!/^[\w-]{1,128}$/.test(item.chatId))continue
        const desiredUrl=browserTarget(item.desiredUrl),url=desiredUrl||browserTarget(item.url)
        if(!url)continue
        tab={key:item.key,chatId:item.chatId,path:item.path||'新标签页',fullTitle:typeof item.fullTitle==='string'?item.fullTitle:item.path,kind:'browser',url}
        if(item.persistent===true)tab.persistent=true
        if(desiredUrl)tab.desiredUrl=desiredUrl
        const favicon=browserTarget(item.faviconUrl)
        if(favicon)tab.faviconUrl=favicon
        if(typeof item.pinned==='boolean')tab.pinned=item.pinned
        if(typeof item.manualMuted==='boolean'){tab.manualMuted=item.manualMuted;tab.muted=item.manualMuted}
        else if(typeof item.muted==='boolean'&&item.muteReason!=='agent')tab.muted=item.muted
        if(typeof item.order==='number'&&Number.isFinite(item.order)&&item.order>=0)tab.order=Math.floor(item.order)
      }else {if(typeof item.path!=='string')continue;tab=makeFileTab(item.chatId,item.path)}
      if(!tabs.some(existing=>existing.key===tab.key))tabs.push(tab)
    }catch{/* Discard invalid stored metadata. */}
  }
  return {tabs,active:restoredActive(source,typeof raw.active==='string'?raw.active:'',tabs),open:raw.open===true&&tabs.length>0}
}
