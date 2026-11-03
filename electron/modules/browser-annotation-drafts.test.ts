import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {BrowserAnnotationDraftStore} from './browser-annotation-drafts'
import {createAnnotationDrafts} from '../../src/composables/annotationDrafts'
import type {BrowserAnnotation,BrowserDraftInput,BrowserWorkspaceApi} from '../../shared/browser-workspace'

function fixture(t:import('node:test').TestContext){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navora-drafts-'))
  t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('navora-drafts-'));fs.rmSync(root,{recursive:true,force:true})})
  const files={resolve:(chatId:string,file:string)=>path.join(root,chatId,file)}
  return {root,files,store:new BrowserAnnotationDraftStore(files)}
}
const input=(text:string,editorId='one',sequence=1):BrowserDraftInput=>({text,editorId,sequence,baseComment:'original',baseRevision:1,deleted:false})
function client(store:BrowserAnnotationDraftStore){return {
  annotationDrafts:async(chat:string)=>store.list(chat),
  annotationDraftRecovery:async(chat:string)=>store.recovery(chat),
  writeAnnotationDraft:async(chat:string,id:string,version:number,value:BrowserDraftInput)=>store.write(chat,id,version,value),
  resolveAnnotationDraft:async(chat:string,id:string,version:number,value:BrowserDraftInput,copy:{id:string;sequence:number})=>store.resolve(chat,id,version,value,copy),
} as BrowserWorkspaceApi}

test('annotation drafts survive service restart and remain isolated by chat',t=>{
  const {store,files}=fixture(t),draft=store.write('chat','ann_one',0,input('unsubmitted opinion'))
  const restored=new BrowserAnnotationDraftStore(files)
  assert.deepEqual(restored.list('chat'),[draft])
  assert.deepEqual(restored.list('other'),[])
  assert.equal(fs.existsSync(files.resolve('chat','browser-annotations/drafts/ann_one.json.tmp')),false)
  assert.throws(()=>store.write('chat','../outside',0,input('bad')),/invalid_annotation_id/)
  assert.throws(()=>store.write('chat','ann_bad',0,input('x'.repeat(4001))),/invalid_annotation_draft/)
})

test('in-flight edits retain the newest sequence and another window needs the latest draft version',t=>{
  const {store}=fixture(t)
  const first=store.write('chat','ann_one',0,input('first'))
  const latest=store.write('chat','ann_one',0,input('second','one',2))
  assert.equal(latest.version,2)
  assert.deepEqual(store.write('chat','ann_one',0,input('late first','one',1)),latest)
  assert.throws(()=>store.write('chat','ann_one',first.version,input('stale window','two')),/annotation_draft_conflict/)
  assert.equal(store.list('chat')[0]!.text,'second')
  const next=store.write('chat','ann_one',latest.version,input('accepted in second window','two'))
  assert.throws(()=>store.write('chat','ann_one',latest.version,input('old window','one',3)),/annotation_draft_conflict/)
  assert.equal(next.text,'accepted in second window')
})

test('clearing keeps a version tombstone so stale edits cannot resurrect a saved draft',t=>{
  const {store,files}=fixture(t)
  const first=store.write('chat','ann_one',0,input('saved'))
  const cleared=store.write('chat','ann_one',first.version,{...input('','one',2),deleted:true})
  assert.equal(store.write('chat','ann_one',first.version,input('late save','one',1)).deleted,true)
  assert.throws(()=>store.write('chat','ann_one',first.version,input('late other window','two')),/annotation_draft_conflict/)
  assert.equal(new BrowserAnnotationDraftStore(files).list('chat')[0]!.version,cleared.version)
  store.remove('chat','ann_one');assert.deepEqual(new BrowserAnnotationDraftStore(files).list('chat'),[])
})

test('renderer draft buffer rebases status changes, survives transfer and protects concurrent edits',async t=>{
  const {store}=fixture(t)
  const api=client(store)
  const note={id:'ann_one',comment:'original',revision:1} as BrowserAnnotation
  const one=createAnnotationDrafts(api,'chat',()=>{})
  await Promise.all([one.remember(note,'typed first'),one.remember(note,'typed newest')]);await one.flush(note.id)
  assert.equal(store.list('chat')[0]!.text,'typed newest')
  const two=createAnnotationDrafts(api,'chat',()=>{});two.sync(await api.annotationDrafts('chat'))
  assert.equal(two.read(note)?.text,'typed newest')
  assert.equal(two.read({...note,revision:2})?.baseRevision,2,'Status changes preserve the opinion base')
  await two.remember(note,'another window draft')
  one.sync(await api.annotationDrafts('chat'),note.id)
  assert.match(one.state(note).error,/annotation_draft_conflict/)
  assert.equal(one.read(note)?.text,'typed newest')
  await assert.rejects(one.flush(note.id),/annotation_draft_conflict/)
  assert.equal(one.state(note).copied,true,'Focused buffer is retained on disk before permitting reload')
  assert.equal(store.recovery('chat').copies[0]!.text,'typed newest')
  assert.equal(await one.reload(note),'another window draft')
  await one.clear(note);assert.equal(one.read(note),undefined)
  const updated={...note,comment:'fresh opinion',revision:3}
  await one.remember(updated,updated.comment)
  await one.remember(updated,'new draft after matching saved opinion')
  assert.equal(one.read(updated)?.baseComment,updated.comment)
  assert.equal(one.read(updated)?.baseRevision,3)
})

test('a damaged draft is isolated without blocking healthy drafts or overwriting original bytes',t=>{
  const {store,files}=fixture(t)
  store.write('chat','ann_one',0,input('retain on error'))
  const file=files.resolve('chat','browser-annotations/drafts/ann_one.json')
  fs.writeFileSync(file,'{damaged')
  store.write('chat','ann_good',0,input('healthy'))
  const restarted=new BrowserAnnotationDraftStore(files)
  assert.equal(restarted.list('chat')[0]!.text,'healthy')
  const issue=restarted.recovery('chat').issues[0]!
  assert.equal(issue.annotationId,'ann_one')
  const original=files.resolve('chat','browser-annotations/drafts/'+issue.fileName)
  assert.equal(fs.readFileSync(original,'utf8'),'{damaged')
  restarted.write('chat','ann_one',0,input('fresh recoverable text','two'))
  const again=new BrowserAnnotationDraftStore(files)
  assert.equal(again.list('chat').length,2)
  assert.equal(again.recovery('chat').issues.length,1,'Isolation warning survives a process restart')
  assert.equal(fs.readFileSync(original,'utf8'),'{damaged')
})

test('rejected buffers persist per editor, ignore late sequences and restore in another panel',async t=>{
  const {store,files}=fixture(t)
  store.write('chat','ann_one',0,input('canonical'))
  assert.throws(()=>store.write('chat','ann_one',0,input('older rejected','two',1)),/annotation_draft_conflict/)
  assert.throws(()=>store.write('chat','ann_one',0,input('newest rejected','two',2)),/annotation_draft_conflict/)
  assert.throws(()=>store.write('chat','ann_one',0,input('late rejected','two',1)),/annotation_draft_conflict/)
  const restarted=new BrowserAnnotationDraftStore(files),api=client(restarted)
  assert.equal(restarted.list('chat')[0]!.text,'canonical')
  assert.equal(restarted.recovery('chat').copies.length,1)
  const panel=createAnnotationDrafts(api,'chat',()=>{}),note={id:'ann_one',comment:'original',revision:1} as BrowserAnnotation
  panel.sync(await api.annotationDrafts('chat'));panel.syncRecovery(await api.annotationDraftRecovery('chat'))
  assert.equal(panel.copies(note.id)[0]!.text,'newest rejected')
  assert.equal(await panel.resolve(note,panel.copies(note.id)[0]!,'canonical\n\nnewest rejected'),'canonical\n\nnewest rejected')
  assert.equal(restarted.recovery('chat').copies.length,0)
  assert.equal(new BrowserAnnotationDraftStore(files).list('chat')[0]!.text,'canonical\n\nnewest rejected')
})

test('resolving checks both the selected copy sequence and the observed canonical version',t=>{
  const {store}=fixture(t)
  const first=store.write('chat','ann_one',0,input('original draft'))
  assert.throws(()=>store.write('chat','ann_one',0,input('copy','two')),/annotation_draft_conflict/)
  const copy=store.recovery('chat').copies[0]!
  assert.throws(()=>store.write('chat','ann_one',0,input('newer copy','two',2)),/annotation_draft_conflict/)
  assert.throws(()=>store.resolve('chat','ann_one',first.version,input('merge','resolver'),copy),/annotation_draft_copy_changed/)
  const selected=store.recovery('chat').copies[0]!,latest=store.write('chat','ann_one',first.version,input('new remote draft','third'))
  assert.throws(()=>store.resolve('chat','ann_one',first.version,input('stale merge','resolver'),selected),/annotation_draft_conflict/)
  assert.equal(store.list('chat')[0]!.text,'new remote draft')
  assert.equal(store.recovery('chat').copies.length,2,'Rejected merge and the newer source copy both remain')
  const result=store.resolve('chat','ann_one',latest.version,input('explicit merge','resolver',2),selected)
  assert.equal(result.text,'explicit merge')
  assert.equal(store.recovery('chat').copies.length,1,'Only the explicitly selected copy is consumed')
})

test('corrupt conflict copies and malformed filenames do not block valid copies',t=>{
  const {store,files}=fixture(t)
  store.write('chat','ann_one',0,input('canonical'))
  for(const editor of ['two','three'])assert.throws(()=>store.write('chat','ann_one',0,input(editor,editor)),/annotation_draft_conflict/)
  const broken=store.recovery('chat').copies[0]!
  const directory=files.resolve('chat','browser-annotations/drafts')
  fs.writeFileSync(path.join(directory,'conflicts',broken.id+'.json'),'{damaged copy')
  fs.writeFileSync(path.join(directory,'invalid name.json'),'{}')
  fs.writeFileSync(path.join(directory,'ann_large.json'),'x'.repeat(40001))
  const restarted=new BrowserAnnotationDraftStore(files),recovery=restarted.recovery('chat')
  assert.equal(restarted.list('chat')[0]!.text,'canonical')
  assert.equal(recovery.copies.length,1)
  assert.equal(recovery.issues.length,3)
  assert.equal(new BrowserAnnotationDraftStore(files).recovery('chat').issues.length,3)
  store.remove('chat','ann_one')
  assert.equal(new BrowserAnnotationDraftStore(files).recovery('chat').copies.length,0)
})

test('a rejected merge preserves the resolving editor original as well as the selected source copy',t=>{
  const {store,files}=fixture(t)
  const first=store.write('chat','ann_one',0,input('canonical'))
  assert.throws(()=>store.write('chat','ann_one',0,input('local original','resolver')),/annotation_draft_conflict/)
  assert.throws(()=>store.write('chat','ann_one',0,input('other original','other')),/annotation_draft_conflict/)
  const selected=store.recovery('chat').copies.find(copy=>copy.editorId==='other')!
  store.write('chat','ann_one',first.version,input('new canonical','one',2))
  assert.throws(()=>store.resolve('chat','ann_one',first.version,input('local original\n\nother original','resolver',2),selected),/annotation_draft_conflict/)
  const copies=new BrowserAnnotationDraftStore(files).recovery('chat').copies
  assert.equal(copies.length,3)
  assert.equal(copies.find(copy=>copy.editorId==='resolver')?.text,'local original')
  assert.equal(copies.find(copy=>copy.id===selected.id)?.text,'other original')
  assert.ok(copies.some(copy=>copy.text==='local original\n\nother original'))
  assert.equal(store.list('chat')[0]!.text,'new canonical')
})

test('a failed disk write never advertises a retained copy or discards the local buffer',async t=>{
  const {store}=fixture(t),api=client(store),note={id:'ann_one',comment:'original',revision:1} as BrowserAnnotation
  api.writeAnnotationDraft=async()=>{throw Error('disk_full')}
  const panel=createAnnotationDrafts(api,'chat',()=>{})
  await panel.remember(note,'unsaved local text')
  assert.equal(panel.state(note).copied,false)
  assert.equal(panel.state(note).retained,false)
  await assert.rejects(panel.reload(note),/disk_full/)
  assert.equal(panel.read(note)?.text,'unsaved local text')
})
