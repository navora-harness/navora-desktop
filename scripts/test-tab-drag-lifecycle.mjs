import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-tab-drag-'))
const source=String.raw`
import test from 'node:test'
import assert from 'node:assert/strict'
import {useFileDrag} from './src/composables/useFileDrag'
import {useBrowserDrag} from './src/composables/useBrowserDrag'
class Element{closest(){return null}}
globalThis.Element=Element
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
function event(effect='none',outside=true){const data=new Map();return {dataTransfer:{dropEffect:effect,setData:(key,value)=>data.set(key,value),getData:key=>data.get(key),types:[]},currentTarget:new Element(),screenX:outside?400:50,screenY:50,clientX:50,clientY:50,prevented:false,preventDefault(){this.prevented=true},stopPropagation(){},stopImmediatePropagation(){}}}
function fixture(kind){
 const f={unmount:[],listeners:new Map(),errors:[],ends:[],tokens:new Set(),transfers:0,next:0,holdPrepare:null,holdDrop:null,failDrop:false}
 globalThis.__dragFixture=f
 const begin=async()=>{if(f.holdPrepare)await f.holdPrepare.promise;const token='token-'+(++f.next);f.tokens.add(token);return token}
 const drop=async token=>{if(f.holdDrop)await f.holdDrop.promise;if(!f.tokens.has(token))throw Error('file_drag_expired');if(f.failDrop)throw Error('target_busy');f.tokens.delete(token);f.transfers++;return {pageId:'page',pageIds:['page']}}
 const end=async(token,outside)=>{f.ends.push({token,outside});f.tokens.delete(token)}
 globalThis.window={screenX:0,screenY:0,outerWidth:100,outerHeight:100,addEventListener:(name,fn)=>f.listeners.set(name,fn),removeEventListener:name=>f.listeners.delete(name),navora:{app:{platform:'win32'},fileTabs:{beginDrag:begin,drop,endDrag:end},browser:{workspace:{beginDrag:begin,dropTabs:drop,endDrag:end}}}}
 const tab={key:'owner:file.txt',chatId:'owner',path:'file.txt'}
 f.drag=kind==='file'?useFileDrag(message=>f.errors.push(message),()=> 'owner'):useBrowserDrag(message=>f.errors.push(message))
 f.prepare=()=>f.drag.prepare(kind==='file'?tab:'page')
 f.start=e=>f.drag.start(e,kind==='file'?tab:'page')
 return f
}
for(const kind of ['file','browser']){
 test(kind+': receiver may consume a successful drop after source dragend',async()=>{
  const f=fixture(kind);await f.prepare();const e=event('move');f.start(e);f.holdDrop=deferred()
  const receive=f.drag.drop(e);await f.drag.end(e)
  assert.equal(f.ends.length,0,'source must not cancel or detach an accepted receiver transfer')
  f.holdDrop.resolve();await receive
  assert.equal(f.transfers,1);assert.deepEqual(f.errors,[]);assert.equal(f.tokens.size,0)
 })
 test(kind+': outside unaccepted drag detaches exactly once',async()=>{
  const f=fixture(kind);await f.prepare();const e=event();f.start(e);await f.drag.end(e);await f.drag.end(e)
  assert.equal(f.ends.length,1);assert.equal(f.ends[0].outside,true);assert.equal(f.transfers,0)
 })
 test(kind+': Escape cancels without creating a detached window',async()=>{
  const f=fixture(kind);await f.prepare();const e=event();f.start(e);f.listeners.get('keydown')({...e,key:'Escape'});await f.drag.end(e)
  assert.equal(f.ends.length,1);assert.equal(f.ends[0].outside,false);assert.equal(f.transfers,0)
 })
 test(kind+': delayed preparation cannot revive an unmounted drag owner',async()=>{
  const f=fixture(kind);f.holdPrepare=deferred();const pending=f.prepare();for(const callback of f.unmount)callback();f.holdPrepare.resolve();await pending
  const e=event();f.start(e);assert.equal(e.prevented,true);assert.deepEqual(f.errors,[])
 })
 test(kind+': receiver failure is reported and never triggers an extra detach',async()=>{
  const f=fixture(kind);await f.prepare();const e=event('move');f.start(e);f.failDrop=true;f.holdDrop=deferred();const receive=f.drag.drop(e);await f.drag.end(e);f.holdDrop.resolve();await receive
  assert.equal(f.ends.length,0);assert.equal(f.transfers,0);assert.equal(f.errors.length,1)
 })
}
`
try{
 const outfile=path.join(temporary,'test.mjs')
 await build({stdin:{contents:source,resolveDir:root,sourcefile:'tab-drag-lifecycle.test.ts',loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',target:'node20',logLevel:'warning',plugins:[{name:'drag-boundaries',setup(builder){
  builder.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'fixture'}))
  builder.onResolve({filter:/tabDragFeedback$/},()=>({path:'feedback',namespace:'fixture'}))
  builder.onResolve({filter:/^@shared\//},args=>({path:path.join(root,'shared',args.path.slice(8)+'.ts')}))
  builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='vue'?'export function onBeforeUnmount(callback){globalThis.__dragFixture.unmount.push(callback)}':'export const startTabFeedback=()=>{},endTabFeedback=()=>{},showTabDrop=()=>{},leaveTabDrop=()=>{};export const tabDropBefore=(_event,before)=>before;',loader:'js'}))
 }}]})
 const result=spawnSync(process.execPath,['--test',outfile],{cwd:root,stdio:'inherit',windowsHide:true});if(result.error)throw result.error;process.exitCode=result.status??1
}finally{
 const relative=path.relative(os.tmpdir(),temporary);if(!relative.startsWith('navora-tab-drag-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe drag fixture cleanup')
 fs.rmSync(temporary,{recursive:true,force:true})
}
