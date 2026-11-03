import fs from 'node:fs'
import {randomUUID} from 'node:crypto'
import type {WorkspaceFiles} from './workspace-files'
import type {BrowserRegistry} from './browser-registry'
import type {BrowserAnnotation,BrowserSelection,BrowserAnnotationResult,BrowserAnnotationComparison} from '../../shared/browser-workspace'
import type {BrowserPage} from './browser-host'

const WORLD=1008
// Runs in a private isolated world. No preload or general IPC is exposed to the website.
const selectionSource=String.raw`(() => {
  const key='__navoraAnnotations';
  if(globalThis[key])globalThis[key].stop();
  const state={id:(globalThis.__navoraDocumentId ||= crypto.randomUUID()),selection:null,stop:null};globalThis[key]=state;
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:auto;cursor:crosshair';
  const root=host.attachShadow({mode:'closed'}),box=document.createElement('div');
  box.style.cssText='position:fixed;border:2px solid #477bb2;background:#477bb214;pointer-events:none';root.append(box);document.documentElement.append(host);
  let start=null,mode=MODE;
  const draw=r=>{Object.assign(box.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'})};
  const rect=(x,y,w,h)=>({x,y,width:w,height:h});
  const target=e=>{host.style.display='none';let el=document.elementFromPoint(e.clientX,e.clientY);host.style.display='';while(el?.shadowRoot){const inner=el.shadowRoot.elementFromPoint(e.clientX,e.clientY);if(!inner||inner===el)break;el=inner}return el};
  function move(e){if(mode==='region'&&start)draw(rect(Math.min(start.x,e.clientX),Math.min(start.y,e.clientY),Math.abs(start.x-e.clientX),Math.abs(start.y-e.clientY)));else if(mode==='element'){const el=target(e);if(el instanceof Element)draw(el.getBoundingClientRect())}}
  const block=e=>{e.preventDefault();e.stopImmediatePropagation()};
  function down(e){block(e);try{host.setPointerCapture(e.pointerId)}catch{}start={x:e.clientX,y:e.clientY}}
  function up(e){block(e);const el=target(e);if(!(el instanceof Element))return;
    const r=mode==='region'&&start?rect(Math.min(start.x,e.clientX),Math.min(start.y,e.clientY),Math.abs(start.x-e.clientX),Math.abs(start.y-e.clientY)):el.getBoundingClientRect();
    if(r.width<2||r.height<2)return;
    const path=[];let node=el;while(node&&node!==document.documentElement&&path.length<10){if(node.id){path.unshift('#'+CSS.escape(node.id));break}const parent=node.parentElement;if(!parent)break;path.unshift(node.localName+':nth-child('+(Array.from(parent.children).indexOf(node)+1)+')');node=parent}
    state.element=mode==='element'?el:null;
    state.selection={documentId:state.id,url:location.href,title:document.title,kind:mode,rect:rect(r.x,r.y,r.width,r.height),selector:mode==='element'?path.join(' > '):undefined,text:mode==='element'&&!el.matches('input,textarea')?(el.textContent||'').trim().slice(0,500):'',viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY,dpr:devicePixelRatio}};
    stop();document.addEventListener('click',block,{capture:true,once:true});setTimeout(()=>document.removeEventListener('click',block,true),150);
  }
  function keydown(e){if(e.key==='Escape'){block(e);state.cancelled=true;stop()}}
  function stop(){host.remove();for(const [name,fn] of handlers)document.removeEventListener(name,fn,true)}
  const handlers=[['pointermove',move],['pointerdown',down],['pointerup',up],['click',block],['keydown',keydown]];
  state.stop=stop;for(const [name,fn] of handlers)document.addEventListener(name,fn,true);
  return true;
})()`

export class BrowserAnnotationService {
  private captures=new Set<string>()
  private previousControl=new WeakMap<BrowserPage,boolean>()
  private watched=new WeakSet<BrowserPage>()
  private starting=new WeakSet<BrowserPage>()
  private finish(page:BrowserPage){
    const previous=this.previousControl.get(page)
    if(previous!==undefined)page.manualControl=previous
    this.previousControl.delete(page);page.annotationSelecting=false
    return page.manualControl
  }
  constructor(private registry:BrowserRegistry,private files:WorkspaceFiles){}
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
  async begin(chatId:string,pageId:string,kind:'element'|'region'){
    const page=this.registry.assertWindowOwned(chatId,pageId).win
    if(page.annotationSelecting||this.captures.has(pageId))throw Error('browser_busy_finish_action_first')
    if(page.activeOperations)throw Error('browser_busy_wait_for_current_action')
    if(!this.watched.has(page)){
      this.watched.add(page)
      page.webContents.on('did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace)this.finish(page)})
      page.webContents.on('render-process-gone',()=>this.finish(page))
    }
    this.previousControl.set(page,page.manualControl)
    this.starting.add(page)
    page.manualControl=true;page.annotationSelecting=true
    try{await page.webContents.executeJavaScriptInIsolatedWorld(WORLD,[{code:'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))).then(()=>'+selectionSource.replace('MODE',JSON.stringify(kind))+')'}])}
    catch(error){this.finish(page);throw error}finally{this.starting.delete(page)}
  }
  async cancel(chatId:string,pageId:string,resume=false){
    const page=this.registry.assertWindowOwned(chatId,pageId).win
    if(this.captures.has(pageId)||this.starting.has(page))throw Error('browser_busy_wait_for_current_action')
    await page.webContents.executeJavaScriptInIsolatedWorld(WORLD,[{code:'(() => {const s=globalThis.__navoraAnnotations;if(s){s.stop();s.selection=null;s.cancelled=true}})()'}]).catch(()=>{})
    this.finish(page);if(resume)page.manualControl=false
    return page.manualControl
  }
  async collect(chatId:string,pageId:string):Promise<BrowserAnnotationResult>{
    if(this.captures.has(pageId))return {}
    const page=this.registry.assertWindowOwned(chatId,pageId).win,wc=page.webContents
    if(!page.annotationSelecting)return {cancelled:true,manualControl:page.manualControl}
    const value=await wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:'(() => {const s=globalThis.__navoraAnnotations;return s?{selection:s.selection,cancelled:s.cancelled,id:s.id}:null})()'}]).catch(error=>{this.finish(page);throw error}) as {selection?:BrowserSelection;cancelled?:boolean;id:string}|null
    if(!page.annotationSelecting)return {cancelled:true,manualControl:page.manualControl}
    if(!value){this.finish(page);throw Error('annotation_page_changed_select_again')}
    if(value?.cancelled){return {cancelled:true,manualControl:await this.cancel(chatId,pageId)}}
    if(!value?.selection)return {}
    this.captures.add(pageId)
    let file:string|undefined
    try{
      const list=this.list(chatId);if(list.length>=200)throw Error('annotation_limit_200')
      const selection=value.selection
      await wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'}])
      const image=await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})
      if(image.isEmpty())throw Error('annotation_screenshot_empty')
      const png=image.toPNG();if(png.length>8*1024*1024)throw Error('annotation_image_too_large')
      const directory=this.files.resolve(chatId,'browser-annotations')
      const used=fs.existsSync(directory)?fs.readdirSync(directory).filter(name=>name.endsWith('.png')).reduce((sum,name)=>sum+fs.statSync(this.files.resolve(chatId,`browser-annotations/${name}`)).size,0):0
      if(used+png.length>100*1024*1024)throw Error('annotation_storage_limit_100MB')
      const current=await wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:'(() => {const s=globalThis.__navoraAnnotations,el=s?.element,r=el?.isConnected?el.getBoundingClientRect():null;return {id:s?.id,url:location.href,x:scrollX,y:scrollY,w:innerWidth,h:innerHeight,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,text:el&&!el.matches("input,textarea")?(el.textContent||"").trim().slice(0,500):""}})()'}])
      if(selection.kind==='element'&&(!current.rect||(['x','y','width','height'] as const).some(key=>Math.abs(current.rect[key]-selection.rect[key])>1)||current.text!==selection.text))throw Error('annotation_page_changed_select_again')
      if(current.id!==selection.documentId||current.url!==selection.url||current.x!==selection.viewport.scrollX||current.y!==selection.viewport.scrollY||current.w!==selection.viewport.width||current.h!==selection.viewport.height)throw Error('annotation_page_changed_select_again')
      const id=`ann_${randomUUID()}`,screenshotPath=`browser-annotations/${id}.png`
      file=this.files.resolve(chatId,screenshotPath)
      fs.mkdirSync(this.files.resolve(chatId,'browser-annotations'),{recursive:true});fs.writeFileSync(file,png)
      const now=Date.now(),annotation:BrowserAnnotation={id,chatId,pageId,sessionId:this.registry.assertWindowOwned(chatId,pageId).sessionId,selection,screenshotPath,comment:'',createdAt:now,updatedAt:now,revision:1,taskState:'draft',anchorState:'valid'}
      const latest=this.list(chatId);if(latest.length>=200)throw Error('annotation_limit_200')
      this.write(chatId,[...latest,annotation])
      await wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:'globalThis.__navoraAnnotations.selection=null'}]).catch(()=>{})
      return {annotation,manualControl:this.finish(page)}
    }catch(error){this.finish(page);if(file&&fs.existsSync(file))fs.unlinkSync(file);throw error}
    finally{this.captures.delete(pageId);page.annotationSelecting=false}
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
      let anchor='region';
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
