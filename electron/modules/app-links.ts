import {ipcMain,type BrowserWindow,type WebContents} from 'electron'
import type {AppConfig} from '../../shared/config'
import {appLinkMode,appLinkUrl,type AppLinkRequest,type AppLinkResult} from '../../shared/app-links'
import {isUrlAllowed} from '../../shared/url-allowlist'
import type {BrowserRegistry} from './browser-registry'

/** User links create new pages; they never navigate a task's existing page. */
export type AppLinkOptions={registry:BrowserRegistry;getConfig:()=>AppConfig;chatExists:(id:string)=>boolean;trusted:(sender:WebContents,chatId?:string)=>BrowserWindow|undefined;external:(url:string)=>Promise<unknown>}
export function createAppLinkService(options:AppLinkOptions) {
  async function open(sender:WebContents,input:AppLinkRequest):Promise<AppLinkResult> {
    try {
      if(!input||typeof input!=='object'||input.mode!==undefined&&!['window','tab','external'].includes(input.mode))throw Error('invalid_link')
      const url=appLinkUrl(input.url),chatId=input.chatId
      if(chatId!==undefined&&(typeof chatId!=='string'||chatId.length>256))throw Error('chat_required')
      if(!options.trusted(sender,chatId))throw Error('local_only')
      const config=options.getConfig(),mode=appLinkMode(input.mode??config.browser.link_open_mode)
      if(mode==='external'){await options.external(url);return {ok:true}}
      if(!chatId||!options.chatExists(chatId))throw Error('chat_required')
      if(!isUrlAllowed(url,config.browser.url_allowlist))throw Error('url_not_allowed')
      const registry=options.registry,session=await registry.resolveSession(chatId)
      if(!options.trusted(sender,chatId)||!options.chatExists(chatId))throw Error('chat_required')
      const created=registry.createWindow(session.sessionId,{chatId,url,show:false,deferLoad:true})
      const page=registry.getWindowRecord(created.windowId)!.win
      try {
        const source=registry.hosts.hostForSender(sender)
        if(mode==='window')registry.hosts.detach(page)
        else if(source&&!source.embedded&&registry.hosts.hostPages(source.id).every(id=>registry.hosts.pages.get(id)?.chatId===chatId))registry.hosts.transfer(page,source.id,false)
        registry.markDesiredUrl(page.id,url)
        // Await the actual navigation so a failure is reported against this new page.
        await page.loadURL(url)
        if(page.isDestroyed())throw Error('browser_page_not_found')
        registry.hosts.present(page)
        return {ok:true,pageId:page.id}
      } catch(error) {
        // Keep a page that has a visible navigation error available for retry.
        if(!page.isDestroyed())registry.hosts.present(page)
        throw error
      }
    } catch(error) {return {ok:false,error:error instanceof Error?error.message:String(error)}}
  }
  return {open}
}

export function createAppLinkOpener(options:AppLinkOptions) {
  const service=createAppLinkService(options)
  ipcMain.handle('navora:app.openLink',(event,input:AppLinkRequest)=>{
    if(event.senderFrame!==event.sender.mainFrame)return {ok:false,error:'local_only'}
    return service.open(event.sender,input)
  })
  return service
}
