import {ipcMain,Menu,nativeImage,NativePanel,BrowserWindow,webContents,type IpcMainInvokeEvent,type WebContents,type MenuItemConstructorOptions} from 'electron'
import {randomUUID} from 'node:crypto'
import packageManifest from '../../package.json'
import installedElectron from '../../node_modules/electron/package.json'
import {nativeAnchor,nativeMenuItems,nativeMenuControlAllowed,nativeMenuRefreshCompatible,nativePanelNodes,nativePanelActionAllowed,nativePanelScale,nativePanelPresentationTree,nativePanelOptions,nativePanelInteraction,nativePanelShouldDismiss,nativeMenuAppearance,nativeUiKeys,nativeUiTheme,nativePanelTreePatch,nativeUiDefined} from '../../shared/native-ui-validation'
import {appearancePalette} from '../../shared/appearance'
import type {WindowMaterialState} from '../../shared/window-material'
import {nativeMenuPosition} from '../../shared/native-menu-position'
import type {NativePanelContent,NativeMenuItem,NativeMenuShow,NativeMenuPatch,NativePanelShow,NativePanelPatch,NativePanelOptions,NativeUiIcons,NativePanelEvent,NativeUiTheme,NativeAnchor,NativePanelRole} from '../../shared/native-ui'

type Source={webContents:WebContents;valid:()=>boolean}
type Panel={id:string;session:string;panel:NativePanel;sender:WebContents;parent:BrowserWindow;source?:Source;sourceId?:string;context:string;focus:string;role:NativePanelRole;dismissOnEscape:boolean;dismissOnOutsideClick:boolean;returnFocus?:WebContents;open:boolean;closed:boolean;nodes:Map<string,NativePanelContent>;icons:Map<string,Electron.NativeImage>;tree:NativePanelContent;anchor:NativeAnchor;placement:NonNullable<NativePanelShow['placement']>;restoreAfterMinimize:boolean;restoreFocus?:WebContents;zoom:number;options:NativePanelOptions;theme?:NativeUiTheme}
type MenuRequest={id:string;menu:Menu;items:NativeMenuItem[];icons:Map<string,Electron.NativeImage>;source?:Source;sender:WebContents;parent:BrowserWindow;sequence:number;finish:(reason?:'dismissed'|'superseded'|'closed')=>void}
// Both JSON files are statically bundled. Packaged apps need no devDependencies at runtime.
const declaredDistribution=packageManifest.devDependencies.electron.match(/\/v(45\.0\.0-cloudbypass\.\d+)\//)?.[1]
const distributionVersion=declaredDistribution===installedElectron.version?installedElectron.version:'unknown'
// Releases .9/.10 retain the identical .8 public types and .6/.7 native UI contracts.
const panel11=distributionVersion==='45.0.0-cloudbypass.11'
const richPanels=panel11||['45.0.0-cloudbypass.6','45.0.0-cloudbypass.7','45.0.0-cloudbypass.8','45.0.0-cloudbypass.9','45.0.0-cloudbypass.10'].includes(distributionVersion)
const panel7=panel11||['45.0.0-cloudbypass.7','45.0.0-cloudbypass.8','45.0.0-cloudbypass.9','45.0.0-cloudbypass.10'].includes(distributionVersion)
/** Narrow local UI bridge. No remote RPC registration and no web/plugin caller window IDs. */
export function registerNativeUi(options:{trusted:(sender:WebContents)=>BrowserWindow|undefined;source:(sender:WebContents,id:string)=>Source;pageSettings:(parent:BrowserWindow,url:string)=>void;materialState?:(sender:WebContents)=>(Pick<WindowMaterialState,'mode'|'dark'>&Partial<WindowMaterialState>)|undefined}){
  const panels=new Map<string,Panel>(),menus=new Map<number,MenuRequest>(),watched=new Set<WebContents>(),channels:string[]=[]
  const guestMenus=new Map<BrowserWindow,()=>void>()
  const ownerObservers=new Map<BrowserWindow,()=>void>()
  const supported=()=>typeof NativePanel==='function'&&NativePanel.isSupported()
  const key=(sender:WebContents,id:string)=>`${sender.id}:${id}`
  function send(row:Panel,event:Omit<NativePanelEvent,'id'|'session'>){if(!row.sender.isDestroyed())row.sender.send('navora:native-ui.event',{id:row.id,session:row.session,...event})}
  function destroy(row:Panel){if(row.closed)return;row.closed=true;row.open=false;panels.delete(key(row.sender,row.id));row.panel.destroy()}
  function cleanup(sender:WebContents){menus.get(sender.id)?.finish('closed');for(const row of [...panels.values()])if(row.sender===sender)destroy(row)}
  function suspendSearch(row:Panel){
    if(row.role!=='search'||!row.open||row.closed||row.restoreAfterMinimize)return
    // A native popup can own focus while Electron still remembers the last
    // focused page. Do not restore that stale page over the search input.
    const focused=row.parent.isFocused()?webContents.getFocusedWebContents():undefined
    row.restoreAfterMinimize=true;row.restoreFocus=focused&&!focused.isDestroyed()&&BrowserWindow.fromWebContents(focused)===row.parent?focused:undefined
  }
  function observeOwner(win:BrowserWindow){
    if(ownerObservers.has(win))return
    let timer:ReturnType<typeof setTimeout>|undefined,revision=0
    const cancel=()=>{revision++;clearTimeout(timer);timer=undefined}
    const minimized=()=>{
      cancel()
      for(const row of panels.values())if(row.parent===win){suspendSearch(row);if(row.restoreAfterMinimize)row.panel.hide()}
    }
    const schedule=()=>{
      cancel();const ticket=revision;let previous='',attempts=0
      const reposition=()=>{
        timer=undefined;if(ticket!==revision||win.isDestroyed())return
        const bounds=win.getContentBounds(),valid=!win.isMinimized()&&win.isVisible()&&[bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite)&&bounds.width>0&&bounds.height>0&&!(bounds.x===-32000&&bounds.y===-32000),encoded=valid?JSON.stringify(bounds):''
        let retry=false
        // Restore/show can arrive before Windows leaves its minimized bounds.
        // Wait for stable geometry and the owner's native focus messages before
        // activating the popup. A real dismissal is never resumed.
        if(valid&&encoded===previous){
          for(const row of [...panels.values()]){
            if(row.parent!==win||row.closed||!row.open)continue
            if(row.sender.isDestroyed()||options.trusted(row.sender)!==win||BrowserWindow.fromWebContents(row.sender)!==win||row.source&&!row.source.valid()){destroy(row);continue}
            try{
              const anchorBounds=anchor(row.sender,win,row.anchor)
              if(row.role==='search'&&row.restoreAfterMinimize){
                row.panel.show({anchorBounds,placement:row.placement});row.restoreAfterMinimize=false
                const focused=row.restoreFocus;row.restoreFocus=undefined
                if(focused&&!focused.isDestroyed()&&BrowserWindow.fromWebContents(focused)===win&&win.isFocused())focused.focus()
              }else row.panel.update({anchorBounds})
            }catch{retry=true}
          }
          if(!retry)return
        }
        previous=encoded;if(++attempts<6)timer=setTimeout(reposition,16)
      }
      timer=setTimeout(reposition,0)
    }
    const hooked:number[]=[]
    if(process.platform==='win32'){
      const hook=(message:number,callback:(wParam:Buffer,lParam:Buffer)=>void)=>{
        if(win.isWindowMessageHooked(message))return
        win.hookWindowMessage(message,callback);hooked.push(message)
      }
      // NativePanel follows parent bounds before its parent-hidden notification.
      // WM_WINDOWPOSCHANGING sees the minimized state before those bounds move.
      // Hiding here avoids origin clamping and, unlike hiding on SC_MINIMIZE,
      // cannot activate the parent and interrupt an in-progress minimize.
      hook(0x46,()=>{if(win.isMinimized())minimized()})
    }
    const stop=()=>{cancel();if(!win.isDestroyed())for(const message of hooked)win.unhookWindowMessage(message);win.removeListener('restore',schedule);win.removeListener('show',schedule);win.removeListener('maximize',schedule);win.removeListener('unmaximize',schedule);win.removeListener('resize',schedule);win.removeListener('minimize',minimized);win.removeListener('closed',stop);ownerObservers.delete(win)}
    win.on('restore',schedule);win.on('show',schedule);win.on('maximize',schedule);win.on('unmaximize',schedule);win.on('resize',schedule)
    win.on('minimize',minimized);win.once('closed',stop);ownerObservers.set(win,stop)
  }
  function parent(event:IpcMainInvokeEvent){
    const win=options.trusted(event.sender)
    if(!win||win.isDestroyed()||event.senderFrame!==event.sender.mainFrame)throw Error('native_ui_local_app_only')
    observeOwner(win)
    if(!watched.has(event.sender)){
      watched.add(event.sender);event.sender.once('destroyed',()=>{cleanup(event.sender);watched.delete(event.sender)})
      event.sender.on('did-start-navigation',(_event,_url,inPlace,isMain)=>{if(isMain&&!inPlace)cleanup(event.sender)})
    }
    return win
  }
  const handle=(name:string,fn:(event:IpcMainInvokeEvent,...args:any[])=>unknown)=>{const channel='navora:native-ui.'+name;channels.push(channel);ipcMain.handle(channel,fn)}
  function identifier(value:unknown){if(typeof value!=='string'||!value||value.length>256)throw Error('invalid_native_ui_id');return value}
  function images(input:NativeUiIcons={}){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>256)throw Error('invalid_native_ui_icons')
    const result=new Map<string,Electron.NativeImage>()
    for(const [id,icon] of Object.entries(input)){
      let value:string,logicalSize:16|20=16
      if(typeof icon==='string')value=icon
      else{
        nativeUiKeys(icon,['dataUrl','logicalSize'])
        if(icon.logicalSize!==16&&icon.logicalSize!==20)throw Error('invalid_native_ui_icon')
        value=icon.dataUrl;logicalSize=icon.logicalSize
      }
      if(id.length>256||typeof value!=='string'||value.length>65536||!value.startsWith('data:image/png;base64,'))throw Error('invalid_native_ui_icon')
      const bytes=Buffer.from(value.slice(22),'base64')
      if(bytes.length<24||bytes.readUInt32BE(16)>256||bytes.readUInt32BE(20)>256)throw Error('invalid_native_ui_icon')
      const image=nativeImage.createFromBuffer(bytes,{scaleFactor:bytes.readUInt32BE(16)/logicalSize});if(image.isEmpty())throw Error('invalid_native_ui_icon')
      result.set(id,image)
    }
    return result
  }
  function content(tree:NativePanelContent,zoom:number,icons:Map<string,Electron.NativeImage>):Electron.NativePanelContent{
    const scaled=nativePanelScale(tree,zoom)
    // Validate scaled values as well, before entering the native strict schema.
    nativePanelNodes(scaled)
    function convert(current:NativePanelContent):Electron.NativePanelContent{
      const {icon,children,...node}=current
      const result:Electron.NativePanelContent=nativeUiDefined(node)
      for(const field of Object.keys(result))if((result as any)[field]===undefined)delete (result as any)[field]
      if(icon){const image=icons.get(icon);if(!image)throw Error('native_ui_icon_missing');result.image=image}
      if(children)result.children=children.map(convert)
      return result
    }
    return convert(scaled)
  }
  function appearance(theme:NativeUiTheme|undefined,zoom:number):Electron.NativePanelTheme|undefined{return theme?nativeUiTheme(theme,zoom):undefined}
  function presentation(sender:WebContents,theme:NativeUiTheme|undefined,zoom:number){
    let state:ReturnType<NonNullable<typeof options.materialState>>
    try{state=options.materialState?.(sender)}catch{state=undefined}
    const dark=state?.dark??theme?.mode==='dark',palette=state?.theme?appearancePalette(state.theme,dark?'dark':'light',state.systemDark??dark):undefined
    const current:NativeUiTheme={...theme,...(palette?{mode:dark?'dark':'light',background:palette.surface,text:palette.ink,muted:palette.muted,accent:palette.accent,border:palette.stroke}:{}),materialTint:theme?.materialTint??(dark?'#B3202020':'#CCFAFAFA')}
    return {backgroundMaterial:panel11&&state?.mode==='acrylic'?'acrylic' as const:'none' as const,theme:appearance(current,zoom)}
  }
  function refreshMaterials(parent?:BrowserWindow){
    for(const row of [...panels.values()]){
      if(parent&&row.parent!==parent||row.closed)continue
      if(row.parent.isDestroyed()||row.sender.isDestroyed()||options.trusted(row.sender)!==row.parent||row.source&&!row.source.valid()){destroy(row);continue}
      try{row.panel.update(presentation(row.sender,row.theme,row.zoom))}catch{try{row.panel.update({backgroundMaterial:'none'})}catch{/* Closing native host. */}}
    }
  }
  function anchor(sender:WebContents,win:BrowserWindow,value:NativeAnchor){const origin=win.getContentBounds();return nativeAnchor(value,sender.getZoomFactor(),origin)}
  function dismissOthers(sender:WebContents,except?:Panel){
    if([...panels.values()].some(row=>row.sender===sender&&row!==except&&row.open&&!row.closed&&!row.dismissOnOutsideClick&&!row.dismissOnEscape))throw Error('native_ui_modal_active')
    for(const [parent,close] of guestMenus)if(parent.webContents===sender){guestMenus.delete(parent);close()}
    menus.get(sender.id)?.finish('superseded')
    for(const row of panels.values())if(row.sender===sender&&row!==except&&row.open&&!row.closed&&nativePanelShouldDismiss(row.role,except?.role)){row.open=false;row.panel.hide();send(row,{kind:'dismissed',reason:'superseded'})}
  }
  function restoreFocus(row:Panel){
    // A passive panel never took focus, so closing it must not steal a later click's target.
    if(row.role==='passive'||row.focus==='none')return
    // Outside clicks establish their own target. Only explicit/keyboard closes use this path.
    queueMicrotask(()=>{
      if(row.parent.isDestroyed()||!row.parent.isFocused()||menus.has(row.sender.id)||[...panels.values()].some(p=>p.parent===row.parent&&p.open&&!p.closed))return
      const target=row.returnFocus
      if(!target||target.isDestroyed()||BrowserWindow.fromWebContents(target)!==row.parent)return
      if(target!==row.sender&&(!row.source||target!==row.source.webContents||!row.source.valid()))return
      target.focus()
    })
  }
  function checkPanelFeatures(nodes:Map<string,NativePanelContent>){
    for(const node of nodes.values()){
      if(!richPanels&&(node.type==='item'||node.type==='iconButton'||node.selected!==undefined||node.singleLine!==undefined||node.maxWidth!==undefined||node.style!==undefined||node.highlights!==undefined||node.linkRange!==undefined||node.variant!==undefined))throw Error('native_ui_feature_unavailable')
      if(!panel7&&(node.type==='textarea'||node.scrollbarPlacement!==undefined))throw Error('native_ui_feature_unavailable')
    }
  }
  function find(event:IpcMainInvokeEvent,id:string,session:string){parent(event);const row=panels.get(key(event.sender,identifier(id)));if(!row||row.closed||row.session!==session)return;if(row.source&&!row.source.valid()){destroy(row);return}return row}
  handle('capabilities',event=>{parent(event);const panels=supported(),capabilities=panel11?NativePanel.getCapabilities():undefined;return {menus:true,panels,pageInfo:typeof (event.sender as any).showPageInfoDialog==='function',distributionVersion,menuControls:richPanels&&typeof Menu.prototype.refresh==='function',menuAppearance:richPanels&&process.platform==='win32',panelItems:panels&&richPanels,panelTextarea:panels&&panel7,panelScrollbars:panels&&panel7,panelApiVersion:capabilities?.apiVersion??1,panelFeatures:capabilities?.features||[],panelMaterial:panels&&panel11}})
  handle('menu',(event,input:NativeMenuShow)=>{
    const win=parent(event);nativeUiKeys(input,['requestId','items','anchor','placement','icons','contextKey','sourcePageId','appearance','parentPanelId','parentPanelTargetId','sourceType'])
    const id=identifier(input.requestId),items=nativeMenuItems(input.items),menuIcons=images(input.icons),zoom=event.sender.getZoomFactor(),position=nativeAnchor(input.anchor,zoom),source=input.sourcePageId?options.source(event.sender,identifier(input.sourcePageId)):undefined
    if(input.contextKey!==undefined&&(typeof input.contextKey!=='string'||input.contextKey.length>4096))throw Error('invalid_native_ui_context')
    if(input.placement!==undefined&&!['auto','top-start','top-end','bottom-start','bottom-end'].includes(input.placement))throw Error('invalid_native_placement')
    if(!richPanels&&items.some(item=>item.controls))throw Error('native_ui_feature_unavailable')
    const menuAppearance=input.appearance?nativeMenuAppearance(input.appearance,zoom):undefined
    if(source&&!source.valid())throw Error('native_ui_source_invalid')
    const parentPanel=input.parentPanelId===undefined?undefined:panels.get(key(event.sender,identifier(input.parentPanelId)))
    if(input.parentPanelId!==undefined&&(!parentPanel||parentPanel.closed||!parentPanel.open||parentPanel.parent!==win||parentPanel.source&&!parentPanel.source.valid()))throw Error('native_ui_parent_panel_invalid')
    if(input.parentPanelTargetId!==undefined&&(!parentPanel||!parentPanel.nodes.has(identifier(input.parentPanelTargetId))))throw Error('native_ui_parent_panel_target_invalid')
    if(input.sourceType!==undefined&&!['mouse','keyboard'].includes(input.sourceType))throw Error('invalid_native_ui_source_type')
    dismissOthers(event.sender,parentPanel)
    return new Promise((resolve,reject)=>{
      let done=false,selectedId:string|undefined,checked:boolean|undefined,row:MenuRequest|undefined
      const finish=(reason:'dismissed'|'superseded'|'closed'='dismissed')=>{if(done)return;done=true;const current=menus.get(event.sender.id);if(current===row){menus.delete(event.sender.id);if(!win.isDestroyed())current!.menu.closePopup(win)}resolve({supported:true,selectedId,checked,reason:selectedId?undefined:reason})}
      const active=()=>!done&&!!row&&menus.get(event.sender.id)===row&&!win.isDestroyed()&&!event.sender.isDestroyed()&&(!source||source.valid())
      const controls=(item:NativeMenuItem,icons:Map<string,Electron.NativeImage>)=>item.controls?.map(control=>{const {icon,...value}=control;if(icon&&!icons.has(icon))throw Error('native_ui_icon_missing');return {...value,...(icon?{icon:icons.get(icon)}:{})}})
      const template=(rows:NativeMenuItem[]):MenuItemConstructorOptions[]=>rows.map(item=>({
        id:item.id,label:item.label,type:item.children?'submenu':item.type||'normal',enabled:item.enabled!==false,checked:item.checked,toolTip:item.reason,
        ...(item.shortcut?{accelerator:item.shortcut,registerAccelerator:false,acceleratorWorksWhenHidden:false}:{}),...(item.icon&&menuIcons.has(item.icon)?{icon:menuIcons.get(item.icon)}:{}),...(item.controls?{controls:controls(item,menuIcons)}:{}),
        ...(item.children?{submenu:template(item.children)}:{click:clicked=>{if(!active()){finish('closed');return}const current=row!.menu.getMenuItemById(item.id);if(!current?.enabled||item.type==='separator'||item.controls)return;selectedId=item.id;checked=clicked.checked;finish()}}),
      }))
      try{
        const menu=Menu.buildFromTemplate(template(items));row={id,menu,items,icons:menuIcons,source,sender:event.sender,parent:win,sequence:0,finish};menus.set(event.sender.id,row)
        // This event belongs to the root Menu and has one detail argument, not an Event.
        menu.on('control-action',detail=>{
          if(!active()){finish('closed');return}
          const control=nativeMenuControlAllowed(row!.items,detail);if(!control)return
          event.sender.send('navora:native-ui.menu-control',{requestId:id,itemId:detail.itemId,controlId:detail.controlId,sequence:++row!.sequence})
          if(control.closeOnClick)finish()
        })
        const appearance=menuAppearance&&richPanels&&process.platform==='win32'?menuAppearance:undefined
        const popupPosition=nativeMenuPosition({anchor:position,content:win.getContentBounds(),items,placement:input.placement,appearance,gap:4*zoom})
        if(parentPanel&&panel11){
          menu.once('menu-will-close',()=>queueMicrotask(()=>finish()))
          const screenAnchor=anchor(event.sender,win,input.anchor)
          parentPanel.panel.popupMenu(menu,{...(input.parentPanelTargetId?{id:input.parentPanelTargetId}:{}),x:screenAnchor.x,y:screenAnchor.y,...(input.sourceType?{sourceType:input.sourceType}:{})})
        }else menu.popup({window:win,...popupPosition,...(appearance?{appearance}:{}),callback:()=>queueMicrotask(()=>finish())})
        if(active())event.sender.send('navora:native-ui.menu-opened',{requestId:id})
      }catch(error){done=true;if(menus.get(event.sender.id)===row){menus.delete(event.sender.id);if(!win.isDestroyed())row?.menu.closePopup(win)}reject(error)}
    })
  })
  handle('updateMenu',(event,id,patch:NativeMenuPatch)=>{
    parent(event);identifier(id);nativeUiKeys(patch,['items','icons'])
    const row=menus.get(event.sender.id);if(!row||row.id!==id)return false
    if(row.source&&!row.source.valid()){row.finish('closed');return false}
    const items=nativeMenuItems(patch.items);if(!nativeMenuRefreshCompatible(row.items,items))throw Error('native_ui_menu_membership_changed')
    const nextIcons=patch.icons?images(patch.icons):row.icons,updates:Array<()=>void>=[]
    function visit(rows:NativeMenuItem[]){for(const item of rows){
      const target=row!.menu.getMenuItemById(item.id);if(!target)throw Error('native_ui_menu_membership_changed')
      const controls=item.controls?.map(control=>{const {icon,...value}=control;if(icon&&!nextIcons.has(icon))throw Error('native_ui_icon_missing');return {...value,...(icon?{icon:nextIcons.get(icon)}:{})}})
      if(item.icon&&!nextIcons.has(item.icon))throw Error('native_ui_icon_missing')
      updates.push(()=>{target.label=item.label;target.enabled=item.enabled!==false;if(item.checked!==undefined)target.checked=item.checked;if(controls)target.controls=controls})
      if(item.children)visit(item.children)
    }}
    visit(items);for(const apply of updates)apply();row.menu.refresh();row.items=items;row.icons=nextIcons;return true
  })
  handle('closeMenu',(event,id)=>{parent(event);if(menus.get(event.sender.id)?.id===id)menus.get(event.sender.id)!.finish('closed')})
  handle('show',(event,input:NativePanelShow)=>{
    const win=parent(event);nativeUiKeys(input,['id','content','anchor','placement','focusMode','theme','icons','sourcePageId','contextKey','role','radius','contentInset','scrollbarPlacement','shadow','dismissOnEscape','dismissOnOutsideClick'])
    const id=identifier(input.id);if(!supported())return {supported:false,id,session:''}
    const nodes=nativePanelNodes(input.content),zoom=event.sender.getZoomFactor(),panelIcons=images(input.icons),tree=content(input.content,zoom,panelIcons),bounds=anchor(event.sender,win,input.anchor),interaction=nativePanelInteraction(input),focus=interaction.focusMode,role=interaction.role,source=input.sourcePageId?options.source(event.sender,identifier(input.sourcePageId)):undefined
    const logicalOptions:NativePanelOptions={radius:input.radius??12,shadow:input.shadow===undefined?true:input.shadow,...(richPanels?{contentInset:input.contentInset??12}:{}),...(panel7?{scrollbarPlacement:input.scrollbarPlacement??'gutter'}:{})},panelOptions=nativePanelOptions(logicalOptions,zoom)
    checkPanelFeatures(nodes)
    if(input.placement!==undefined&&!['auto','top-start','top-end','bottom-start','bottom-end'].includes(input.placement))throw Error('invalid_native_placement')
    if(input.contextKey!==undefined&&(typeof input.contextKey!=='string'||input.contextKey.length>4096))throw Error('invalid_native_ui_context')
    for(const field of ['dismissOnEscape','dismissOnOutsideClick'] as const)if(input[field]!==undefined&&typeof input[field]!=='boolean')throw Error('invalid_native_panel_dismiss')
    const {dismissOnEscape,dismissOnOutsideClick}=interaction
    if(source&&!source.valid())throw Error('native_ui_source_invalid')
    if(!panel7&&input.scrollbarPlacement!==undefined||!richPanels&&input.contentInset!==undefined)throw Error('native_ui_feature_unavailable')
    if([...panels.values()].some(p=>p.sender===event.sender&&p.id!==id&&p.open&&!p.closed&&!p.dismissOnOutsideClick&&!p.dismissOnEscape))throw Error('native_ui_modal_active')
    // A passive hint cannot displace an editor and cannot claim pointer-through support.
    if(role==='passive'&&(menus.has(event.sender.id)||[...panels.values()].some(p=>p.parent===win&&p.open&&p.role!=='passive'&&p.role!=='search')))throw Error('native_ui_editor_active')
    let row=panels.get(key(event.sender,id))
    if(row&&(row.context!==(input.contextKey||'')||row.sourceId!==input.sourcePageId||row.focus!==focus||row.role!==role||row.dismissOnEscape!==dismissOnEscape||row.dismissOnOutsideClick!==dismissOnOutsideClick||row.source&&!row.source.valid())){destroy(row);row=undefined}
    if(!row){
      const panel=new NativePanel({parent:win,...(source?{sourceWebContents:source.webContents}:{}),content:tree,...presentation(event.sender,input.theme,zoom),...panelOptions,focusMode:focus,dismissOnEscape,dismissOnOutsideClick})
      row={id,session:randomUUID(),panel,sender:event.sender,parent:win,source,sourceId:input.sourcePageId,context:input.contextKey||'',focus,role,dismissOnEscape,dismissOnOutsideClick,open:false,closed:false,nodes,icons:panelIcons,tree:input.content,anchor:{...input.anchor},placement:input.placement||'auto',restoreAfterMinimize:false,zoom,options:logicalOptions,theme:input.theme};panels.set(key(event.sender,id),row)
      const current=row
      panel.on('action',action=>{
        if(current.closed||!current.open||panels.get(key(current.sender,current.id))!==current||current.source&&!current.source.valid())return
        if(typeof action.revision==='number'&&action.revision!==current.panel.revision)return
        const normalized={...action,type:action.type==='context-menu'?'contextMenu':action.type}
        // Oversized native drafts must invalidate the editor's previous value,
        // without transporting the rejected text or authorizing a submit.
        if(typeof action.value==='string'&&action.value.length>65536&&(action.type==='change'||action.type==='submit')&&nativePanelActionAllowed(current.nodes,{id:action.id,type:action.type,value:''})){
          const node=current.nodes.get(action.id)
          if(node?.type==='input'||node?.type==='textarea')send(current,{kind:'input-overflow',controlId:action.id,length:action.value.length})
          return
        }
        if(normalized.type==='contextMenu'||normalized.anchor){
          const point=(action as any).anchor
          if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return
          const origin=current.parent.getContentBounds()
          normalized.anchor={x:(point.x-origin.x)/current.zoom,y:(point.y-origin.y)/current.zoom,width:Math.max(1,Number(point.width)||1)/current.zoom,height:Math.max(1,Number(point.height)||1)/current.zoom}
        }
        if(nativePanelActionAllowed(current.nodes,normalized as any))send(current,{kind:'action',action:normalized as any})
      })
      panel.on('dismissed',details=>{
        if(current.closed||!current.open)return
        if(details.reason==='parent-hidden'&&current.role==='search'&&current.parent.isMinimized()){suspendSearch(current);return}
        current.open=false;current.restoreAfterMinimize=false;current.restoreFocus=undefined;send(current,{kind:'dismissed',reason:details.reason});if(details.reason==='escape')restoreFocus(current)
      })
      panel.on('closed',()=>{current.closed=true;current.open=false;if(panels.get(key(current.sender,current.id))===current)panels.delete(key(current.sender,current.id));send(current,{kind:'closed'})})
    }else{row.panel.update({content:tree,...panelOptions,...presentation(event.sender,input.theme,zoom)});row.nodes=nodes;row.icons=panelIcons;row.tree=input.content;row.zoom=zoom;row.options=logicalOptions;row.theme=input.theme}
    // A hidden native instance is reusable; an old display's IPC credential is not.
    row.anchor={...input.anchor};row.placement=input.placement||'auto';row.restoreAfterMinimize=false;row.restoreFocus=undefined;row.session=randomUUID();const focused=webContents.getFocusedWebContents();row.returnFocus=focused&&!focused.isDestroyed()&&BrowserWindow.fromWebContents(focused)===win&&(focused===event.sender||focused===source?.webContents)?focused:event.sender
    dismissOthers(event.sender,row);row.open=true
    try{row.panel.show({anchorBounds:bounds,placement:input.placement||'auto'})}catch(error){row.open=false;destroy(row);throw error}
    return {supported:true,id,session:row.session,...(panel11?{revision:row.panel.revision}:{})}
  })
  handle('update',(event,id,session,patch:NativePanelPatch)=>{
    const row=find(event,id,session);if(!row)return false
    nativeUiKeys(patch,['content','anchor','theme','icons','radius','contentInset','scrollbarPlacement','shadow','expectedRevision','revision'])
    for(const field of ['expectedRevision','revision'] as const)if(patch[field]!==undefined&&(!Number.isSafeInteger(patch[field])||patch[field]!<0))throw Error('invalid_native_panel_revision')
    if(patch.expectedRevision!==undefined&&patch.expectedRevision!==row.panel.revision||patch.revision!==undefined&&patch.revision<=row.panel.revision)return false
    const zoom=event.sender.getZoomFactor(),nextTree=patch.content||(zoom!==row.zoom?nativePanelPresentationTree(row.tree):undefined),nodes=nextTree?nativePanelNodes(nextTree):row.nodes,imagesForUpdate=patch.icons?images(patch.icons):row.icons,logicalOptions={...row.options}
    for(const field of ['contentInset','radius','scrollbarPlacement','shadow'] as const)if(patch[field]!==undefined)(logicalOptions as any)[field]=patch[field]
    const update:Electron.NativePanelUpdateOptions=nativePanelOptions(logicalOptions,zoom)
    checkPanelFeatures(nodes)
    if(!panel7&&patch.scrollbarPlacement!==undefined||!richPanels&&patch.contentInset!==undefined)throw Error('native_ui_feature_unavailable')
    if(nextTree)update.content=content(nextTree,zoom,imagesForUpdate)
    if(patch.anchor)update.anchorBounds=anchor(event.sender,row.parent,patch.anchor)
    Object.assign(update,presentation(event.sender,patch.theme||row.theme,zoom),...(panel11?[{...(patch.expectedRevision!==undefined?{expectedRevision:patch.expectedRevision}:{}),...(patch.revision!==undefined?{revision:patch.revision}:{})}]:[]))
    if(row.panel.update(update)===false)return false
    row.nodes=nodes;row.icons=imagesForUpdate;row.zoom=zoom;row.options=logicalOptions;if(nextTree)row.tree=nextTree;if(patch.anchor)row.anchor={...patch.anchor};if(patch.theme)row.theme=patch.theme;return true
  })
  handle('command',(event,id,session,command)=>{
    const row=find(event,id,session);if(!row||!row.open||!panel11)return command?.type==='bounds'?null:false
    const type=command?.type
    nativeUiKeys(command,['type',...(type==='announce'?['text','assertive']:type==='scroll-list'?['id','offset']:['id'])])
    if(type==='announce'){
      if(typeof command.text!=='string'||command.text.length>65536||command.assertive!==undefined&&typeof command.assertive!=='boolean')throw Error('invalid_native_panel_announcement')
      row.panel.announce(command.text,command.assertive);return true
    }
    if(type==='active'&&command.id==='')return row.panel.setActiveItem(null)
    if(type==='bounds'&&command.id===undefined){const bounds=row.panel.getBounds();if(!bounds)return null;const origin=row.parent.getContentBounds();return {x:(bounds.x-origin.x)/row.zoom,y:(bounds.y-origin.y)/row.zoom,width:bounds.width/row.zoom,height:bounds.height/row.zoom}}
    const node=row.nodes.get(identifier(command.id));if(!node||node.disabled||node.visible===false)return type==='bounds'?null:false
    if(type==='focus')return row.panel.focus(node.id)
    if(type==='active')return node.type==='item'&&row.panel.setActiveItem(node.id)
    if(type==='scroll')return row.panel.scrollTo(node.id)
    if(type==='scroll-list'){if(node.type!=='list'||typeof command.offset!=='number'||!Number.isFinite(command.offset)||command.offset<0)throw Error('invalid_native_panel_scroll');return row.panel.scrollListTo(node.id,command.offset*row.zoom)}
    if(type==='bounds'){const bounds=row.panel.getBounds(node.id);if(!bounds)return null;const origin=row.parent.getContentBounds();return {x:(bounds.x-origin.x)/row.zoom,y:(bounds.y-origin.y)/row.zoom,width:bounds.width/row.zoom,height:bounds.height/row.zoom}}
    throw Error('invalid_native_panel_command')
  })
  handle('patch',(event,id,session,operations,guards={})=>{
    const row=find(event,id,session);if(!row||!panel11)return false
    nativeUiKeys(guards,['expectedRevision','revision'])
    for(const field of ['expectedRevision','revision'] as const)if(guards[field]!==undefined&&(!Number.isSafeInteger(guards[field])||guards[field]<0))throw Error('invalid_native_panel_revision')
    if(guards.expectedRevision!==undefined&&guards.expectedRevision!==row.panel.revision||guards.revision!==undefined&&guards.revision<=row.panel.revision)return false
    const next=nativePanelTreePatch(row.tree,operations),nodes=nativePanelNodes(next)
    let candidate=row.tree
    const wireOperations=operations.map((operation:any)=>{
      candidate=nativePanelTreePatch(candidate,[operation])
      if(operation.op==='insert'||operation.op==='replace')return {...operation,node:content(operation.node,row.zoom,row.icons)}
      if(operation.op!=='set')return operation
      const control=nativePanelNodes(candidate).get(operation.id)!,converted=content(control,row.zoom,row.icons) as any
      return {...operation,properties:Object.fromEntries(Object.keys(operation.properties).map(key=>[key==='icon'?'image':key,converted[key==='icon'?'image':key]]))}
    })
    if(row.panel.applyPatch(wireOperations,guards)===false)return false
    row.tree=next;row.nodes=nodes;return true
  })
  function ownerClosed(event:IpcMainInvokeEvent){const win=BrowserWindow.fromWebContents(event.sender);return event.sender.isDestroyed()||!win||win.isDestroyed()||!event.senderFrame}
  handle('hide',(event,id,session)=>{if(ownerClosed(event))return;const row=find(event,id,session);if(row){const wasOpen=row.open;row.open=false;row.restoreAfterMinimize=false;row.restoreFocus=undefined;row.panel.hide();if(wasOpen)restoreFocus(row)}})
  handle('destroy',(event,id,session)=>{if(ownerClosed(event))return;const row=find(event,id,session);if(row){const wasOpen=row.open;destroy(row);if(wasOpen)restoreFocus(row)}})
  handle('pageInfo',(event,id,bounds,siteUrl)=>{
    const win=parent(event),source=options.source(event.sender,identifier(id));dismissOthers(event.sender)
    const wc=source.webContents;if(typeof wc.showPageInfoDialog!=='function')return false
    const listener=(_event:unknown,details:{url:string})=>{if(source.valid())options.pageSettings(win,details.url)}
    // A fixed listener per source avoids accumulating callbacks across repeated opens.
    const previous=(wc as any).__navoraPageInfoListener;if(previous)wc.removeListener('page-info-open-site-settings',previous)
    ;(wc as any).__navoraPageInfoListener=listener;wc.on('page-info-open-site-settings',listener)
    return wc.showPageInfoDialog({anchorBounds:anchor(event.sender,win,bounds),...(siteUrl?{siteUrl}:{})})
  })
  return {
    refreshMaterials,
    prepareGuestMenu(parent:BrowserWindow,close:()=>void){
      if(parent.isDestroyed()||options.trusted(parent.webContents)!==parent)throw Error('native_ui_local_app_only')
      dismissOthers(parent.webContents)
      guestMenus.set(parent,close)
      return ()=>{if(guestMenus.get(parent)===close)guestMenus.delete(parent)}
    },
    dispose(){for(const stop of [...ownerObservers.values()])stop();for(const close of [...guestMenus.values()])close();guestMenus.clear();for(const sender of watched)cleanup(sender);for(const channel of channels)ipcMain.removeHandler(channel)}
  }
}
