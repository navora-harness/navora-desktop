import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeAgentTargetSchema,nativeTargetIssues} from './browser-native-target'
import {AGENT_TOOLS} from './agent-tools'
const target={webContentsId:1,processId:2,routingId:3,documentId:4,backendNodeId:5}
test('all native input schemas and host validation require complete bounded integer targets without extras',()=>{
  assert.deepEqual(nativeTargetIssues(target),[])
  for(const key of Object.keys(target))for(const value of [undefined,-1,1.1,2147483648,'4'])assert.ok(nativeTargetIssues({...target,[key]:value}).some(issue=>issue.startsWith(key)))
  assert.ok(nativeTargetIssues({...target,selector:'input'}).some(issue=>issue.includes('unexpected')))
  for(const name of ['browser_click','browser_type','browser_press','browser_mouse','browser_touch','browser_hover']){
    const schema=AGENT_TOOLS.find(tool=>tool.function.name===name)!.function.parameters as {properties:{target:unknown}}
    assert.deepEqual(schema.properties.target,nativeAgentTargetSchema,name)
  }
})
