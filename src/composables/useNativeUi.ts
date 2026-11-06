import {onBeforeUnmount,ref,watch} from 'vue'
import {BROWSER_CHROME_OPEN} from '@shared/browser-chrome-events'
import {getUiIcon} from '@shared/ui-icons'
import {nativePanelPresentationTree,nativePanelInteraction,nativePanelShouldDismiss,nativePanelFirstFocusable,nativePanelTreePatch} from '@shared/native-ui-validation'
import {NATIVE_UI_OPEN,type NativeAnchor,type NativeMenuItem,type NativeMenuControlEvent,type NativeMenuAppearance,type NativePanelAction,type NativePanelContent,type NativePanelOptions,type NativePanelRole,type NativePlacement,type NativeUiApi,type NativeUiIcons,type NativeUiTheme,type NativePanelCommand,type NativePanelNodePatch} from '@shared/native-ui'

const menusSupported=ref(false),panelsSupported=ref(false),menuControlsSupported=ref(false),menuAppearanceSupported=ref(false),panelTextareaSupported=ref(false),panelItemsSupported=ref(false),panelScrollbarsSupported=ref(false)
const panelApiVersion=ref(1),panelFeatures=ref<string[]>([])
let loading:Promise<void>|undefined
const bridge=():NativeUiApi|undefined=>window.navora?.app.platform==='web'?undefined:window.navora?.nativeUi
async function ready(){
  if(!loading)loading=(async()=>{try{const value=await bridge()?.capabilities();menusSupported.value=!!value?.menus;panelsSupported.value=!!value?.panels;menuControlsSupported.value=!!value?.menuControls;menuAppearanceSupported.value=!!value?.menuAppearance;panelTextareaSupported.value=!!value?.panelTextarea;panelItemsSupported.value=!!value?.panelItems;panelScrollbarsSupported.value=!!value?.panelScrollbars;panelApiVersion.value=value?.panelApiVersion||1;panelFeatures.value=value?.panelFeatures||[]}catch{menusSupported.value=false;panelsSupported.value=false;menuControlsSupported.value=false;menuAppearanceSupported.value=false;panelTextareaSupported.value=false;panelItemsSupported.value=false;panelScrollbarsSupported.value=false}})()
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
function iconNames(value:NativePanelContent|NativeMenuItem[]):string[]{return Array.isArray(value)?value.flatMap(item=>[...(item.icon?[item.icon]:[]),...(item.controls||[]).flatMap(control=>control.icon?[control.icon]:[]),...iconNames(item.children||[])]):[...(value.icon?[value.icon]:[]),...(value.children||[]).flatMap(iconNames)]}
function iconButtons(value:NativePanelContent):string[]{return [...(value.type==='iconButton'&&value.icon?[value.icon]:[]),...(value.children||[]).flatMap(iconButtons)]}
async function icons(value:NativePanelContent|NativeMenuItem[],appearance:NativeUiTheme,iconButtonSize:16|20=16,custom:Readonly<Record<string,string>>={}):Promise<NativeUiIcons>{
  const color=appearance.text||'#263b55',scale=Math.max(1,Math.min(4,window.devicePixelRatio||1))
  const buttons=new Set(!Array.isArray(value)&&iconButtonSize===20?iconButtons(value):[])
  const entries=await Promise.all([...new Set(iconNames(value))].map(async name=>{
    if(custom[name]){
      const source=custom[name],pixels=Math.ceil(20*scale),key=`custom:${pixels}:${source}`
      try{
        if(!iconCache.has(key))iconCache.set(key,(async()=>{
          const image=new Image(pixels,pixels);image.src=source;await image.decode()
          const canvas=document.createElement('canvas');canvas.width=canvas.height=pixels;canvas.getContext('2d')!.drawImage(image,0,0,pixels,pixels)
          return canvas.toDataURL('image/png')
        })())
        return [name,{dataUrl:await iconCache.get(key)!,logicalSize:20}] as const
      }catch{iconCache.delete(key)}
    }
    const logicalSize:16|20=buttons.has(name)?20:16,pixels=Math.ceil(logicalSize*scale),key=`${name}:${color}:${logicalSize}:${pixels}`
    if(!iconCache.has(key))iconCache.set(key,(async()=>{
      const asset=getUiIcon(custom[name]?'file-lines':name,16),audio=name==='tab-muted'||name==='tab-audio'
      const paths=audio?`<path d="M2 6h3l4-3v10l-4-3H2z" fill="none" stroke="${color}" stroke-width="1.2"/>${name==='tab-muted'?`<path d="m11 6 4 4m0-4-4 4" stroke="${color}" stroke-width="1.2"/>`:`<path d="M11 5q5 3 0 6" fill="none" stroke="${color}" stroke-width="1.2"/>`}`:asset.paths.map(p=>`<path d="${p.d}" fill="${p.fill||color}"${p.fillRule?` fill-rule="${p.fillRule}"`:''}${asset.strokeWidth?` stroke="${color}" stroke-width="${asset.strokeWidth}"`:''}/>`).join('')
      const image=new Image(pixels,pixels);image.src='data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${audio?16:asset.size} ${audio?16:asset.size}">${paths}</svg>`);await image.decode()
      const canvas=document.createElement('canvas');canvas.width=canvas.height=pixels;canvas.getContext('2d')!.drawImage(image,0,0);return canvas.toDataURL('image/png')
    })())
    const dataUrl=await iconCache.get(key)!
    const image:NativeUiIcons[string]=logicalSize===20?{dataUrl,logicalSize:20}:dataUrl
    return [name,image] as const
  }))
  return Object.fromEntries(entries)
}
function announce(id:string,role:NativePanelRole='transient',parentPanelId?:string){if(role!=='passive')window.dispatchEvent(new Event('navora:tab-hover-dismiss'));window.dispatchEvent(new CustomEvent(NATIVE_UI_OPEN,{detail:{id,role,parentPanelId}}))}
function menuTheme(value:NativeUiTheme):NativeMenuAppearance{return {theme:value.mode,background:value.background,foreground:value.text,border:value.border,fontFamily:value.fontFamily,fontSize:value.fontSize,width:240,padding:5,itemPadding:14,rowHeight:34,radius:14,itemRadius:9,separatorInset:12,separatorSpacing:12}}

export function useNativeUi(){
  let requestId:string|undefined,disposed=false,menuAnchor:Anchor|undefined,epoch=0,revision=0
  async function closeMenu(){epoch++;revision++;const id=requestId;requestId=undefined;menuAnchor=undefined;if(id)await bridge()?.closeMenu(id)}
  async function popupMenu(items:NativeMenuItem[],anchor:Anchor,options:{placement?:NativePlacement;contextKey?:string;sourcePageId?:string;appearance?:NativeMenuAppearance;parentPanelId?:string;parentPanelTargetId?:string;sourceType?:'mouse'|'keyboard';onOpened?:(requestId:string)=>void;onControlAction?:(detail:NativeMenuControlEvent)=>void|Promise<void>}={}){
    const generation=++epoch;await ready()
    if(disposed||generation!==epoch)return {supported:true,reason:'closed' as const}
    if(!menusSupported.value||!bridge())return {supported:false}
    const id=crypto.randomUUID(),appearance=theme(anchor),{onControlAction,onOpened,...settings}=options;requestId=id;menuAnchor=anchor;revision++;announce(id,'transient',options.parentPanelId)
    const unsubscribeOpened=bridge()!.onMenuOpened?.(detail=>{if(!disposed&&requestId===id&&detail.requestId===id)onOpened?.(id)})
    let lastSequence=0,actions=Promise.resolve()
    const unsubscribe=bridge()!.onMenuControl?.(detail=>{
      if(disposed||requestId!==id||detail.requestId!==id||!Number.isInteger(detail.sequence)||detail.sequence<=lastSequence)return
      lastSequence=detail.sequence
      // A normal close commits already accepted controls; supersede/context close
      // increments epoch and rejects their queued work. requestId alone would lose
      // the final closeOnClick action when the native popup Promise settles first.
      actions=actions.then(async()=>{if(!disposed&&epoch===generation)await onControlAction?.(detail)}).catch(error=>{console.warn('Native menu action failed',error)})
    })
    try{
      const images=await icons(items,appearance);if(disposed||requestId!==id)return {supported:true,reason:'closed' as const}
      const result=await bridge()!.popupMenu({requestId:id,items,anchor:rect(anchor),icons:images,...settings,...(menuAppearanceSupported.value?{appearance:options.appearance||menuTheme(appearance)}:{})})
      await actions
      return result
    }
    finally{unsubscribe?.();unsubscribeOpened?.();if(requestId===id){requestId=undefined;menuAnchor=undefined}}
  }
  async function updateMenu(id:string,items:NativeMenuItem[]){
    if(disposed||requestId!==id||!menuAnchor)return false
    const current=++revision,images=await icons(items,theme(menuAnchor))
    if(disposed||requestId!==id||current!==revision)return false
    return await bridge()?.updateMenu(id,{items,icons:images})||false
  }
  async function showPageInfo(pageId:string,anchor:Anchor,siteUrl?:string){await ready();const api=bridge();if(!api)return false;announce('page-info:'+pageId);return api.showPageInfo(pageId,rect(anchor),siteUrl)}
  const domOpened=()=>void closeMenu()
  const nativeOpened=(event:Event)=>{const detail=(event as CustomEvent<{id:string;role?:NativePanelRole}>).detail;if(detail?.role!=='passive'&&detail?.id!==requestId)void closeMenu()}
  window.addEventListener(BROWSER_CHROME_OPEN,domOpened)
  window.addEventListener(NATIVE_UI_OPEN,nativeOpened)
  onBeforeUnmount(()=>{disposed=true;window.removeEventListener(BROWSER_CHROME_OPEN,domOpened);window.removeEventListener(NATIVE_UI_OPEN,nativeOpened);void closeMenu()})
  void ready()
  return {menusSupported,panelsSupported,menuControlsSupported,menuAppearanceSupported,panelItemsSupported,panelTextareaSupported,panelScrollbarsSupported,panelApiVersion,panelFeatures,ready,popupMenu,updateMenu,closeMenu,showPageInfo}
}

export function useNativePanel(options:{key?:string;sourcePageId?:()=>string|undefined;contextKey?:()=>string;icons?:()=>Readonly<Record<string,string>>;role?:NativePanelRole;onAction:(action:NativePanelAction)=>void;onDismissed?:()=>void;onClosed?:()=>void;onInputOverflow?:(details:{controlId:string;length:number})=>void}){
  const id=`${options.key||'panel'}:${crypto.randomUUID()}`,open=ref(false),pending=ref(false),error=ref(''),revision=ref(0)
  let session:string|undefined,epoch=0,focusRevision=0,destroyedThrough=0,updateRevision=0,disposed=false,anchor:Anchor|undefined,lastContent:NativePanelContent|undefined,interval:ReturnType<typeof setInterval>|undefined,appearance='',bounds='',zoom=0,context='',role=options.role||'transient',protectedDialog=false,buttonIconSize:16|20=16,unsubscribe:(()=>void)|undefined
  const stop=()=>{clearInterval(interval);interval=undefined}
  function listen(){if(unsubscribe)return;unsubscribe=bridge()?.onPanelEvent(event=>{
    if(event.id!==id||event.session!==session||disposed)return
    if(context!==(options.contextKey?.()||'')){void hide();return}
    if(event.kind==='action'&&open.value&&event.action){if(event.action.revision!==undefined)revision.value=event.action.revision;options.onAction(event.action)}
    else if(event.kind==='input-overflow'&&open.value&&typeof event.controlId==='string'&&typeof event.length==='number'&&Number.isSafeInteger(event.length)&&event.length>65536)options.onInputOverflow?.({controlId:event.controlId,length:event.length})
    else if(event.kind==='dismissed'){open.value=false;stop();options.onDismissed?.()}
    else if(event.kind==='closed'){session=undefined;open.value=false;stop();options.onClosed?.()}
  })}
  async function syncAnchor(){
    if(!open.value||!session||!anchor||disposed)return
    if(anchor instanceof HTMLElement&&(!anchor.isConnected||!anchor.checkVisibility())){await hide();return}
    const nextBounds=rect(anchor),nextTheme=theme(anchor),encoded=JSON.stringify(nextBounds),styled=JSON.stringify(nextTheme),factor=window.devicePixelRatio
    if(encoded!==bounds||styled!==appearance||zoom!==factor){const repaint=styled!==appearance||zoom!==factor;bounds=encoded;appearance=styled;zoom=factor;if(repaint&&lastContent)await update(lastContent,anchor,true);else await bridge()?.updatePanel(id,session,{anchor:nextBounds,theme:nextTheme})}
  }
  async function hide(){focusRevision++;epoch++;updateRevision++;pending.value=false;open.value=false;stop();const current=session;if(current)await bridge()?.hidePanel(id,current)}
  async function destroy(){destroyedThrough=Math.max(destroyedThrough,epoch);const current=session;try{await hide()}finally{if(session===current)session=undefined;if(current)await bridge()?.destroyPanel(id,current)}}
  async function show(content:NativePanelContent,target:Anchor,settings:NativePanelOptions&{placement?:NativePlacement;focusMode?:'none'|'menu'|'input';role?:NativePanelRole;dismissOnEscape?:boolean;dismissOnOutsideClick?:boolean;iconButtonSize?:16|20}={}){
    const generation=++epoch;focusRevision++
    await ready();const api=bridge();if(disposed||generation!==epoch||!panelsSupported.value||!api)return false
    const {iconButtonSize=16,...nativeSettings}=settings
    buttonIconSize=iconButtonSize
    const interaction=nativePanelInteraction({...nativeSettings,role:nativeSettings.role||options.role||'transient'}),sourcePageId=options.sourcePageId?.();updateRevision++;lastContent=content;anchor=target;context=options.contextKey?.()||'';role=interaction.role;protectedDialog=!interaction.dismissOnEscape&&!interaction.dismissOnOutsideClick;listen();pending.value=true;open.value=true;error.value='';session=undefined;announce(id,role)
    try{
      const currentTheme=theme(target),images=await icons(content,currentTheme,buttonIconSize,options.icons?.())
      if(disposed||generation!==epoch)return false
      const result=await api.showPanel({id,content,anchor:rect(target),icons:images,theme:currentTheme,contextKey:context,sourcePageId,...nativeSettings,...interaction})
      if(disposed||generation!==epoch){if(result.supported){if(disposed||generation<=destroyedThrough)await api.destroyPanel(id,result.session);else await api.hidePanel(id,result.session)}return false}
      session=result.session;open.value=result.supported;revision.value=result.revision||0
      if(result.supported){stop();interval=setInterval(()=>void syncAnchor().catch(e=>{error.value=String(e)}),150);if(lastContent&&lastContent!==content)await update(lastContent,target);await syncAnchor()}
      return result.supported
    }catch(e){if(generation===epoch){error.value=String(e);open.value=false};throw e}
    finally{if(generation===epoch)pending.value=false}
  }
  /** Public API only: a fresh native instance starts traversal at its input. */
  async function showFocused(content:NativePanelContent,target:Anchor,settings:Parameters<typeof show>[2]={}){
    const first=nativePanelFirstFocusable(content)
    if(!first||!['input','textarea'].includes(first.type))throw Error('native_panel_input_must_be_first')
    const request=++focusRevision,generation=epoch
    await ready()
    if(disposed||request!==focusRevision||generation!==epoch)return false
    if(panelApiVersion.value>=2){const shown=await show(content,target,{...settings,focusMode:'input'});if(shown)await focus(first.id);return shown}
    await destroy()
    if(disposed||request+1!==focusRevision)return false
    return show(content,target,{...settings,focusMode:'input'})
  }
  async function update(content:NativePanelContent,target?:Anchor,preserveInputValues=false){
    lastContent=content
    const wireContent=preserveInputValues?nativePanelPresentationTree(content):content
    if(target)anchor=target
    const current=session,generation=epoch,updateTicket=++updateRevision;if(!current||!open.value||disposed)return false
    try{const currentTheme=theme(anchor),images=await icons(wireContent,currentTheme,buttonIconSize,options.icons?.())
      if(current!==session||generation!==epoch||updateTicket!==updateRevision||!open.value)return false
      const applied=await bridge()?.updatePanel(id,current,{content:wireContent,icons:images,theme:currentTheme,...(target?{anchor:rect(target)}:{})})||false
      if(applied&&panelApiVersion.value>=2)revision.value++
      return applied}
    catch(e){if(generation===epoch)error.value=String(e);return false}
  }
  async function command(value:NativePanelCommand){const current=session,generation=epoch,api=bridge();if(!current||!open.value||disposed||!api?.commandPanel||panelApiVersion.value<2)return value.type==='bounds'?null:false;const result=await api.commandPanel(id,current,value);return current===session&&generation===epoch?result:value.type==='bounds'?null:false}
  const focus=(nodeId:string)=>command({type:'focus',id:nodeId}).then(value=>value===true)
  const setActiveItem=(nodeId:string|null)=>command({type:'active',id:nodeId||''}).then(value=>value===true)
  const scrollTo=(nodeId:string)=>command({type:'scroll',id:nodeId}).then(value=>value===true)
  const scrollListTo=(nodeId:string,offset:number)=>command({type:'scroll-list',id:nodeId,offset}).then(value=>value===true)
  const getBounds=(nodeId?:string)=>command({type:'bounds',...(nodeId?{id:nodeId}:{})}).then(value=>typeof value==='object'?value:null)
  const announceText=(text:string,assertive=false)=>command({type:'announce',text,assertive}).then(value=>value===true)
  async function applyPatch(operations:NativePanelNodePatch[],guards?:{expectedRevision?:number;revision?:number}){
    const current=session,generation=epoch,api=bridge();if(!current||!open.value||disposed||!lastContent||!api?.patchPanel||panelApiVersion.value<2)return false
    const candidate=nativePanelTreePatch(lastContent,operations),applied=await api.patchPanel(id,current,operations,guards)
    if(current!==session||generation!==epoch||!applied)return false
    lastContent=candidate;revision.value=guards?.revision??revision.value+1;return true
  }
  const domOpened=()=>{if(!protectedDialog&&nativePanelShouldDismiss(role)&&(open.value||pending.value))void hide()}
  const nativeOpened=(event:Event)=>{const detail=(event as CustomEvent<{id:string;role?:NativePanelRole;parentPanelId?:string}>).detail;if(detail?.id!==id&&detail?.parentPanelId!==id&&!protectedDialog&&nativePanelShouldDismiss(role,detail?.role)&&(open.value||pending.value))void hide()}
  window.addEventListener(BROWSER_CHROME_OPEN,domOpened)
  window.addEventListener(NATIVE_UI_OPEN,nativeOpened)
  if(options.contextKey)watch(options.contextKey,()=>{if(open.value||pending.value)void hide()})
  onBeforeUnmount(()=>{disposed=true;window.removeEventListener(BROWSER_CHROME_OPEN,domOpened);window.removeEventListener(NATIVE_UI_OPEN,nativeOpened);unsubscribe?.();void destroy()})
  void ready()
  return {id,supported:panelsSupported,itemsSupported:panelItemsSupported,textareaSupported:panelTextareaSupported,scrollbarsSupported:panelScrollbarsSupported,panelApiVersion,panelFeatures,revision,open,pending,error,ready,show,showFocused,update,hide,destroy,focus,setActiveItem,scrollTo,scrollListTo,getBounds,announce:announceText,applyPatch}
}
