import {randomUUID} from 'node:crypto'

export const FETCH_SCOPE_HEADER='x-navora-internal-fetch-scope'
export type NetworkRequestIdentity={id:number;url:string;method:string;webContentsId?:number}
export type NetworkRequestOwner={chatId:string;pageId?:string;source?:'page'|'host'|'session-principal'}
export type NetworkScopeOptions={resolveOwner?:(sessionId:string,details:NetworkRequestIdentity)=>NetworkRequestOwner|null;isShared?:(sessionId:string)=>boolean}
type BoundScope=NetworkRequestOwner&{fetchId?:string}
type HostFetch={id:string;proof:string;sessionId:string;chatId:string;url:string;method:string;controller:AbortController;finished:boolean;requests:Set<string>}
type RequestState={sessionId:string;scope:BoundScope|null}

const keyOf=(sessionId:string,id:number)=>`${sessionId}\0${id}`
function normalizedUrl(raw:string){const url=new URL(raw);url.hash='';return url.href}

/** One-time host proof identifies explicit fetches; URL coincidence never does. */
export class BrowserNetworkScopes {
  private tokens=new Map<string,HostFetch>()
  private fetches=new Map<string,HostFetch>()
  private requests=new Map<string,RequestState>()
  private barriers=new Set<string>()

  constructor(private options:NetworkScopeOptions={}){}

  get scoped(){return typeof this.options.resolveOwner==='function'}
  isShared(sessionId:string){return this.options.isShared?.(sessionId)===true}
  hasDedicatedPrincipalContract(sessionId:string){return this.scoped&&this.options.isShared?.(sessionId)===false}
  isManaging(sessionId:string){return this.barriers.has(sessionId)}

  start(sessionId:string,details:NetworkRequestIdentity):{cancel:boolean;owner:NetworkRequestOwner|null}{
    if(this.barriers.has(sessionId))return{cancel:true,owner:null}
    const key=keyOf(sessionId,details.id),existing=this.requests.get(key)
    if(existing)return{cancel:false,owner:existing.scope}
    let owner:NetworkRequestOwner|null=null
    try{
      const resolved=this.options.resolveOwner?.(sessionId,details)
      if(resolved?.source==='session-principal'){
        if(this.hasDedicatedPrincipalContract(sessionId)&&(details.webContentsId===undefined||details.webContentsId<0))owner={...resolved,source:'session-principal'}
      }else if(resolved&&Number.isSafeInteger(details.webContentsId)&&Number(details.webContentsId)>0)owner={...resolved,source:'page'}
    }catch{/* A destroyed/unknown source has no chat authority. */}
    this.requests.set(key,{sessionId,scope:owner})
    return{cancel:false,owner}
  }

  beforeHeaders(sessionId:string,details:NetworkRequestIdentity,headers:Record<string,string>):{cancel:boolean;owner:NetworkRequestOwner|null}{
    const proofs=Object.entries(headers).filter(([name])=>name.toLowerCase()===FETCH_SCOPE_HEADER)
    for(const [name] of proofs)delete headers[name]
    if(this.barriers.has(sessionId))return{cancel:true,owner:null}
    const key=keyOf(sessionId,details.id)
    let state=this.requests.get(key)
    if(!state){this.start(sessionId,details);state=this.requests.get(key)!}
    if(proofs.length){
      if(proofs.length!==1){for(const [,token] of proofs)this.tokens.delete(token);return{cancel:true,owner:null}}
      const token=proofs[0]![1],host=this.tokens.get(token)
      this.tokens.delete(token)
      if(!host){
        // Chromium may restore the caller's original headers on redirect. A
        // consumed proof can only match its already-bound native request ID;
        // it never authorizes another request or changes chat ownership.
        const bound=state.scope?.fetchId?this.fetches.get(state.scope.fetchId):undefined
        if(!bound||bound.proof!==token||!bound.requests.has(key)||bound.controller.signal.aborted)return{cancel:true,owner:null}
      }else{
        if(host.sessionId!==sessionId||host.controller.signal.aborted||host.finished||host.url!==normalizedUrl(details.url)||host.method!==details.method.toUpperCase()||state.scope&&state.scope.chatId!==host.chatId)return{cancel:true,owner:null}
        state.scope={chatId:host.chatId,fetchId:host.id,source:'host'};host.requests.add(key)
      }
    }
    const host=state.scope?.fetchId?this.fetches.get(state.scope.fetchId):undefined
    if(state.scope?.fetchId&&(!host||host.controller.signal.aborted))return{cancel:true,owner:null}
    return{cancel:false,owner:state.scope}
  }

  finish(sessionId:string,id:number){
    const key=keyOf(sessionId,id),state=this.requests.get(key)
    this.requests.delete(key)
    const host=state?.scope?.fetchId?this.fetches.get(state.scope.fetchId):undefined
    if(host){host.requests.delete(key);if(host.finished&&!host.requests.size)this.fetches.delete(host.id)}
  }

  async withFetchScope<T>(sessionId:string,chatId:string,url:string,method:string,signal:AbortSignal|undefined,action:(headers:Record<string,string>,signal:AbortSignal)=>Promise<T>):Promise<T>{
    if(!chatId)throw Error('network_scope_required')
    if(this.barriers.has(sessionId))throw Error('shared_session_management_busy')
    if(signal?.aborted)throw Error('aborted')
    const controller=new AbortController(),id=randomUUID(),token=randomUUID()
    const host:HostFetch={id,proof:token,sessionId,chatId,url:normalizedUrl(url),method:method.toUpperCase(),controller,finished:false,requests:new Set()}
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true})
    this.tokens.set(token,host);this.fetches.set(id,host)
    try{return await action({[FETCH_SCOPE_HEADER]:token},controller.signal)}
    finally{
      signal?.removeEventListener('abort',abort);this.tokens.delete(token);host.finished=true
      if(!host.requests.size)this.fetches.delete(id)
    }
  }

  /** Abort host fetches and wait for native terminal events, never fake a drain. */
  async withManagement<T>(sessionId:string,signal:AbortSignal|undefined,action:()=>Promise<T>,timeoutMs=3000):Promise<T>{
    if(this.barriers.has(sessionId))throw Error('shared_session_management_busy')
    if(signal?.aborted)throw Error('aborted')
    this.barriers.add(sessionId)
    try{
      for(const host of this.fetches.values())if(host.sessionId===sessionId)host.controller.abort()
      const deadline=Date.now()+Math.max(1,timeoutMs)
      while([...this.fetches.values()].some(host=>host.sessionId===sessionId)||[...this.requests.values()].some(request=>request.sessionId===sessionId)){
        if(signal?.aborted)throw Error('aborted')
        if(Date.now()>=deadline)throw Error('shared_session_network_drain_unconfirmed')
        await new Promise(resolve=>setTimeout(resolve,10))
      }
      if(signal?.aborted)throw Error('aborted')
      return await action()
    }finally{this.barriers.delete(sessionId)}
  }

  cancelChat(sessionId:string,chatId:string){for(const host of this.fetches.values())if(host.sessionId===sessionId&&host.chatId===chatId)host.controller.abort()}

  dispose(sessionId:string){
    for(const [token,host] of this.tokens)if(host.sessionId===sessionId)this.tokens.delete(token)
    for(const [id,host] of this.fetches)if(host.sessionId===sessionId){host.controller.abort();this.fetches.delete(id)}
    for(const [key,request] of this.requests)if(request.sessionId===sessionId)this.requests.delete(key)
  }
}
