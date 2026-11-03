import {randomUUID} from 'node:crypto'
import type {BrowserRegistry} from './browser-registry'
import type {BrowserPage} from './browser-host'
import {browserAddress,type BrowserTabCommandInput,type BrowserTabCommandResult,type BrowserTabState} from '../../shared/browser-workspace'
import type {AppConfig} from '../../shared/config'
import {isUrlAllowed} from '../../shared/url-allowlist'
import {startOwnedHistoryNavigation} from './browser-navigation-control'

/** Tab identity, order and destructive commands are owned by the main process.
 * Renderers receive snapshots and never infer a transfer from a local removal. */
export class BrowserTabsService {
  constructor(private registry:BrowserRegistry,private getConfig:()=>AppConfig,private chatExists:(id:string)=>boolean){}
  private get hosts(){return this.registry.hosts}
  private source(hostId:string,chatId:string){
    const host=this.hosts.getHost(hostId)
    if(!host||host.window.isDestroyed())throw Error('browser_host_unavailable')
    if(typeof chatId!=='string'||!this.chatExists(chatId))throw Error('browser_wrong_chat')
    if(!host.embedded&&this.hosts.hostPages(hostId).some(id=>this.hosts.pages.get(id)?.chatId!==chatId))throw Error('browser_chat_mismatch')
    return host
  }
  private page(hostId:string,chatId:string,id:string){
    const page=this.hosts.pages.get(id)
    if(!page||page.isDestroyed())throw Error('browser_page_not_found')
    if(page.hostId!==hostId)throw Error('browser_page_wrong_host')
    if(page.chatId!==chatId)throw Error('browser_wrong_chat')
    return page
  }
  state(hostId:string,chatId:string):BrowserTabState{
    const host=this.hosts.getHost(hostId),embedded=host?.embedded??false
    if(host)this.source(hostId,chatId)
    const order=this.hosts.hostPages(hostId).filter(id=>this.hosts.pages.get(id)?.chatId===chatId)
    const byId=new Map(this.registry.getTree(chatId).flatMap(session=>session.windows).map(page=>[page.windowId,page]))
    return {chatId,hostId,embedded,revision:this.registry.tabRevision,order,activeId:host?.active&&order.includes(host.active)?host.active:null,
      pages:order.map(id=>byId.get(id)!).filter(Boolean),recentlyClosed:this.registry.recentlyClosed(chatId),
      compatibleHosts:this.hosts.listHosts().filter(candidate=>candidate.id!==hostId&&(candidate.embedded||this.hosts.hostPages(candidate.id).every(id=>this.hosts.pages.get(id)?.chatId===chatId)))
        .map(candidate=>({id:candidate.id,label:candidate.embedded?'主窗口工作区':candidate.window.getTitle()||'浏览器窗口',embedded:candidate.embedded,tabCount:this.hosts.hostPages(candidate.id).filter(id=>this.hosts.pages.get(id)?.chatId===chatId).length}))}
  }
  private present(page:BrowserPage,background=false){if(!background)this.hosts.present(page)}
  private compatibleTarget(targetId:string,chatId:string){
    const target=this.hosts.getHost(targetId)
    if(!target||target.window.isDestroyed())throw Error('browser_host_unavailable')
    if(!target.embedded&&this.hosts.hostPages(targetId).some(id=>this.hosts.pages.get(id)?.chatId!==chatId))throw Error('browser_chat_mismatch')
    return target
  }
  async transferPages(pageIds:string[],targetId:string,expectedSource?:string){
    const unique=[...new Set(pageIds)],pages=unique.map(id=>this.hosts.pages.get(id))
    if(!pages.length||pages.some(page=>!page||page.isDestroyed()))throw Error('browser_page_not_found')
    const selected=(pages as BrowserPage[]).sort((a,b)=>a.id.localeCompare(b.id)),chatId=selected[0]!.chatId,sourceId=expectedSource||selected[0]!.hostId
    if(!sourceId||selected.some(page=>page.chatId!==chatId||page.hostId!==sourceId))throw Error('browser_drag_stale')
    if(selected.some(page=>page.annotationSelecting))throw Error('browser_busy_finish_action_first')
    this.compatibleTarget(targetId,chatId)
    if(sourceId===targetId)return
    const ordered=this.hosts.hostPages(sourceId).filter(id=>unique.includes(id)),sourceOrder=this.hosts.hostPages(sourceId),sourceActive=this.hosts.getHost(sourceId)?.active
    const lock=async(index:number):Promise<void>=>{
      if(index<selected.length){await selected[index]!.automation.withTransfer(()=>lock(index+1));return}
      if(selected.some(page=>page.isDestroyed()||page.hostId!==sourceId))throw Error('browser_drag_stale')
      this.compatibleTarget(targetId,chatId)
      const moved:BrowserPage[]=[]
      try{for(const id of ordered){const page=this.hosts.pages.get(id)!;this.hosts.transfer(page,targetId,false,false);moved.push(page)}}
      catch(error){
        for(const page of moved.reverse())if(!page.isDestroyed())this.hosts.transfer(page,sourceId,false,false)
        this.hosts.setOrder(sourceId,sourceOrder)
        const active=sourceActive&&this.hosts.pages.get(sourceActive);if(active)this.hosts.activate(active)
        throw error
      }
    }
    try{await lock(0)}finally{this.hosts.closeEmptyDetachedHosts([sourceId,targetId])}
  }
  private targetIds(hostId:string,chatId:string,input:BrowserTabCommandInput){
    const host=this.source(hostId,chatId),raw=input.pageIds?.length?input.pageIds:input.pageId?[input.pageId]:host.active?[host.active]:[]
    if(raw.length>256||raw.some(id=>typeof id!=='string'))throw Error('invalid_browser_tab')
    const selected=new Set(raw)
    for(const id of selected)this.page(hostId,chatId,id)
    return this.hosts.hostPages(hostId).filter(id=>selected.has(id))
  }
  private create(hostId:string,input:BrowserTabCommandInput):BrowserPage{
    const host=this.source(hostId,input.chatId),sourceId=input.pageId||host.active
    const source=input.pageId?this.page(hostId,input.chatId,input.pageId):sourceId&&this.hosts.pages.get(sourceId)?.chatId===input.chatId?this.page(hostId,input.chatId,sourceId):undefined
    if(input.key!==undefined&&(typeof input.key!=='string'||!/^browser:[\w-]{1,128}$/.test(input.key)))throw Error('invalid_browser_tab')
    const existing=input.key?this.registry.getTree(input.chatId).flatMap(session=>session.windows).find(page=>page.tabKey===input.key):undefined
    if(existing){const page=this.page(hostId,input.chatId,existing.windowId);if(input.beforeId!==undefined){if(input.beforeId)this.page(hostId,input.chatId,input.beforeId);this.hosts.reorder(hostId,[page.id],input.beforeId)}return page}
    const url=browserAddress(input.url||'about:blank')
    if(url!=='about:blank'&&!isUrlAllowed(url,this.getConfig().browser.url_allowlist))throw Error('url_not_allowed')
    const sessionId=source?this.registry.getWindowRecord(source.id)!.sessionId:this.registry.getTree(input.chatId)[0]?.sessionId||this.registry.createSession(input.chatId,{persist:true}).sessionId
    const created=this.registry.createWindow(sessionId,{url,show:false,deferLoad:true}),record=this.registry.getWindowRecord(created.windowId)!,page=record.win
    record.tabKey=input.key||`browser:${randomUUID()}`
    this.registry.markDesiredUrl(page.id,url)
    try{
      if(page.hostId!==hostId)this.hosts.transfer(page,hostId,false)
      if(input.beforeId!==undefined){
        if(input.beforeId)this.page(hostId,input.chatId,input.beforeId)
        this.hosts.reorder(hostId,[page.id],input.beforeId)
      }else this.hosts.insertAfter(page,source?.id)
      if(url!=='about:blank')void page.loadURL(url).catch(error=>{if(!page.isDestroyed())console.warn('[browser] new tab navigation failed',error)})
      return page
    }catch(error){this.registry.closeWindow(page.id);throw error}
  }
  async action(hostId:string,input:BrowserTabCommandInput):Promise<BrowserTabCommandResult>{
    if(!input||typeof input!=='object'||typeof input.action!=='string')throw Error('invalid_browser_tab_command')
    const host=this.source(hostId,input.chatId),result:Omit<BrowserTabCommandResult,'state'>={}
    if(input.action==='new'){
      const page=this.create(hostId,input);this.present(page,!!input.background);result.pageId=page.id
    }else if(input.action==='reopen'){
      const entry=this.registry.closedTab(input.chatId,input.closedId)
      if(!entry)throw Error('browser_no_closed_tabs')
      let restoreHost=entry.hostId
      try{this.compatibleTarget(restoreHost,input.chatId)}catch{restoreHost=this.hosts.mainHostId||'';this.compatibleTarget(restoreHost,input.chatId)}
      const page=this.registry.createFromSnapshot(entry,restoreHost)
      const order=this.hosts.hostPages(restoreHost).filter(id=>id!==page.id),at=entry.hostId===restoreHost?Math.min(Math.max(0,entry.index),order.length):order.length
      order.splice(at,0,page.id);this.hosts.setOrder(restoreHost,order)
      this.registry.forgetClosedTab(input.chatId,entry.id);this.present(page,!!input.background);result.pageId=page.id
    }else{
      const ids=this.targetIds(hostId,input.chatId,input),pages=ids.map(id=>this.page(hostId,input.chatId,id))
      const first=pages[0],target=input.pageId?this.page(hostId,input.chatId,input.pageId):first
      if(!first||!target)throw Error('browser_page_not_found')
      switch(input.action){
        case 'activate':this.hosts.present(target);result.pageId=target.id;break
        case 'duplicate':{
          if(this.hosts.pages.size+pages.length>this.getConfig().browser.max_windows_total)throw Error('max_windows_total')
          const created:BrowserPage[]=[],originalOrder=this.hosts.hostPages(hostId),copies=new Map<string,BrowserPage>();let lastPinnedCopy:string|undefined
          try{
            for(const source of pages){
              const snapshot=this.registry.snapshotTab(source.id);if(!snapshot)throw Error('browser_page_not_found')
              const page=this.registry.createFromSnapshot(snapshot,hostId,false);created.push(page);copies.set(source.id,page)
              this.hosts.insertAfter(page,source.pinned?lastPinnedCopy||source.id:source.id)
              if(source.pinned)lastPinnedCopy=page.id
            }
          }catch(error){for(const page of created)this.registry.closeWindow(page.id);this.hosts.setOrder(hostId,originalOrder);throw error}
          const chosen=copies.get(target.id)||created.at(-1)!;this.present(chosen,!!input.background);result.pageId=chosen.id;result.pageIds=created.map(page=>page.id);break
        }
        case 'reload':
          for(const page of pages){
            if(page.annotationSelecting)throw Error('browser_busy_finish_action_first')
            const state=await page.automation.takeControl()
            if(state.error&&!(state.error==='cleanup_unconfirmed'&&state.nativeConfirmed&&!state.inputProtected))throw Error(state.error)
            this.page(hostId,input.chatId,page.id)
            this.registry.markDesiredUrl(page.id,this.registry.getWindowRecord(page.id)?.desiredUrl||page.webContents.getURL()||'about:blank')
            void startOwnedHistoryNavigation(page.webContents,undefined,()=>page.webContents.reload(),60000).catch(()=>{})
          }break
        case 'setPinned':
          if(typeof input.value!=='boolean')throw Error('invalid_browser_tab_command')
          for(const page of pages)this.hosts.setPinned(page,input.value)
          break
        case 'setMuted':
          if(typeof input.value!=='boolean')throw Error('invalid_browser_tab_command')
          for(const page of pages)this.registry.setPageMuted(page,input.value)
          this.hosts.onChanged?.();break
        case 'reorder':
          if(input.beforeId)this.page(hostId,input.chatId,input.beforeId)
          this.hosts.reorder(hostId,ids,input.beforeId);break
        case 'moveFirst':case 'moveLast':{
          const all=this.hosts.hostPages(hostId),selected=new Set(ids)
          for(const pinned of [true,false]){
            const moved=all.filter(id=>selected.has(id)&&this.hosts.pages.get(id)?.pinned===pinned)
            if(!moved.length)continue
            const rest=this.hosts.hostPages(hostId).filter(id=>!moved.includes(id)),partition=rest.map((id,index)=>({id,index})).filter(item=>this.hosts.pages.get(item.id)?.chatId===input.chatId&&this.hosts.pages.get(item.id)?.pinned===pinned)
            const at=input.action==='moveFirst'?(partition[0]?.index??(pinned?0:rest.length)):((partition.at(-1)?.index??(pinned?-1:rest.length-1))+1)
            rest.splice(at,0,...moved);this.hosts.setOrder(hostId,rest)
          }break
        }
        case 'moveToWindow':
          if(typeof input.targetHostId!=='string'||input.targetHostId===hostId)throw Error('invalid_browser_target')
          await this.transferPages(ids,input.targetHostId,hostId);this.present(target,!!input.background);break
        case 'attach':
          if(!this.hosts.mainHostId)throw Error('main_browser_host_unavailable')
          await this.transferPages(ids,this.hosts.mainHostId,hostId);this.present(target,!!input.background);break
        case 'detach':{
          if(pages.some(page=>page.annotationSelecting))throw Error('browser_busy_finish_action_first')
          const newHost=this.hosts.createDetachedHost()
          await this.transferPages(ids,newHost,hostId);this.present(target,!!input.background);break
        }
        case 'close':case 'closeOthers':case 'closeLeft':case 'closeRight':{
          const order=this.hosts.hostPages(hostId).filter(id=>this.hosts.pages.get(id)?.chatId===input.chatId),selected=new Set(ids),indices=ids.map(id=>order.indexOf(id))
          const candidates=input.action==='close'?ids:input.action==='closeOthers'?order.filter(id=>!selected.has(id)):input.action==='closeLeft'?order.slice(0,Math.min(...indices)):order.slice(Math.max(...indices)+1)
          const closing=candidates.filter(id=>!((input.action!=='close'||input.skipPinned)&&this.hosts.pages.get(id)?.pinned))
          result.closed=[];result.cancelled=[]
          for(let index=0;index<closing.length;index++){
            const id=closing[index]!
            if(await this.registry.closeUserTab(id,hostId))result.closed.push(id)
            else{result.cancelled.push(...closing.slice(index));break}
          }break
        }
        default:throw Error('invalid_browser_tab_command')
      }
    }
    return {...result,state:this.state(hostId,input.chatId)}
  }
}
