import type {BrowserTreeWindow} from './types'
import {browserTabAfterRemoval} from './browser-workspace'
import type {FileTab,FileTabs,WorkspaceBrowserTab} from './file-tabs'

const pageMatches=(tab:FileTab,page:BrowserTreeWindow)=>tab.pageId===page.windowId||!!page.tabKey&&tab.key===page.tabKey
const pinned=(tab:FileTab)=>tab.kind==='browser'&&tab.pinned===true
const webUrl=(url?:string)=>/^https?:\/\//i.test(url||'')?url:undefined
export function workspaceBrowserPageTab(previous:FileTab|undefined,page:BrowserTreeWindow,owner:string):WorkspaceBrowserTab{
  return {...previous,key:previous?.key||page.tabKey||'browser:'+page.windowId,chatId:owner,kind:'browser',pageId:page.windowId,path:page.title||'新标签页',fullTitle:page.title||'',url:webUrl(page.url)||'about:blank',desiredUrl:webUrl(page.desiredUrl),faviconUrl:webUrl(page.faviconUrl),loading:!!page.loading,persistent:page.persistent,pinned:!!page.pinned,muted:!!page.muted,manualMuted:page.manualMuted,muteReason:page.muteReason,audible:!!page.audible,order:page.order,loadFailure:page.loadError?.description}
}

/** A versioned native snapshot covers one resource owner, even in a parent workspace. */
export function applyWorkspaceBrowserSnapshot(previous:FileTabs,versions:ReadonlyMap<string,number>,snapshot:{owner:string;pages:readonly BrowserTreeWindow[];all?:readonly BrowserTreeWindow[];revision:number}){
  if(!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||snapshot.revision<(versions.get(snapshot.owner)??-1))return {accepted:false,state:previous,versions}
  const seen=new Set<string>(),before=previous.tabs.filter(tab=>!seen.has(tab.key)&&!!seen.add(tab.key))
  const owned=before.filter(tab=>tab.kind==='browser'&&tab.chatId===snapshot.owner),all=snapshot.all||snapshot.pages
  const pageIds=new Set<string>(),known=snapshot.pages.filter(page=>!pageIds.has(page.windowId)&&!!pageIds.add(page.windowId)).sort((a,b)=>(a.order??Number.MAX_SAFE_INTEGER)-(b.order??Number.MAX_SAFE_INTEGER)).map(page=>workspaceBrowserPageTab(owned.find(tab=>pageMatches(tab,page)),page,snapshot.owner))
  const knownKeys=new Set(known.map(tab=>tab.key)),pending=owned.filter(tab=>!tab.pageId&&!knownKeys.has(tab.key)&&!all.some(page=>pageMatches(tab,page)))
  const mergePartition=(isPinned:boolean)=>{
    const ordered=known.filter(tab=>pinned(tab)===isPinned),orderedKeys=new Set(ordered.map(tab=>tab.key)),pendingByKey=new Map(pending.filter(tab=>pinned(tab)===isPinned).map(tab=>[tab.key,tab]))
    const result:FileTab[]=[];let index=0
    for(const tab of before.filter(tab=>pinned(tab)===isPinned)){
      if(tab.kind!=='browser'||tab.chatId!==snapshot.owner){result.push(tab);continue}
      const waiting=pendingByKey.get(tab.key)
      if(waiting){result.push(waiting);pendingByKey.delete(tab.key)}
      else if(orderedKeys.has(tab.key)&&ordered[index])result.push(ordered[index++]!)
    }
    result.push(...ordered.slice(index),...pendingByKey.values())
    return result
  }
  const tabs=[...mergePartition(true),...mergePartition(false)],nextVersions=new Map(versions);nextVersions.set(snapshot.owner,snapshot.revision)
  return {accepted:true,state:{tabs,active:browserTabAfterRemoval(before.map(tab=>tab.key),previous.active,tabs.map(tab=>tab.key)),open:previous.open&&tabs.length>0},versions:nextVersions}
}
