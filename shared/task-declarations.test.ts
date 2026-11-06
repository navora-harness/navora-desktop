import test from 'node:test'
import assert from 'node:assert/strict'
import {deriveTaskConstraints,normalizeTaskDeclarations,hasTaskDeclarations,taskDeclarationsLabel} from './task-declarations'
import {compileComposerDocument,previewComposerDocument,composerDocumentEmpty,composerDocumentHasState,composerDocumentsHaveSameContent,composerSemanticIdentity,composerSubmissionKey,createComposerDocument,mergeComposerDocuments,normalizeComposerDocument} from './composer-document'
import {formatChatAsMarkdown} from './export-chat'

test('declarations canonicalize independently of selection order and combined automation remains plan',()=>{
  assert.deepEqual(normalizeTaskDeclarations({version:1,ids:['plan','automation','plan']}),{version:1,ids:['automation','plan']})
  assert.equal(deriveTaskConstraints({version:1,ids:['automation','plan']}).phase,'plan')
  assert.equal(deriveTaskConstraints({version:1,ids:['automation']}).phase,'execute')
  assert.equal(hasTaskDeclarations(undefined),false)
  assert.equal(taskDeclarationsLabel({version:1,ids:['plan','automation']}),'自动化、计划')
  for(const value of [{version:2,ids:['plan']},{version:1,ids:['future']},{version:1,ids:[],phase:'execute'},null])assert.throws(()=>normalizeTaskDeclarations(value))
  assert.throws(()=>deriveTaskConstraints(undefined,{documentRevision:-1}),/source/)
})

test('declarations-only documents persist meaningful state without becoming sendable',()=>{
  const base=createComposerDocument('chat'),plan={...base,declarations:{version:1,ids:['plan']}}
  assert.equal(composerDocumentEmpty(plan),true)
  assert.equal(composerDocumentHasState(plan),true)
  assert.equal(composerDocumentHasState(base),false)
  assert.deepEqual(compileComposerDocument(plan).declarations,{version:1,ids:['plan']})
  assert.deepEqual(mergeComposerDocuments(base,plan).declarations,plan.declarations)
})

test('retry and content identities include canonical declarations while declaration-free identities remain compatible',()=>{
  const base=createComposerDocument('chat','同样正文'),plan={...base,declarations:{version:1,ids:['plan']}},automation={...base,declarations:{version:1,ids:['automation']}}
  assert.equal(composerSemanticIdentity(base),JSON.stringify(['document',base.chatId,base.id,base.revision,base.content]))
  assert.notEqual(composerSubmissionKey(base),composerSubmissionKey(plan))
  assert.notEqual(composerSubmissionKey(plan),composerSubmissionKey(automation))
  assert.equal(composerDocumentsHaveSameContent(plan,automation),false)
  assert.equal(composerSubmissionKey({...base,declarations:{version:1,ids:['plan','automation','plan']}}),composerSubmissionKey({...base,declarations:{version:1,ids:['automation','plan']}}))
  assert.throws(()=>mergeComposerDocuments(plan,automation),/declarations_conflict/)
})

test('unknown declaration semantics remain intact in previews and recoveries but cannot compile or submit',()=>{
  const raw={...createComposerDocument('chat','保留正文'),declarations:{version:2,ids:['future'],payload:{nested:['保留']}}},document=normalizeComposerDocument(raw)
  assert.deepEqual(document.declarations,raw.declarations)
  assert.equal(previewComposerDocument(document).content,'保留正文')
  assert.throws(()=>compileComposerDocument(document),/declarations_version/)
  assert.throws(()=>composerSubmissionKey(document),/declarations_version/)
})

test('Markdown exports retain visible task declaration context without mixing it into executable body text',()=>{
  const document={...createComposerDocument('chat','正文'),declarations:{version:1,ids:['automation','plan']}},constraints=deriveTaskConstraints(document.declarations)
  const exported=formatChatAsMarkdown({id:'chat',title:'测试',createdAt:1,updatedAt:1,messages:[{id:'user',role:'user',createdAt:1,content:'正文',meta:{document,taskConstraints:constraints}}]})
  assert.match(exported,/任务声明：自动化、计划/)
  assert.equal(compileComposerDocument(document).content,'正文')
})
