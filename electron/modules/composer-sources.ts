import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import type {IpcMainInvokeEvent} from 'electron'
import type {WorkspaceFiles} from './workspace-files'
import type {BrowserRegistry} from './browser-registry'
import type {BrowserAnnotationService} from './browser-annotations'
import type {ComposerContextSource} from '../../shared/composer-document'
import type {ComposerExcerpt,ComposerExcerptInput,ComposerImportFile,ComposerImportedFile} from '../../shared/composer-sources'

export type ComposerSourceCaller={kind:'main'|'remote'}|{kind:'host';hostId:string}|{kind:'denied'}
type Options={files:WorkspaceFiles;registry:BrowserRegistry;chatExists:(chatId:string)=>boolean;caller:(event:IpcMainInvokeEvent|null)=>ComposerSourceCaller;annotations?:()=>Pick<BrowserAnnotationService,'get'>|undefined}
const ITEM_LIMIT=12*1024*1024,TOTAL_LIMIT=32*1024*1024,TEXT_LIMIT=80000
const digest=(text:string)=>createHash('sha256').update(text).digest('hex')
const fileVersion=(stat:{mtimeMs:number;size:number})=>`${stat.mtimeMs}:${stat.size}`
function safeName(input:string){
  let name=path.posix.basename(input.replace(/\\/g,'/')).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g,'_').replace(/[. ]+$/,'').slice(0,120)
  if(!name||name==='.'||name==='..')name='附件'
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='附件-'+name
  return name
}
function detectedMime(bytes:Buffer,fallback:string){
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png'
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg'
  if(/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii')))return 'image/gif'
  if(bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp'
  if(bytes.subarray(0,2).toString('ascii')==='BM')return 'image/bmp'
  if(bytes.subarray(0,5).toString('ascii')==='%PDF-')return 'application/pdf'
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(fallback)?fallback.toLowerCase():'application/octet-stream'
}
const imageExtensions:Record<string,string>={'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp','image/bmp':'.bmp'}
function checkedRange(input:ComposerExcerptInput['range']){
  if(input===undefined)return undefined
  if(!input||typeof input!=='object')throw Error('invalid_composer_range')
  const result:NonNullable<ComposerExcerptInput['range']>={}
  for(const key of ['startLine','endLine','pageStart','pageEnd'] as const){if(input[key]!==undefined){if(!Number.isSafeInteger(input[key])||input[key]!<1)throw Error('invalid_composer_range');result[key]=input[key]}}
  if(result.startLine&&result.endLine&&result.startLine>result.endLine||result.pageStart&&result.pageEnd&&result.pageStart>result.pageEnd)throw Error('invalid_composer_range')
  if(input.selector!==undefined){if(typeof input.selector!=='string'||input.selector.length>2048)throw Error('invalid_composer_range');result.selector=input.selector}
  return result
}
function lines(text:string,range:ComposerExcerptInput['range']){
  if(!range?.startLine&&!range?.endLine)return text
  const all=text.split(/\r?\n/),start=range.startLine||1,end=range.endLine||all.length
  if(start>all.length)throw Error('composer_excerpt_range_unavailable')
  return all.slice(start-1,Math.min(end,all.length)).join('\n')
}

/** Read-only extraction never navigates a page or changes automation ownership.
 * Every imported byte is copied into the owning conversation's workspace. */
export function createComposerSources(options:Options){
  const {files,registry}=options
  function authorize(event:IpcMainInvokeEvent|null,chatId:string,pageId?:string){
    if(typeof chatId!=='string'||!options.chatExists(chatId))throw Error('chat_not_found')
    const caller=options.caller(event)
    if(caller.kind==='denied')throw Error('composer_ui_only')
    if(caller.kind==='host'){
      const host=registry.hosts.getHost(caller.hostId)
      if(!host||host.window.isDestroyed()||!registry.hosts.hostPages(host.id).some(id=>registry.hosts.pages.get(id)?.chatId===chatId))throw Error('composer_context_wrong_chat')
      if(pageId&&registry.hosts.pages.get(pageId)?.hostId!==host.id)throw Error('browser_page_wrong_host')
    }
    if(pageId){const page=registry.getWindowRecord(pageId);if(!page||page.chatId!==chatId||page.win.isDestroyed())throw Error('composer_source_missing')}
    return caller
  }
  async function importContextFiles(event:IpcMainInvokeEvent|null,chatId:string,inputs:ComposerImportFile[]):Promise<ComposerImportedFile[]>{
    authorize(event,chatId)
    if(!Array.isArray(inputs)||!inputs.length||inputs.length>20)throw Error('invalid_composer_files')
    let total=0
    const prepared=inputs.map(input=>{
      if(!input||typeof input.name!=='string'||input.name.length>1024||typeof input.mime!=='string'||input.mime.length>120||typeof input.base64!=='string'||!input.base64||input.base64.length>Math.ceil(ITEM_LIMIT/3)*4+4||input.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw Error('invalid_composer_file')
      const data=Buffer.from(input.base64,'base64');if(!data.length||data.length>ITEM_LIMIT)throw Error('composer_file_too_large')
      if(data.toString('base64')!==input.base64)throw Error('invalid_composer_file')
      total+=data.length;if(total>TOTAL_LIMIT)throw Error('composer_files_too_large')
      const mime=detectedMime(data,input.mime),imageExtension=imageExtensions[mime]
      let name=safeName(input.name)
      if(imageExtension&&!new Set(mime==='image/jpeg'?['.jpg','.jpeg']:[imageExtension]).has(path.extname(name).toLowerCase()))name=name.replace(/\.[^.]*$/,'')+imageExtension
      return {data,mime,name,relative:`attachments/context/${randomUUID()}-${name}`,image:!!imageExtension}
    })
    const written:string[]=[],result:ComposerImportedFile[]=[]
    try{
      for(const item of prepared){
        authorize(event,chatId)
        await files.writeBytes(chatId,item.relative,item.data);written.push(item.relative)
        const stat=await files.stat(chatId,item.relative)
        const source:ComposerContextSource={kind:item.image?'image':'file',identity:item.relative,chatId,path:item.relative,mimeType:item.mime}
        result.push({path:item.relative,name:item.name,mime:item.mime,size:stat.size,sourceVersion:fileVersion(stat),source})
      }
      authorize(event,chatId);return result
    }catch(error){
      for(const relative of written){try{const absolute=files.resolve(chatId,relative);await fs.unlink(absolute)}catch{/* Roll back only files created by this request. */}}
      if(written.length)files.emitChanged(chatId)
      throw error
    }
  }
  async function fileExcerpt(event:IpcMainInvokeEvent|null,chatId:string,input:ComposerExcerptInput):Promise<ComposerExcerpt>{
    if(typeof input.path!=='string'||!input.path||input.path.length>2048||path.isAbsolute(input.path)||path.win32.isAbsolute(input.path)||/[\u0000-\u001f]/.test(input.path))throw Error('invalid_composer_source_path')
    const range=checkedRange(input.range),absolute=await files.resolveExisting(chatId,input.path),before=await fs.stat(absolute)
    if(!before.isFile())throw Error('composer_source_not_file')
    const relative=files.toRel(chatId,absolute),preview=await files.preview(chatId,relative),after=await fs.stat(await files.resolveExisting(chatId,relative))
    authorize(event,chatId)
    if(fileVersion(before)!==fileVersion(after))throw Error('composer_source_changed')
    const source:ComposerContextSource={kind:preview.kind==='image'?'image':'file',identity:relative,chatId,path:relative,...(preview.mime?{mimeType:preview.mime}:{})}
    const result:ComposerExcerpt={kind:'file',label:path.basename(relative),text:'',source,sourceVersion:fileVersion(after),truncated:false,...(range?{range}:{})}
    if(range?.pageStart||range?.pageEnd){return {...result,referenceOnly:true,reason:'保留文件与页码引用；当前未提取 PDF 正文。'}}
    if(range?.selector)return {...result,referenceOnly:true,reason:'该文件未提供结构化范围提取；可改用行号或文件引用。'}
    if(preview.kind==='image'){return {...result,referenceOnly:true,reason:'图片作为引用加入，可在资料块内编辑说明。',...(preview.base64&&preview.base64.length<700000?{thumbnail:{mime:preview.mime||'image/png',base64:preview.base64}}:{})}}
    if(preview.kind!=='text'&&preview.kind!=='markdown')return {...result,referenceOnly:true,reason:'该格式暂不支持正文摘录，可作为文件引用加入。'}
    let text:string
    try{text=lines(preview.content||'',range)}catch(error){if(preview.truncated)return {...result,referenceOnly:true,reason:'所选行超出文本预览范围，请缩小范围或引用文件。'};throw error}
    return {...result,text:text.slice(0,TEXT_LIMIT),truncated:!!preview.truncated||text.length>TEXT_LIMIT}
  }
  async function pageExcerpt(event:IpcMainInvokeEvent|null,chatId:string,input:ComposerExcerptInput):Promise<ComposerExcerpt>{
    if(typeof input.pageId!=='string'||!input.pageId)throw Error('invalid_composer_page')
    authorize(event,chatId,input.pageId)
    const record=registry.getWindowRecord(input.pageId)!,page=record.win,wc=page.webContents,epoch=page.automation.captureDocumentEpoch(),range=checkedRange(input.range)
    if(page.annotationSelecting||page.automation.isBusy())throw Error('composer_source_busy')
    if(range?.pageStart||range?.pageEnd){const url=record.desiredUrl||record.url,label=record.title||'网页';return {kind:'page',label,text:'',source:{kind:'page',identity:page.id,chatId,url,browserRef:{kind:'window',sessionId:record.sessionId,windowId:page.id,label,url}},sourceVersion:`page:${page.id}:${epoch}:reference`,range,truncated:false,referenceOnly:true,reason:'保留页面与页码引用；当前未提取 PDF 正文。'}}
    const argument=JSON.stringify({selection:!!input.selection,selector:range?.selector||'',max:TEXT_LIMIT+1})
    const code=`(()=>{const options=${argument};let node=document.body;let text='';if(options.selection){const active=document.activeElement;if(active&&(active.tagName==='TEXTAREA'||active.tagName==='INPUT'&&active.type!=='password')&&typeof active.selectionStart==='number')text=String(active.value||'').slice(active.selectionStart,active.selectionEnd);else text=String(getSelection()?.toString()||'');}else{if(options.selector){try{node=document.querySelector(options.selector)}catch{throw Error('invalid_composer_selector')}if(!node)throw Error('composer_source_missing')}text=String(node?('innerText' in node?node.innerText||'':node.textContent||''):'')}return {text:text.slice(0,options.max),url:location.href,title:document.title||location.hostname};})()`
    let timeout:ReturnType<typeof setTimeout>|undefined
    const extracted=await Promise.race([wc.executeJavaScriptInIsolatedWorld(1006,[{code}]),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('composer_source_timeout')),8000)})]).finally(()=>clearTimeout(timeout)) as {text?:unknown;url?:unknown;title?:unknown}
    authorize(event,chatId,input.pageId)
    if(page.isDestroyed()||epoch!==page.automation.captureDocumentEpoch())throw Error('composer_source_changed')
    const raw=typeof extracted.text==='string'?extracted.text:'',url=typeof extracted.url==='string'?extracted.url:record.url,label=(typeof extracted.title==='string'?extracted.title:record.title)||'网页'
    if(input.selection&&!raw.trim())throw Error('composer_page_selection_empty')
    const text=lines(raw,range),source:ComposerContextSource={kind:'page',identity:page.id,chatId,url,browserRef:{kind:'window',sessionId:record.sessionId,windowId:page.id,label,url}}
    const result:ComposerExcerpt={kind:'page',label,text:text.slice(0,TEXT_LIMIT),source,sourceVersion:`page:${page.id}:${epoch}:${digest(url+'\n'+text)}`,truncated:raw.length>TEXT_LIMIT,...(range?{range}:{})}
    if(!input.capture)return result
    const host=registry.hosts.getHost(page.hostId||'')
    if(!host||host.active!==page.id)throw Error('composer_capture_active_page_only')
    let rect:Electron.Rectangle|undefined
    if(input.rect){const r=input.rect;if(!['x','y','width','height'].every(key=>typeof r[key as keyof typeof r]==='number'&&Number.isFinite(r[key as keyof typeof r]))||r.x<0||r.y<0||r.width<1||r.height<1||r.width>7680||r.height>4320)throw Error('invalid_composer_capture_rect');rect={x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}}
    const image=await wc.capturePage(rect,{stayHidden:true,stayAwake:false})
    authorize(event,chatId,input.pageId)
    if(page.isDestroyed()||epoch!==page.automation.captureDocumentEpoch())throw Error('composer_source_changed')
    if(image.isEmpty())throw Error('composer_capture_unavailable')
    const png=image.toPNG();if(png.length>ITEM_LIMIT)throw Error('composer_file_too_large')
    const file=(await importContextFiles(event,chatId,[{name:`网页截图-${Date.now()}.png`,mime:'image/png',base64:png.toString('base64')}]))[0]!
    const size=image.getSize(),scale=Math.min(1,512/Math.max(size.width,size.height)),thumbnail=image.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale))})
    return {...result,file,thumbnail:{mime:'image/png',base64:thumbnail.toPNG().toString('base64')}}
  }
  async function annotationExcerpt(event:IpcMainInvokeEvent|null,chatId:string,input:ComposerExcerptInput):Promise<ComposerExcerpt>{
    if(typeof input.annotationId!=='string'||!/^ann_[\w-]{1,100}$/.test(input.annotationId))throw Error('invalid_composer_annotation')
    const service=options.annotations?.();if(!service)throw Error('composer_annotation_unavailable')
    const note=service.get(chatId,input.annotationId)
    if(note.chatId!==chatId)throw Error('composer_context_wrong_chat')
    const source:ComposerContextSource={kind:'annotation',identity:note.id,chatId,url:note.selection.url,browserRef:{kind:'annotation',sessionId:note.sessionId,windowId:note.pageId,annotationId:note.id,annotationRevision:note.revision,label:note.comment.slice(0,120)||note.selection.title,url:note.selection.url}}
    let thumbnail:ComposerExcerpt['thumbnail']
    if(note.screenshotPath){try{const preview=await files.preview(chatId,note.screenshotPath);if(preview.kind==='image'&&preview.base64&&preview.base64.length<700000)thumbnail={mime:preview.mime||'image/png',base64:preview.base64}}catch{/* The comment remains usable if its old thumbnail is missing. */}}
    authorize(event,chatId)
    const text=[note.comment,note.selection.text].filter(Boolean).join('\n\n')
    return {kind:'annotation',label:note.selection.title||'页面批注',text:text.slice(0,TEXT_LIMIT),source,sourceVersion:`annotation:${note.id}:${note.revision}`,truncated:text.length>TEXT_LIMIT,...(thumbnail?{thumbnail}:{})}
  }
  async function contextExcerpt(event:IpcMainInvokeEvent|null,chatId:string,input:ComposerExcerptInput):Promise<ComposerExcerpt>{
    authorize(event,chatId)
    if(!input||typeof input!=='object')throw Error('invalid_composer_source')
    if(input.kind==='file')return fileExcerpt(event,chatId,input)
    if(input.kind==='page')return pageExcerpt(event,chatId,input)
    if(input.kind==='annotation')return annotationExcerpt(event,chatId,input)
    throw Error('invalid_composer_source')
  }
  return {importContextFiles,contextExcerpt}
}
