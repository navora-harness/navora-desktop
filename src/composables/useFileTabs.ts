import type {BrowserTreeSession,BrowserTreeWindow} from '@shared/types'
import type {FileTransfer} from '@shared/file-windows'
import {type BrowserTabState,type BrowserWorkspaceApi} from '@shared/browser-workspace'
import {computed,onBeforeUnmount,ref,watch,type Ref} from 'vue'
import {closeFileTab,emptyFileTabs,openFileTab,openBrowserTab,openSubchatTab,makeQuestionnaireTab,openQuestionnaireTab,showFileWorkspace,removeFileOwner,type FileTab,type FileTabs} from '@shared/file-tabs'
import {applyWorkspaceBrowserSnapshot} from '@shared/workspace-browser-snapshot'
import {WORKSPACE_TABS_STORAGE,restoreWorkspaces,persistWorkspaces} from '@shared/workspace-tabs-persistence'
import {browserPagesByChat} from '@shared/browser-resource-sessions'

type BrowserMetadata=Pick<BrowserTreeWindow,'desiredUrl'|'persistent'|'pinned'|'muted'|'manualMuted'|'muteReason'|'audible'|'order'>
export function useFileTabs(viewer:Ref<string|null>,notify?:(message:string)=>void){
  const workspaces=ref(new Map<string,FileTabs>())
  const revisions=new Map<string,ReadonlyMap<string,number>>(),pendingCreates=new Map<string,Promise<void>>()
  let disposed=false,presentationRequest=0,pendingMove:{owner:string;id:string;before?:string;pageIds?:string[]}|null=null
  const read=(key:string)=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
  workspaces.value=restoreWorkspaces(read(WORKSPACE_TABS_STORAGE),read('navora.file-tabs.v1'))
  const current=computed(()=>workspaces.value.get(viewer.value||'')||emptyFileTabs())
  const active=computed(()=>current.value.tabs.find(tab=>tab.key===current.value.active)||null)
  const api=():BrowserWorkspaceApi|undefined=>window.navora?.app.platform!=='web'?window.navora?.browser.workspace:undefined
  function report(message:string){if(!disposed){if(notify)notify(message);else console.warn('[workspace]',message)}}
  function update(state:FileTabs,owner=viewer.value){if(owner&&!disposed)workspaces.value.set(owner,state)}
  const stateFor=(owner:string)=>workspaces.value.get(owner)||emptyFileTabs()
  const isPage=(tab:FileTab,page:BrowserTreeWindow)=>tab.pageId===page.windowId||!!page.tabKey&&tab.key===page.tabKey
  const webUrl=(url?:string)=>/^https?:\/\//i.test(url||'')?url:undefined
  /** Snapshot versions are tracked per viewer and the resource owner they cover. */
  function reconcile(owner:string,resourceOwner:string,pages:BrowserTreeWindow[],all:BrowserTreeWindow[],revision:number){
    if(disposed)return false
    const result=applyWorkspaceBrowserSnapshot(stateFor(owner),revisions.get(owner)||new Map(),{owner:resourceOwner,pages,all,revision})
    if(!result.accepted)return false
    revisions.set(owner,result.versions);update(result.state,owner)
    const move=pendingMove
    if(move?.owner===owner&&(move.pageIds?.length?move.pageIds:[move.id]).every(id=>result.state.tabs.some(tab=>tab.key===id||tab.pageId===id))){pendingMove=null;reorder(move.id,move.before,owner,move.pageIds)}
    return true
  }
  function accept(owner:string,state:BrowserTabState){return state.embedded&&reconcile(owner,state.chatId,state.pages,state.pages,state.revision)}
  async function refresh(owner:string,resourceOwner=owner){
    try{const state=await api()?.tabState(resourceOwner);if(state)accept(owner,state);return state}catch{return undefined}
  }
  function open(chatId:string,path:string){presentationRequest++;update(openFileTab(current.value,chatId,path))}
  function openSubchats(parentChatId:string,selectedSubchatId?:string){presentationRequest++;update(openSubchatTab(stateFor(parentChatId),parentChatId,selectedSubchatId),parentChatId)}
  function openQuestionnaire(questionnaire:{id:string;chatId:string;schemaRevision:number;title?:string}){
    const owner=viewer.value
    if(!owner||disposed)return false
    let next:FileTabs
    try{next=openQuestionnaireTab(stateFor(owner),{chatId:questionnaire.chatId,questionnaireId:questionnaire.id,questionnaireRevision:questionnaire.schemaRevision,questionnaireTitle:questionnaire.title})}
    catch{report('标签页已达上限，请先关闭部分标签页。');return false}
    presentationRequest++
    // One presentation container across every chat workspace; answers belong to
    // their own questionnaire record and never to this shared tab identity.
    for(const [id,state]of workspaces.value)if(id!==owner){
      const tabs=state.tabs.filter(tab=>tab.kind!=='questionnaire')
      if(tabs.length!==state.tabs.length)update({...state,tabs,active:tabs.some(tab=>tab.key===state.active)?state.active:tabs[0]?.key||'',open:state.open&&tabs.length>0},id)
    }
    update(next,owner)
    return true
  }
  function updateQuestionnaire(questionnaire:{id:string;chatId:string;schemaRevision:number;title?:string}){
    for(const [owner,state]of workspaces.value){
      let changed=false
      const tabs=state.tabs.map(tab=>{
        if(tab.kind!=='questionnaire'||tab.questionnaireId!==questionnaire.id||tab.chatId!==questionnaire.chatId)return tab
        const next=makeQuestionnaireTab({chatId:questionnaire.chatId,questionnaireId:questionnaire.id,questionnaireRevision:questionnaire.schemaRevision,questionnaireTitle:questionnaire.title})
        if(tab.title===next.title&&tab.questionnaireTitle===next.questionnaireTitle&&tab.questionnaireRevision===next.questionnaireRevision)return tab
        changed=true;return next
      })
      if(changed)update({...state,tabs},owner)
    }
  }
  function selectSubchat(key:string,selectedSubchatId:string|null){presentationRequest++;update({...current.value,tabs:current.value.tabs.map(tab=>tab.key===key&&tab.kind==='subchats'?{...tab,selectedSubchatId:selectedSubchatId||undefined}:tab)})}
  function openBrowser(afterKey?:string):Promise<void>{
    presentationRequest++
    const owner=viewer.value,backend=api()
    if(!owner)return Promise.resolve()
    if(!backend){report('此操作需要桌面端浏览器。');return Promise.resolve()}
    const previous=stateFor(owner),anchorId=typeof afterKey==='string'?afterKey:previous.active
    const anchor=previous.tabs.find(tab=>tab.key===anchorId||tab.pageId===anchorId)
    let next:FileTabs
    try{next=openBrowserTab({...previous,active:anchor?.key||previous.active},owner)}catch{report('标签页已达上限，请先关闭部分标签页。');return Promise.resolve()}
    const key=next.active
    update(next,owner)
    const creation=(async()=>{
      try{
        if(anchor)await pendingCreates.get(anchor.key)
        let source=anchor&&stateFor(owner).tabs.find(tab=>tab.key===anchor.key)
        if(source?.kind==='browser'&&source.chatId!==owner)source=undefined
        if(source?.kind==='browser'&&!source.pageId){
          const sourceKey=source.key,pageId=await backend.ensure(source.chatId,sourceKey,source.desiredUrl||source.url)
          update({...stateFor(owner),tabs:stateFor(owner).tabs.map(tab=>tab.key===sourceKey?{...tab,pageId}:tab)},owner)
          source={...source,pageId}
        }
        const state=stateFor(owner),sourceAt=source?state.tabs.findIndex(tab=>tab.key===source.key):-1
        const before=source?.kind!=='browser'&&sourceAt>=0?state.tabs.slice(sourceAt+1).find(tab=>tab.kind==='browser'&&tab.key!==key&&tab.pageId)?.pageId:undefined
        const result=await backend.tabAction({chatId:owner,action:'new',key,url:'about:blank',pageId:source?.kind==='browser'?source.pageId:undefined,...(source?.kind!=='browser'?{beforeId:before||null}:{})})
        if(result.pageId)update({...stateFor(owner),tabs:stateFor(owner).tabs.map(tab=>tab.key===key?{...tab,pageId:result.pageId}:tab)},owner)
        accept(owner,result.state)
      }catch{
        const recovered=await refresh(owner)
        if(!recovered?.pages.some(page=>page.tabKey===key)){
          update(closeFileTab(stateFor(owner),key),owner)
          report('无法新建标签页，请稍后重试。')
        }
      }finally{pendingCreates.delete(key)}
    })()
    pendingCreates.set(key,creation)
    return creation
  }
  function updateBrowser(key:string,title:string,url:string,pageId?:string,faviconUrl?:string,loading?:boolean,metadata?:Partial<BrowserMetadata>){
    update({...current.value,tabs:current.value.tabs.map(tab=>tab.key===key&&tab.kind==='browser'?{...tab,pageId:pageId||tab.pageId,path:title||'新标签页',fullTitle:title,url:webUrl(url)||'about:blank',faviconUrl:webUrl(faviconUrl),loading:!!loading,...metadata}:tab)})
  }
  function removeOwner(owner:string){workspaces.value.delete(owner);revisions.delete(owner);for(const [viewer,versions]of revisions){const remaining=new Map(versions);remaining.delete(owner);revisions.set(viewer,remaining)}for(const [id,state] of workspaces.value)workspaces.value.set(id,removeFileOwner(state,owner))}
  function select(key:string){
    presentationRequest++
    const owner=viewer.value,tab=current.value.tabs.find(tab=>tab.key===key)
    if(!owner||!tab)return
    update({...current.value,active:key,open:true})
    if(tab.kind==='browser'&&tab.pageId&&api())void api()!.tabAction({chatId:tab.chatId,action:'activate',pageId:tab.pageId}).then(result=>accept(owner,result.state)).catch(()=>refresh(owner,tab.chatId))
  }
  /** Resolve only after optimistic creation settles, including batch menu commands. */
  async function resolveBrowser(key:string,owner=viewer.value):Promise<string>{
    const backend=api()
    if(!owner||disposed)throw Error('browser_page_not_found')
    if(!backend)throw Error('browser_desktop_only')
    const matches=(tab:FileTab)=>tab.kind==='browser'&&(tab.key===key||tab.pageId===key)
    const initial=stateFor(owner).tabs.find(matches)
    if(!initial)throw Error('browser_page_not_found')
    await pendingCreates.get(initial.key)
    const target=stateFor(owner).tabs.find(matches)
    if(!target||disposed)throw Error('browser_page_not_found')
    if(target.pageId)return target.pageId
    const pageId=await backend.ensure(target.chatId,target.key,target.desiredUrl||target.url)
    const state=stateFor(owner)
    if(disposed||!state.tabs.some(tab=>tab.kind==='browser'&&tab.key===target.key))throw Error('browser_page_not_found')
    update({...state,tabs:state.tabs.map(tab=>tab.key===target.key?{...tab,pageId}:tab)},owner)
    return pageId
  }
  async function close(key:string){
    presentationRequest++
    const owner=viewer.value,tab=current.value.tabs.find(tab=>tab.key===key),backend=api()
    if(!owner||!tab)return
    if(tab.kind!=='browser'||!backend){update(closeFileTab(current.value,key));return}
    try{
      const pageId=await resolveBrowser(key,owner)
      const result=await backend.tabAction({chatId:tab.chatId,action:'close',pageId})
      accept(owner,result.state)
      if(result.cancelled?.includes(pageId))report('网页取消了关闭，标签页已保留。')
    }catch{await refresh(owner,tab.chatId);report('无法关闭标签页，请稍后重试。')}
  }
  function syncBrowser(tree:BrowserTreeSession[]){
    const owner=viewer.value
    if(!owner)return
    const groups=browserPagesByChat(tree)
    const owners=new Set([owner,...groups.keys(),...stateFor(owner).tabs.filter(tab=>tab.kind==='browser').map(tab=>tab.chatId)])
    for(const resourceOwner of owners){
      const all=groups.get(resourceOwner),versions=all?.flatMap(page=>typeof page.tabRevision==='number'?[page.tabRevision]:[])||[]
      // Missing or empty owners carry no revision. Confirm their own snapshot;
      // a root-only tree is never authority to delete a child's pages.
      if(!all?.length||!versions.length){void refresh(owner,resourceOwner);continue}
      reconcile(owner,resourceOwner,all.filter(page=>page.presentation==='embedded'),all,Math.max(...versions))
    }
  }
  // This is an acknowledgement from onPresent, never another activate command.
  function present(pageId:string){const tab=current.value.tabs.find(tab=>tab.pageId===pageId);if(tab)update({...current.value,active:tab.key,open:true})}
  async function presentResource(pageId:string,resourceOwner:string){
    const request=++presentationRequest,owner=viewer.value,backend=api();if(!owner||!backend)return false
    const state=await backend.tabState(resourceOwner),page=state.pages.find(page=>page.windowId===pageId)
    // A present notification acknowledges a previous native selection. Its late
    // state read must not become a new activation over a newer tab/user intent.
    if(request!==presentationRequest||!page||disposed||viewer.value!==owner||!state.embedded||state.activeId!==pageId||page.presentation!=='embedded')return false
    if(!accept(owner,state))return false
    const previous=stateFor(owner),tab=previous.tabs.find(tab=>tab.kind==='browser'&&isPage(tab,page))
    if(!tab)return false
    update({...previous,active:tab.key,open:true},owner)
    return true
  }
  function reorder(pageId:string,before?:string,owner=viewer.value,pageIds?:string[]){
    if(!owner||disposed)return
    const previous=stateFor(owner),ids=[...new Set(pageIds?.length?[pageId,...pageIds]:[pageId])]
    const matches=(tab:FileTab,id:string)=>tab.pageId===id||tab.key===id
    if(ids.some(id=>!previous.tabs.some(tab=>matches(tab,id)))){
      const move={owner,id:pageId,before,pageIds:ids}
      pendingMove=move
      // A cross-window drop can finish before this renderer receives its tree.
      void refresh(owner).then(state=>{
        if(pendingMove!==move||!state||disposed)return
        pendingMove=null
        if(ids.every(id=>stateFor(owner).tabs.some(tab=>matches(tab,id))))reorder(pageId,before,owner,ids)
        else report('标签页已移动或关闭，正在更新列表。')
      })
      return
    }
    const moved=previous.tabs.filter(tab=>ids.some(id=>matches(tab,id))),selected=new Set(moved.map(tab=>tab.key))
    if(before&&moved.some(tab=>matches(tab,before)))return
    const tabs=previous.tabs.filter(tab=>!selected.has(tab.key))
    // A mixed selection moves separately inside each pin partition. No drop
    // implicitly pins or unpins a page, and file tabs keep their relative order.
    for(const pinned of [true,false]){
      const group=moved.filter(tab=>!!tab.pinned===pinned)
      if(!group.length)continue
      const pinnedEnd=tabs.reduce((end,item,at)=>item.pinned?at+1:end,0)
      const requested=before?tabs.findIndex(tab=>matches(tab,before)):-1
      const at=pinned?Math.min(requested<0?pinnedEnd:requested,pinnedEnd):Math.max(requested<0?tabs.length:requested,pinnedEnd)
      tabs.splice(at,0,...group)
    }
    update({...previous,tabs},owner)
    const backend=api()
    if(!backend||!moved.some(tab=>tab.kind==='browser'))return
    void (async()=>{
      for(const resourceOwner of new Set(moved.filter(tab=>tab.kind==='browser').map(tab=>tab.chatId)))for(const pinned of [true,false]){
        const group=moved.filter(tab=>tab.kind==='browser'&&tab.chatId===resourceOwner&&!!tab.pinned===pinned)
        if(!group.length)continue
        const pages=await Promise.all(group.map(tab=>resolveBrowser(tab.key,owner)))
        const last=tabs.reduce((at,tab,index)=>selected.has(tab.key)&&tab.chatId===resourceOwner&&!!tab.pinned===pinned?index:at,-1)
        const next=tabs.slice(last+1).find(tab=>tab.kind==='browser'&&tab.chatId===resourceOwner&&!selected.has(tab.key)&&!!tab.pinned===pinned)
        const beforeId=next?await resolveBrowser(next.key,owner):null
        const result=(await backend.tabAction({chatId:resourceOwner,action:'reorder',pageIds:pages,beforeId})).state
        accept(owner,result)
      }
    })().catch(async()=>{await refresh(owner);report('无法移动标签页，请稍后重试。')})
  }
  function transfer(event:FileTransfer){
    if(event.tab.kind!==undefined)return
    const state=stateFor(event.viewerChatId)
    if(event.kind==='remove'){update(closeFileTab(state,event.tab.key),event.viewerChatId);return}
    const next=openFileTab(state,event.tab.chatId,event.tab.path),tabs=next.tabs.filter(tab=>tab.key!==event.tab.key),at=tabs.findIndex(tab=>tab.key===event.before)
    tabs.splice(at<0?tabs.length:at,0,event.tab);update({...next,tabs},event.viewerChatId)
  }
  function hide(){presentationRequest++;update({...current.value,open:false})}
  function show(){if(viewer.value){if(!current.value.tabs.length)void openBrowser();else update(showFileWorkspace(current.value,viewer.value))}}
  function toggle(){if(current.value.open)hide();else show()}
  let timer:ReturnType<typeof setTimeout>|undefined
  function persist(){try{localStorage.setItem(WORKSPACE_TABS_STORAGE,JSON.stringify(persistWorkspaces(workspaces.value)))}catch{/* Storage is optional; file contents never enter storage. */}}
  watch(workspaces,()=>{clearTimeout(timer);timer=setTimeout(persist,150)},{deep:true})
  watch(viewer,()=>{presentationRequest++},{flush:'sync'})
  onBeforeUnmount(()=>{disposed=true;presentationRequest++;clearTimeout(timer);persist()})
  return {current,active,open,openBrowser,openSubchats,openQuestionnaire,updateQuestionnaire,selectSubchat,updateBrowser,resolveBrowser,syncBrowser,present,presentResource,reorder,select,close,hide,show,toggle,removeOwner,transfer}
}
