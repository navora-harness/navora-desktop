import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {isUrlAllowed} from '../../shared/url-allowlist'
import type {WorkspaceFiles} from './workspace-files'

type PlanFetch=(url:string,init:RequestInit)=>Promise<Response>
function publicUrl(raw:unknown,allowlist:readonly string[]){
  if(typeof raw!=='string'||!raw.trim())throw Error('plan_read_url_required')
  const url=new URL(raw)
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('plan_read_url_invalid')
  if(!isUrlAllowed(url.href,[...allowlist]))throw Error('url_not_allowed')
  return url
}

/** A bounded public-document read, with no browser storage or caller-supplied credentials. */
export async function readPublicPlanUrl(raw:unknown,options:{allowlist:readonly string[];maxBytes:number;signal:AbortSignal;fetch:PlanFetch}){
  let url=publicUrl(raw,options.allowlist)
  const limit=Math.max(1,Math.min(524288,Math.floor(options.maxBytes)||524288))
  for(let hop=0;hop<=5;hop++){
    options.signal.throwIfAborted()
    const response=await options.fetch(url.href,{method:'GET',credentials:'omit',redirect:'manual',referrerPolicy:'no-referrer',headers:{Accept:'text/html,application/json,text/plain,application/xml;q=0.8,*/*;q=0.1'},signal:options.signal})
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');await response.body?.cancel()
      if(!location)throw Error('plan_read_redirect_missing_location')
      if(hop===5)throw Error('plan_read_redirect_limit')
      url=publicUrl(new URL(location,url).href,options.allowlist);continue
    }
    const contentType=response.headers.get('content-type')||''
    if(contentType&&!/^(?:text\/|application\/(?:json|[^;]+\+json|xml|[^;]+\+xml|xhtml\+xml))/i.test(contentType)){await response.body?.cancel();throw Error('plan_read_text_response_required')}
    const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let bytes=0,truncated=false
    if(reader)try{
      while(true){
        options.signal.throwIfAborted()
        const next=await reader.read();if(next.done)break
        const remaining=limit-bytes
        if(next.value.byteLength>remaining){chunks.push(next.value.subarray(0,remaining));bytes+=remaining;truncated=true;await reader.cancel();break}
        chunks.push(next.value);bytes+=next.value.byteLength
      }
    }finally{reader.releaseLock()}
    return{ok:true as const,url:url.href,status:response.status,contentType,body:Buffer.concat(chunks).toString('utf8'),bytes,truncated,credentials:'omitted',note:'公开资料 GET 读取，不运行网页脚本，不使用浏览器登录；任意网站的 GET 仍可能记录访问等服务端事件。'}
  }
  throw Error('plan_read_redirect_limit')
}

function assertNoLinks(root:string,directory:string){
  const relative=path.relative(root,directory)
  if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('plan_artifact_path_invalid')
  let current=root
  for(const segment of ['',...relative.split(path.sep).filter(Boolean)]){
    if(segment)current=path.join(current,segment)
    try{if(fs.lstatSync(current).isSymbolicLink())throw Error('plan_artifact_symlink_forbidden')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  }
}

/** The only planning-stage write: a fresh, host-named text artifact under this run. */
export function writePlanArtifact(files:WorkspaceFiles,chatId:string,runId:string,args:Record<string,unknown>,maxBytes:number,signal:AbortSignal){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(runId))throw Error('plan_artifact_run_required')
  if(Object.keys(args).some(key=>!['content','title'].includes(key)))throw Error('plan_artifact_arbitrary_path_forbidden')
  if(typeof args.content!=='string'||!args.content.trim())throw Error('plan_artifact_content_required')
  if(args.title!==undefined&&(typeof args.title!=='string'||args.title.length>120||/[\r\n\0]/.test(args.title)))throw Error('plan_artifact_title_invalid')
  const data=Buffer.from((args.title?'# '+String(args.title).trim()+'\n\n':'')+args.content,'utf8')
  if(data.length>Math.min(262144,Math.max(1,maxBytes)))throw Error('plan_artifact_too_large')
  signal.throwIfAborted()
  const workspace=files.chatRoot(chatId),directory=files.resolve(chatId,`plans/${runId}`)
  assertNoLinks(workspace,directory);fs.mkdirSync(directory,{recursive:true});assertNoLinks(workspace,directory)
  const relative=`plans/${runId}/plan-${randomUUID()}.md`,destination=files.resolve(chatId,relative)
  signal.throwIfAborted()
  const descriptor=fs.openSync(destination,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600)
  try{fs.writeFileSync(descriptor,data)}catch(error){fs.closeSync(descriptor);fs.unlinkSync(destination);throw error}
  fs.closeSync(descriptor);files.emitChanged(chatId)
  return{ok:true as const,path:relative,bytes:data.length,purpose:'plan-artifact',runId}
}
