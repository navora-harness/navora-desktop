import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {ANNOTATION_DRAFT_LIMIT} from '../../shared/browser-annotation-limits'
import {BrowserAnnotationTargetStore} from './browser-annotation-drafts'
import type {BrowserAnnotationTarget} from '../../shared/browser-workspace'
function fixture(t:import('node:test').TestContext){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navora-target-test-'))
  t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('navora-target-test-'));fs.rmSync(root,{recursive:true,force:true})})
  const files={resolve:(chat:string,file:string)=>path.join(root,chat,file)},store=new BrowserAnnotationTargetStore(files)
  const row:BrowserAnnotationTarget={id:'target_fixture',chatId:'chat',pageId:'page',sessionId:'manual-token',selection:{documentId:'document',url:'https://example.test/',title:'Fixture',kind:'point',point:{x:10,y:20},rect:{x:6,y:16,width:8,height:8},viewport:{width:800,height:600,scrollX:0,scrollY:0,dpr:1}},screenshotPath:'browser-annotations/targets/target_fixture.png',comment:'',version:1,editorId:'',sequence:0,createdAt:1,updatedAt:1}
  const png=files.resolve('chat',row.screenshotPath);fs.mkdirSync(path.dirname(png),{recursive:true});fs.writeFileSync(png,Buffer.from('fixture-png-bytes'));store.create('chat',row)
  return {root,files,store,row}
}
test('temporary targets survive restart separately from annotation index and isolate page/chat',t=>{
  const {store,files,row}=fixture(t)
  assert.deepEqual(new BrowserAnnotationTargetStore(files).get('chat',row.id),row)
  assert.equal(fs.existsSync(files.resolve('chat','browser-annotations/index.json')),false)
  assert.deepEqual(store.list('other','page'),[]);assert.deepEqual(store.list('chat','other'),[])
  assert.throws(()=>store.get('chat','../outside'),/invalid_annotation_target/)
})
test('chat recovery lists drafts from every original page while retaining page and chat filters',t=>{
  const {store,row}=fixture(t)
  const other={...row,id:'target_other_page',pageId:'closed-page',screenshotPath:'browser-annotations/targets/target_other_page.png',updatedAt:2}
  store.create('chat',other)
  assert.deepEqual(store.list('chat').map(target=>target.id),[other.id,row.id])
  assert.deepEqual(store.list('chat','page').map(target=>target.id),[row.id])
  assert.deepEqual(store.list('other'),[])
  store.remove('chat',other.id,other.version)
  assert.deepEqual(store.list('chat').map(target=>target.id),[row.id])
})
test('same-editor delayed writes cannot replace newest target text; foreign conflicts retain their own screenshot',t=>{
  const {store,files,row}=fixture(t)
  const first=store.update('chat',row.id,1,{text:'first',editorId:'one',sequence:1})
  const second=store.update('chat',row.id,1,{text:'newest',editorId:'one',sequence:2})
  assert.deepEqual(store.update('chat',row.id,1,{text:'late',editorId:'one',sequence:1}),second)
  assert.throws(()=>store.update('chat',row.id,first.version,{text:'other-window',editorId:'two',sequence:1}),/annotation_target_draft_conflict/)
  const copy=store.list('chat','page').find(target=>target.conflictOf===row.id)!
  assert.equal(copy.comment,'other-window');assert.notEqual(copy.screenshotPath,row.screenshotPath)
  assert.deepEqual(fs.readFileSync(files.resolve('chat',copy.screenshotPath)),fs.readFileSync(files.resolve('chat',row.screenshotPath)))
  assert.throws(()=>store.update('chat',row.id,first.version,{text:'later-other',editorId:'two',sequence:2}),/annotation_target_draft_conflict/)
  assert.equal(store.get('chat',copy.id).comment,'later-other');assert.equal(store.get('chat',row.id).comment,'newest')
})
test('discard is version guarded and late target writes cannot resurrect a discarded target',t=>{
  const {store,row}=fixture(t)
  const edited=store.update('chat',row.id,1,{text:'kept',editorId:'one',sequence:1})
  assert.throws(()=>store.remove('chat',row.id,1),/annotation_target_draft_conflict/)
  store.remove('chat',row.id,edited.version)
  assert.throws(()=>store.update('chat',row.id,edited.version,{text:'late',editorId:'one',sequence:2}),/annotation_target_not_found/)
  assert.deepEqual(store.list('chat','page'),[])
})
test('invalid target drafts do not overwrite the retained original',t=>{
  const {store,row}=fixture(t)
  for(const value of [{text:'x'.repeat(ANNOTATION_DRAFT_LIMIT+1),editorId:'one',sequence:1},{text:'ok',editorId:'',sequence:1},{text:'ok',editorId:'one',sequence:0}])assert.throws(()=>store.update('chat',row.id,1,value),/invalid_annotation_target_draft/)
  assert.throws(()=>store.update('chat',row.id,NaN,{text:'ok',editorId:'one',sequence:1}),/invalid_annotation_target_draft/)
  assert.equal(store.get('chat',row.id).comment,'')
})


test('target drafts retain multiline overflow and intact surrogate pairs after restart',t=>{
  const {store,files,row}=fixture(t),text='字'.repeat(3999)+'😀\n'+ '行'.repeat(12000)
  const saved=store.update('chat',row.id,1,{text,editorId:'one',sequence:1})
  assert.equal(saved.comment,text)
  assert.equal(new BrowserAnnotationTargetStore(files).get('chat',row.id).comment,text)
})
