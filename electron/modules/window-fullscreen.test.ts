import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import type {BrowserWindow,Input,WebContents} from 'electron'
import {registerWindowFullscreen,fullscreenForSender,fullscreenShortcut,foregroundFullscreenPage,htmlFullscreenPage} from './window-fullscreen'
import {captureWindowState} from './window-state'

function fixture(maximized=false){
  const events=new EventEmitter(),contents=new EventEmitter(),messages:unknown[][]=[],calls:unknown[][]=[]
  const normal={x:120,y:90,width:1100,height:740}
  let fullscreen=false,destroyed=false,focused=true,visible=true,minimized=false,bounds={...normal},max=maximized
  const wc=Object.assign(contents,{mainFrame:{},isDestroyed:()=>destroyed,send:(...args:unknown[])=>messages.push(args)}) as unknown as WebContents
  const win=Object.assign(events,{webContents:wc,isDestroyed:()=>destroyed,isFullScreen:()=>fullscreen,isMaximized:()=>max,isFocused:()=>focused,isVisible:()=>visible,isMinimized:()=>minimized,
    getNormalBounds:()=>({...normal}),getBounds:()=>({...bounds}),
    setBounds:(value:typeof normal)=>{calls.push(['bounds',value]);bounds={...value}},
    maximize:()=>{max=true;calls.push(['maximize'])},unmaximize:()=>{max=false;calls.push(['unmaximize'])},
    setFullScreen:(value:boolean)=>{calls.push(['fullscreen',value]);fullscreen=value;if(value){bounds={x:0,y:0,width:1920,height:1080};max=false}else bounds={...normal};events.emit(value?'enter-full-screen':'leave-full-screen')},
  }) as unknown as BrowserWindow
  const controller=registerWindowFullscreen(win)
  return {win,wc,controller,calls,messages,normal,set focused(value:boolean){focused=value},set visible(value:boolean){visible=value},set minimized(value:boolean){minimized=value},close(){destroyed=true;events.emit('closed')}}
}

test('normal and maximized windows restore independently without persisting fullscreen geometry',async()=>{
  for(const maximized of [false,true]){
    const first=fixture(maximized),second=fixture()
    const pageIdentity=first.wc
    assert.deepEqual(await first.controller.toggle(),{ok:true,fullscreen:true})
    assert.deepEqual(captureWindowState(first.win),{...first.normal,maximized})
    assert.equal(second.win.isFullScreen(),false)
    assert.deepEqual(await first.controller.toggle(),{ok:true,fullscreen:false})
    assert.equal(first.win.isMaximized(),maximized)
    assert.deepEqual(first.win.getBounds(),first.normal)
    assert.equal(first.calls.filter(call=>call[0]==='bounds').length,0,'native-restored bounds must not be reapplied on fractional-DPI displays')
    assert.equal(first.win.webContents,pageIdentity)
    assert.deepEqual(captureWindowState(first.win),{...first.normal,maximized})
    first.close();second.close()
  }
})

test('fullscreen IPC resolves registered host main frames only, never guest or arbitrary windows',()=>{
  const f=fixture(),guest=new EventEmitter() as unknown as WebContents
  assert.equal(fullscreenForSender(f.wc,f.wc.mainFrame),f.controller)
  assert.throws(()=>fullscreenForSender(f.wc,{} as typeof f.wc.mainFrame),/local_host_only/)
  assert.throws(()=>fullscreenForSender(guest,null),/local_host_only/)
  f.close();assert.throws(()=>fullscreenForSender(f.wc,f.wc.mainFrame),/local_host_only/)
})

test('host F11 is handled once; composition, repeats and modified chords are preserved',async()=>{
  const f=fixture(),input={key:'F11',type:'keyDown',control:false,meta:false,alt:false,shift:false,isAutoRepeat:false,isComposing:false} as Input
  let prevented=0
  f.wc.emit('before-input-event',{preventDefault:()=>prevented++},input)
  await Promise.resolve();assert.equal(f.win.isFullScreen(),true);assert.equal(prevented,1)
  for(const patch of [{type:'keyUp'},{shift:true},{control:true},{meta:true},{alt:true},{isAutoRepeat:true},{isComposing:true}])assert.equal(fullscreenShortcut({...input,...patch} as Input),false)
  assert.equal(f.messages.at(-1)?.[1],true)
  f.close()
})

test('HTML fullscreen leaves a pre-existing F11 session intact and restores an ordinary window',async()=>{
  for(const enteredByF11 of [false,true]){
    const f=fixture(true);if(enteredByF11)await f.controller.toggle()
    f.controller.enterHtml({pageId:'foreground',exit:async()=>{},changed:()=>{}})
    assert.equal(htmlFullscreenPage(f.win),'foreground');assert.equal(f.win.isFullScreen(),true)
    f.controller.leaveHtml('different-page');assert.equal(f.win.isFullScreen(),true)
    f.controller.leaveHtml('foreground');assert.equal(f.win.isFullScreen(),enteredByF11)
    if(enteredByF11)await f.controller.toggle()
    assert.equal(f.win.isMaximized(),true);assert.deepEqual(f.win.getBounds(),f.normal)
    f.close()
  }
})

test('F11 exits the active HTML document first; a rejected document exit keeps its state',async()=>{
  const f=fixture();let reject=true,exits=0
  f.controller.enterHtml({pageId:'video',exit:async()=>{exits++;if(reject)throw Error('exit failed');f.controller.leaveHtml('video')},changed:()=>{}})
  await assert.rejects(f.controller.toggle(),/exit failed/)
  assert.equal(htmlFullscreenPage(f.win),'video');assert.equal(f.win.isFullScreen(),true)
  reject=false;await f.controller.toggle()
  assert.equal(exits,2);assert.equal(htmlFullscreenPage(f.win),undefined);assert.equal(f.win.isFullScreen(),false)
  f.close()
})

test('navigation/transfer revocation touches only its document and never calls show or focus',async()=>{
  const first=fixture(),other=fixture();let exits=0
  first.controller.enterHtml({pageId:'video',exit:async()=>{exits++},changed:()=>{}})
  first.controller.revokeHtml('another-page');assert.equal(first.win.isFullScreen(),true)
  first.controller.revokeHtml('video');await Promise.resolve()
  assert.equal(exits,1);assert.equal(first.win.isFullScreen(),false);assert.equal(other.calls.length,0)
  assert.ok(first.calls.every(call=>!['show','focus'].includes(String(call[0]))))
  first.close();other.close()
})

test('HTML fullscreen eligibility requires the current visible focused host and page',()=>{
  const f=fixture(),page={id:'page',hostId:'host',isDestroyed:()=>false,view:{getVisible:()=>true}},host={id:'host',active:'page',ready:true,suspended:false,window:f.win}
  assert.equal(foregroundFullscreenPage(page,host),true)
  for(const patch of [{active:'background'},{ready:false},{suspended:true},{id:'foreign'}])assert.equal(foregroundFullscreenPage(page,{...host,...patch}),false)
  f.focused=false;assert.equal(foregroundFullscreenPage(page,host),false)
  f.focused=true;f.visible=false;assert.equal(foregroundFullscreenPage(page,host),false)
  f.visible=true;f.minimized=true;assert.equal(foregroundFullscreenPage(page,host),false)
  f.minimized=false;assert.equal(foregroundFullscreenPage({...page,view:{getVisible:()=>false}},host),false)
  f.close()
})
