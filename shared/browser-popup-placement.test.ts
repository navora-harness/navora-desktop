import test from 'node:test'
import assert from 'node:assert/strict'
import {browserPopupPosition} from './browser-popup-placement'

const viewport={width:1200,height:800},view={left:620,top:100,right:1200,bottom:800}
test('a popup already in chat space keeps its preferred position',()=>{
  assert.deepEqual(browserPopupPosition({width:260,height:300},{x:280,y:110},viewport,[view]),{x:280,y:110})
})
test('an overlapping browser menu moves completely into chat space',()=>{
  const position=browserPopupPosition({width:260,height:300},{x:900,y:110},viewport,[view])!
  assert.ok(position.x+260<=view.left);assert.equal(position.y,110)
})
test('a short menu may fit above the live browser without touching it',()=>{
  const position=browserPopupPosition({width:240,height:60},{x:800,y:30},viewport,[view])!
  assert.equal(position.x,800);assert.ok(position.y+60<=view.top)
})
test('no usable renderer region refuses a popup instead of hiding its View',()=>{
  assert.equal(browserPopupPosition({width:360,height:300},{x:800,y:110},viewport,[{...view,left:240}]),null)
})
test('multiple live Views are all excluded and window bounds are respected',()=>{
  const views=[{left:0,top:150,right:380,bottom:800},{left:640,top:150,right:1200,bottom:800}]
  const position=browserPopupPosition({width:220,height:300},{x:900,y:400},viewport,views)!
  assert.ok(position.x>=380&&position.x+220<=640);assert.ok(position.y>=8&&position.y+300<=792)
})
test('without a View the geometry helper only clamps within the window',()=>{
  assert.deepEqual(browserPopupPosition({width:200,height:100},{x:1190,y:790},viewport,[]),{x:992,y:692})
})
