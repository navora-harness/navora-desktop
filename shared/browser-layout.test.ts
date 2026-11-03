import test from 'node:test'
import assert from 'node:assert/strict'
import {browserLayoutRect} from './browser-workspace'

test('browser renderer layout uses UI zoom in DIP, including viewport scroll offsets',()=>{
  const css={x:320,y:96,width:640,height:480,scrollLeft:24,scrollTop:16}
  for(const zoom of [1,1.25,1.5,1.75,2])assert.deepEqual(browserLayoutRect(css,zoom),{x:320*zoom,y:96*zoom,width:640*zoom,height:480*zoom,scrollLeft:24*zoom,scrollTop:16*zoom})
})

test('zero, negative and nonfinite layout rectangles never become a valid one-pixel native viewport',()=>{
  for(const invalid of [{x:0,y:0,width:0,height:100},{x:0,y:0,width:100,height:-1},{x:NaN,y:0,width:100,height:100},{x:0,y:0,width:Infinity,height:100}])assert.throws(()=>browserLayoutRect(invalid),/invalid_browser_bounds/)
  for(const zoom of [0,-1,NaN,Infinity])assert.throws(()=>browserLayoutRect({x:0,y:0,width:100,height:100},zoom),/invalid_browser_bounds/)
})
