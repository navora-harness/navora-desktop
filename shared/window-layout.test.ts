import assert from 'node:assert/strict'
import {test} from 'node:test'
import {detachedWindowBounds} from './window-layout'

test('tear-off keeps the full window within display edges and taskbar boundaries',()=>{
  const work={x:0,y:0,width:1920,height:1040},size={width:1000,height:760}
  assert.deepEqual(detachedWindowBounds(size,work,{x:1919,y:1039}),{x:918,y:278,width:1000,height:760})
  assert.deepEqual(detachedWindowBounds(size,work,{x:10,y:10}),{x:2,y:2,width:1000,height:760})
  assert.deepEqual(detachedWindowBounds(size,work,{x:700,y:100}),{x:600,y:80,width:1000,height:760})
})
test('tear-off fits smaller displays and monitors left or above the primary screen',()=>{
  const work={x:-1280,y:-900,width:1280,height:860}
  const bounds=detachedWindowBounds({width:1600,height:1000},work,{x:-1,y:-41})
  assert.deepEqual(bounds,{x:-1278,y:-898,width:1276,height:856})
})
