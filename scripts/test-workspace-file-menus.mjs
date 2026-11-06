import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

// Exercise the actual async menu coordinator without opening user files or an OS chooser.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-file-menus-'))
const source=String.raw`
import test from 'node:test'
import assert from 'node:assert/strict'
import {useWorkspaceFileActions} from './src/composables/useWorkspaceFileActions'
import {useAppLinks} from './src/composables/useAppLinks'
import {editablePaste} from './src/utils/editable-context'
class Element {closest(){return this}}
class HTMLElement extends Element {isConnected=true;focused=false;attributes={};dataset={};getAttribute(name){return this.attributes[name]??null}getBoundingClientRect(){return {x:20,y:30,width:100,height:20}}focus(){this.focused=true}}
class MouseEvent {clientX=50;clientY=60;prevented=false;stopped=false;constructor(element){this.target=this.currentTarget=element}preventDefault(){this.prevented=true}stopPropagation(){this.stopped=true}}
class KeyboardEvent extends MouseEvent {constructor(element){super(element);this.clientX=this.clientY=0}}
Object.assign(globalThis,{Element,HTMLElement,MouseEvent,KeyboardEvent})
function fixture(){
 const state={current:true,revision:'r1',selection:'copyPath',supported:true,requests:[],menus:[],messages:[],opens:[],unmount:()=>{},beforeInspect:()=>{},beforeChoice:()=>{}}
 state.native={menusSupported:{value:true},ready:async()=>{},popupMenu:async(items,anchor)=>{state.menus.push({items,anchor});await state.beforeChoice();return {supported:state.supported,selectedId:state.selection}}}
 globalThis.__fileMenuFixture=state
 globalThis.window={navora:{workspace:{fileAction:async(chatId,path,action,options)=>{
   state.requests.push({chatId,path,action,options});if(action==='inspect')await state.beforeInspect()
   if(options.revision&&options.revision!==state.revision)return {ok:false,error:'file_changed_refresh'}
   return action==='inspect'?{ok:true,capabilities:{revision:state.revision,directory:false,openWith:true,copyContent:false,copyContentReason:'二进制文件'}}:{ok:true}
 }}}}
 state.actions=useWorkspaceFileActions({open:(path,chatId)=>state.opens.push({path,chatId}),notify:text=>state.messages.push(text),isCurrent:()=>state.current})
 return state
}
test('file menu inspects the captured owner/path and carries its revision to the chosen action',async()=>{
 const f=fixture(),element=new HTMLElement(),event=new MouseEvent(element)
 await f.actions.show({chatId:'owner-b',path:'images/picture.png'},event)
 assert.equal(event.prevented,true);assert.equal(event.stopped,true)
 assert.equal(f.menus[0].items.find(item=>item.id==='copyContent').enabled,false)
 assert.equal(f.menus[0].items.find(item=>item.id==='copyContent').reason,'二进制文件')
 assert.ok(f.menus[0].items.some(item=>item.id==='open-options'&&item.children.some(child=>child.id==='openWith')))
 assert.deepEqual(f.requests.map(row=>[row.chatId,row.path,row.action,row.options.revision]),[['owner-b','images/picture.png','inspect',undefined],['owner-b','images/picture.png','copyPath','r1']])
})
test('revision changes after the menu opens retain data and report refresh instead of executing a stale action',async()=>{
 const f=fixture();f.beforeChoice=()=>{f.revision='r2'}
 await f.actions.show({chatId:'owner',path:'file.txt'},new MouseEvent(new HTMLElement()))
 assert.equal(f.requests.at(-1).options.revision,'r1');assert.ok(f.messages.some(text=>text.includes('文件已更新')));assert.equal(f.opens.length,0)
})
test('changing the owner view during inspection prevents opening a menu',async()=>{
 const f=fixture();f.beforeInspect=()=>{f.current=false}
 await f.actions.show({chatId:'old',path:'file.txt'},new MouseEvent(new HTMLElement()))
 assert.equal(f.menus.length,0);assert.equal(f.requests.length,1);assert.ok(f.messages.some(text=>text.includes('来源窗口或文件已切换')))
})
test('closing the source component while a menu is open cannot dispatch its late selection',async()=>{
 const f=fixture();f.beforeChoice=()=>f.unmount()
 await f.actions.show({chatId:'old',path:'file.txt'},new MouseEvent(new HTMLElement()))
 assert.equal(f.requests.length,1);assert.ok(f.messages.some(text=>text.includes('来源窗口或文件已切换')))
})
test('extra tab/download actions re-inspect the captured revision before dispatch',async()=>{
 const f=fixture();f.selection='close-tab';let extra
 await f.actions.show({chatId:'owner-b',path:'file.txt'},new MouseEvent(new HTMLElement()),'context',{items:[{id:'close-tab',label:'关闭标签页'}],run:(id,target)=>{extra={id,target}}})
 assert.equal(f.requests.length,2);assert.equal(f.requests[1].action,'inspect');assert.equal(f.requests[1].options.revision,'r1')
 assert.equal(extra.target.chatId,'owner-b');assert.equal(extra.target.path,'file.txt');assert.equal(extra.id,'close-tab')
})
test('keyboard invocation anchors to the focused file row and cancellation has no file side effect',async()=>{
 const f=fixture(),element=new HTMLElement();f.selection=undefined
 await f.actions.show({chatId:'owner',path:'file.txt'},new KeyboardEvent(element))
 assert.deepEqual(f.menus[0].anchor,{x:20,y:30,width:100,height:20});assert.equal(f.requests.length,1)
})
test('unsupported native presentation reports a recoverable error without invoking a file action',async()=>{
 const f=fixture();f.supported=false;f.selection=undefined
 await f.actions.show({chatId:'owner',path:'file.txt'},new MouseEvent(new HTMLElement()))
 assert.equal(f.requests.length,1);assert.ok(f.messages.some(text=>text.includes('暂时不可用')))
})
test('unsupported link menus report feedback rather than silently swallowing the request',async()=>{
 const f=fixture();f.native.menusSupported.value=false
 const links=useAppLinks(text=>f.messages.push(text))
 await links.showLinkMenu('https://example.test/',new MouseEvent(new HTMLElement()),'chat')
 assert.equal(f.menus.length,0);assert.ok(f.messages.some(text=>text.includes('链接菜单暂时不可用')))
})
test('keyboard link menus retain their source URL/owner and await external launch',async()=>{
 const f=fixture(),element=new HTMLElement();element.attributes.href='https://example.test/';element.dataset.chatId='owner-b';f.selection='external'
 window.navora.app={platform:'win32',openLink:async value=>{f.opens.push(value);return {ok:true}}}
 const links=useAppLinks(text=>f.messages.push(text))
 await links.showLinkMenu(element.attributes.href,new KeyboardEvent(element),'owner-b')
 assert.deepEqual(f.menus[0].anchor,{x:20,y:30,width:100,height:20});assert.deepEqual(f.opens,[{url:'https://example.test/',chatId:'owner-b',mode:'external'}])
})
test('a removed or changed link cannot dispatch a late choice against replacement content',async()=>{
 for(const change of [element=>{element.isConnected=false},element=>{element.attributes.href='https://changed.test/'},element=>{element.dataset.chatId='other'}]){
   const f=fixture(),element=new HTMLElement();element.attributes.href='https://example.test/';element.dataset.chatId='owner';f.selection='external'
   window.navora.app={platform:'win32',openLink:async value=>{f.opens.push(value);return {ok:true}}};f.beforeChoice=()=>change(element)
   const links=useAppLinks(text=>f.messages.push(text));await links.showLinkMenu('https://example.test/',new MouseEvent(element),'owner');assert.equal(f.opens.length,0)
 }
})
test('an asynchronous clipboard read cannot paste after its saved editable target becomes stale',async()=>{
 let finish;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{readText:()=>new Promise(resolve=>{finish=resolve})}}})
 const target={kind:'input',el:{value:'original'}},pending=editablePaste(target,0,8,()=>false)
 finish('replacement');assert.equal(await pending,false);assert.equal(target.el.value,'original')
})
`
try{
  const output=path.join(temporary,'file-menu.test.mjs')
  await build({stdin:{contents:source,resolveDir:root,sourcefile:'file-menu.test.ts',loader:'ts'},outfile:output,bundle:true,platform:'node',format:'esm',target:'node20',alias:{'@shared':path.join(root,'shared')},logLevel:'warning',plugins:[{name:'file-menu-ui-boundary',setup(builder){
    builder.onResolve({filter:/^\.\/useNativeUi$/},()=>({path:'native',namespace:'fixture'}))
    builder.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'fixture'}))
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='native'?'export function useNativeUi(){return globalThis.__fileMenuFixture.native}':'export function onBeforeUnmount(callback){globalThis.__fileMenuFixture.unmount=callback}',loader:'js'}))
  }}]})
  const result=spawnSync(process.execPath,['--test',output],{cwd:root,stdio:'inherit',windowsHide:true});process.exitCode=result.status??1
}finally{
  if(path.dirname(temporary)!==path.resolve(os.tmpdir())||!path.basename(temporary).startsWith('navora-file-menus-'))throw Error('Unsafe test cleanup path')
  fs.rmSync(temporary,{recursive:true,force:true})
}
