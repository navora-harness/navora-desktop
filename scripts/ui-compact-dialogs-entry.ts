import {app,BrowserWindow,NativePanel,ipcMain} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import assert from 'node:assert/strict'
import {registerNativeUi} from '../electron/modules/native-ui'
import {chatSearchPanel,readSourcesPanel,workspacePickerPanel,fitNativeDialogContent,nativeDialogMetrics} from '../shared/native-dialog-panels'
import {nativePanelNodes,nativePanelPresentationTree} from '../shared/native-ui-validation'
import {getUiIcon} from '../shared/ui-icons'
import type {NativePanelContent,NativePanelEvent,NativePanelHandle,NativeUiTheme} from '../shared/native-ui'
import type {WorkspaceResource} from '../shared/workspace-resources'

const project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,profile=process.env.NAVORA_DATA_ROOT!
if(!profile||!path.isAbsolute(profile))throw Error('An isolated fixture profile is required')
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),run=promisify(execFile),checks:string[]=[],captures:any[]=[],published:NativePanelEvent[]=[],actions:unknown[]=[]
const themes:Record<'light'|'dark',NativeUiTheme>={light:{mode:'light',background:'#feffff',text:'#263c50',muted:'#5c7185',accent:'#3d6f96',border:'#d7e3ed',fontFamily:'Segoe UI',fontSize:13},dark:{mode:'dark',background:'#18212c',text:'#e4edf6',muted:'#9babbc',accent:'#6ba4d0',border:'#344457',fontFamily:'Segoe UI',fontSize:13}}
const handlers=new Map<string,Function>(),originalHandle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>{handlers.set(channel,listener);originalHandle(channel,listener)}
let owner:BrowserWindow|undefined,panel:NativePanel|undefined,handle:NativePanelHandle|undefined,current:NativePanelContent|undefined,mode:'light'|'dark'='light'
const originalShow=NativePanel.prototype.show
NativePanel.prototype.show=function(options){originalShow.call(this,options);panel=this}
const state=()=>{assert.ok(panel);return (panel as unknown as {_getState():any})._getState()}
const invoke=(name:string,...args:any[])=>{assert.ok(owner);return handlers.get('navora:native-ui.'+name)!({sender:owner.webContents,senderFrame:owner.webContents.mainFrame},...args)}
async function until(check:()=>boolean,label:string){const deadline=Date.now()+6000;while(Date.now()<deadline){if(check())return;await wait(35)}throw Error('Timed out: '+label)}
async function icons(content:NativePanelContent){
  const names=[...new Set([...nativePanelNodes(content).values()].flatMap(node=>node.icon?[node.icon]:[]))],result:Record<string,string>={}
  for(const name of names){
    const icon=getUiIcon(name,16),svg=`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 ${icon.size} ${icon.size}">${icon.paths.map(part=>`<path d="${part.d}" fill="${part.fill||themes[mode].text}"${part.fillRule?` fill-rule="${part.fillRule}"`:''}${icon.strokeWidth?` stroke="${themes[mode].text}" stroke-width="${icon.strokeWidth}"`:''}/>`).join('')}</svg>`
    result[name]=await owner!.webContents.executeJavaScript(`(async()=>{const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(${JSON.stringify(svg)});await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=16;canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png')})()`)
  }
  return result
}
function fitted(content:NativePanelContent,width:number,height:number){const search=content.id==='chat-search-root',metrics=nativeDialogMetrics(search?'search':undefined);return fitNativeDialogContent(content,{width:search?Math.min(content.width||480,width-48)-(metrics.width-24):Math.min(content.width||480,width-16-metrics.width),maxHeight:height-(search?31:16)-metrics.height}).content}
async function show(content:NativePanelContent,width=720,height=620,theme:'light'|'dark'='light',focus='none'){
  if(handle)invoke('destroy',handle.id,handle.session)
  owner!.setContentSize(width,height);mode=theme;current=fitted(content,width,height)
  const metrics=nativeDialogMetrics(current.id==='chat-search-root'?'search':undefined)
  handle=invoke('show',{id:'compact-fixture',contextKey:'isolated-dialogs',content:current,anchor:{x:8,y:24,width:1,height:1},placement:'bottom-start',focusMode:focus,role:focus==='input'?'search':'transient',dismissOnOutsideClick:false,theme:themes[mode],icons:await icons(current),contentInset:metrics.contentInset,radius:metrics.radius,scrollbarPlacement:'gutter'})
  assert.equal(handle!.supported,true);await until(()=>state().visible,'real NativePanel visible');await wait(100)
}
async function update(content:NativePanelContent,width=owner!.getContentBounds().width,height=owner!.getContentBounds().height){
  current=nativePanelPresentationTree(fitted(content,width,height));assert.equal(invoke('update',handle!.id,handle!.session,{content:current,theme:themes[mode],icons:await icons(current)}),true);await wait(85)
}
async function capture(name:string){
  await wait(100);const diagnostic=state();fs.writeFileSync(path.join(output,name+'-state.json'),JSON.stringify({request:current,native:diagnostic},null,2))
  const {stdout}=await run('python',[path.join(project,'scripts/capture-native-panel.py'),'--pid',String(process.pid),'--hwnd',String(diagnostic.windowHandle),'--owner',String(diagnostic.parentWindowHandle),'--output',path.join(output,name+'.png')],{windowsHide:true,timeout:15000}),image=JSON.parse(stdout)
  assert.equal(image.ok,true);assert.equal(image.method,'PrintWindow');assert.ok(diagnostic.nativeWindowsValid)
  captures.push({name,owner:owner!.getContentBounds(),bounds:diagnostic.bounds,contentHeight:diagnostic.contentHeight,viewportHeight:diagnostic.viewportHeight,capture:image})
  return diagnostic
}
async function input(args:string[]){const diagnostic=state();await run('python',[path.join(project,'scripts/native-panel-test-input.py'),'--pid',String(process.pid),'--hwnd',String(diagnostic.windowHandle),...args],{windowsHide:true,timeout:10000})}
function click(id:string){assert.ok(nativePanelNodes(current!).get(id));const previous=published.length;panel!.emit('action',{id,type:'click'});assert.equal(published.length,previous+1);assert.equal(published.at(-1)?.action?.id,id);actions.push({id,type:'click'})}
const hit=(index:number)=>({id:`chat-${index}`,title:index===0?'项目资料与浏览器操作记录':'资料分析和后续事项 '.repeat(8)+index,snippet:'已整理网页内容、引用来源和待办事项。'.repeat(8),relative:'刚刚'})
const file=(index:number):WorkspaceResource=>({id:`file-${index}`,ownerChatId:'fixture-chat',path:`项目资料/参考文档/2026-11/${index}-网页操作记录与检查说明.md`,name:`${index}-网页操作记录与检查说明.md`,kind:'document',size:100,mtimeMs:index,revision:`rev-${index}`,evidence:{messageId:`message-${index}`,createdAt:1,operation:'file_write'}})
const picker=(entries:WorkspaceResource[],extra:Record<string,unknown>={})=>workspacePickerPanel({title:'打开对话文件',chatId:'fixture-chat',query:'',kind:'all',entries,loading:false,error:false,snapshot:{ok:true,entries,truncated:false,unavailable:0},page:0,showLocate:true,...extra})
const sources=[{url:'https://example.test/reference'},{url:'https://www.example.test/',siteName:'example.test',title:'https://www.example.test/'},{url:'https://docs.example.test/guide',siteName:'示例文档',title:'浏览器工作区操作指南',snippet:'关于网页内容、文件资料和对话之间如何关联的详细说明。这份文档还包含操作步骤与常见问题。'.repeat(8)}]

void app.whenReady().then(async()=>{
let service:ReturnType<typeof registerNativeUi>|undefined
try{
  assert.equal(NativePanel.isSupported(),true)
  owner=new BrowserWindow({show:false,width:720,height:620,x:-30000,y:-30000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
  owner.showInactive();await owner.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><title>Isolated compact native dialog verification</title><p>Only synthetic fixture data.</p>'));owner.webContents.setZoomFactor(1)
  const originalSend=owner.webContents.send.bind(owner.webContents)
  owner.webContents.send=(channel,...args)=>{if(channel==='navora:native-ui.event')published.push(structuredClone(args[0]));originalSend(channel,...args)}
  service=registerNativeUi({trusted:sender=>sender===owner!.webContents?owner:undefined,source:()=>{throw Error('No remote source is used')},pageSettings:()=>{throw Error('No site settings action is expected')}})
  ipcMain.handle=originalHandle
  const empty=chatSearchPanel([],'找不到的内容',null,true).content
  await show(empty);const emptyState=await capture('01-chat-empty-light');assert.equal(nativePanelNodes(current!).has('chat-search-results'),false)
  await show(chatSearchPanel([hit(0)],'项目','chat-0',true).content);const oneState=await capture('02-chat-one-light')
  assert.ok(oneState.bounds.height<emptyState.bounds.height+100)
  await show(chatSearchPanel(Array.from({length:40},(_,index)=>hit(index)),'资料','chat-0',true).content);const longState=await capture('03-chat-long-light')
  assert.ok(longState.bounds.height>oneState.bounds.height+180);assert.ok(longState.bounds.height<=350);checks.push('empty-single-and-long-native-chat-lists-follow-content-height')
  await show(readSourcesPanel(sources,'fixture-source').content);await capture('04-sources-dedup-light')
  assert.equal([...nativePanelNodes(current!).values()].filter(node=>node.type==='text'&&node.text==='example.test').length,1);checks.push('source-fallbacks-appear-once-and-real-native-summary-has-at-most-two-lines')
  const entries=[file(0),file(1)],partial=picker(entries,{snapshot:{ok:true,entries,truncated:false,unavailable:2}})
  await show(partial.content);await capture('05-files-partial-light');assert.equal([...nativePanelNodes(current!).values()].filter(node=>/workspace-picker-(refresh|retry)/.test(node.id)).length,1)
  assert.equal(partial.matches.length,2);click('workspace-picker-refresh');click([...partial.actions].find(([,action])=>action.kind==='locate')![0]);checks.push('partially-unreadable-workspace-keeps-files-and-one-refresh-retry-entry')
  await show(picker([]).content);await capture('06-files-empty-light');assert.equal(nativePanelNodes(current!).has('workspace-picker-results'),false)
  for(const theme of ['light','dark'] as const){
    await show(chatSearchPanel(Array.from({length:40},(_,index)=>hit(index)),'资料','chat-0',true).content,390,500,theme);const searchState=await capture(`07-chat-long-narrow-${theme}`)
    await show(readSourcesPanel(sources,'fixture-source').content,390,500,theme);const sourceState=await capture(`08-sources-narrow-${theme}`)
    await show(picker(Array.from({length:36},(_,index)=>file(index)),{snapshot:{ok:true,entries:Array.from({length:36},(_,index)=>file(index)),truncated:true,unavailable:2}}).content,390,500,theme);const fileState=await capture(`09-files-partial-narrow-${theme}`)
    for(const diagnostic of [searchState,sourceState,fileState]){assert.ok(diagnostic.bounds.width<=390,`native popup width ${diagnostic.bounds.width} exceeds 390`);assert.ok(diagnostic.bounds.height<=500,`native popup height ${diagnostic.bounds.height} exceeds 500`);assert.equal(diagnostic.theme.mode,theme)}
    assert.ok(searchState.bounds.height<=300,'global chat search should stay compact with many results')
    checks.push(`390px-${theme}-native-search-sources-and-files-fit-available-width-and-height`)
  }
  await show(chatSearchPanel(Array.from({length:40},(_,index)=>hit(index)),'资料','chat-0',true).content,390,300,'dark');const shortSearch=await capture('11-chat-short-viewport-dark');assert.ok(shortSearch.bounds.height<=200);checks.push('chat-search-results-shrink-again-for-short-window-without-cropping-outer-card')
  await show(picker(entries,{error:true,snapshot:{ok:true,entries,truncated:true,unavailable:2}}).content,390,500,'dark');await capture('10-files-refresh-error-dark');assert.equal(nativePanelNodes(current!).get('workspace-picker-refresh')!.accessibleName,'重试读取文件')
  await show(chatSearchPanel([hit(0)],'','chat-0',true).content,390,500,'light','input');assert.equal(state().focusedId,'chat-search-query')
  await input(['--text','项目']);await until(()=>published.some(event=>event.action?.id==='chat-search-query'&&event.action.value==='项目'),'typed native search query')
  const currentQuery=state().controls.find((control:any)=>control.id==='chat-search-query');assert.equal(currentQuery.value,'项目')
  await update(chatSearchPanel([hit(0),hit(1)],'项目','chat-0').content);assert.equal(state().focusedId,'chat-search-query');assert.equal(state().controls.find((control:any)=>control.id==='chat-search-query').value,'项目')
  await input(['--key','13']);await until(()=>published.some(event=>event.action?.id==='chat-search-query'&&event.action.type==='submit'&&event.action.value==='项目'),'native Enter commits current query');checks.push('real-targeted-native-typing-and-Enter-work-after-input-preserving-results-update')
  const manySources=Array.from({length:35},(_,index)=>({url:`https://example.test/${index}`,title:`来源 ${index}`})),first=readSourcesPanel(manySources,'pagination',0),second=readSourcesPanel(manySources,'pagination',1)
  await show(first.content);click('read-sources-next');const staleId=[...first.actions.keys()][0]!
  await update(second.content);const count=published.length;panel!.emit('action',{id:staleId,type:'click'});assert.equal(published.length,count);click([...second.actions.keys()][0]!);checks.push('source-pagination-validates-current-visible-actions-and-rejects-stale-row')
  const report={ok:true,checks,captures,actions,nativeEvents:published.length,electron:process.versions.electron,layoutMetrics:{search:nativeDialogMetrics('search'),other:nativeDialogMetrics()},scope:'Current shared builders, nativeDialogMetrics frame reservations and production native-ui IPC service rendered by actual customized Electron NativePanel; isolated synthetic data. Search uses contentInset=10/radius=24; other cards use contentInset=8/radius=12. Screenshots capture only the PID-checked popup HWND using PrintWindow. Native query typing and Enter use PID-restricted Win32 messages. Pagination and file/source clicks use injected native action events. Vue caller integration, physical clicks and physical IME composition are not claimed.'}
  fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,checks,captures:captures.length}))
}catch(error){fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({ok:false,error:String(error),stack:error instanceof Error?error.stack:undefined,checks,captures,request:current,native:panel?state():undefined},null,2));console.error(error);process.exitCode=1}
finally{service?.dispose();if(owner&&!owner.isDestroyed())owner.destroy();await wait(150);app.exit(Number(process.exitCode||0))}
})
