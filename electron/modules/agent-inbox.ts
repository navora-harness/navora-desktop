import {randomUUID} from 'node:crypto'
import type {BrowserContextRef,ChatSession,QueuedMessage} from '../../shared/types'
type Input={content:string;refs?:BrowserContextRef[]}
type Deps={get:(id:string)=>ChatSession|null;save:(id:string,entries:QueuedMessage[],paused:boolean)=>void;changed:(id:string)=>void;running:(id:string)=>boolean;start:(id:string,input:Input)=>Promise<unknown>;insert:(id:string,input:Input)=>boolean;maxChars:()=>number}

/** Main-process queue: the renderer closing or switching chats cannot lose work. */
export class AgentInbox {
  private pumping=new Set<string>()
  constructor(private deps:Deps){}
  private chat(id:string){const chat=this.deps.get(id);if(!chat)throw new Error('chat_not_found');return chat}
  private input(input:Input):Input {
    const content=String(input?.content||'').trim(),refs=Array.isArray(input?.refs)?input.refs.slice(0,100):[]
    if(!content&&!refs.length)throw new Error('empty_message')
    if(content.length>this.deps.maxChars())throw new Error('message_too_long')
    return {content,refs}
  }
  private save(id:string,entries:QueuedMessage[],paused=this.chat(id).queuePaused===true){this.deps.save(id,entries,paused);this.deps.changed(id)}
  async submit(id:string,raw:Input,mode:'queue'|'insert') {
    const input=this.input(raw),chat=this.chat(id)
    if(mode==='insert'&&this.deps.running(id)&&this.deps.insert(id,input))return
    if((chat.queuedMessages?.length||0)>=80)throw new Error('message_queue_full')
    this.save(id,[...(chat.queuedMessages||[]),{id:randomUUID(),...input,createdAt:Date.now()}],chat.queuePaused===true&&Boolean(chat.queuedMessages?.length))
    await this.pump(id)
  }
  edit(id:string,messageId:string,content:string){
    const entries=this.chat(id).queuedMessages||[],entry=entries.find(item=>item.id===messageId)
    if(!entry)throw new Error('queued_message_not_found')
    if(this.pumping.has(id))throw new Error('queue_busy')
    const input=this.input({content,refs:entry.refs})
    this.save(id,entries.map(item=>item===entry?{...entry,...input,error:undefined}:item))
  }
  remove(id:string,messageId:string){if(this.pumping.has(id))throw new Error('queue_busy');this.save(id,(this.chat(id).queuedMessages||[]).filter(item=>item.id!==messageId))}
  pause(id:string){const chat=this.deps.get(id);if(chat)this.save(id,chat.queuedMessages||[],true)}
  async resume(id:string){this.save(id,(this.chat(id).queuedMessages||[]).map(entry=>({...entry,error:undefined})),false);await this.pump(id)}
  async insert(id:string,messageId:string){
    if(this.pumping.has(id))throw new Error('queue_busy')
    const entry=(this.chat(id).queuedMessages||[]).find(item=>item.id===messageId)
    if(!entry)throw new Error('queued_message_not_found')
    if(this.deps.running(id)){
      if(!this.deps.insert(id,this.input(entry)))throw new Error('agent_not_running')
    }else{
      this.pumping.add(id)
      try{await this.deps.start(id,this.input(entry))}finally{this.pumping.delete(id)}
    }
    this.save(id,(this.chat(id).queuedMessages||[]).filter(item=>item.id!==messageId))
    if(!this.deps.running(id))void this.pump(id)
  }
  finished(id:string){queueMicrotask(()=>void this.pump(id))}
  private async pump(id:string){
    const chat=this.deps.get(id)
    if(!chat||chat.queuePaused||this.pumping.has(id)||this.deps.running(id))return
    const entry=chat.queuedMessages?.[0]
    if(!entry||entry.error)return
    this.pumping.add(id)
    let accepted=false
    try{
      await this.deps.start(id,this.input(entry));accepted=true
      const current=this.deps.get(id)
      if(current)this.save(id,(current.queuedMessages||[]).filter(item=>item.id!==entry.id))
    }catch(error){
      if(this.deps.get(id))this.save(id,(this.chat(id).queuedMessages||[]).map(item=>item.id===entry.id?{...item,error:error instanceof Error?error.message:'send_failed'}:item),true)
    }finally{
      this.pumping.delete(id)
      if(accepted&&!this.deps.running(id))this.finished(id)
    }
  }
}
