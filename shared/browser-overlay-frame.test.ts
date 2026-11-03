import {test} from 'node:test'
import assert from 'node:assert/strict'
import {prepareBrowserOverlayFrame} from './browser-overlay-frame'
test('native surface stays available through capture, decode and paint',async()=>{
  const calls:string[]=[]
  const ok=await prepareBrowserOverlayFrame({capture:async()=>{calls.push('capture');return 'frame'},decode:async()=>{calls.push('decode')},paint:async()=>{calls.push('paint')},current:()=>true})
  calls.push('hide-native');assert.equal(ok,true);assert.deepEqual(calls,['capture','decode','paint','hide-native'])
})
test('stalled preview returns control and ignores a late frame',async()=>{
  let finish!:(frame:string)=>void,painted=false
  const result=await prepareBrowserOverlayFrame({capture:()=>new Promise(resolve=>{finish=resolve}),decode:async()=>{},paint:async()=>{painted=true},current:()=>true,timeoutMs:5})
  assert.equal(result,false);finish('late');await new Promise(resolve=>setTimeout(resolve,5));assert.equal(painted,false)
})
test('changed owner cannot paint the captured frame',async()=>{
  let current=true,painted=false
  const result=await prepareBrowserOverlayFrame({capture:async()=>'frame',decode:async()=>{current=false},paint:async()=>{painted=true},current:()=>current})
  assert.equal(result,false);assert.equal(painted,false)
})
