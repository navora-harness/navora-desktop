import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {browserAddress} from '../../shared/browser-workspace'
import type {BrowserQuickLink,BrowserVisit,BrowserStartState} from '../../shared/browser-start'

/** Shared quick links, conversation-scoped history, no network requests on the start page. */
export class BrowserStartStore{
  private links:BrowserQuickLink[]=[]
  private history:BrowserVisit[]=[]
  private timer:ReturnType<typeof setTimeout>|undefined
  onChanged?:(chatId?:string)=>void
  constructor(private file:string){
    if(!fs.existsSync(file))return
    try{
      if(fs.statSync(file).size>4000000)throw Error('browser_start_store_invalid')
      const saved=JSON.parse(fs.readFileSync(file,'utf8'))
      if(!Array.isArray(saved.links)||!Array.isArray(saved.history))throw Error('browser_start_store_invalid')
      this.links=saved.links.slice(0,12).flatMap((row:BrowserQuickLink)=>{try{if(typeof row.id!=='string'||!/^[a-z\d-]{1,80}$/i.test(row.id))return [];return [{id:row.id,...this.link(row)}]}catch{return []}})
      this.history=saved.history.slice(0,200).flatMap((row:BrowserVisit)=>{try{if(typeof row.chatId!=='string'||!row.chatId||row.chatId.length>120||!Number.isSafeInteger(row.visitedAt))return [];return [{chatId:row.chatId,...this.link(row),visitedAt:row.visitedAt}]}catch{return []}})
    }catch{
      // Preserve unreadable settings before allowing a new start-page record.
      fs.renameSync(file,file+'.corrupt-'+randomUUID())
    }
  }
  private link(value:{url:string;title:string}){
    if(!value||typeof value.url!=='string'||typeof value.title!=='string'||value.title.length>160)throw Error('invalid_quick_link')
    const url=browserAddress(value.url)
    if(url==='about:blank')throw Error('invalid_quick_link')
    return {url,title:value.title.trim().slice(0,80)||new URL(url).hostname}
  }
  state(chatId:string):BrowserStartState{return {links:this.links.map(row=>({...row})),history:this.history.filter(row=>row.chatId===chatId).map(row=>({...row}))}}
  saveLink(input:{id?:string;title:string;url:string}){
    const value=this.link(input),current=input.id?this.links.find(row=>row.id===input.id):this.links.find(row=>row.url===value.url)
    if(input.id&&!current)throw Error('quick_link_not_found')
    if(this.links.some(row=>row.url===value.url&&row.id!==current?.id))throw Error('quick_link_exists')
    if(!current&&this.links.length>=12)throw Error('quick_link_limit')
    const next={id:current?.id||randomUUID(),...value},previous=this.links
    this.links=current?this.links.map(row=>row.id===current.id?next:row):[...this.links,next]
    try{this.flush()}catch(error){this.links=previous;throw error}
    this.onChanged?.();return {...next}
  }
  removeLink(id:string){
    const previous=this.links;this.links=this.links.filter(row=>row.id!==id)
    try{this.flush()}catch(error){this.links=previous;throw error}
    this.onChanged?.()
  }
  visit(value:{chatId:string;url:string;title:string}){
    if(!value.chatId)return
    let link:ReturnType<BrowserStartStore['link']>
    try{link=this.link({...value,title:value.title.slice(0,160)})}catch{return}
    const previous=this.history.find(row=>row.chatId===value.chatId&&row.url===link.url)
    // A new visit has a different identity even when recorded in the same millisecond.
    const visitedAt=Math.max(Date.now(),(previous?.visitedAt??0)+1)
    this.history=[{...link,chatId:value.chatId,visitedAt},...this.history.filter(row=>row.chatId!==value.chatId||row.url!==link.url)].slice(0,200)
    clearTimeout(this.timer);this.timer=setTimeout(()=>{try{this.flush()}catch(error){console.warn('[browser-start] history save failed',error)}},250);this.timer.unref?.()
    this.onChanged?.(value.chatId)
  }
  clearHistory(chatId:string,url?:string,visitedAt?:number){
    if(visitedAt!==undefined){
      if(typeof url!=='string'||!url||!Number.isSafeInteger(visitedAt))throw Error('invalid_browser_history_entry')
      const current=this.history.find(row=>row.chatId===chatId&&row.url===url)
      if(current&&current.visitedAt!==visitedAt)throw Error('browser_history_changed')
    }
    const previous=this.history;this.history=this.history.filter(row=>row.chatId!==chatId||url!==undefined&&row.url!==url)
    try{this.flush()}catch(error){this.history=previous;throw error}
    this.onChanged?.(chatId)
  }
  flush(){
    clearTimeout(this.timer);this.timer=undefined
    fs.mkdirSync(path.dirname(this.file),{recursive:true})
    fs.writeFileSync(this.file+'.tmp',JSON.stringify({links:this.links,history:this.history}));fs.renameSync(this.file+'.tmp',this.file)
  }
}
