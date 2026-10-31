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
