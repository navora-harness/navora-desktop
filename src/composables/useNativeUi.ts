import {onBeforeUnmount,ref,watch} from 'vue'
import {BROWSER_CHROME_OPEN} from '@shared/browser-chrome-events'
import {getUiIcon} from '@shared/ui-icons'
import {NATIVE_UI_OPEN,type NativeAnchor,type NativeMenuItem,type NativePanelAction,type NativePanelContent,type NativePlacement,type NativeUiApi,type NativeUiTheme} from '@shared/native-ui'

const menusSupported=ref(false),panelsSupported=ref(false)
let loading:Promise<void>|undefined
const bridge=():NativeUiApi|undefined=>window.navora?.app.platform==='web'?undefined:window.navora?.nativeUi
async function ready(){
  if(!loading)loading=(async()=>{try{const value=await bridge()?.capabilities();menusSupported.value=!!value?.menus;panelsSupported.value=!!value?.panels}catch{menusSupported.value=false;panelsSupported.value=false}})()
  await loading
}
type Anchor=HTMLElement|NativeAnchor
const rect=(anchor:Anchor):NativeAnchor=>{const r=anchor instanceof HTMLElement?anchor.getBoundingClientRect():anchor;return {x:r.x,y:r.y,width:Math.max(1,r.width),height:Math.max(1,r.height)}}
function hex(value:string,fallback:string){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1
  const ctx=canvas.getContext('2d');if(!ctx)return fallback
  ctx.fillStyle=fallback;try{ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const data=ctx.getImageData(0,0,1,1).data;return '#'+[data[0],data[1],data[2]].map(n=>n!.toString(16).padStart(2,'0')).join('')}catch{return fallback}
}
function theme(anchor?:Anchor):NativeUiTheme{
  const element=anchor instanceof HTMLElement?anchor:document.querySelector('.navora-app')||document.documentElement,style=getComputedStyle(element)
  const color=(key:string,fallback:string)=>hex(style.getPropertyValue(key).trim()||fallback,fallback)
  const background=color('--navora-surface','#ffffff'),brightness=parseInt(background.slice(1,3),16)+parseInt(background.slice(3,5),16)+parseInt(background.slice(5),16)
  return {mode:brightness<384?'dark':'light',background,text:color('--navora-ink','#263b55'),muted:color('--navora-muted','#718096'),accent:color('--navora-accent','#3978b5'),border:color('--navora-stroke','#dbe2eb'),fontFamily:'Segoe UI',fontSize:13}
}
const iconCache=new Map<string,Promise<string>>()
function iconNames(value:NativePanelContent|NativeMenuItem[]):string[]{return Array.isArray(value)?value.flatMap(item=>[...(item.icon?[item.icon]:[]),...iconNames(item.children||[])]):[...(value.icon?[value.icon]:[]),...(value.children||[]).flatMap(iconNames)]}
async function icons(value:NativePanelContent|NativeMenuItem[],appearance:NativeUiTheme){
  const color=appearance.text||'#263b55',scale=Math.max(1,Math.min(4,window.devicePixelRatio||1))
  const entries=await Promise.all([...new Set(iconNames(value))].map(async name=>{
    const key=`${name}:${color}:${scale}`
    if(!iconCache.has(key))iconCache.set(key,(async()=>{
      const asset=getUiIcon(name,16),audio=name==='tab-muted'||name==='tab-audio'
      const paths=audio?`<path d="M2 6h3l4-3v10l-4-3H2z" fill="none" stroke="${color}" stroke-width="1.2"/>${name==='tab-muted'?`<path d="m11 6 4 4m0-4-4 4" stroke="${color}" stroke-width="1.2"/>`:`<path d="M11 5q5 3 0 6" fill="none" stroke="${color}" stroke-width="1.2"/>`}`:asset.paths.map(p=>`<path d="${p.d}" fill="${p.fill||color}"${p.fillRule?` fill-rule="${p.fillRule}"`:''}${asset.strokeWidth?` stroke="${color}" stroke-width="${asset.strokeWidth}"`:''}/>`).join('')
      const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 ${audio?16:asset.size} ${audio?16:asset.size}">${paths}</svg>`);await image.decode()
      const canvas=document.createElement('canvas');canvas.width=canvas.height=Math.ceil(16*scale);canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png')
    })())
    return [name,await iconCache.get(key)!] as const
  }))
  return Object.fromEntries(entries)
}
function announce(id:string){window.dispatchEvent(new Event('navora:tab-hover-dismiss'));window.dispatchEvent(new CustomEvent(NATIVE_UI_OPEN,{detail:{id}}))}

export function useNativeUi(){
  let requestId:string|undefined,disposed=false
  async function closeMenu(){const id=requestId;requestId=undefined;if(id)await bridge()?.closeMenu(id)}
  async function popupMenu(items:NativeMenuItem[],anchor:Anchor,options:{placement?:NativePlacement;contextKey?:string}={}){
    await ready();if(disposed||!menusSupported.value||!bridge())return {supported:false}
    const id=crypto.randomUUID(),appearance=theme(anchor);requestId=id;announce(id)
    try{const images=await icons(items,appearance);if(disposed||requestId!==id)return {supported:true,reason:'closed' as const};return await bridge()!.popupMenu({requestId:id,items,anchor:rect(anchor),icons:images,...options})}
    finally{if(requestId===id)requestId=undefined}
  }
  async function showPageInfo(pageId:string,anchor:Anchor,siteUrl?:string){await ready();const api=bridge();if(!api)return false;announce('page-info:'+pageId);return api.showPageInfo(pageId,rect(anchor),siteUrl)}
  const domOpened=()=>void closeMenu()
  const nativeOpened=(event:Event)=>{if((event as CustomEvent<{id:string}>).detail?.id!==requestId)void closeMenu()}
  window.addEventListener(BROWSER_CHROME_OPEN,domOpened)
  window.addEventListener(NATIVE_UI_OPEN,nativeOpened)
  onBeforeUnmount(()=>{disposed=true;window.removeEventListener(BROWSER_CHROME_OPEN,domOpened);window.removeEventListener(NATIVE_UI_OPEN,nativeOpened);void closeMenu()})
  void ready()
  return {menusSupported,panelsSupported,ready,popupMenu,closeMenu,showPageInfo}
}

export function useNativePanel(options:{key?:string;sourcePageId?:()=>string|undefined;contextKey?:()=>string;onAction:(action:NativePanelAction)=>void;onDismissed?:()=>void;onClosed?:()=>void}){
  const id=`${options.key||'panel'}:${crypto.randomUUID()}`,open=ref(false),pending=ref(false),error=ref('')
  let session:string|undefined,epoch=0,updateRevision=0,disposed=false,anchor:Anchor|undefined,lastContent:NativePanelContent|undefined,interval:ReturnType<typeof setInterval>|undefined,appearance='',bounds='',zoom=0,context='',unsubscribe:(()=>void)|undefined
  const stop=()=>{clearInterval(interval);interval=undefined}
  function listen(){if(unsubscribe)return;unsubscribe=bridge()?.onPanelEvent(event=>{
    if(event.id!==id||event.session!==session||disposed)return
    if(context!==(options.contextKey?.()||'')){void hide();return}
    if(event.kind==='action'&&open.value&&event.action)options.onAction(event.action)
    else if(event.kind==='dismissed'){open.value=false;stop();options.onDismissed?.()}
    else if(event.kind==='closed'){session=undefined;open.value=false;stop();options.onClosed?.()}
  })}
  async function syncAnchor(){
    if(!open.value||!session||!anchor||disposed)return
    if(anchor instanceof HTMLElement&&(!anchor.isConnected||!anchor.checkVisibility())){await hide();return}
    const nextBounds=rect(anchor),nextTheme=theme(anchor),encoded=JSON.stringify(nextBounds),styled=JSON.stringify(nextTheme),factor=window.devicePixelRatio
    if(encoded!==bounds||styled!==appearance||zoom!==factor){const repaint=styled!==appearance||zoom!==factor;bounds=encoded;appearance=styled;zoom=factor;if(repaint&&lastContent)await update(lastContent,anchor);else await bridge()?.updatePanel(id,session,{anchor:nextBounds,theme:nextTheme})}
  }
  async function hide(){epoch++;updateRevision++;pending.value=false;open.value=false;stop();const current=session;if(current)await bridge()?.hidePanel(id,current)}
  async function destroy(){await hide();const current=session;session=undefined;if(current)await bridge()?.destroyPanel(id,current)}
  async function show(content:NativePanelContent,target:Anchor,settings:{placement?:NativePlacement;focusMode?:'none'|'menu'|'input'}={}){
    await ready();const api=bridge();if(disposed||!panelsSupported.value||!api)return false
    const generation=++epoch,sourcePageId=options.sourcePageId?.();updateRevision++;lastContent=content;anchor=target;context=options.contextKey?.()||'';listen();pending.value=true;open.value=true;error.value='';session=undefined;announce(id)
    try{
      const currentTheme=theme(target),images=await icons(content,currentTheme)
      if(disposed||generation!==epoch)return false
      const result=await api.showPanel({id,content,anchor:rect(target),icons:images,theme:currentTheme,contextKey:context,sourcePageId,...settings})
      if(disposed||generation!==epoch){if(result.supported)await api.hidePanel(id,result.session);return false}
      session=result.session;open.value=result.supported
      if(result.supported){stop();interval=setInterval(()=>void syncAnchor().catch(e=>{error.value=String(e)}),150);if(lastContent&&lastContent!==content)await update(lastContent,target);await syncAnchor()}
      return result.supported
    }catch(e){if(generation===epoch){error.value=String(e);open.value=false};throw e}
    finally{if(generation===epoch)pending.value=false}
  }
  async function update(content:NativePanelContent,target?:Anchor){
    lastContent=content
    if(target)anchor=target
    const current=session,generation=epoch,revision=++updateRevision;if(!current||!open.value||disposed)return false
    try{const currentTheme=theme(anchor),images=await icons(content,currentTheme)
      if(current!==session||generation!==epoch||revision!==updateRevision||!open.value)return false
      return await bridge()?.updatePanel(id,current,{content,icons:images,theme:currentTheme,...(target?{anchor:rect(target)}:{})})||false}
    catch(e){if(generation===epoch)error.value=String(e);return false}
  }
  const domOpened=()=>{if(open.value||pending.value)void hide()}
  const nativeOpened=(event:Event)=>{if((event as CustomEvent<{id:string}>).detail?.id!==id&&(open.value||pending.value))void hide()}
  window.addEventListener(BROWSER_CHROME_OPEN,domOpened)
  window.addEventListener(NATIVE_UI_OPEN,nativeOpened)
  if(options.contextKey)watch(options.contextKey,()=>{if(open.value||pending.value)void hide()})
  onBeforeUnmount(()=>{disposed=true;window.removeEventListener(BROWSER_CHROME_OPEN,domOpened);window.removeEventListener(NATIVE_UI_OPEN,nativeOpened);unsubscribe?.();void destroy()})
  void ready()
  return {id,supported:panelsSupported,open,pending,error,ready,show,update,hide,destroy}
}
