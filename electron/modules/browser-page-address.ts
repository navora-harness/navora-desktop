import {browserHttpAddress,browserPageAddressState,sameBrowserPageAddress,type BrowserPageAddressContext,type BrowserPageAddressAction} from '../../shared/browser-page-address'
import type {BrowserRegistry} from './browser-registry'

export function browserPageAddressContext(registry:BrowserRegistry,pageId:string):BrowserPageAddressContext|undefined{
  const record=registry.getWindowRecord(pageId),page=record?.win
  if(!record||!page||page.isDestroyed()||!page.hostId)return
  // A failed navigation may retain the previous WebContents URL. Its explicit
  // failure target is handled separately; current-page actions use the live URL.
  return browserPageAddressState({windowId:page.id,chatId:page.chatId,hostWindowId:page.hostId,url:page.webContents.getURL(),loading:record.loading||page.webContents.isLoadingMainFrame(),crashed:record.crashed,loadError:record.loadError,automation:{...page.automation.snapshot(),documentEpoch:page.automation.captureDocumentEpoch()}}).context
}

/** The caller owns authorization; this boundary checks the exact captured target. */
export async function performBrowserPageAddressAction(expected:BrowserPageAddressContext|BrowserPageAddressContext[],action:BrowserPageAddressAction,options:{current:(context:BrowserPageAddressContext)=>BrowserPageAddressContext|undefined;allowed:(url:string)=>boolean;external:(url:string)=>Promise<unknown>;copy:(url:string)=>unknown}){
  if(action!=='copy'&&action!=='external')throw Error('invalid_browser_address_action')
  const contexts=Array.isArray(expected)?expected:[expected]
  if(!contexts.length||contexts.length>256||action==='external'&&contexts.length!==1)throw Error('invalid_browser_address_action')
  const urls=contexts.map(context=>{
    const current=options.current(context)
    if(!sameBrowserPageAddress(context,current))throw Error('browser_page_address_changed')
    if(browserHttpAddress(current!.url)!==current!.url)throw Error('browser_page_address_changed')
    if(!options.allowed(current!.url))throw Error('url_not_allowed')
    return current!.url
  })
  if(action==='copy'){options.copy(urls.join('\n'));return}
  try{await options.external(urls[0]!)}catch{throw Error('browser_external_open_failed')}
}
