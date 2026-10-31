import test from 'node:test'
import assert from 'node:assert/strict'
import {resourceKind,searchWorkspaceResources,associateResourceEvidence,replyArtifactGroups,type WorkspaceResource} from './workspace-resources'

test('file search matches all path tokens, ranks exact names, and preserves owner identities',()=>{
  const rows=[
    {name:'report.md',path:'archive/report.md',mtimeMs:1,ownerChatId:'a',id:'a'},
    {name:'report.md.bak',path:'new/report.md.bak',mtimeMs:3,ownerChatId:'b',id:'b'},
    {name:'note.md',path:'archive/note.md',mtimeMs:2,ownerChatId:'a',id:'c'},
  ] as WorkspaceResource[]
  assert.deepEqual(searchWorkspaceResources(rows,'REPORT.MD').map(row=>row.id),['a','b'])
  assert.deepEqual(searchWorkspaceResources(rows,'archive md').map(row=>row.id),['c','a'])
  assert.deepEqual(searchWorkspaceResources(rows,'').map(row=>row.id),['b','c','a'])
  assert.deepEqual(searchWorkspaceResources(rows,'missing'),[])
  assert.deepEqual(rows.map(row=>row.id),['a','b','c'])
  assert.equal(resourceKind('photo.PNG'),'image')
  assert.equal(resourceKind('notes.md'),'document')
  assert.equal(resourceKind('config.json'),'code')
})


test('only successful known file operations receive turn and answer associations',()=>{
  const entries=[{id:'a',ownerChatId:'chat',path:'report.md',name:'report.md'},{id:'b',ownerChatId:'chat',path:'unknown.md',name:'unknown.md'}] as WorkspaceResource[]
  const messages=[
    {id:'u',role:'user',content:'Create report',createdAt:1},
    {id:'t',role:'tool',content:'{"ok":true,"path":"report.md"}',createdAt:2,meta:{toolName:'file_write',status:'done'}},
    {id:'a',role:'assistant',content:'Created',createdAt:3,meta:{phase:'final'}},
  ] as import('./types').ChatMessage[]
  const related=associateResourceEvidence(entries,messages)
  assert.deepEqual(related[0]!.evidence,{messageId:'t',turnId:'u',answerId:'a',operation:'file_write',createdAt:2})
  assert.equal(related[1]!.evidence,undefined)
  assert.deepEqual(replyArtifactGroups(entries,messages).get('a')?.map(entry=>entry.path),['report.md'])
  assert.equal(replyArtifactGroups(entries,messages.slice(0,2)).size,0,'In-flight files wait for the final answer')
  assert.equal(replyArtifactGroups(entries.slice(1),messages).size,0,'Removed or unknown files never become output cards')
  assert.equal(entries[0]!.evidence,undefined,'Cached metadata stays immutable')
  for(const meta of [{toolName:'file_write',status:'error'},{toolName:'file_write',status:'running'},{toolName:'file_write',status:'done',fromPlugin:true}]){
    assert.equal(associateResourceEvidence(entries,[{...messages[1]!,meta}])[0]!.evidence,undefined)
  }
  assert.equal(associateResourceEvidence(entries,[...messages,{id:'d',role:'tool',content:'{"ok":true,"path":"report.md"}',createdAt:4,meta:{toolName:'file_delete',status:'done'}}])[0]!.evidence,undefined)
})
