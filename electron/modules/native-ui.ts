import {ipcMain,Menu,nativeImage,NativePanel,BrowserWindow,type IpcMainInvokeEvent,type WebContents,type MenuItemConstructorOptions} from 'electron'
import {randomUUID} from 'node:crypto'
import {nativeAnchor,nativeMenuItems,nativePanelNodes,nativePanelActionAllowed} from '../../shared/native-ui-validation'
import type {NativePanelContent,NativeMenuItem,NativePanelShow,NativeUiIcons,NativePanelEvent,NativeUiTheme,NativeAnchor} from '../../shared/native-ui'

type Source={webContents:WebContents;valid:()=>boolean}
type Panel={id:string;session:string;panel:NativePanel;sender:WebContents;parent:BrowserWindow;source?:Source;sourceId?:string;context:string;focus:string;open:boolean;closed:boolean;nodes:Map<string,NativePanelContent>}
/** Narrow local UI bridge. No remote RPC registration and no web/plugin caller window IDs. */
export function registerNativeUi(options:{trusted:(sender:WebContents)=>BrowserWindow|undefined;source:(sender:WebContents,id:string)=>Source;pageSettings:(parent:BrowserWindow,url:string)=>void}){
  const panels=new Map<string,Panel>(),menus=new Map<number,{id:string;menu:Menu;finish:(reason?:'dismissed'|'superseded'|'closed')=>void}>(),watched=new Set<WebContents>(),channels:string[]=[]
  const supported=()=>typeof NativePanel==='function'&&NativePanel.isSupported()
  const key=(sender:WebContents,id:string)=>`${sender.id}:${id}`
  function send(row:Panel,event:Omit<NativePanelEvent,'id'|'session'>){if(!row.sender.isDestroyed())row.sender.send('navora:native-ui.event',{id:row.id,session:row.session,...event})}
  function destroy(row:Panel){if(row.closed)return;row.closed=true;row.open=false;panels.delete(key(row.sender,row.id));row.panel.destroy()}
  function cleanup(sender:WebContents){menus.get(sender.id)?.finish('closed');for(const row of [...panels.values()])if(row.sender===sender)destroy(row)}
  function parent(event:IpcMainInvokeEvent){
    const win=options.trusted(event.sender)
    if(!win||win.isDestroyed()||event.senderFrame!==event.sender.mainFrame)throw Error('native_ui_local_app_only')
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
    for(const [id,value] of Object.entries(input)){
      if(id.length>256||typeof value!=='string'||value.length>65536||!value.startsWith('data:image/png;base64,'))throw Error('invalid_native_ui_icon')
      const bytes=Buffer.from(value.slice(22),'base64')
      if(bytes.length<24||bytes.readUInt32BE(16)>256||bytes.readUInt32BE(20)>256)throw Error('invalid_native_ui_icon')
      const image=nativeImage.createFromBuffer(bytes,{scaleFactor:bytes.readUInt32BE(16)/16});if(image.isEmpty())throw Error('invalid_native_ui_icon')
      result.set(id,image)
    }
    return result
  }
  function content(tree:NativePanelContent,zoom:number,icons:Map<string,Electron.NativeImage>):Electron.NativePanelContent{
    const {icon,children,...node}=tree
    const result:Electron.NativePanelContent={...node}
    for(const field of ['width','height','gap','padding','fontSize'] as const)if(typeof result[field]==='number')result[field]=result[field]!*zoom
    if(icon){const image=icons.get(icon);if(!image)throw Error('native_ui_icon_missing');result.image=image}
    if(children)result.children=children.map(child=>content(child,zoom,icons))
    return result
  }
  function appearance(theme:NativeUiTheme|undefined,zoom:number):Electron.NativePanelTheme|undefined{return theme?{...theme,...(theme.fontSize!==undefined?{fontSize:theme.fontSize*zoom}:{})}:undefined}
  function anchor(sender:WebContents,win:BrowserWindow,value:NativeAnchor){const origin=win.getContentBounds();return nativeAnchor(value,sender.getZoomFactor(),origin)}
  function dismissOthers(sender:WebContents,except?:Panel){
    menus.get(sender.id)?.finish('superseded')
    for(const row of panels.values())if(row.sender===sender&&row!==except&&row.open&&!row.closed){row.open=false;row.panel.hide();send(row,{kind:'dismissed',reason:'superseded'})}
  }
  function find(event:IpcMainInvokeEvent,id:string,session:string){parent(event);const row=panels.get(key(event.sender,identifier(id)));if(!row||row.closed||row.session!==session)return;if(row.source&&!row.source.valid()){destroy(row);return}return row}
  handle('capabilities',event=>{parent(event);return {menus:true,panels:supported(),pageInfo:typeof (event.sender as any).showPageInfoDialog==='function',distributionVersion:'45.0.0-cloudbypass.5'}})
  handle('menu',(event,input)=>{
    const win=parent(event),id=identifier(input?.requestId),items=nativeMenuItems(input.items),icons=images(input.icons),position=nativeAnchor(input.anchor,event.sender.getZoomFactor())
    dismissOthers(event.sender)
    return new Promise((resolve,reject)=>{
      let done=false,selectedId:string|undefined,checked:boolean|undefined
      const finish=(reason:'dismissed'|'superseded'|'closed'='dismissed')=>{if(done)return;done=true;const current=menus.get(event.sender.id);if(current?.id===id){menus.delete(event.sender.id);current.menu.closePopup(win)}resolve({supported:true,selectedId,checked,reason:selectedId?undefined:reason})}
      const template=(rows:NativeMenuItem[]):MenuItemConstructorOptions[]=>rows.map(item=>({
        id:item.id,label:item.label,type:item.children?'submenu':item.type||'normal',enabled:item.enabled!==false,checked:item.checked,toolTip:item.reason,
        ...(item.shortcut?{accelerator:item.shortcut,registerAccelerator:false,acceleratorWorksWhenHidden:false}:{}),...(item.icon&&icons.has(item.icon)?{icon:icons.get(item.icon)}:{}),
        ...(item.children?{submenu:template(item.children)}:{click:clicked=>{if(menus.get(event.sender.id)?.id!==id||item.enabled===false||item.type==='separator')return;selectedId=item.id;checked=clicked.checked;finish()}}),
      }))
      try{const menu=Menu.buildFromTemplate(template(items));menus.set(event.sender.id,{id,menu,finish});menu.popup({window:win,x:position.x,y:input.placement?.startsWith('top')?position.y:position.y+position.height,callback:()=>finish()})}catch(error){done=true;menus.delete(event.sender.id);reject(error)}
    })
  })
  handle('closeMenu',(event,id)=>{parent(event);if(menus.get(event.sender.id)?.id===id)menus.get(event.sender.id)!.finish('closed')})
  handle('show',(event,input:NativePanelShow)=>{
    const win=parent(event),id=identifier(input.id);if(!supported())return {supported:false,id,session:''}
    const nodes=nativePanelNodes(input.content),zoom=event.sender.getZoomFactor(),icons=images(input.icons),tree=content(input.content,zoom,icons),bounds=anchor(event.sender,win,input.anchor),focus=input.focusMode||'menu',source=input.sourcePageId?options.source(event.sender,input.sourcePageId):undefined
    let row=panels.get(key(event.sender,id))
    if(row&&(row.context!==(input.contextKey||'')||row.sourceId!==input.sourcePageId||row.focus!==focus||row.source&&!row.source.valid())){destroy(row);row=undefined}
    if(!row){
      const panel=new NativePanel({parent:win,...(source?{sourceWebContents:source.webContents}:{}),content:tree,...(input.theme?{theme:appearance(input.theme,zoom)}:{}),radius:12*zoom,shadow:true,focusMode:focus,dismissOnEscape:true,dismissOnOutsideClick:true})
      row={id,session:randomUUID(),panel,sender:event.sender,parent:win,source,sourceId:input.sourcePageId,context:input.contextKey||'',focus,open:false,closed:false,nodes};panels.set(key(event.sender,id),row)
      const current=row
      panel.on('action',action=>{if(current.closed||!current.open||panels.get(key(current.sender,current.id))!==current||current.source&&!current.source.valid())return;if(nativePanelActionAllowed(current.nodes,action as any))send(current,{kind:'action',action:action as any})})
      panel.on('dismissed',details=>{if(current.closed)return;current.open=false;send(current,{kind:'dismissed',reason:details.reason})})
      panel.on('closed',()=>{current.closed=true;current.open=false;if(panels.get(key(current.sender,current.id))===current)panels.delete(key(current.sender,current.id));send(current,{kind:'closed'})})
    }else{row.panel.update({content:tree,...(input.theme?{theme:appearance(input.theme,zoom)}:{})});row.nodes=nodes}
    // A hidden native instance is reusable; an old display's IPC credential is not.
    row.session=randomUUID()
    dismissOthers(event.sender,row);row.open=true;row.panel.show({anchorBounds:bounds,placement:input.placement||'auto'})
    return {supported:true,id,session:row.session}
  })
  handle('update',(event,id,session,patch)=>{
    const row=find(event,id,session);if(!row)return false
    const zoom=event.sender.getZoomFactor(),nodes=patch.content?nativePanelNodes(patch.content):row.nodes,imagesForUpdate=images(patch.icons),update:Electron.NativePanelUpdateOptions={}
    if(patch.content)update.content=content(patch.content,zoom,imagesForUpdate)
    if(patch.anchor)update.anchorBounds=anchor(event.sender,row.parent,patch.anchor)
    if(patch.theme)update.theme=appearance(patch.theme,zoom)
    row.panel.update(update);row.nodes=nodes;return true
  })
  function ownerClosed(event:IpcMainInvokeEvent){const win=BrowserWindow.fromWebContents(event.sender);return event.sender.isDestroyed()||!win||win.isDestroyed()||!event.senderFrame}
  handle('hide',(event,id,session)=>{if(ownerClosed(event))return;const row=find(event,id,session);if(row){row.open=false;row.panel.hide()}})
  handle('destroy',(event,id,session)=>{if(ownerClosed(event))return;const row=find(event,id,session);if(row)destroy(row)})
  handle('pageInfo',(event,id,bounds,siteUrl)=>{
    const win=parent(event),source=options.source(event.sender,identifier(id));dismissOthers(event.sender)
    const wc=source.webContents;if(typeof wc.showPageInfoDialog!=='function')return false
    const listener=(_event:unknown,details:{url:string})=>{if(source.valid())options.pageSettings(win,details.url)}
    // A fixed listener per source avoids accumulating callbacks across repeated opens.
    const previous=(wc as any).__navoraPageInfoListener;if(previous)wc.removeListener('page-info-open-site-settings',previous)
    ;(wc as any).__navoraPageInfoListener=listener;wc.on('page-info-open-site-settings',listener)
    return wc.showPageInfoDialog({anchorBounds:anchor(event.sender,win,bounds),...(siteUrl?{siteUrl}:{})})
  })
  return {dispose(){for(const sender of watched)cleanup(sender);for(const channel of channels)ipcMain.removeHandler(channel)}}
}
