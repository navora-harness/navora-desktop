import fs from 'node:fs'
import {randomUUID} from 'node:crypto'
import type {WorkspaceFiles} from './workspace-files'
import type {BrowserRegistry} from './browser-registry'
import type {BrowserAnnotation,BrowserSelection,BrowserAnnotationResult,BrowserAnnotationComparison} from '../../shared/browser-workspace'
import type {BrowserPage} from './browser-host'
import type {BrowserManualSessionToken} from './browser-automation-controller'
import {annotationSelectionSource} from './browser-annotation-selection'
import {BrowserAnnotationTargetStore} from './browser-annotation-drafts'
import type {BrowserAnnotationTarget,BrowserAnnotationPhase} from '../../shared/browser-workspace'

const WORLD=1008
export class BrowserAnnotationService {
  private captures=new Set<string>()
  private sessions=new Map<string,{id:string;token:BrowserManualSessionToken}>()
  private targets:BrowserAnnotationTargetStore
  private watched=new WeakSet<BrowserPage>()
  private starting=new WeakSet<BrowserPage>()
  private cancelRequested=new Set<string>()
  private async finish(page:BrowserPage){
    const session=this.sessions.get(page.id);this.sessions.delete(page.id);this.cancelRequested.delete(page.id);page.annotationSelecting=false
    if(session&&!page.webContents.isDestroyed())await page.webContents.executeJavaScriptInIsolatedWorld(WORLD,[{code:'globalThis.__navoraAnnotations?.stop()'}]).catch(()=>{})
    if(session)await page.automation.releaseManualSession(session.token)
    return page.manualControl
  }
  constructor(private registry:BrowserRegistry,private files:WorkspaceFiles){this.targets=new BrowserAnnotationTargetStore(files)}
  private path(chatId:string){return this.files.resolve(chatId,'browser-annotations/index.json')}
  list(chatId:string):BrowserAnnotation[]{
    const file=this.path(chatId);if(!fs.existsSync(file))return []
    const list=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(list))throw Error('annotation_store_invalid')
    return list
  }
  private write(chatId:string,list:BrowserAnnotation[]){
    const file=this.path(chatId);fs.mkdirSync(this.files.resolve(chatId,'browser-annotations'),{recursive:true})
    const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(list));fs.renameSync(temp,file)
    this.files.emitChanged(chatId)
  }
  get(chatId:string,id:string){const row=this.list(chatId).find(a=>a.id===id);if(!row)throw Error('annotation_not_found');return row}
  async begin(chatId:string,pageId:string,kind:'auto'|'element'|'region',context?:{key:string;assertCurrent:()=>void}){
    const page=this.registry.assertWindowOwned(chatId,pageId).win
    if(page.annotationSelecting||this.captures.has(pageId)||this.starting.has(page))throw Error('browser_busy_finish_action_first')
    if(!this.watched.has(page)){
      this.watched.add(page)
      page.webContents.on('did-start-navigation',(_event,_url,_inPlace,mainFrame)=>{if(mainFrame)void this.finish(page).catch(()=>{})})
      page.webContents.on('render-process-gone',()=>{void this.finish(page).catch(()=>{})})
      page.webContents.on('destroyed',()=>{this.sessions.delete(page.id);page.annotationSelecting=false})
    }
    this.cancelRequested.delete(pageId);this.starting.add(page);page.annotationSelecting=true
    try{
      const token=await page.automation.acquireManualSession(),id=token.id
      this.sessions.set(page.id,{id,token})
      if(this.cancelRequested.has(pageId)||!page.annotationSelecting)throw Error('annotation_session_closed')
      if(token.documentEpoch!==page.automation.captureDocumentEpoch())throw Error('annotation_page_changed_select_again')
      context?.assertCurrent()
      const started=await page.webContents.executeJavaScriptInIsolatedWorld(WORLD,[{code:annotationSelectionSource(kind,id,context?.key)}])
      if(started!==true)throw Error(context?'browser_context_target_changed':'annotation_session_closed')
      if(!page.annotationSelecting||token.documentEpoch!==page.automation.captureDocumentEpoch())throw Error('annotation_page_changed_select_again')
      context?.assertCurrent()
    }catch(error){await this.finish(page).catch(()=>{});throw error}finally{this.starting.delete(page)}
  }
  async beginFromContext(chatId:string,pageId:string,key:string,assertCurrent:()=>void){
    const page=this.registry.assertWindowOwned(chatId,pageId).win
    assertCurrent()
    try{
      await this.begin(chatId,pageId,'element',{key,assertCurrent})
      const result=await this.collect(chatId,pageId)
      assertCurrent()
      if(!result.target)throw Error('browser_context_target_changed')
      return result.target
    }catch(error){await this.finish(page).catch(()=>{});throw error}
  }
  async mode(chatId:string,pageId:string,mode:'armed'|'passthrough',expectedTargetId?:string){
    const page=this.registry.assertWindowOwned(chatId,pageId).win,session=this.sessions.get(pageId)
    if(!session||!page.annotationSelecting)throw Error('annotation_session_not_found')
    await page.webContents.executeJavaScriptInIsolatedWorld(WORLD,[{code:'(() => {const s=globalThis.__navoraAnnotations;const expected='+JSON.stringify(expectedTargetId??null)+';if(s&&(!expected||!s.selection||s.selection.targetId===expected))s.mode('+JSON.stringify(mode)+')})()'}])
  }
  async cancel(chatId:string,pageId:string,_resume=false){
    const page=this.registry.assertWindowOwned(chatId,pageId).win
    if(this.captures.has(pageId)||this.starting.has(page)){this.cancelRequested.add(pageId);page.annotationSelecting=false;return page.manualControl}
    await page.webContents.executeJavaScriptInIsolatedWorld(WORLD,[{code:'(() => {const s=globalThis.__navoraAnnotations;if(s){s.stop();s.selection=null;s.cancelled=true}})()'}]).catch(()=>{})
    return this.finish(page)
  }
  listTargets(chatId:string,pageId?:string){return this.targets.list(chatId,pageId)}
  getTarget(chatId:string,id:string){return this.targets.get(chatId,id)}
  writeTarget(chatId:string,id:string,version:number,input:{text:string;editorId:string;sequence:number}){try{return this.targets.update(chatId,id,version,input)}finally{this.files.emitChanged(chatId)}}
  async discardTarget(chatId:string,pageId:string,id:string,version:number){
    const row=this.targets.get(chatId,id);if(row.pageId!==pageId)throw Error('browser_wrong_chat')
    this.targets.remove(chatId,id,version);fs.rmSync(this.files.resolve(chatId,row.screenshotPath),{force:true})
    this.files.emitChanged(chatId)
    if(this.sessions.has(pageId))await this.mode(chatId,pageId,'armed',id)
  }
  async commitTarget(chatId:string,pageId:string,id:string,version:number){
    const existing=this.list(chatId).find(row=>row.sourceTargetId===id);if(existing)return existing
    const page=this.registry.assertWindowOwned(chatId,pageId).win
    const current=await page.webContents.executeJavaScriptInIsolatedWorld(WORLD,[{code:'({id:globalThis.__navoraDocumentId,url:location.href})'}]).catch(()=>null)
    const target=this.targets.get(chatId,id)
    if(target.pageId!==pageId)throw Error('browser_wrong_chat')
    if(target.version!==version)throw Error('annotation_target_draft_conflict')
    if(!target.comment.trim())throw Error('annotation_comment_required')
    if(target.comment.length>4000)throw Error('invalid_annotation_comment')
    const list=this.list(chatId);if(list.length>=200)throw Error('annotation_limit_200')
    const annotationId='ann_'+id.slice(7),screenshotPath='browser-annotations/'+annotationId+'.png',file=this.files.resolve(chatId,screenshotPath)
    const now=Date.now(),annotation:BrowserAnnotation={id:annotationId,chatId,pageId,sessionId:this.registry.assertWindowOwned(chatId,pageId).sessionId,selection:target.selection,screenshotPath,comment:target.comment,createdAt:now,updatedAt:now,revision:1,taskState:'draft',anchorState:current?.id===target.selection.documentId&&current?.url===target.selection.url?'valid':'stale',sourceTargetId:id}
    fs.copyFileSync(this.files.resolve(chatId,target.screenshotPath),file)
    try{this.write(chatId,[...list,annotation])}catch(error){fs.rmSync(file,{force:true});throw error}
    this.targets.remove(chatId,id,version);fs.rmSync(this.files.resolve(chatId,target.screenshotPath),{force:true})
    if(this.sessions.has(pageId))await this.mode(chatId,pageId,'armed',id).catch(()=>{})
    return annotation
  }
  async collect(chatId:string,pageId:string):Promise<BrowserAnnotationResult>{
    const page=this.registry.assertWindowOwned(chatId,pageId).win,wc=page.webContents,session=this.sessions.get(pageId)
    if(!page.annotationSelecting||!session)return {cancelled:true,manualControl:page.manualControl}
    const liveStatus=async():Promise<BrowserAnnotationResult>=>{
      const current=await wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:'(() => {const s=globalThis.__navoraAnnotations;return s?{phase:s.phase,annotationSessionId:s.sessionId}:null})()'}]).catch(()=>null)
      return {...current,manualControl:page.manualControl,...(!page.annotationSelecting?{cancelled:true}:{})}
    }
    const value=await wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:'(() => {const s=globalThis.__navoraAnnotations;return s?{selection:s.selection,cancelled:s.cancelled,id:s.id,phase:s.phase,sessionId:s.sessionId}:null})()'}]) as {selection?:BrowserSelection;cancelled?:boolean;id:string;phase:BrowserAnnotationPhase;sessionId:string}|null
    if(this.sessions.get(pageId)!==session)return liveStatus()
    if(!value||value.sessionId!==session.id||!page.annotationSelecting)return {cancelled:true,manualControl:await this.cancel(chatId,pageId)}
    if(value.cancelled)return {cancelled:true,manualControl:await this.cancel(chatId,pageId)}
    const status={phase:value.phase,annotationSessionId:session.id,manualControl:page.manualControl}
    if(!value.selection||value.phase!=='target-ready'||this.captures.has(pageId))return status
    const targetId=value.selection.targetId
    if(!targetId)throw Error('invalid_annotation_target')
    const expected=`s?.sessionId===${JSON.stringify(session.id)}&&s.selection?.targetId===${JSON.stringify(targetId)}&&!s.cancelled`
    const existing=this.targets.list(chatId,pageId).find(row=>row.id===targetId)
    if(existing)return {...status,target:existing}
    this.captures.add(pageId)
    const captureId=randomUUID(),captureOwned=`s?.sessionId===${JSON.stringify(session.id)}&&s.captureOwner===${JSON.stringify(captureId)}`
    let file:string|undefined
    try{
      const selection=value.selection
      const retained=await wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:`(() => {const s=globalThis.__navoraAnnotations;if(!(${expected}))return false;s.hideForCapture(true,${JSON.stringify(captureId)});return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r((${expected})&&(${captureOwned})&&globalThis.__navoraAnnotations===s))))})()`}])
      if(!retained||this.sessions.get(pageId)!==session)return liveStatus()
      const image=await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})
      if(image.isEmpty())throw Error('annotation_screenshot_empty')
      const png=image.toPNG();if(png.length>8*1024*1024)throw Error('annotation_image_too_large')
      const directory=this.files.resolve(chatId,'browser-annotations'),targetsDirectory=this.files.resolve(chatId,'browser-annotations/targets')
      const used=[directory,targetsDirectory].reduce((total,dir)=>total+(fs.existsSync(dir)?fs.readdirSync(dir).filter(name=>name.endsWith('.png')).reduce((sum,name)=>sum+fs.statSync(dir+'/'+name).size,0):0),0)
      if(used+png.length>100*1024*1024)throw Error('annotation_storage_limit_100MB')
      const current=await wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:`(() => {const s=globalThis.__navoraAnnotations;if(!(${expected})||!(${captureOwned}))return null;const el=s.element,r=el?.isConnected?el.getBoundingClientRect():null;return {id:s.id,url:location.href,x:scrollX,y:scrollY,w:innerWidth,h:innerHeight,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,text:el&&!el.matches("input,textarea")?(el.textContent||"").trim().slice(0,500):""}})()`}])
      if(!current||this.sessions.get(pageId)!==session)return liveStatus()
      if(selection.kind==='element'&&(!current.rect||(['x','y','width','height'] as const).some(key=>Math.abs(current.rect[key]-selection.rect[key])>1)||current.text!==selection.text))throw Error('annotation_page_changed_select_again')
      if(!page.annotationSelecting||this.sessions.get(pageId)!==session||session.token.documentEpoch!==page.automation.captureDocumentEpoch()||current.id!==selection.documentId||current.url!==selection.url||current.x!==selection.viewport.scrollX||current.y!==selection.viewport.scrollY||current.w!==selection.viewport.width||current.h!==selection.viewport.height)throw Error('annotation_page_changed_select_again')
      const screenshotPath='browser-annotations/targets/'+targetId+'.png';file=this.files.resolve(chatId,screenshotPath)
      fs.mkdirSync(this.files.resolve(chatId,'browser-annotations/targets'),{recursive:true});fs.writeFileSync(file,png)
      const now=Date.now(),target=this.targets.create(chatId,{id:targetId,chatId,pageId,sessionId:session.id,selection,screenshotPath,comment:'',version:1,editorId:'',sequence:0,createdAt:now,updatedAt:now})
      this.files.emitChanged(chatId)
      return {...status,target}
    }catch(error){
      if(file)fs.rmSync(file,{force:true})
      if(this.sessions.get(pageId)!==session)return liveStatus()
      const retained=await wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:`(() => {const s=globalThis.__navoraAnnotations;if(!(${expected})||!(${captureOwned}))return false;s.phase="stale";return true})()`}]).catch(()=>false)
      if(!retained)return liveStatus()
      throw error
    }
    finally{await wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:`(() => {const s=globalThis.__navoraAnnotations;if(${captureOwned})s.hideForCapture(false,${JSON.stringify(captureId)})})()`}]).catch(()=>{});this.captures.delete(pageId);if(this.cancelRequested.has(pageId)){await wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:'globalThis.__navoraAnnotations?.stop()'}]).catch(()=>{});await this.finish(page)}}
  }
  update(chatId:string,id:string,revision:number,patch:{comment?:string;taskState?:BrowserAnnotation['taskState']}){
    const list=this.list(chatId),row=list.find(a=>a.id===id);if(!row)throw Error('annotation_not_found')
    if(row.revision!==revision)throw Error('annotation_revision_conflict')
    if(patch.comment!==undefined){if(typeof patch.comment!=='string'||patch.comment.length>4000)throw Error('invalid_annotation_comment');row.comment=patch.comment}
    if(patch.taskState!==undefined){if(!['draft','pending','review','resolved'].includes(patch.taskState))throw Error('invalid_annotation_state');row.taskState=patch.taskState}
    row.revision++;row.updatedAt=Date.now();this.write(chatId,list);return row
  }
  remove(chatId:string,id:string){
    const row=this.get(chatId,id)
    // Evidence attached to a message is immutable and remains available to that message.
    this.write(chatId,this.list(chatId).filter(a=>a.id!==id))
    const retained=fs.readdirSync(this.files.resolve(chatId,'browser-annotations')).some(name=>name.startsWith(row.id+'-r')&&name.endsWith('.json'))
    const file=this.files.resolve(chatId,row.screenshotPath);if(!retained&&fs.existsSync(file))fs.unlinkSync(file)
  }
  markReview(chatId:string,ids:Set<string>){
    const list=this.list(chatId);let changed=false
    for(const note of list){
      const key=[...ids].find(key=>key.startsWith(note.id+'-r'))
      if(!key||note.taskState!=='pending')continue
      try{const evidence=JSON.parse(fs.readFileSync(this.files.resolve(chatId,`browser-annotations/${key}.json`),'utf8'));if(evidence.comment!==note.comment)continue}catch{continue}
      note.taskState='review';note.updatedAt=Date.now();note.revision++;changed=true
    }
    if(changed)this.write(chatId,list)
  }
  async locate(chatId:string,id:string){
    const note=this.get(chatId,id),page=this.registry.assertWindowOwned(chatId,note.pageId).win
    if(page.activeOperations||page.manualControl)throw Error('browser_busy_finish_action_first')
    const expected=JSON.stringify(note.selection)
    const located=!!await page.webContents.executeJavaScriptInIsolatedWorld(WORLD,[{code:`(() => {
      const note=${expected};if(location.href!==note.url||!note.selector||note.kind!=='element')return false;
      const matches=document.querySelectorAll(note.selector);if(matches.length!==1)return false;
      const element=matches[0],text=(element.textContent||'').trim().slice(0,500);
      if(!note.text||text!==note.text)return false;
      element.scrollIntoView({block:'center',inline:'nearest'});
      const r=element.getBoundingClientRect(),marker=document.createElement('div');
      marker.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #477bb2;background:#477bb214';
      Object.assign(marker.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});
      document.documentElement.append(marker);setTimeout(()=>marker.remove(),1800);return true;
    })()`}])
    if(located)page.show()
    return located
  }
  async compare(chatId:string,id:string):Promise<BrowserAnnotationComparison>{
    const note=this.get(chatId,id),page=this.registry.assertWindowOwned(chatId,note.pageId).win
    const selection=JSON.stringify(note.selection)
    return await page.webContents.executeJavaScriptInIsolatedWorld(WORLD,[{code:`(() => {
      const note=${selection},currentUrl=location.href,currentTitle=document.title;
      let anchor=note.kind==='point'?'point':'region';
      if(note.kind==='element'){
        if(!note.selector)anchor='invalid-selector';
        else try{
          const matches=document.querySelectorAll(note.selector);
          if(matches.length===0)anchor='missing';
          else if(matches.length!==1)anchor='ambiguous';
          else {
            const element=matches[0],text=element.matches('input,textarea')?'':(element.textContent||'').trim().slice(0,500);
            anchor=note.text&&text!==note.text?'text-changed':'matched';
          }
        }catch{anchor='invalid-selector'}
      }
      return {currentUrl,currentTitle,urlChanged:currentUrl!==note.url,titleChanged:currentTitle!==note.title,anchor};
    })()`}]) as BrowserAnnotationComparison
  }
}
