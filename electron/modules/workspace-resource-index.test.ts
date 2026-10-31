import test from 'node:test'
import assert from 'node:assert/strict'
import {WorkspaceResourceIndex} from './workspace-resource-index'
test('file owner index hides empty workspaces, caps concurrency and invalidates changed owners',async()=>{
  let running=0,peak=0,calls=0
  const files=new Set(['a','e'])
  const index=new WorkspaceResourceIndex(async id=>{running++;peak=Math.max(peak,running);calls++;await new Promise(resolve=>setImmediate(resolve));running--;if(id==='error')throw Error('access');return files.has(id)})
  assert.deepEqual(await index.owners(['a','b','c','d','e','error']),{chatIds:['a','e'],unavailable:1})
  assert.ok(peak<=4);assert.equal(calls,6)
  files.add('b');index.invalidate('b')
  assert.deepEqual(await index.owners(['a','b','c']),{chatIds:['a','b'],unavailable:0});assert.equal(calls,7)
  files.delete('a');assert.deepEqual((await index.owners(['a','b'],true)).chatIds,['b'])
})


test('resource snapshots coalesce reads, cap concurrency, invalidate owners and retry failures',async()=>{
  let calls=0,running=0,peak=0,fail=false
  const index=new WorkspaceResourceIndex(async()=>true,async id=>{
    calls++;running++;peak=Math.max(peak,running)
    await new Promise(resolve=>setImmediate(resolve));running--
    if(fail)throw Error('access')
    return {ok:true,entries:[],truncated:false,unavailable:0}
  })
  await Promise.all([index.resources('a'),index.resources('a')]);assert.equal(calls,1)
  await Promise.all(Array.from({length:12},(_,i)=>index.resources(String(i))));assert.ok(peak<=4)
  const before=calls;index.invalidate('a');await index.resources('a');assert.equal(calls,before+1)
  fail=true;await assert.rejects(index.resources('error'),/access/)
  fail=false;await index.resources('error');assert.equal(calls,before+3)
  await index.resources('a',true);assert.equal(calls,before+4)
})
