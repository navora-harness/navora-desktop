// Exercises the IPC boundary with native objects replaced by strict, inert fakes.
// No Electron process, windows, browser profile, or network is opened.
import strictAssert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
const require=createRequire(import.meta.url),handlers=new Map(),windows=new Map(),nativePanels=[],nativeMenus=[]
let failNextPanelShow=false
let checks=0
const assert=new Proxy(strictAssert,{get(target,key){const value=Reflect.get(target,key);return typeof value==='function'?(...args)=>{checks++;return Reflect.apply(value,target,args)}:value}})
class FakeContents extends EventEmitter {
  constructor(id){super();this.id=id;this.mainFrame={};this.sent=[];this.zoom=1;this.destroyed=false;this.focusCount=0}
  isDestroyed(){return this.destroyed}
  getZoomFactor(){return this.zoom}
  send(channel,payload){this.sent.push({channel,payload})}
  focus(){this.focusCount++}
}
class FakeWindow extends EventEmitter {
  constructor(){super();this.destroyed=false;this.focused=true;this.visible=true;this.minimized=false;this.origin={x:-1200,y:40};this.hooks=new Map()}
  static fromWebContents(sender){return windows.get(sender)}
  isDestroyed(){return this.destroyed}
  isFocused(){return this.focused}
  isVisible(){return this.visible}
  isMinimized(){return this.minimized}
  isWindowMessageHooked(message){return this.hooks.has(message)}
  hookWindowMessage(message,callback){this.hooks.set(message,callback)}
  unhookWindowMessage(message){this.hooks.delete(message)}
  getContentBounds(){return {...this.origin,width:900,height:700}}
}
class FakeMenu extends EventEmitter {
  constructor(items){super();this.items=items;this.refreshCount=0;nativeMenus.push(this)}
  static buildFromTemplate(items){return new FakeMenu(items.map(item=>({...item,enabled:item.enabled!==false})))}
  getMenuItemById(id){const find=rows=>{for(const item of rows){if(item.id===id)return item;const child=item.submenu&&find(item.submenu);if(child)return child}};return find(this.items)}
  popup(options){this.popupOptions=options;this.open=true}
  closePopup(){const open=this.open;this.open=false;this.popupOptions?.callback?.();if(open)this.emit('menu-will-close')}
  refresh(){this.refreshCount++}
}
class FakePanel extends EventEmitter {
  constructor(options){super();this.options=options;this.updates=[];this.commands=[];this.transactions=[];this.revision=0;this.destroyed=false;nativePanels.push(this)}
  static isSupported(){return true}
  static getCapabilities(){return {supported:true,apiVersion:2,backend:'views',createsWebContents:false,features:['descendant-hover','context-menu','owned-popups','active-item','node-transactions','revision-guards','wrap-layout','virtual-list','shared-styles','state-styles','selectable-text','multiple-links','native-editing','accessibility','diagnostics'],limits:{mountedNodes:2000,dataNodes:100000,virtualRows:50000,depth:32}}}
  show(options){assert.equal(this.destroyed,false);if(failNextPanelShow){failNextPanelShow=false;throw Error('injected_native_show_failure')}this.showCount=(this.showCount||0)+1;this.showOptions=options;this.open=true}
  hide(){this.open=false}
  update(patch){assert.equal(this.destroyed,false);if(patch.expectedRevision!==undefined&&patch.expectedRevision!==this.revision)return false;this.updates.push(patch);if(patch.content||patch.revision!==undefined)this.revision=patch.revision??this.revision+1;return true}
  applyPatch(operations,guards){assert.equal(this.destroyed,false);if(guards?.expectedRevision!==undefined&&guards.expectedRevision!==this.revision)return false;this.transactions.push({operations,guards});this.revision=guards?.revision??this.revision+1;return true}
  focus(id){this.commands.push({type:'focus',id});return true}
  setActiveItem(id){this.commands.push({type:'active',id});return true}
  scrollTo(id){this.commands.push({type:'scroll',id});return true}
  scrollListTo(id,offset){this.commands.push({type:'scroll-list',id,offset});return true}
  announce(text,assertive){this.commands.push({type:'announce',text,assertive})}
  getBounds(id){this.commands.push({type:'bounds',id});return this.nativeBounds||null}
  popupMenu(menu,options){this.menuPopup={menu,options};menu.popup({window:this.options.parent})}
  destroy(){this.destroyed=true;this.open=false;this.emit('closed')}
}
let focusedContents
const electron={ipcMain:{handle:(id,fn)=>handlers.set(id,fn),removeHandler:id=>handlers.delete(id)},BrowserWindow:FakeWindow,NativePanel:FakePanel,Menu:FakeMenu,nativeImage:{createFromBuffer:(bytes,settings)=>({isEmpty:()=>false,scaleFactor:settings.scaleFactor,pixelWidth:bytes.readUInt32BE(16),pixelHeight:bytes.readUInt32BE(20)})},webContents:{getFocusedWebContents:()=>focusedContents}}
const output=await build({entryPoints:['electron/modules/native-ui.ts'],write:false,bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'silent'})
const module={exports:{}}
new Function('require','module','exports',output.outputFiles[0].text)(id=>id==='electron'?electron:require(id),module,module.exports)
const sender=new FakeContents(1),guest=new FakeContents(2),win=new FakeWindow(),foreign=new FakeContents(9)
windows.set(sender,win);windows.set(guest,win);win.webContents=sender;focusedContents=guest
let sourceValid=true,materialState={mode:'solid',dark:false}
const registered=module.exports.registerNativeUi({trusted:wc=>wc===sender?win:undefined,source:(wc,id)=>{assert.equal(wc,sender);assert.equal(id,'page');return {webContents:guest,valid:()=>sourceValid}},pageSettings:()=>{},materialState:()=>materialState})
const event={sender,senderFrame:sender.mainFrame},invoke=(name,...args)=>handlers.get('navora:native-ui.'+name)(event,...args)
const anchor={x:10,y:20,width:300,height:30},events=channel=>sender.sent.filter(event=>event.channel===channel).map(event=>event.payload)
const controls=()=>[{id:'zoom',label:'缩放',controls:[{id:'minus',type:'button',label:'−',group:1},{id:'value',type:'label',label:'100%',group:1},{id:'plus',type:'button',label:'+',group:1}]}]
const menuInput=id=>({requestId:id,items:controls(),anchor,sourcePageId:'page'})
const capabilities=invoke('capabilities')
assert.equal(capabilities.distributionVersion,'45.0.0-cloudbypass.11')
for(const name of ['menus','panels','menuControls','menuAppearance','panelItems','panelTextarea','panelScrollbars'])assert.equal(capabilities[name],true,`The .11 distribution retains ${name}`)

// Native icon buttons paint at20 DIP. Exact-size rasters retain that logical
// size while legacy icons keep16 DIP and existing callers remain unchanged.
const pngData=(width,height=width)=>{const bytes=Buffer.alloc(24);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return 'data:image/png;base64,'+bytes.toString('base64')}
const iconTree={id:'icon-root',type:'row',children:[{id:'legacy-icon',type:'icon',icon:'legacy'},{id:'search-icon',type:'iconButton',icon:'search',accessibleName:'关闭'}]}
const iconHandle=invoke('show',{id:'icon-representations',content:iconTree,anchor,icons:{legacy:pngData(28),search:{dataUrl:pngData(35),logicalSize:20}}}),iconPanel=nativePanels.at(-1)
assert.equal(iconPanel.options.content.children[0].image.scaleFactor,1.75)
assert.equal(iconPanel.options.content.children[0].image.pixelWidth,28)
assert.equal(iconPanel.options.content.children[1].image.scaleFactor,1.75)
assert.equal(iconPanel.options.content.children[1].image.pixelWidth,35)
assert.equal(invoke('update',iconHandle.id,iconHandle.session,{content:iconTree,icons:{legacy:{dataUrl:pngData(32),logicalSize:16},search:{dataUrl:pngData(40),logicalSize:20}}}),true)
assert.equal(iconPanel.updates.at(-1).content.children[0].image.scaleFactor,2)
assert.equal(iconPanel.updates.at(-1).content.children[1].image.scaleFactor,2)
for(const value of [{dataUrl:pngData(35),logicalSize:17},{dataUrl:pngData(35),logicalSize:NaN},{dataUrl:pngData(35)},{dataUrl:pngData(35),logicalSize:20,extra:true},{dataUrl:'not-a-png',logicalSize:20},{dataUrl:pngData(257),logicalSize:20},null,[]])assert.throws(()=>invoke('show',{id:'invalid-icon',content:iconTree,anchor,icons:{legacy:pngData(28),search:value}}),/invalid_native_ui/)
invoke('destroy',iconHandle.id,iconHandle.session)

// Material is a trusted owner decision. Refreshing it updates existing native
// surfaces without replaying their trees, input values, geometry, or sessions.
const materialTree={id:'material-root',type:'column',width:300,children:[{id:'material-query',type:'input',value:'保留原生草稿'},{id:'material-label',type:'text',text:'材质测试'}]}
const materialTheme={mode:'light',background:'#fafafa',text:'#202020',border:'#dddddd'}
const materialHidden=invoke('show',{id:'material-hidden',content:materialTree,anchor,theme:materialTheme,role:'editor',focusMode:'none'}),hiddenMaterialPanel=nativePanels.at(-1)
assert.equal(hiddenMaterialPanel.options.backgroundMaterial,'none')
invoke('hide',materialHidden.id,materialHidden.session)
const materialVisible=invoke('show',{id:'material-visible',content:materialTree,anchor,theme:materialTheme,role:'editor',focusMode:'none'}),visibleMaterialPanel=nativePanels.at(-1)
const materialPanelCount=nativePanels.length,materialShowCount=visibleMaterialPanel.showCount,materialFocusCount=guest.focusCount
materialState={mode:'acrylic',dark:false};registered.refreshMaterials(win)
for(const native of [hiddenMaterialPanel,visibleMaterialPanel]){
  const patch=native.updates.at(-1)
  assert.equal(patch.backgroundMaterial,'acrylic')
  assert.equal(patch.theme.materialTint,'#CCFAFAFA')
  for(const field of ['content','anchorBounds','focusMode'])assert.equal(field in patch,false,`Material refresh never replays ${field}`)
}
assert.equal(hiddenMaterialPanel.open,false);assert.equal(visibleMaterialPanel.open,true)
assert.equal(nativePanels.length,materialPanelCount);assert.equal(visibleMaterialPanel.showCount,materialShowCount)
assert.equal(guest.focusCount,materialFocusCount)
materialState={mode:'solid',dark:false};registered.refreshMaterials(win)
for(const native of [hiddenMaterialPanel,visibleMaterialPanel]){
  const patch=native.updates.at(-1)
  assert.equal(patch.backgroundMaterial,'none')
  assert.equal(patch.theme.background,materialTheme.background)
}
assert.equal(invoke('update',materialVisible.id,materialVisible.session,{anchor}),true,'Material switches retain the renderer session')
assert.equal(invoke('update',materialHidden.id,materialHidden.session,{anchor}),true,'Hidden instances retain their credentials through a material switch')
const materialDark=invoke('show',{id:'material-dark',content:materialTree,anchor,theme:{...materialTheme,mode:'dark',background:'#202020'},focusMode:'none'}),darkMaterialPanel=nativePanels.at(-1)
materialState={mode:'acrylic',dark:true};registered.refreshMaterials(win)
assert.equal(darkMaterialPanel.updates.at(-1).theme.materialTint,'#B3202020')
assert.throws(()=>invoke('show',{id:'forged-material',content:materialTree,anchor,backgroundMaterial:'acrylic'}),/field/,'Renderers cannot bypass the setting')
assert.throws(()=>invoke('update',materialDark.id,materialDark.session,{backgroundMaterial:'acrylic'}),/field/,'Updates cannot bypass the setting')
for(const nativeHandle of [materialVisible,materialHidden,materialDark])invoke('destroy',nativeHandle.id,nativeHandle.session)
materialState={mode:'solid',dark:false}

// The v2 boundary keeps node identity and revisions authoritative while exposing
// native focus, selection, geometry, transactions, and panel-owned context menus.
assert.equal(capabilities.panelApiVersion,2);assert.equal(capabilities.panelMaterial,true)
assert.ok(capabilities.panelFeatures.includes('node-transactions'))
sender.zoom=1.5
const v2Tree={id:'v2-root',type:'column',width:300,gap:6,children:[{id:'v2-query',type:'input',value:'原生草稿'},{id:'v2-list',type:'list',height:100,children:[{id:'v2-row',type:'item',contextMenu:true,styleName:'download',children:[{id:'v2-name',type:'text',text:'样例.exe',singleLine:true,style:{textDecoration:'line-through'}}]}]}]}
const v2=invoke('show',{id:'v2-bridge',content:v2Tree,anchor,focusMode:'none',theme:{mode:'light',background:'#ffffff',tokens:{fileInk:'#123456',fileHover:'$surfaceHover'},styles:{download:{color:'$fileInk',hover:{background:'$fileHover'},paddingLeft:4}}}}),v2Panel=nativePanels.at(-1)
assert.equal(v2Panel.options.theme.styles.download.paddingLeft,6)
assert.equal(v2Panel.options.content.children[1].children[0].styleName,'download')
assert.equal(invoke('command',v2.id,v2.session,{type:'focus',id:'v2-query'}),true)
assert.deepEqual(v2Panel.commands.at(-1),{type:'focus',id:'v2-query'})
assert.equal(invoke('command',v2.id,'stale-session',{type:'focus',id:'v2-query'}),false)
assert.equal(invoke('command',v2.id,v2.session,{type:'focus',id:'forged-node'}),false)
assert.equal(invoke('command',v2.id,v2.session,{type:'active',id:'v2-query'}),false)
assert.equal(invoke('command',v2.id,v2.session,{type:'active',id:'v2-row'}),true)
assert.equal(invoke('command',v2.id,v2.session,{type:'active',id:''}),true)
assert.deepEqual(v2Panel.commands.at(-1),{type:'active',id:null})
assert.equal(invoke('command',v2.id,v2.session,{type:'scroll-list',id:'v2-list',offset:12}),true)
assert.deepEqual(v2Panel.commands.at(-1),{type:'scroll-list',id:'v2-list',offset:18})
assert.throws(()=>invoke('command',v2.id,v2.session,{type:'scroll-list',id:'v2-row',offset:12}),/scroll/)
assert.throws(()=>invoke('command',v2.id,v2.session,{type:'scroll-list',id:'v2-list',offset:Infinity}),/scroll/)
assert.equal(invoke('command',v2.id,v2.session,{type:'announce',text:'下载已完成',assertive:true}),true)
assert.deepEqual(v2Panel.commands.at(-1),{type:'announce',text:'下载已完成',assertive:true})
assert.throws(()=>invoke('command',v2.id,v2.session,{type:'announce',text:[],assertive:true}),/announcement/)
assert.throws(()=>invoke('command',v2.id,v2.session,{type:'focus',id:'v2-query',windowId:999}),/field/)
v2Panel.nativeBounds={x:-1185,y:70,width:450,height:225}
assert.deepEqual(invoke('command',v2.id,v2.session,{type:'bounds'}),{x:10,y:20,width:300,height:150})
assert.deepEqual(invoke('command',v2.id,v2.session,{type:'bounds',id:'v2-row'}),{x:10,y:20,width:300,height:150})
assert.equal(invoke('command',v2.id,v2.session,{type:'bounds',id:'missing'}),null)
const revisionBefore=v2Panel.revision,patchBefore=v2Panel.transactions.length
assert.equal(invoke('patch',v2.id,v2.session,[{op:'set',id:'v2-name',properties:{text:'修改.exe'}}],{expectedRevision:revisionBefore+1}),false)
assert.equal(v2Panel.transactions.length,patchBefore)
assert.equal(invoke('patch',v2.id,v2.session,[{op:'set',id:'v2-name',properties:{text:'修改.exe',minWidth:40}}],{expectedRevision:revisionBefore,revision:7}),true)
assert.equal(v2Panel.revision,7)
assert.equal(v2Panel.transactions.at(-1).operations[0].properties.minWidth,60)
const acceptedTransactions=v2Panel.transactions.length
assert.throws(()=>invoke('patch',v2.id,v2.session,[{op:'set',id:'v2-name',properties:{text:'不应提交'}},{op:'remove',id:'forged-node'}]),/patch_target/)
assert.equal(v2Panel.transactions.length,acceptedTransactions,'A failed candidate never reaches native applyPatch')
assert.equal(invoke('update',v2.id,v2.session,{content:v2Tree,expectedRevision:6}),false)
const v2ActionsBefore=events('navora:native-ui.event').filter(event=>event.kind==='action').length
v2Panel.emit('action',{id:'v2-row',type:'context-menu',revision:6,sourceType:'keyboard',anchor:{x:-1185,y:70,width:3,height:3}})
assert.equal(events('navora:native-ui.event').filter(event=>event.kind==='action').length,v2ActionsBefore,'Stale native actions are rejected')
v2Panel.emit('action',{id:'v2-row',type:'context-menu',revision:7,sourceType:'keyboard',anchor:{x:-1185,y:70,width:3,height:3}})
assert.deepEqual(events('navora:native-ui.event').at(-1).action,{id:'v2-row',type:'contextMenu',revision:7,sourceType:'keyboard',anchor:{x:10,y:20,width:2,height:2}})
const ownedMenu=invoke('menu',{requestId:'v2-owned-context',items:[{id:'copy',label:'复制下载链接'}],anchor,parentPanelId:v2.id,parentPanelTargetId:'v2-row',sourceType:'keyboard'}),v2Menu=nativeMenus.at(-1)
assert.equal(v2Panel.menuPopup.menu,v2Menu)
assert.deepEqual(v2Panel.menuPopup.options,{id:'v2-row',x:-1185,y:70,sourceType:'keyboard'})
assert.equal(v2Panel.open,true,'Opening a panel-owned native menu retains its parent panel')
invoke('closeMenu','v2-owned-context');assert.equal((await ownedMenu).reason,'closed')
invoke('hide',v2.id,v2.session)
assert.equal(invoke('command',v2.id,v2.session,{type:'focus',id:'v2-query'}),false,'Hidden native panels cannot take focus through a stale action')
invoke('destroy',v2.id,v2.session);sender.zoom=1
sender.sent=sender.sent.filter(event=>event.channel!=='navora:native-ui.event'||event.payload.id!==v2.id)

// Popup coordinates remain owner-content DIP, including on negative monitors.
const edge=invoke('menu',{...menuInput('menu-edge'),anchor:{x:870,y:660,width:24,height:30},placement:'bottom-end',appearance:{width:240,rowHeight:34,padding:5}}),edgeMenu=nativeMenus.at(-1)
assert.equal(edgeMenu.popupOptions.x,642);assert.equal(edgeMenu.popupOptions.y,648)
assert.equal(edgeMenu.popupOptions.window,win)
invoke('closeMenu','menu-edge');await edge
sender.zoom=1.5
const zoomEdge=invoke('menu',{...menuInput('menu-zoom-edge'),anchor:{x:560,y:20,width:24,height:28},placement:'bottom-end',appearance:{width:240,rowHeight:34,padding:5}}),zoomEdgeMenu=nativeMenus.at(-1)
assert.equal(zoomEdgeMenu.popupOptions.x,500);assert.equal(zoomEdgeMenu.popupOptions.y,78)
invoke('closeMenu','menu-zoom-edge');await zoomEdge;sender.zoom=1

const request=invoke('menu',menuInput('menu-a')),menu=nativeMenus.at(-1)
assert.deepEqual(events('navora:native-ui.menu-opened').at(-1),{requestId:'menu-a'})
menu.emit('control-action',{itemId:'zoom',controlId:'minus'})
menu.emit('control-action',{itemId:'zoom',controlId:'plus'})
assert.equal(menu.open,true);assert.deepEqual(events('navora:native-ui.menu-control').map(event=>event.sequence),[1,2])
const refreshed=controls();refreshed[0].controls[0].enabled=false;refreshed[0].controls[1].label='110%'
assert.equal(invoke('updateMenu','menu-a',{items:refreshed}),true);assert.equal(menu.refreshCount,1)
menu.emit('control-action',{itemId:'zoom',controlId:'minus'});menu.emit('control-action',{itemId:'zoom',controlId:'value'})
assert.equal(events('navora:native-ui.menu-control').length,2)
const wrong=controls();wrong[0].controls[0].id='forged'
assert.throws(()=>invoke('updateMenu','menu-a',{items:wrong}),/membership/)
invoke('closeMenu','menu-a');assert.equal((await request).reason,'closed')
menu.emit('control-action',{itemId:'zoom',controlId:'plus'});assert.equal(events('navora:native-ui.menu-control').length,2)
assert.equal(invoke('updateMenu','menu-a',{items:controls()}),false)

const stale=invoke('menu',menuInput('menu-stale')),staleMenu=nativeMenus.at(-1)
sourceValid=false;staleMenu.emit('control-action',{itemId:'zoom',controlId:'plus'})
assert.equal((await stale).reason,'closed');assert.equal(events('navora:native-ui.menu-control').length,2);sourceValid=true
const closeItems=controls();closeItems[0].controls[2].closeOnClick=true
const closeRequest=invoke('menu',{...menuInput('menu-close'),items:closeItems}),closeNative=nativeMenus.at(-1)
// The native close callback can run before the root control-action dispatch.
closeNative.closePopup();closeNative.emit('control-action',{itemId:'zoom',controlId:'plus'})
await closeRequest;assert.equal(events('navora:native-ui.menu-control').at(-1).requestId,'menu-close')

const tree={id:'root',type:'list',width:300,height:150,scrollbarPlacement:'gutter',children:[{id:'row',type:'item',selected:true,children:[{id:'text',type:'text',text:'😀标题',singleLine:true,maxWidth:180,highlights:[{start:0,end:2}],style:{paddingRight:8,radius:4}}]},{id:'editor',type:'textarea',value:'第一行\n第二行',height:80,maxLength:4000,submitOnEnter:true,scrollbarPlacement:'overlay'}]}
const show=(id,extra={})=>invoke('show',{id,content:tree,anchor,sourcePageId:'page',...extra})
sender.zoom=1.5
const first=show('panel',{contentInset:5,scrollbarPlacement:'gutter',role:'editor',focusMode:'input'}),panel=nativePanels.at(-1)
assert.deepEqual(panel.showOptions.anchorBounds,{x:-1185,y:70,width:450,height:45})
assert.equal(panel.options.content.width,450);assert.equal(panel.options.content.children[0].children[0].maxWidth,270)
assert.deepEqual(panel.options.content.children[0].children[0].highlights,[{start:0,end:2}])
assert.equal(panel.options.content.children[0].children[0].style.paddingRight,12)
assert.equal(panel.options.content.children[1].maxLength,4000);assert.equal(panel.options.contentInset,8)
assert.equal(panel.options.scrollbarPlacement,'gutter');assert.equal(panel.options.content.children[1].scrollbarPlacement,'overlay')
assert.equal(panel.options.shadow,true)
assert.equal(panel.options.backgroundMaterial,'none')
panel.emit('action',{id:'row',type:'click'});panel.emit('action',{id:'editor',type:'submit',value:'全文\n😀'})
assert.equal(events('navora:native-ui.event').filter(event=>event.kind==='action').length,2)
panel.emit('action',{id:'editor',type:'change',value:'x'.repeat(65537)})
panel.emit('action',{id:'editor',type:'submit',value:'x'.repeat(65537)})
assert.deepEqual(events('navora:native-ui.event').filter(event=>event.kind==='input-overflow').map(({kind,controlId,length})=>({kind,controlId,length})),[{kind:'input-overflow',controlId:'editor',length:65537},{kind:'input-overflow',controlId:'editor',length:65537}])
assert.equal(events('navora:native-ui.event').filter(event=>event.kind==='action').length,2)
assert.equal(events('navora:native-ui.event').filter(event=>event.kind==='input-overflow').some(event=>'value' in event||'action' in event),false)
invoke('hide','panel',first.session);panel.emit('action',{id:'row',type:'click'})
assert.equal(events('navora:native-ui.event').filter(event=>event.kind==='action').length,2)
await Promise.resolve();assert.equal(guest.focusCount,1)
const beforeReuse=nativePanels.length,second=show('panel',{contentInset:5,role:'editor',focusMode:'input'})
assert.equal(nativePanels.length,beforeReuse);assert.notEqual(first.session,second.session)
assert.equal(invoke('update','panel',first.session,{content:tree}),false)
invoke('destroy','panel',first.session);assert.equal(panel.destroyed,false)
const omitted=structuredClone(tree);delete omitted.children[1].value
assert.equal(invoke('update','panel',second.session,{content:omitted}),true)
assert.equal('value' in panel.updates.at(-1).content.children[1],false)
assert.equal(invoke('update','panel',second.session,{shadow:false}),true)
assert.equal(panel.updates.at(-1).shadow,false)
const beforeInvalidShadow=panel.updates.length
assert.throws(()=>invoke('update','panel',second.session,{shadow:'false'}),/boolean/)
assert.equal(panel.updates.length,beforeInvalidShadow)
sender.zoom=2
assert.equal(invoke('update','panel',second.session,{anchor}),true)
assert.equal(panel.updates.at(-1).content.width,600)
assert.equal(panel.updates.at(-1).radius,24)
assert.equal(panel.updates.at(-1).contentInset,10)
assert.equal(panel.updates.at(-1).shadow,false,'Anchor/zoom updates retain an explicit false shadow preference')
assert.equal('value' in panel.updates.at(-1).content.children[1],false)
sender.zoom=1.5
const disabled=structuredClone(tree);disabled.disabled=true
invoke('update','panel',second.session,{content:disabled});panel.emit('action',{id:'row',type:'click'})
assert.equal(events('navora:native-ui.event').filter(event=>event.kind==='action').length,2)
panel.emit('action',{id:'editor',type:'change',value:'x'.repeat(65537)})
assert.equal(events('navora:native-ui.event').filter(event=>event.kind==='input-overflow').length,2)
invoke('hide','panel',second.session)

const persistent=show('confirmation',{role:'editor',dismissOnOutsideClick:false,dismissOnEscape:false}),persistentPanel=nativePanels.at(-1),beforeBlocked=nativePanels.length
assert.throws(()=>show('blocked'),/modal_active/);assert.equal(nativePanels.length,beforeBlocked)
assert.throws(()=>invoke('menu',menuInput('blocked-menu')),/modal_active/)
const persistentAgain=show('confirmation',{role:'editor',dismissOnOutsideClick:false,dismissOnEscape:false})
assert.equal(nativePanels.at(-1),persistentPanel);assert.notEqual(persistent.session,persistentAgain.session)
show('confirmation',{role:'editor',dismissOnOutsideClick:true,dismissOnEscape:true})
assert.equal(persistentPanel.destroyed,true);assert.notEqual(nativePanels.at(-1),persistentPanel)
assert.throws(()=>show('bad-material',{backgroundMaterial:'acrylic'}),/field/)
assert.throws(()=>show('bad-flags',{dismissOnEscape:'false'}),/dismiss/)
for(const shadow of ['false',null,0])assert.throws(()=>show('bad-shadow',{shadow}),/boolean/)
assert.throws(()=>handlers.get('navora:native-ui.capabilities')({sender:foreign,senderFrame:foreign.mainFrame}),/local_app_only/)
assert.throws(()=>handlers.get('navora:native-ui.capabilities')({sender,senderFrame:{}}),/local_app_only/)
sourceValid=false;assert.throws(()=>show('stale-page'),/source_invalid/);sourceValid=true

const flat=show('flat',{shadow:false}),flatPanel=nativePanels.at(-1)
assert.equal(flatPanel.options.shadow,false)
assert.equal(invoke('update','flat',flat.session,{anchor}),true)
assert.equal(flatPanel.updates.at(-1).shadow,false)
invoke('hide','flat',flat.session)

// Windows may clamp an owned popup to the display origin while its owner is
// minimized. Restore must use the latest logical anchor and current owner bounds,
// without resending the editor or opening a new interaction session.
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const restored=show('restore-anchor',{role:'search',shadow:false,placement:'bottom-end'}),restoredPanel=nativePanels.at(-1),logicalAnchor={x:33,y:47,width:1,height:1}
invoke('update',restored.id,restored.session,{anchor:logicalAnchor})
const beforeMinimizeUpdates=restoredPanel.updates.length,beforeMinimizePanels=nativePanels.length,focusBeforeRestore=guest.focusCount
focusedContents=undefined
if(process.platform==='win32'){
  const eventCount=events('navora:native-ui.event').length
  win.minimized=true
  win.hooks.get(0x46)(Buffer.alloc(8),Buffer.alloc(8))
  assert.deepEqual(win.origin,{x:-1200,y:40})
  assert.equal(restoredPanel.open,false,'Minimized position message hides the native popup before owner geometry changes')
  assert.equal(events('navora:native-ui.event').length,eventCount,'Pre-hide retains the renderer search session')
}
win.minimized=true;win.visible=false;win.origin={x:-32000,y:-32000};win.emit('minimize');win.emit('restore')
const beforeParentHidden=events('navora:native-ui.event').length
restoredPanel.hide();restoredPanel.emit('dismissed',{reason:'parent-hidden'})
assert.equal(events('navora:native-ui.event').length,beforeParentHidden,'Temporary parent hiding must not close renderer search state')
await pause(35)
assert.equal(restoredPanel.updates.length,beforeMinimizeUpdates,'Invalid minimized owner bounds must not move the popup')
win.minimized=false;win.visible=true;win.origin={x:-1600,y:240};sender.zoom=2;win.emit('restore');win.emit('show')
await pause(65)
assert.deepEqual(restoredPanel.showOptions,{anchorBounds:{x:-1534,y:334,width:2,height:2},placement:'bottom-end'})
assert.equal(nativePanels.length,beforeMinimizePanels);assert.equal(restoredPanel.showCount,2)
assert.equal(restoredPanel.updates.length,beforeMinimizeUpdates,'Restore does not replay content or native input values')
assert.equal(restoredPanel.open,true)
assert.equal(restoredPanel.options.sourceWebContents,guest);assert.equal(guest.focusCount,focusBeforeRestore)
assert.equal(invoke('update',restored.id,restored.session,{anchor:logicalAnchor}),true,'Restore retains the original panel credential')
restoredPanel.hide();restoredPanel.emit('dismissed',{reason:'outside-click'})
const afterDismissUpdates=restoredPanel.updates.length
win.emit('restore');await pause(50)
assert.equal(restoredPanel.updates.length,afterDismissUpdates);assert.equal(restoredPanel.open,false);assert.equal(restoredPanel.showCount,2)
focusedContents=guest
const guestSearch=show('restore-guest',{role:'search'}),guestSearchPanel=nativePanels.at(-1),guestFocusBeforeMinimize=guest.focusCount
win.minimized=true;win.emit('minimize');guestSearchPanel.hide();guestSearchPanel.emit('dismissed',{reason:'parent-hidden'});win.minimized=false;win.emit('restore');await pause(50)
assert.equal(guestSearchPanel.showCount,2);assert.equal(guest.focusCount,guestFocusBeforeMinimize+1,'Restore keeps an already focused page in the same owner focused')
invoke('hide',guestSearch.id,guestSearch.session)
sender.zoom=1.5
const ownerChanged=show('restore-owner',{role:'search'}),ownerChangedPanel=nativePanels.at(-1),wrongOwner=new FakeWindow()
windows.set(sender,wrongOwner);win.emit('restore');await pause(50)
assert.equal(ownerChangedPanel.destroyed,true,'Owner restore must not act for a transferred sender')
windows.set(sender,win)
const staleSource=show('restore-source',{role:'search'}),staleSourcePanel=nativePanels.at(-1)
sourceValid=false;win.emit('show');await pause(50)
assert.equal(staleSourcePanel.destroyed,true,'Owner restore must not revive a stale source page')
sourceValid=true
assert.equal(win.listenerCount('restore'),1,'One owner watcher serves every popup from the window')
if(process.platform==='win32'){
  const cancelled=show('position-transition',{role:'search'}),cancelledPanel=nativePanels.at(-1)
  win.hooks.get(0x46)(Buffer.alloc(8),Buffer.alloc(8))
  assert.equal(cancelledPanel.open,true,'Normal moves, maximize and cancelled minimize do not suspend search')
  win.minimized=true;win.hooks.get(0x46)(Buffer.alloc(8),Buffer.alloc(8))
  assert.equal(cancelledPanel.open,false,'Minimized window-position changes also suspend before native panel following')
  win.minimized=false;win.emit('restore')
  await pause(65)
  assert.equal(cancelledPanel.open,true)
  invoke('hide',cancelled.id,cancelled.session)
}

// Search is an app coordination role, never an Electron constructor field.
const search=show('search',{role:'search'}),searchPanel=nativePanels.at(-1)
assert.equal(searchPanel.options.focusMode,'input')
assert.equal(searchPanel.options.dismissOnOutsideClick,false);assert.equal(searchPanel.options.dismissOnEscape,true)
assert.equal('role' in searchPanel.options,false)
show('ordinary');assert.equal(searchPanel.open,true)
const searchMenu=invoke('menu',menuInput('search-menu'))
assert.equal(searchPanel.open,true);invoke('closeMenu','search-menu');await searchMenu
const guestCleanup=registered.prepareGuestMenu(win,()=>{})
assert.equal(searchPanel.open,true);guestCleanup()
show('passive',{role:'passive',focusMode:'none'});assert.equal(searchPanel.open,true)
const replacementSearch=show('search-new',{role:'search'}),replacementPanel=nativePanels.at(-1)
assert.equal(searchPanel.open,false);assert.equal(replacementPanel.open,true)
const searchActions=events('navora:native-ui.event').filter(event=>event.kind==='action').length
searchPanel.emit('action',{id:'row',type:'click'})
assert.equal(events('navora:native-ui.event').filter(event=>event.kind==='action').length,searchActions)
const focusPopup=show('focus-popup')
const retainedFocus=guest.focusCount
invoke('hide','focus-popup',focusPopup.session)
await Promise.resolve();assert.equal(guest.focusCount,retainedFocus,'Retaining search must not refocus the page when another popup closes')
const modalSearchGuard=show('search-modal',{role:'editor',dismissOnOutsideClick:false,dismissOnEscape:false})
assert.equal(replacementPanel.open,true)
assert.throws(()=>show('blocked-search',{role:'search'}),/modal_active/)
invoke('hide','search-modal',modalSearchGuard.session)
invoke('hide','search-new',replacementSearch.session)
sender.emit('did-start-navigation',{},'https://app.invalid',false,true)
assert.equal(nativePanels.every(panel=>panel.destroyed),true)
failNextPanelShow=true
assert.throws(()=>show('failed-confirmation',{role:'editor',dismissOnEscape:false,dismissOnOutsideClick:false}),/injected_native_show_failure/)
assert.equal(nativePanels.at(-1).destroyed,true)
const afterFailure=invoke('menu',menuInput('after-failure'));invoke('closeMenu','after-failure');await afterFailure
registered.dispose();assert.equal(handlers.size,0)
assert.equal(win.listenerCount('restore'),0);assert.equal(win.listenerCount('show'),0);assert.equal(win.listenerCount('minimize'),0)
assert.equal(win.hooks.size,0,'Disposal releases only the native message hooks installed for this owner')

// Legacy callers and hosts without a trustworthy material state stay opaque.
const withoutMaterial=module.exports.registerNativeUi({trusted:wc=>wc===sender?win:undefined,source:()=>{throw Error('Unexpected source lookup')},pageSettings:()=>{}})
const failClosed=invoke('show',{id:'no-material-provider',content:materialTree,anchor,theme:materialTheme,focusMode:'none'})
assert.equal(nativePanels.at(-1).options.backgroundMaterial,'none')
assert.equal(invoke('update',failClosed.id,failClosed.session,{theme:materialTheme}),true)
assert.equal(nativePanels.at(-1).updates.at(-1).backgroundMaterial,'none')
withoutMaterial.dispose();assert.equal(handlers.size,0)

// Run the real renderer composable as well: closing a popup commits the final
// accepted inline action, but explicit context cancellation drops queued work.
const savedGlobals=new Map(['window','document','HTMLElement','getComputedStyle','CustomEvent','Image'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
const cleanupHooks=[],menuOpenedListeners=new Set(),controlListeners=new Set(),panelListeners=new Set(),rendererCalls=[],panelCalls=[],panelOperations=[],panelUpdates=[],rendererCommands=[],rendererPatches=[]
let menuWaiter
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
const rendererApi={
  capabilities:async()=>({menus:true,panels:true,menuControls:true,menuAppearance:true}),
  popupMenu:input=>{const pending=defer();menuWaiter={input,...pending};rendererCalls.push(menuWaiter);return pending.promise},
  updateMenu:async()=>true,
  closeMenu:async id=>{if(menuWaiter?.input.requestId===id)menuWaiter.resolve({supported:true,reason:'closed'})},
  onMenuOpened:fn=>{menuOpenedListeners.add(fn);return ()=>menuOpenedListeners.delete(fn)},
  onMenuControl:fn=>{controlListeners.add(fn);return ()=>controlListeners.delete(fn)},
  showPanel:input=>{const pending=defer();panelCalls.push({input,...pending});return pending.promise},
  updatePanel:async(id,session,patch)=>{panelUpdates.push({id,session,patch});return true},
  commandPanel:async(id,session,command)=>{rendererCommands.push({id,session,command});return command.type==='bounds'?{x:10,y:20,width:300,height:150}:true},
  patchPanel:async(id,session,operations,guards)=>{rendererPatches.push({id,session,operations,guards});return true},
  hidePanel:async(id,session)=>{panelOperations.push({kind:'hide',id,session})},
  destroyPanel:async(id,session)=>{panelOperations.push({kind:'destroy',id,session})},
  onPanelEvent:fn=>{panelListeners.add(fn);return ()=>panelListeners.delete(fn)},
}
const fakeVue={ref:value=>({value}),watch:()=>{},onBeforeUnmount:fn=>cleanupHooks.push(fn)}
try{
  const rendererWindow=new EventTarget()
  Object.assign(rendererWindow,{navora:{app:{platform:'win32'},nativeUi:rendererApi},devicePixelRatio:1})
  Object.assign(globalThis,{window:rendererWindow,HTMLElement:class {},Image:class {async decode(){}},CustomEvent:class extends Event{constructor(type,options){super(type);this.detail=options?.detail}},document:{documentElement:{},querySelector:()=>({}),createElement:()=>{const canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(){},getImageData:()=>({data:[255,255,255,255]})}),toDataURL:()=>pngData(canvas.width,canvas.height)};return canvas}},getComputedStyle:()=>({getPropertyValue:()=>''})})
  const rendererBundle=await build({entryPoints:['src/composables/useNativeUi.ts'],tsconfig:'tsconfig.app.json',write:false,bundle:true,platform:'node',format:'cjs',external:['vue'],logLevel:'silent'})
  const rendererModule={exports:{}}
  new Function('require','module','exports',rendererBundle.outputFiles[0].text)(id=>id==='vue'?fakeVue:require(id),rendererModule,rendererModule.exports)
  const ui=rendererModule.exports.useNativeUi();await ui.ready()
  const settle=()=>new Promise(resolve=>setImmediate(resolve))
  const sendControl=(id,sequence)=>{for(const fn of controlListeners)fn({requestId:id,itemId:'zoom',controlId:'plus',sequence})}
  const gate=defer(),performed=[],opened=[]
  const rendering=ui.popupMenu(controls(),anchor,{onOpened:id=>opened.push(id),onControlAction:async detail=>{if(detail.sequence===1)await gate.promise;performed.push(detail.sequence)}})
  await settle();const current=rendererCalls.at(-1)
  for(const fn of menuOpenedListeners){fn({requestId:'foreign'});fn({requestId:current.input.requestId})}
  assert.deepEqual(opened,[current.input.requestId])
  sendControl(current.input.requestId,1);sendControl(current.input.requestId,2)
  current.resolve({supported:true,reason:'dismissed'})
  await settle();assert.deepEqual(performed,[])
  gate.resolve();await rendering;assert.deepEqual(performed,[1,2])
  assert.equal(controlListeners.size,0);assert.equal(menuOpenedListeners.size,0)

  const secondGate=defer(),cancelled=[]
  const cancelling=ui.popupMenu(controls(),anchor,{onControlAction:async detail=>{if(detail.sequence===1)await secondGate.promise;cancelled.push(detail.sequence)}})
  await settle();const previous=rendererCalls.at(-1)
  sendControl(previous.input.requestId,1);sendControl(previous.input.requestId,2)
  await settle();await ui.closeMenu();secondGate.resolve();await cancelling
  assert.deepEqual(cancelled,[1],'A started operation owns its own cancellation; the queued old-context action is rejected')
  assert.equal(controlListeners.size,0)

  const beforePreparing=rendererCalls.length,preparing=ui.popupMenu(controls(),anchor)
  await ui.closeMenu();const dismissed=await preparing
  assert.equal(rendererCalls.length,beforePreparing)
  assert.deepEqual(dismissed,{supported:true,reason:'closed'},'Cancellation must not masquerade as unsupported and reopen an HTML fallback')

  const body={id:'root',type:'column',children:[{id:'body',type:'text',text:'content'}]}
  const rasterTree={id:'raster-search',type:'row',children:[{id:'raster-input',type:'input'},{id:'raster-leading',type:'icon',icon:'magnifying-glass',width:16,height:16},{id:'raster-close',type:'iconButton',icon:'xmark',accessibleName:'关闭'}]}
  const rasterUi=rendererModule.exports.useNativePanel({role:'search',onAction:()=>{}})
  rendererWindow.devicePixelRatio=1.75
  const rasterShow=rasterUi.showFocused(rasterTree,anchor,{iconButtonSize:20})
  await settle();const rasterCall=panelCalls.at(-1)
  assert.equal('iconButtonSize' in rasterCall.input,false,'The renderer-only size hint is never sent as a native option')
  assert.equal(typeof rasterCall.input.icons['magnifying-glass'],'string','The leading search icon retains its16 DIP representation')
  assert.equal(Buffer.from(rasterCall.input.icons['magnifying-glass'].split(',')[1],'base64').readUInt32BE(16),28)
  assert.equal(rasterCall.input.icons.xmark.logicalSize,20)
  assert.equal(Buffer.from(rasterCall.input.icons.xmark.dataUrl.split(',')[1],'base64').readUInt32BE(16),35)
  rasterCall.resolve({supported:true,id:rasterUi.id,session:'raster-search-1'});assert.equal(await rasterShow,true)
  rendererWindow.devicePixelRatio=2
  assert.equal(await rasterUi.update(rasterTree,anchor,true),true)
  assert.equal(panelUpdates.at(-1).patch.icons.xmark.logicalSize,20,'Theme/layout/scale updates retain the selected representation size')
  assert.equal(Buffer.from(panelUpdates.at(-1).patch.icons.xmark.dataUrl.split(',')[1],'base64').readUInt32BE(16),40)
  assert.equal(Buffer.from(panelUpdates.at(-1).patch.icons['magnifying-glass'].split(',')[1],'base64').readUInt32BE(16),32)
  await rasterUi.destroy()
  const legacyIcons=rendererModule.exports.useNativePanel({onAction:()=>{}}),legacyShow=legacyIcons.show(rasterTree,anchor)
  await settle();const legacyCall=panelCalls.at(-1)
  assert.equal(typeof legacyCall.input.icons.xmark,'string','Other native panels retain the legacy16 DIP default')
  legacyCall.resolve({supported:true,id:legacyIcons.id,session:'legacy-icons'});assert.equal(await legacyShow,true)
  await legacyIcons.destroy();rendererWindow.devicePixelRatio=1
  const unmounted=rendererModule.exports.useNativePanel({onAction:()=>{}}),unmountedShow=unmounted.show(body,anchor)
  await settle();const lateUnmount=panelCalls.at(-1)
  cleanupHooks.at(-1)();await settle()
  lateUnmount.resolve({supported:true,id:lateUnmount.input.id,session:'late-unmount'})
  assert.equal(await unmountedShow,false)
  assert.ok(panelOperations.some(op=>op.kind==='destroy'&&op.session==='late-unmount'))
  assert.equal(panelOperations.some(op=>op.kind==='hide'&&op.session==='late-unmount'),false)

  const destroyed=rendererModule.exports.useNativePanel({onAction:()=>{}}),destroyedShow=destroyed.show(body,anchor)
  await settle();const lateDestroy=panelCalls.at(-1)
  await destroyed.destroy();lateDestroy.resolve({supported:true,id:lateDestroy.input.id,session:'late-destroy'})
  assert.equal(await destroyedShow,false)
  assert.ok(panelOperations.some(op=>op.kind==='destroy'&&op.session==='late-destroy'))

  const hidden=rendererModule.exports.useNativePanel({onAction:()=>{}}),hiddenShow=hidden.show(body,anchor)
  await settle();const lateHide=panelCalls.at(-1)
  await hidden.hide();lateHide.resolve({supported:true,id:lateHide.input.id,session:'late-hide'})
  assert.equal(await hiddenShow,false)
  assert.ok(panelOperations.some(op=>op.kind==='hide'&&op.session==='late-hide'))
  assert.equal(panelOperations.some(op=>op.kind==='destroy'&&op.session==='late-hide'),false)

  const inputTree={id:'search-root',type:'column',children:[{id:'query',type:'input',value:'原草稿'},{id:'close',type:'button',text:'关闭'}]}
  const searchUi=rendererModule.exports.useNativePanel({role:'search',onAction:()=>{}})
  const firstSearch=searchUi.showFocused(inputTree,anchor,{shadow:false})
  await settle();const firstSearchCall=panelCalls.at(-1)
  assert.equal(firstSearchCall.input.role,'search');assert.equal(firstSearchCall.input.focusMode,'input')
  assert.equal(firstSearchCall.input.dismissOnOutsideClick,false);assert.equal(firstSearchCall.input.dismissOnEscape,true)
  assert.equal(firstSearchCall.input.shadow,false)
  firstSearchCall.resolve({supported:true,id:searchUi.id,session:'search-1'});assert.equal(await firstSearch,true)
  const nativeOpen=(id,role)=>window.dispatchEvent(new CustomEvent('navora:native-ui-open',{detail:{id,role}}))
  const beforeOrdinary=panelOperations.length
  window.dispatchEvent(new Event('navora:browser-chrome-open'));nativeOpen('ordinary','transient');nativeOpen('editor','editor');nativeOpen('hint','passive')
  assert.equal(searchUi.open.value,true);assert.equal(panelOperations.length,beforeOrdinary)
  const showCount=panelCalls.length
  assert.equal(await searchUi.update({...inputTree,width:360},anchor,true),true)
  assert.equal(panelCalls.length,showCount,'Cosmetic/layout updates must not open or refocus a native instance')
  assert.equal('value' in panelUpdates.at(-1).patch.content.children[0],false,'Refreshes preserve live input and composition')

  const reopened=searchUi.showFocused(inputTree,anchor)
  await settle();assert.ok(panelOperations.some(op=>op.kind==='destroy'&&op.session==='search-1'))
  const reopenedCall=panelCalls.at(-1)
  assert.notEqual(reopenedCall,firstSearchCall)
  reopenedCall.resolve({supported:true,id:searchUi.id,session:'search-2'});assert.equal(await reopened,true)
  nativeOpen('new-search','search');assert.equal(searchUi.open.value,false)
  assert.ok(panelOperations.some(op=>op.kind==='hide'&&op.session==='search-2'))

  const beforeCancelledFocus=panelCalls.length,cancelledFocus=searchUi.showFocused(inputTree,anchor)
  await searchUi.hide();assert.equal(await cancelledFocus,false)
  assert.equal(panelCalls.length,beforeCancelledFocus,'Closing while a fresh focus request is preparing cancels the request')
  await assert.rejects(searchUi.showFocused({id:'wrong-order',type:'column',children:[{id:'close-first',type:'button',text:'关闭'},{id:'query-last',type:'input'}]},anchor),/input_must_be_first/)

  const protectedUi=rendererModule.exports.useNativePanel({onAction:()=>{}}),protectedShow=protectedUi.show(body,anchor,{dismissOnOutsideClick:false,dismissOnEscape:false})
  await settle();const protectedCall=panelCalls.at(-1)
  protectedCall.resolve({supported:true,id:protectedUi.id,session:'renderer-modal'});await protectedShow
  window.dispatchEvent(new Event('navora:browser-chrome-open'));nativeOpen('new-search','search')
  assert.equal(protectedUi.open.value,true,'A search announcement cannot dismiss a protected modal')
  await protectedUi.destroy();await searchUi.destroy()

  // V2 explicitly focuses the requested native editor and reuses the native
  // instance. Legacy cancellation/recreation behavior above stays covered too.
  searchUi.panelApiVersion.value=2
  const v2Ui=rendererModule.exports.useNativePanel({role:'search',onAction:()=>{}})
  const v2Showing=v2Ui.showFocused(inputTree,anchor)
  await settle();const v2ShowCall=panelCalls.at(-1)
  v2ShowCall.resolve({supported:true,id:v2Ui.id,session:'renderer-v2-1',revision:1})
  assert.equal(await v2Showing,true)
  const rendererInitialRevision=v2Ui.revision.value
  assert.ok(rendererInitialRevision>=1,'The renderer retains the native show revision and any initial presentation refresh')
  assert.deepEqual(rendererCommands.at(-1),{id:v2Ui.id,session:'renderer-v2-1',command:{type:'focus',id:'query'}})
  assert.deepEqual(await v2Ui.getBounds('query'),{x:10,y:20,width:300,height:150})
  assert.equal(await v2Ui.setActiveItem(null),true)
  assert.deepEqual(rendererCommands.at(-1).command,{type:'active',id:''})
  assert.equal(await v2Ui.announce('输入仍保留'),true)
  assert.equal(await v2Ui.applyPatch([{op:'set',id:'close',properties:{text:'完成'}}],{expectedRevision:rendererInitialRevision,revision:4}),true)
  assert.equal(v2Ui.revision.value,4)
  assert.deepEqual(rendererPatches.at(-1).guards,{expectedRevision:rendererInitialRevision,revision:4})
  const beforeV2Reopen=panelOperations.length,v2Reopened=v2Ui.showFocused(inputTree,anchor)
  await settle();const v2ReopenCall=panelCalls.at(-1)
  assert.equal(panelOperations.length,beforeV2Reopen,'V2 focus uses public focus() while retaining its native instance')
  v2ReopenCall.resolve({supported:true,id:v2Ui.id,session:'renderer-v2-2',revision:5})
  assert.equal(await v2Reopened,true)
  const beforeV2Cancel=panelCalls.length,v2Cancelled=v2Ui.showFocused(inputTree,anchor)
  await v2Ui.hide();assert.equal(await v2Cancelled,false)
  assert.equal(panelCalls.length,beforeV2Cancel,'V2 focus preparation honors immediate cancellation')
  const commandsBeforeClosed=rendererCommands.length
  assert.equal(await v2Ui.focus('query'),false)
  assert.equal(rendererCommands.length,commandsBeforeClosed,'Closed renderer sessions cannot send native focus commands')
  await v2Ui.destroy()
}finally{
  for(const dispose of cleanupHooks)dispose()
  for(const [key,descriptor] of savedGlobals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]
}
console.log(JSON.stringify({ok:true,checks,nativeProcessesStarted:0,profilesOpened:0}))
