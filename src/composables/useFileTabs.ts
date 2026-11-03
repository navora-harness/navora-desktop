import type {BrowserTreeSession} from '@shared/types'
import type {FileTransfer} from '@shared/file-windows'
import {browserTabAfterRemoval} from '@shared/browser-workspace'
import {computed,onBeforeUnmount,ref,watch,type Ref} from 'vue'
import {closeFileTab,emptyFileTabs,openFileTab,openBrowserTab,showFileWorkspace,removeFileOwner,restoreFileTabs,type FileTabs} from '@shared/file-tabs'
export function useFileTabs(viewer:Ref<string|null>){
  const workspaces=ref(new Map<string,FileTabs>())
  try{const saved=JSON.parse(localStorage.getItem('navora.file-tabs.v1')||'[]');if(Array.isArray(saved))for(const row of saved.slice(-40))if(Array.isArray(row)&&typeof row[0]==='string')workspaces.value.set(row[0],restoreFileTabs(row[1]))}catch{/* Optional metadata restoration. */}
  const current=computed(()=>workspaces.value.get(viewer.value||'')||emptyFileTabs())
  const active=computed(()=>current.value.tabs.find(tab=>tab.key===current.value.active)||null)
  function update(state:FileTabs){if(viewer.value)workspaces.value.set(viewer.value,state)}
  function open(chatId:string,path:string){update(openFileTab(current.value,chatId,path))}
  function openBrowser(){if(viewer.value)update(openBrowserTab(current.value,viewer.value))}
  function updateBrowser(key:string,title:string,url:string,pageId?:string,faviconUrl?:string,loading?:boolean){update({...current.value,tabs:current.value.tabs.map(tab=>tab.key===key&&tab.kind==='browser'?{...tab,pageId:pageId||tab.pageId,path:title.slice(0,160)||'新标签页',url:/^https?:\/\//i.test(url)?url:'about:blank',faviconUrl:/^https?:\/\//i.test(faviconUrl||'')?faviconUrl:undefined,loading:!!loading}:tab)})}
  function removeOwner(owner:string){workspaces.value.delete(owner);for(const [id,state] of workspaces.value)workspaces.value.set(id,removeFileOwner(state,owner))}
  function select(key:string){if(current.value.tabs.some(tab=>tab.key===key))update({...current.value,active:key,open:true})}
  async function close(key:string){
    const tab=current.value.tabs.find(t=>t.key===key),owner=viewer.value
    if(tab?.kind==='browser'&&owner&&window.navora?.app.platform!=='web'){
      const pageId=tab.pageId||await window.navora!.browser.workspace.ensure(tab.chatId,tab.key,tab.url)
      const state=workspaces.value.get(owner)
      if(state)workspaces.value.set(owner,{...state,tabs:state.tabs.map(item=>item.key===key?{...item,pageId}:item)})
      await window.navora!.browser.closeWindow(pageId);return
    }
    update(closeFileTab(current.value,key))
  }
  let pendingMove:{id:string;before?:string}|null=null
  function syncBrowser(tree:BrowserTreeSession[]){
    if(!viewer.value)return
    const live=tree.filter(s=>s.chatId===viewer.value).flatMap(s=>s.windows).filter(w=>w.presentation==='embedded')
    const tabs=current.value.tabs.filter(t=>t.kind!=='browser'||!t.pageId||live.some(w=>w.windowId===t.pageId))
    for(const w of live){const key=w.tabKey||`browser:${w.windowId}`,existing=tabs.find(t=>t.pageId===w.windowId||t.key===key);if(existing){existing.pageId=w.windowId;existing.path=w.title;existing.url=w.url;existing.faviconUrl=w.faviconUrl;existing.loading=w.loading}else tabs.push({key,chatId:viewer.value,path:w.title,url:w.url,kind:'browser',pageId:w.windowId,faviconUrl:w.faviconUrl,loading:w.loading})}
    const selected=browserTabAfterRemoval(current.value.tabs.map(t=>t.key),current.value.active,tabs.map(t=>t.key))
    update({...current.value,tabs,active:selected,open:current.value.open&&(tabs.length>0||current.value.tabs.length===0)})
    if(pendingMove){const move=pendingMove;pendingMove=null;reorder(move.id,move.before)}
  }
  function present(pageId:string){const tab=current.value.tabs.find(t=>t.pageId===pageId);if(tab)select(tab.key)}
    function reorder(pageId:string,before?:string){const tabs=[...current.value.tabs],index=tabs.findIndex(t=>t.pageId===pageId||t.key===pageId);if(index<0){pendingMove={id:pageId,before};return}const tab=tabs[index]!;if(before&&(before===tab.key||before===tab.pageId))return;tabs.splice(index,1);const at=before?tabs.findIndex(t=>t.pageId===before||t.key===before):-1;tabs.splice(at<0?tabs.length:at,0,tab);update({...current.value,tabs})}
  function transfer(event:FileTransfer){
    const state=workspaces.value.get(event.viewerChatId)||emptyFileTabs()
    if(event.kind==='remove'){workspaces.value.set(event.viewerChatId,closeFileTab(state,event.tab.key));return}
    const next=openFileTab(state,event.tab.chatId,event.tab.path),tabs=next.tabs.filter(tab=>tab.key!==event.tab.key),at=tabs.findIndex(tab=>tab.key===event.before)
    tabs.splice(at<0?tabs.length:at,0,event.tab);workspaces.value.set(event.viewerChatId,{...next,tabs})
  }
  function hide(){update({...current.value,open:false})}
  function show(){if(viewer.value)update(showFileWorkspace(current.value,viewer.value))}
  function toggle(){if(current.value.open)hide();else show()}
  let timer:ReturnType<typeof setTimeout>|undefined
  function persist(){try{localStorage.setItem('navora.file-tabs.v1',JSON.stringify([...workspaces.value.entries()].slice(-40)))}catch{/* Storage is optional; file contents never enter storage. */}}
  watch(workspaces,()=>{clearTimeout(timer);timer=setTimeout(persist,150)},{deep:true})
  onBeforeUnmount(()=>{clearTimeout(timer);persist()})
  return {current,active,open,openBrowser,updateBrowser,syncBrowser,present,reorder,select,close,hide,show,toggle,removeOwner,transfer}
}
