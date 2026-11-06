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
  const insertedRun=[messages[0]!,{...messages[1]!,meta:{...messages[1]!.meta,runId:'run-1',turnId:'u'}},
    {id:'correction',role:'user',content:'Please keep it short',createdAt:2,meta:{inserted:true,runId:'run-1',turnId:'u'}},
    {...messages[2]!,meta:{...messages[2]!.meta,runId:'run-1'}}] as import('./types').ChatMessage[]
  assert.equal(replyArtifactGroups(entries,insertedRun).get('a')?.[0]?.evidence?.turnId,'u','Inserted corrections do not detach already-produced files from their run')
  for(const meta of [{toolName:'file_write',status:'error'},{toolName:'file_write',status:'running'},{toolName:'file_write',status:'done',fromPlugin:true}]){
    assert.equal(associateResourceEvidence(entries,[{...messages[1]!,meta}])[0]!.evidence,undefined)
  }
  assert.equal(associateResourceEvidence(entries,[...messages,{id:'d',role:'tool',content:'{"ok":true,"path":"report.md"}',createdAt:4,meta:{toolName:'file_delete',status:'done'}}])[0]!.evidence,undefined)
})


test('late native download artifacts attach to their original completed reply across a later user turn',()=>{
  const entries=[{id:'download',ownerChatId:'chat',path:'downloads/setup.exe',name:'setup.exe'}] as WorkspaceResource[]
  const messages=[
    {id:'u1',role:'user',content:'Download',createdAt:1},
    {id:'a1',role:'assistant',content:'Still downloading',createdAt:2,meta:{phase:'final',runId:'run1'}},
    {id:'u2',role:'user',content:'Next task',createdAt:3},
    {id:'complete',role:'log',content:'Completed',createdAt:4,meta:{kind:'browser_download',runId:'run1',turnId:'u1',download:{state:'completed',path:'downloads/setup.exe'}}},
    {id:'a2',role:'assistant',content:'Next answer',createdAt:5,meta:{phase:'final',runId:'run2'}},
  ] as import('./types').ChatMessage[]
  assert.equal(replyArtifactGroups(entries,messages).get('a1')?.[0]?.evidence?.turnId,'u1')
  assert.equal(replyArtifactGroups(entries,messages).has('a2'),false)
  assert.equal(replyArtifactGroups(entries,messages.map(m=>m.id==='complete'?{...m,meta:{...m.meta,download:{state:'started',path:'downloads/setup.exe'}}}:m)).size,0)
})

test('explicit process and example uses stay out of final cards while legacy associations remain',()=>{
  const entries=['report.md','scratch.json','example.ts','legacy.txt'].map(path=>({id:path,ownerChatId:'chat',path,name:path})) as WorkspaceResource[]
  const messages=[{id:'u',role:'user',content:'Report',createdAt:1},...entries.map((entry,index)=>({id:`tool-${index}`,role:'tool',content:JSON.stringify({ok:true,path:entry.path,...(index===1?{purpose:'process'}:index===2?{purpose:'example'}:{})}),createdAt:2,meta:{toolName:'file_write',status:'done'}})),{id:'final',role:'assistant',content:'Report ready',createdAt:3,meta:{phase:'final',fileOutputs:[{path:'report.md',purpose:'delivery'}]}}] as import('./types').ChatMessage[]
  const original=JSON.stringify(messages)
  assert.deepEqual(replyArtifactGroups(entries,messages).get('final')?.map(entry=>entry.path),['report.md','legacy.txt'])
  assert.equal(associateResourceEvidence(entries,messages).find(entry=>entry.path==='scratch.json')?.evidence?.purpose,'process')
  assert.equal(JSON.stringify(messages),original,'Presentation classification does not mutate original history')
})

test('an explicit final purpose can promote real evidence but cannot invent nonexistent delivery files',()=>{
  const entries=[{id:'shot',ownerChatId:'chat',path:'shot.png',name:'shot.png'}] as WorkspaceResource[]
  const messages=[{id:'tool',role:'tool',content:'{"ok":true,"path":"shot.png","purpose":"evidence"}',createdAt:1,meta:{toolName:'browser_screenshot',status:'done',runId:'one'}},{id:'answer',role:'assistant',content:'Screenshot',createdAt:2,meta:{phase:'final',runId:'one',fileOutputs:[{path:'shot.png',purpose:'delivery'},{path:'missing.txt',purpose:'delivery'}]}}] as import('./types').ChatMessage[]
  assert.deepEqual(replyArtifactGroups(entries,messages).get('answer')?.map(entry=>entry.path),['shot.png'])
  assert.equal(replyArtifactGroups(entries,messages.slice(1)).size,0)
})

test('composed downloads retain the explicit tool-argument purpose through answer grouping',()=>{
  const entries=[{id:'download',ownerChatId:'chat',path:'bundle.txt',name:'bundle.txt'}] as WorkspaceResource[]
  const messages=[{id:'tool',role:'tool',content:'{"ok":true,"path":"bundle.txt"}',createdAt:1,meta:{toolName:'file_download_compose',status:'done',args:{purpose:'evidence'}}},{id:'answer',role:'assistant',content:'Checked',createdAt:2,meta:{phase:'final'}}] as import('./types').ChatMessage[]
  assert.equal(associateResourceEvidence(entries,messages)[0]?.evidence?.purpose,'evidence')
  assert.equal(replyArtifactGroups(entries,messages).size,0)
  assert.equal(replyArtifactGroups(entries,messages.map(message=>message.role==='tool'?{...message,meta:{...message.meta,args:{purpose:'delivery'}}}:message)).get('answer')?.length,1)
})
