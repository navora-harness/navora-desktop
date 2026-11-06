import test from 'node:test'
import assert from 'node:assert/strict'
import {browserConfirmationActive,browserDockFits,browserDockReady,browserDockRight,browserViewports,registerBrowserConfirmation,reportBrowserLayout,reportBrowserViewport,reserveBrowserDock} from '../src/composables/useBrowserSurfaceLayout'
test('surface coordinates copy DOMRect prototype getters and do not retain a live mutable rectangle',()=>{
  class Rectangle{size=600;get left(){return 100}get top(){return 50}get right(){return this.left+this.width}get bottom(){return this.top+this.height}get width(){return this.size}get height(){return 500}}
  const rect=new Rectangle()
  reportBrowserViewport('rect-test',rect)
  assert.deepEqual(browserViewports.value[0],{left:100,top:50,right:700,bottom:550,width:600,height:500})
  rect.size=700;assert.equal(browserViewports.value[0]!.width,600)
  reportBrowserViewport('rect-test',null)
})
test('deferred and hidden native layouts cannot satisfy a dock from old committed geometry',()=>{
  reportBrowserViewport('deferred-test',{left:100,top:50,right:900,bottom:550,width:800,height:500})
  reserveBrowserDock('dialog',400)
  assert.equal(browserDockReady.value,false)
  reportBrowserLayout('deferred-test',{x:400,width:500});assert.equal(browserDockReady.value,true)
  reportBrowserLayout('deferred-test',null);assert.equal(browserDockReady.value,false)
  reportBrowserLayout('deferred-test',{x:100,width:800});assert.equal(browserDockReady.value,false)
  reportBrowserViewport('deferred-test',null);reserveBrowserDock('dialog',null)
})
test('narrow layout clamping cannot falsely authorize an overlapping dialog',()=>{
  reportBrowserViewport('narrow-test',{left:0,top:50,right:250,bottom:550,width:250,height:500})
  reserveBrowserDock('dialog',196)
  reportBrowserLayout('narrow-test',{x:130,width:120})
  assert.equal(browserDockFits.value,false);assert.equal(browserDockReady.value,false)
  reportBrowserViewport('narrow-test',null);reserveBrowserDock('dialog',null)
})
test('multiple panels and confirmations release only their own reservations',()=>{
  reserveBrowserDock('first',400);reserveBrowserDock('second',600)
  assert.equal(browserDockRight.value,600);reserveBrowserDock('second',null);assert.equal(browserDockRight.value,400)
  registerBrowserConfirmation('first',{kind:'delete-chat',contextKey:'a'});registerBrowserConfirmation('second',{kind:'quit',contextKey:'b'})
  registerBrowserConfirmation('first',null);assert.equal(browserConfirmationActive.value,true)
  registerBrowserConfirmation('second',null);assert.equal(browserConfirmationActive.value,false)
  reserveBrowserDock('first',null);assert.equal(browserDockRight.value,0)
})
