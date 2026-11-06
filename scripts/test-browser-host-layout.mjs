// Exercise the real host and automation controller with inert native views.
// No Electron window, personal profile, network, or build output is opened.
import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createRequire} from 'node:module'
import {setTimeout as delay} from 'node:timers/promises'
import {build} from 'esbuild'

const require=createRequire(import.meta.url)
let nextId=1
class Contents extends EventEmitter {
  constructor(){super();this.destroyed=false;this.zoom=1;this.guards=[];this.resetAutomationState()}
  isDestroyed(){return this.destroyed}
  send(){}
  setBackgroundThrottling(){}
  getZoomFactor(){return this.zoom}
  getTitle(){return 'Fixture page'}
  getURL(){return 'https://example.test/'}
  setVirtualCursorFrameRate(){}
  setVirtualCursorImage(){}
  resetAutomationState(){this.automation={isolateInput:false,blockRealPointer:false,blockRealKeyboard:false,keepRendering:false,inputActive:false,virtualCursor:{enabled:false,frameRate:60,hotspot:{x:0,y:0},customImage:false},rendering:{viewAvailable:true,keepAlive:false,requestedBackgroundThrottling:false,effectiveBackgroundThrottling:false}}}
  async setAutomationOptions(options){this.guards.push(options);this.automation={...this.automation,...options,virtualCursor:{...this.automation.virtualCursor,...options.virtualCursor},rendering:{...this.automation.rendering,keepAlive:options.keepRendering??this.automation.keepRendering}}}
  getAutomationState(){return this.automation}
  async resetAutomationOptions(){this.resetAutomationState()}
  close(){if(!this.destroyed){this.destroyed=true;this.emit('destroyed')}}
}
class View {
  constructor(){this.bounds={x:0,y:0,width:0,height:0};this.visible=true;this.children=[];this.visibility=[];this.layouts=[];this.added=0}
  addChildView(view){if(view.parent)view.parent.removeChildView(view);this.children.push(view);view.parent=this;this.added++}
  removeChildView(view){this.children=this.children.filter(child=>child!==view);view.parent=undefined}
  setBounds(bounds){if(this.failNextBounds){this.failNextBounds=false;throw Error('injected_native_layout_failure')}this.bounds={...bounds};this.layouts.push({...bounds})}
  getBounds(){return {...this.bounds}}
  setVisible(visible){this.visible=visible;this.visibility.push(visible)}
  getVisible(){return this.visible}
}
class WebContentsView extends View {constructor(){super();this.webContents=new Contents()}}
class BrowserWindow extends EventEmitter {
  constructor(options={}){super();this.id=nextId++;this.size=[options.width||1200,options.height||800];this.normal=[...this.size];this.webContents=new Contents();this.contentView=new View();this.visible=true;this.destroyed=false;this.fullscreen=false;this.maximized=false}
  getContentSize(){return [...this.size]}
  getBounds(){return {x:0,y:0,width:this.size[0],height:this.size[1]}}
  getNormalBounds(){return {x:0,y:0,width:this.normal[0],height:this.normal[1]}}
  setBounds(bounds){this.size=[bounds.width,bounds.height]}
  isFullScreen(){return this.fullscreen}
  setFullScreen(value){this.fullscreen=value;this.size=value?[1920,1080]:[...this.normal];this.emit(value?'enter-full-screen':'leave-full-screen')}
  isMaximized(){return this.maximized}
  maximize(){this.maximized=true}
  unmaximize(){this.maximized=false}
  isMinimized(){return false}
  isFocused(){return true}
  setContentSize(width,height){this.size=[width,height];this.emit('resize')}
  isDestroyed(){return this.destroyed}
  isVisible(){return this.visible}
  setMenu(){}
  setTitle(){}
  show(){this.visible=true;this.emit('show')}
  destroy(){if(!this.destroyed){this.destroyed=true;this.emit('closed')}}
}
const electron={BrowserWindow,View,WebContentsView}
const hooks=`export const detachedWindowChrome=()=>({});export const resolveWindowIcon=()=>undefined;export const wireDetachedWindowChrome=()=>{};export const registerWindowMaterial=()=>{};export const placeDetachedWindow=()=>{};`
const output=await build({stdin:{contents:"export {BrowserHostManager} from './electron/modules/browser-host.ts';export {windowFullscreen} from './electron/modules/window-fullscreen.ts'",resolveDir:process.cwd()},write:false,bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'silent',plugins:[{name:'inert-window-factories',setup(builder){builder.onResolve({filter:/^\.\/(window-chrome|window-material|window-placement)$/},()=>({path:'window-factories',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:hooks,loader:'js'}))}}]})
const module={exports:{}}
new Function('require','module','exports',output.outputFiles[0].text)(id=>id==='electron'?electron:require(id),module,module.exports)
const {BrowserHostManager,windowFullscreen}=module.exports
const bounds={x:320,y:100,width:700,height:500}
function fixture(t){
  const manager=new BrowserHostManager(),window=new BrowserWindow(),hostId=manager.bindMain(window),notifications=[]
  manager.onLayoutInvalidated=(_host,value)=>notifications.push(value)
  function add(id){const page=manager.create(id,'chat',{}, {width:700,height:500},false);page.automation.bind({getCursorImage:async()=>({image:{},hotspot:{x:0,y:0}})});return page}
  function show(page){manager.activate(page);const owner=manager.claimLayout(hostId,page.id);manager.setLayout(hostId,page.id,bounds,owner,1);return owner}
  const page=add('page'),owner=show(page)
  page.view.visibility=[];page.view.layouts=[]
  t.after(()=>{for(const host of manager.listHosts())host.window.destroy()})
  return {manager,window,hostId,page,owner,notifications,add,show}
}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
async function heldInput(page){
  const entered=deferred(),release=deferred()
  const running=page.automation.run({runId:'layout-run'},async operation=>{entered.resolve();await operation.commit(()=>release.promise);operation.assertCurrent()})
  await entered.promise
  return {release,running}
}

test('pure movement and unchanged resize notifications keep the live view and coordinates',async t=>{
  const f=fixture(t),epoch=f.page.automation.captureEpoch()
  f.window.emit('move');f.window.emit('moved');f.window.emit('resize')
  await delay(40)
  assert.deepEqual(f.page.view.visibility,[])
  assert.deepEqual(f.notifications,[])
  assert.equal(f.manager.isVisible(f.page),true)
  assert.equal(f.page.automation.captureEpoch(),epoch)
})

test('outer resize keeps the page visible before and after the renderer replies',async t=>{
  const f=fixture(t),identity=f.page.webContents,host=f.manager.getHost(f.hostId),mounts=host.surface.added
  f.window.setContentSize(1100,750)
  assert.equal(f.page.view.getVisible(),true)
  await delay(40)
  assert.equal(f.notifications.length,1)
  assert.equal(f.page.view.getVisible(),true)
  assert.equal(f.manager.isVisible(f.page),true)
  const result=f.manager.setLayout(f.hostId,f.page.id,{...bounds,width:600},f.owner,2)
  assert.equal(result.status,'applied');assert.equal(result.visible,true)
  assert.equal(f.page.view.getBounds().width,600)
  assert.deepEqual(f.page.view.visibility,[])
  assert.equal(f.page.webContents,identity)
  assert.equal(host.surface.added,mounts)
})

test('rapid native resizes are coalesced into one request for current geometry',async t=>{
  const f=fixture(t)
  for(let n=0;n<12;n++)f.window.setContentSize(1200+n*10,800+n*5)
  await delay(40)
  assert.equal(f.notifications.length,1)
  assert.deepEqual(f.manager.getHost(f.hostId).contentSize,[1310,855])
  assert.equal(f.notifications[0].reason,'resize')
  f.manager.setLayout(f.hostId,f.page.id,{...bounds,width:810,height:555},f.owner,2)
  assert.deepEqual(f.page.view.visibility,[])
})

test('internal resizing and scrolling update bounds without hiding or remounting',t=>{
  const f=fixture(t),host=f.manager.getHost(f.hostId),mounts=host.surface.added
  const result=f.manager.setLayout(f.hostId,f.page.id,{...bounds,x:280,width:650,scrollLeft:24,scrollTop:16},f.owner,2)
  assert.equal(result.visible,true)
  assert.deepEqual(f.page.view.getBounds(),{x:-24,y:-16,width:650,height:500,scrollLeft:24,scrollTop:16})
  assert.deepEqual(f.page.view.visibility,[])
  assert.equal(host.surface.added,mounts)
})

test('in-flight input keeps its live view and guards, then commits only the latest rectangle',async t=>{
  const f=fixture(t),held=await heldInput(f.page),before=f.page.automation.snapshot()
  f.window.setContentSize(1100,750)
  await delay(40)
  for(const [generation,width] of [[2,650],[3,610]]){
    const result=f.manager.setLayout(f.hostId,f.page.id,{...bounds,width},f.owner,generation)
    assert.equal(result.status,'deferred');assert.equal(result.reason,'busy');assert.equal(result.visible,true)
  }
  assert.equal(f.page.view.getBounds().width,700)
  assert.equal(f.page.automation.captureEpoch(),before.epoch)
  assert.equal(f.page.automation.snapshot().inputProtected,true)
  assert.deepEqual(f.page.view.visibility,[])
  held.release.resolve();await held.running;await delay(0)
  assert.equal(f.page.view.getBounds().width,610)
  assert.equal(f.page.automation.snapshot().owner,'ai')
  assert.equal(f.page.automation.snapshot().leaseRunId,'layout-run')
  assert.equal(f.page.automation.snapshot().inputProtected,true)
  assert.ok(f.page.automation.captureEpoch()>before.epoch)
  assert.ok(f.page.webContents.guards.every(call=>call.isolateInput&&call.keepRendering&&call.blockRealPointer&&call.blockRealKeyboard))
  assert.deepEqual(f.page.view.visibility,[])
})

test('explicit workspace hiding cancels scheduled resize and focus cannot resurrect it',async t=>{
  const f=fixture(t)
  f.window.setContentSize(1000,700)
  f.manager.setLayout(f.hostId,f.page.id,null,f.owner,2)
  f.window.emit('focus');f.window.emit('restore');await delay(40)
  assert.equal(f.notifications.length,0)
  assert.equal(f.page.view.getVisible(),false)
  assert.equal(f.manager.isVisible(f.page),false)
})

test('a deferred layout cannot resurrect a workspace hidden during an operation',async t=>{
  const f=fixture(t),held=await heldInput(f.page)
  f.manager.setLayout(f.hostId,f.page.id,{...bounds,width:600},f.owner,2)
  f.manager.setLayout(f.hostId,f.page.id,null,f.owner,3)
  held.release.resolve();await held.running;await delay(0)
  assert.equal(f.page.view.getVisible(),false)
  assert.equal(f.manager.isVisible(f.page),false)
})

test('switching tabs cancels the old resize and rejects late layout and hide requests',async t=>{
  const f=fixture(t),second=f.add('second')
  f.window.setContentSize(1100,750)
  const owner=f.show(second)
  await delay(40)
  assert.equal(f.notifications.length,0)
  assert.equal(f.page.view.getVisible(),false)
  assert.equal(second.view.getVisible(),true)
  assert.equal(f.manager.setLayout(f.hostId,f.page.id,bounds,f.owner,2).status,'stale')
  assert.equal(f.manager.setLayout(f.hostId,f.page.id,null,f.owner,3).status,'stale')
  assert.equal(second.view.getVisible(),true)
  assert.equal(second.layoutOwner,owner)
})

test('reclaiming a panel owner hides its previous geometry and rejects stale owner replies',t=>{
  const f=fixture(t),owner=f.manager.claimLayout(f.hostId,f.page.id)
  assert.equal(f.page.view.getVisible(),false)
  assert.equal(f.manager.setLayout(f.hostId,f.page.id,bounds,f.owner,2).reason,'owner')
  assert.equal(f.page.view.getVisible(),false)
  assert.equal(f.manager.setLayout(f.hostId,f.page.id,bounds,owner,1).visible,true)
})

test('detached host resizing preserves the same page and main-host replies cannot move it back',async t=>{
  const f=fixture(t),identity=f.page.webContents,target=f.manager.detach(f.page),host=f.manager.getHost(target)
  const owner=f.manager.claimLayout(target,f.page.id)
  f.manager.setLayout(target,f.page.id,{x:0,y:80,width:1000,height:640},owner,1)
  f.page.view.visibility=[]
  host.window.setContentSize(1050,760);await delay(40)
  assert.equal(f.page.view.getVisible(),true)
  assert.equal(f.manager.setLayout(f.hostId,f.page.id,bounds,f.owner,2).reason,'unavailable')
  f.manager.setLayout(target,f.page.id,{x:0,y:80,width:1050,height:680},owner,2)
  assert.equal(f.page.webContents,identity)
  assert.deepEqual(f.page.view.visibility,[])
  assert.equal(f.page.hostId,target)
})

test('native layout failure hides uncertain geometry and a valid retry restores it',t=>{
  const f=fixture(t)
  f.page.view.failNextBounds=true
  const result=f.manager.setLayout(f.hostId,f.page.id,{...bounds,width:600},f.owner,2)
  assert.equal(result.reason,'apply-failed')
  assert.equal(result.visible,false)
  assert.equal(f.page.view.getVisible(),false)
  assert.equal(f.manager.setLayout(f.hostId,f.page.id,{...bounds,width:600},f.owner,3).visible,true)
})

test('fixed viewports retain their zoomed page dimensions while the container resizes',t=>{
  const f=fixture(t)
  f.page.webContents.zoom=1.25;f.page.fixedViewport={width:390,height:844}
  f.manager.setLayout(f.hostId,f.page.id,{...bounds,width:600,scrollTop:20},f.owner,2)
  assert.equal(f.page.view.getBounds().width,488)
  assert.equal(f.page.view.getBounds().height,1055)
  assert.equal(f.page.view.getBounds().y,-20)
  assert.deepEqual(f.page.view.visibility,[])
})

test('closing a host cancels its scheduled resize notification',async t=>{
  const f=fixture(t)
  f.window.setContentSize(1100,750);f.window.destroy();await delay(40)
  assert.equal(f.notifications.length,0)
  assert.equal(f.manager.getHost(f.hostId),undefined)
})

test('HTML fullscreen fills the owner content without replacing the page or fixed viewport preferences',t=>{
  const f=fixture(t),host=f.manager.getHost(f.hostId),identity=f.page.webContents,controller=windowFullscreen(f.window)
  f.page.fixedViewport={width:390,height:844};f.page.webContents.zoom=1.25
  controller.enterHtml({pageId:f.page.id,exit:async()=>{},changed:()=>f.manager.flushLayout(f.page)})
  assert.deepEqual(host.surface.getBounds(),{x:0,y:0,width:1920,height:1080})
  assert.deepEqual(f.page.view.getBounds(),{x:0,y:0,width:1920,height:1080})
  assert.deepEqual(f.page.fixedViewport,{width:390,height:844});assert.equal(f.page.webContents.zoom,1.25)
  f.manager.setLayout(f.hostId,f.page.id,{...bounds,width:640,scrollTop:30},f.owner,2)
  assert.equal(f.page.view.getBounds().width,1920,'ordinary renderer measurements cannot shrink the fullscreen document')
  controller.leaveHtml(f.page.id)
  assert.equal(f.window.isFullScreen(),false)
  assert.equal(f.page.view.getBounds().width,488);assert.equal(f.page.view.getBounds().height,1055);assert.equal(f.page.view.getBounds().y,-30)
  assert.equal(host.surface.getBounds().width,640)
  assert.equal(f.page.webContents,identity);assert.deepEqual(f.page.view.visibility,[])
})

test('a tab change revokes only the old document fullscreen and restores the original window',async t=>{
  const f=fixture(t),controller=windowFullscreen(f.window);let exits=0
  controller.enterHtml({pageId:f.page.id,exit:async()=>{exits++},changed:()=>f.manager.flushLayout(f.page)})
  const second=f.add('second');f.show(second);await Promise.resolve()
  assert.equal(exits,1);assert.equal(f.window.isFullScreen(),false);assert.equal(second.view.getVisible(),true)
  assert.equal(controller.htmlPage(),undefined);assert.equal(f.page.view.getVisible(),false)
})

test('late sender lookup never reads a destroyed host webContents getter',t=>{
  const f=fixture(t),contents=f.window.webContents
  Object.defineProperty(f.window,'webContents',{get(){if(f.window.destroyed)throw Error('Object has been destroyed');return contents}})
  f.window.destroyed=true
  assert.equal(f.manager.hostForSender(contents),undefined)
  f.window.destroyed=false
})
