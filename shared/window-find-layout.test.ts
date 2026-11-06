import assert from 'node:assert/strict'
import {test} from 'node:test'
import {currentFindGeometry,WINDOW_FIND_FRAME_EXTRA} from './window-find-layout'

test('current find measures its right gap against caption buttons, including native frame',()=>{
  const frame=currentFindGeometry({windowWidth:1440,controlsLeft:1302,top:22})
  assert.equal(frame.anchor.x+frame.width+WINDOW_FIND_FRAME_EXTRA,1302-25)
  assert.equal(frame.width,360)
  assert.equal(frame.anchor.y,22)
})
test('a narrow caption area shrinks the card rather than covering caption controls',()=>{
  const frame=currentFindGeometry({windowWidth:500,controlsLeft:362,top:22})
  assert.equal(frame.anchor.x,8)
  assert.ok(frame.width<360)
  assert.equal(frame.anchor.x+frame.width+WINDOW_FIND_FRAME_EXTRA,337)
})
test('fullscreen and left-side caption controls retain a right safety gap',()=>{
  const frame=currentFindGeometry({windowWidth:900,controlsLeft:900,top:8})
  assert.equal(frame.anchor.x+frame.width+WINDOW_FIND_FRAME_EXTRA,875)
  assert.equal(frame.anchor.y,8)
})
