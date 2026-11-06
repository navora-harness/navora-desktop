/// <reference lib="dom" />
import type { WebContents, WebFrameMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { classifyPageBlocker, type PageBlockerProbe, type PageBlockerSummaryV1 } from '../../shared/page-blocker'

const WORLD = 17017
type Sample = { probes: PageBlockerProbe[]; frames: { url: string; visible: boolean; foreground: boolean; blocking: boolean }[]; partial: boolean; transparent?:boolean; layout: string }
type Cache = { generation: string; probeUsed: boolean; summary: PageBlockerSummaryV1 }
const cache = new WeakMap<WebContents, Cache>()

/** Fixed host probe: no clicks, focus, scrolling, network, text values or tokens. */
export function pageBlockerProbeScript(): string {
  return `(${function () {
    const width = innerWidth, height = innerHeight
    const verification = /(?:verify.{0,30}(?:human|identity)|(?:i.?m|i am|you are) not a robot|human verification|security verification|完成.{0,12}(?:人机|安全|身份)验证|确认此网页操作行为确实出自您本人|验证您是真人|请.{0,12}(?:本人|人机验证|验证码))/i
    const challenge = /captcha|turnstile|recaptcha|hcaptcha|geetest|arkose|px-captcha|challenge/i
    const candidates = Array.from(document.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"],[id*="captcha" i],[class*="captcha" i],[id*="challenge" i],[class*="challenge" i],main,form,body'))
    const frames = Array.from(document.querySelectorAll('iframe,frame'))
    const visible = (element: Element) => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect()
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) <= .02 || rect.width < 2 || rect.height < 2 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= width || rect.top >= height) return false
      return !!element.checkVisibility?.({checkOpacity:true,checkVisibilityCSS:true})
    }
    const foreground = (element: Element) => {
      const rect = element.getBoundingClientRect()
      const left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(width-1, rect.right), bottom = Math.min(height-1, rect.bottom)
      return [[.5,.5],[.25,.25],[.75,.75]].some(([x,y]) => {
        const hit = document.elementFromPoint(left+(right-left)*x!, top+(bottom-top)*y!)
        return !!hit && (hit === element || element.contains(hit))
      })
    }
    const probes: {verificationText:boolean;challengeControl:boolean;suspectedFrame:boolean;blockingContainer:boolean;foreground:boolean;visible:boolean;kind:string;partial:boolean}[] = []
    for (const element of candidates.slice(0,64)) {
      if (!visible(element)) continue
      const text = ((element as HTMLElement).innerText || '').slice(0,6000)
      const verificationText = verification.test(text)
      const controls = Array.from(element.querySelectorAll('button,input,[role="checkbox"],iframe,[role="button"]')).slice(0,64)
      const challengeControl = controls.some(control => visible(control) && foreground(control) && (challenge.test(control.id+' '+control.className+' '+control.getAttribute('title')+' '+control.getAttribute('aria-label')) || verification.test(control.textContent || '') || verificationText&&control.matches('iframe')))
      const ownChallenge = challenge.test(element.id+' '+element.className) && controls.some(control=>visible(control)&&foreground(control))
      const style = getComputedStyle(element), rect = element.getBoundingClientRect()
      const modal = element.matches('dialog[open],[aria-modal="true"],[role="dialog"]') || ['fixed','absolute'].includes(style.position) && rect.width*rect.height > width*height*.12
      const verificationPage = verificationText && (challengeControl || ownChallenge) && text.length < 4500
      const password=element.querySelector('input[type="password"]')
      const login = !verificationText && !!password && visible(password) && foreground(password) && (modal || text.length<4500&&/sign in|log in|登录|登入/i.test(text))
      const cookie = !verificationText && modal && /cookie|cookies|隐私|同意/i.test(text)
      const kind = verificationText || ownChallenge ? 'human_verification' : login ? 'login_required' : cookie ? 'site_dialog' : modal ? 'other_overlay' : 'unknown'
      if (verificationText || ownChallenge || modal || login) probes.push({verificationText,challengeControl:challengeControl || ownChallenge || login || cookie || modal&&controls.some(control=>visible(control)&&foreground(control)), suspectedFrame:false, blockingContainer:modal || verificationPage || login,foreground:foreground(element),visible:true,kind,partial:false})
    }
    const frameResults = frames.slice(0,64).map(element => {
      const rect=element.getBoundingClientRect(), style=getComputedStyle(element)
      return {url:(element as HTMLIFrameElement).src || '',visible:visible(element),foreground:visible(element)&&foreground(element),blocking:['fixed','absolute'].includes(style.position)||rect.width*rect.height>width*height*.12}
    })
    const transparent=[[.5,.5],[.25,.25],[.75,.75]].some(([x,y])=>{
      const hit=document.elementFromPoint(width*x!,height*y!)
      if(!hit)return false
      const style=getComputedStyle(hit),rect=hit.getBoundingClientRect()
      return Number(style.opacity)<=.02&&style.pointerEvents!=='none'&&rect.width*rect.height>width*height*.12
    })
    let geometry=0
    for(const element of [...candidates.slice(0,64),...frames.slice(0,64)]){
      const rect=element.getBoundingClientRect()
      for(const value of [rect.x,rect.y,rect.width,rect.height])geometry=(geometry*31+Math.round(value))|0
    }
    return {probes,frames:frameResults,partial:candidates.length>64||frames.length>64||transparent,transparent,layout:width+'x'+height+':'+scrollX+':'+scrollY+':'+geometry}
  }.toString()})()`
}

async function deadline<T>(action: Promise<T>, end: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([action,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('BLOCKER_PROBE_TIMEOUT')),Math.max(1,end-Date.now()))})]) }
  finally { if(timer)clearTimeout(timer) }
}

function validSample(raw: unknown): raw is Sample {
  return !!raw && typeof raw === 'object' && Array.isArray((raw as Sample).probes) && Array.isArray((raw as Sample).frames) && typeof (raw as Sample).layout === 'string'
}

export type PageBlockerObserverContext = {chatId:string;windowId:string;documentEpoch:number;controlEpoch:number;nativeSnapshot?:unknown}
export async function observePageBlocker(wc: WebContents, context: PageBlockerObserverContext): Promise<PageBlockerSummaryV1> {
  const end=Date.now()+1500, reasonCodes:string[]=[], probes:PageBlockerProbe[]=[]
  let partial=false, available=false, omittedFrames=0, layout='unavailable'
  const previous=cache.get(wc)
  try {
    const raw:unknown=await deadline(wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:pageBlockerProbeScript()}],false),end)
    if(!validSample(raw))throw Error('BLOCKER_PROBE_UNAVAILABLE')
    available=true; partial=raw.partial; layout=raw.layout
    if(raw.partial)reasonCodes.push(raw.transparent?'TRANSPARENT_FOREGROUND':'CANDIDATE_BUDGET')
    probes.push(...raw.probes.slice(0,64).map(probe=>({...probe,processId:wc.mainFrame.processId,routingId:wc.mainFrame.routingId})))
    const visible=raw.frames.filter(frame=>frame.visible)
    let children:WebFrameMain[]=[]
    try{children=wc.mainFrame.framesInSubtree.filter(frame=>frame!==wc.mainFrame)}catch{partial=true;reasonCodes.push('FRAME_ENUMERATION_UNAVAILABLE')}
    const selected=visible.slice(0,8)
    omittedFrames=Math.max(0,visible.length-selected.length)
    if(omittedFrames){partial=true;reasonCodes.push('FRAME_BUDGET')}
    for(const candidate of selected){
      const matches=children.filter(frame=>{try{return frame.url===candidate.url&&!frame.isDestroyed()}catch{return false}})
      // An ambiguous/nested frame cannot establish top-level foreground visibility.
      const frame=matches.length===1?matches[0]:undefined
      if(!frame||frame.parent!==wc.mainFrame){partial=true;omittedFrames++;reasonCodes.push('FRAME_VISIBILITY_UNAVAILABLE');continue}
      try{
        const child=await deadline(frame.executeJavaScript(pageBlockerProbeScript(),false),end)
        if(!validSample(child))throw Error('FRAME_PROBE_UNAVAILABLE')
        if(child.partial||child.frames.some(item=>item.visible)){partial=true;reasonCodes.push('NESTED_FRAME_COVERAGE')}
        probes.push(...child.probes.slice(0,64).map(probe=>({...probe,foreground:probe.foreground&&candidate.foreground,blockingContainer:probe.blockingContainer&&candidate.foreground,processId:frame.processId,routingId:frame.routingId})))
      }catch{partial=true;omittedFrames++;reasonCodes.push('FRAME_PROBE_UNAVAILABLE')}
      if(/captcha|challenge|turnstile|arkose|geetest/i.test(candidate.url))probes.push({verificationText:false,challengeControl:false,suspectedFrame:true,blockingContainer:candidate.blocking,foreground:candidate.foreground,visible:true,kind:'human_verification',partial:true})
    }
  }catch(error){partial=true;reasonCodes.push(error instanceof Error&&error.message==='BLOCKER_PROBE_TIMEOUT'?'PROBE_TIMEOUT':'PROBE_UNAVAILABLE')}
  const snapshot=context.nativeSnapshot as {complete?:boolean;truncated?:boolean;frames?:{processId?:number;routingId?:number;documentId?:number;status:string;reason?:string}[];truncationReasons?:string[]}|undefined
  if(snapshot&&(snapshot.truncated||snapshot.complete===false||snapshot.frames?.some(frame=>frame.status!=='covered'))){
    partial=true;reasonCodes.push('NATIVE_COVERAGE_PARTIAL')
    if(snapshot.truncationReasons?.includes('MAX_NODES'))reasonCodes.push('MAX_NODES')
  }
  const generation=JSON.stringify([context.documentEpoch,layout,probes.map(probe=>[probe.kind,probe.visible,probe.foreground,probe.blockingContainer,probe.verificationText,probe.challengeControl,probe.suspectedFrame])])
  let classified=classifyPageBlocker(probes,available,partial)
  if(snapshot?.frames)classified.evidence=classified.evidence.map(evidence=>{
    const frame=snapshot.frames!.find(frame=>frame.processId===evidence.processId&&frame.routingId===evidence.routingId)
    return typeof frame?.documentId==='number'?{...evidence,documentId:frame.documentId}:evidence
  })
  let probeUsed=previous?.generation===generation&&previous.probeUsed||false
  // Exactly one extra targeted host read per stable candidate generation. Never retry a challenge action.
  if(classified.state==='suspected'&&!probeUsed&&Date.now()<end-150){
    probeUsed=true
    try{
      const followup:unknown=await deadline(wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:pageBlockerProbeScript()}],false),end)
      if(validSample(followup))classified=classifyPageBlocker([...followup.probes,...probes.filter(probe=>probe.processId!==wc.mainFrame.processId||probe.routingId!==wc.mainFrame.routingId)],true,partial||followup.partial)
    }catch{reasonCodes.push('FOLLOWUP_UNAVAILABLE')}
    if(classified.state==='suspected'){classified={...classified,state:'unknown',requiresUser:false};reasonCodes.push('UNCONFIRMED_AFTER_PROBE')}
  }else if(classified.state==='suspected'&&probeUsed){classified={...classified,state:'unknown',requiresUser:false};reasonCodes.push('UNCONFIRMED_AFTER_PROBE')}
  const priorBlock=previous?.summary.state==='confirmed'?previous.summary.observedAt:previous?.summary.previouslyBlockedAt
  const summary:PageBlockerSummaryV1={version:1,chatId:context.chatId,windowId:context.windowId,webContentsId:wc.id,documentEpoch:context.documentEpoch,controlEpoch:context.controlEpoch,observedAt:Date.now(),observationId:randomUUID(),layoutRevision:layout,...classified,coverage:!available?'unavailable':partial?'partial':'complete_for_scope',scope:'visible_viewport',reasonCodes:[...new Set(reasonCodes)].slice(0,8),omittedFrames,truncated:partial,evidence:classified.evidence,followup:classified.requiresUser?'user_handoff':'none',probeUsed,...(priorBlock?{previouslyBlockedAt:priorBlock,...(classified.state==='not_observed'?{clearedAt:Date.now()}:{})}:{})}
  cache.set(wc,{generation,probeUsed,summary})
  return summary
}
