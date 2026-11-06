import {createHash,randomUUID} from 'node:crypto'
import type {ChatSession,QueuedMessage} from '../../shared/types'
import {compileComposerDocument,composerDocumentFromLegacy,normalizeComposerDocument,composerSemanticIdentity,type ComposerSubmitInput,type ComposerQueueEditOptions} from '../../shared/composer-document'
import {deriveTaskConstraints,type TaskConstraintSource} from '../../shared/task-declarations'
import {enforceInheritedTaskConstraints,freezeTaskConstraints} from './agent-task-policy'

type Input=ComposerSubmitInput
type Deps={
  get:(id:string)=>ChatSession|null;save:(id:string,entries:QueuedMessage[],paused:boolean)=>void
  changed:(id:string)=>void;running:(id:string)=>boolean;start:(id:string,input:Input,source?:TaskConstraintSource)=>Promise<unknown>
  insert:(id:string,input:Input)=>boolean;maxChars:()=>number
  validateIncoming?:(id:string,input:Input)=>void;prepare?:(id:string,input:Input)=>Promise<Input>;accepted?:(id:string,clientMessageId:string,fingerprint:string)=>void
}

/** The main process owns immutable accepted snapshots, even while the renderer changes chats. */
export class AgentInbox {
  private pumping=new Set<string>()
  private submitTails=new Map<string,Promise<void>>()
  constructor(private deps:Deps){}
  private chat(id:string){const chat=this.deps.get(id);if(!chat)throw new Error('chat_not_found');return chat}
  private input(id:string,raw:Input):Input {
    const document=raw?.document?normalizeComposerDocument(raw.document,id):undefined
    const compiled=document?compileComposerDocument(document):undefined
    const saved=(raw as Input&Pick<QueuedMessage,'taskConstraints'>)?.taskConstraints
    if(saved!==undefined){const frozen=enforceInheritedTaskConstraints(this.deps.get(id),freezeTaskConstraints(saved)),expected=enforceInheritedTaskConstraints(this.deps.get(id),freezeTaskConstraints(deriveTaskConstraints(compiled?.declarations)));if(JSON.stringify(frozen.declarations)!==JSON.stringify(expected.declarations))throw Error('task_constraints_document_mismatch')}
    const content=(compiled?.content??String(raw?.content||'')).trim()
    const refs=(compiled?.refs??(Array.isArray(raw?.refs)?raw.refs:[])).map(ref=>({...ref}))
    if(!content&&!refs.length)throw new Error('empty_message')
    if(content.length>this.deps.maxChars())throw new Error('message_too_long')
    if(refs.length>100)throw new Error('too_many_context_references')
    if(raw.clientMessageId!==undefined&&(typeof raw.clientMessageId!=='string'||!raw.clientMessageId||raw.clientMessageId.length>200||/[\u0000-\u0020]/.test(raw.clientMessageId)))throw new Error('invalid_client_message_id')
    return {content,refs,...(document?{document}:{}),...(raw.modelIdentity?{modelIdentity:structuredClone(raw.modelIdentity)}:{}),...(raw.clientMessageId?{clientMessageId:raw.clientMessageId}:{}),...(typeof raw.draftRevision==='number'?{draftRevision:raw.draftRevision}:{})}
  }
  private async prepare(id:string,input:Input){const normalized=this.input(id,input);return this.deps.prepare?this.input(id,await this.deps.prepare(id,normalized)):normalized}
  private save(id:string,entries:QueuedMessage[],paused=this.chat(id).queuePaused===true){this.deps.save(id,entries,paused);this.deps.changed(id)}
  private fingerprint(input:Input){
    const document=input.document
    const value=document?composerSemanticIdentity(document):JSON.stringify(['legacy',input.content.trim(),input.refs||[]])
    return createHash('sha256').update(value).digest('hex')
  }
  private declared(input:Input){return Boolean(input.document&&compileComposerDocument(input.document).declarations.ids.length)}
  private constraints(id:string,input:Input,source:TaskConstraintSource){return enforceInheritedTaskConstraints(this.deps.get(id),freezeTaskConstraints(deriveTaskConstraints(input.document?compileComposerDocument(input.document).declarations:undefined,{...source,...(input.document?{documentId:input.document.id,documentRevision:input.document.revision}:{})})))}
  private known(chat:ChatSession,input:Input){
    const key=input.clientMessageId;if(!key)return false
    const receipt=chat.acceptedClientMessageIds?.find(entry=>entry.id===key)
    if(receipt){if(receipt.fingerprint&&receipt.fingerprint!==this.fingerprint(input))throw Error('client_message_id_conflict');return true}
    const queued=chat.queuedMessages?.find(entry=>entry.clientMessageId===key)
    const message=chat.messages.find(entry=>entry.meta?.clientMessageId===key)
    const accepted=queued||(message?{content:message.content,refs:message.meta?.refs,document:message.meta?.document,modelIdentity:message.meta?.modelIdentity as Input['modelIdentity']}:undefined)
    if(!accepted)return false
    if(this.fingerprint(accepted)!==this.fingerprint(input))throw Error('client_message_id_conflict')
    return true
  }
  submit(id:string,raw:Input,mode:'queue'|'insert',afterAccepted?:()=>void):Promise<boolean>{
    const operation=(this.submitTails.get(id)||Promise.resolve()).catch(()=>{}).then(()=>this.submitNow(id,raw,mode,afterAccepted))
    const settled=operation.then(()=>{},()=>{});this.submitTails.set(id,settled)
    void settled.then(()=>{if(this.submitTails.get(id)===settled)this.submitTails.delete(id)})
    return operation
  }
  private async submitNow(id:string,raw:Input,mode:'queue'|'insert',afterAccepted?:()=>void){
    const normalized=this.input(id,raw)
    if(this.known(this.chat(id),normalized))return false
    this.deps.validateIncoming?.(id,normalized)
    const input=await this.prepare(id,normalized),chat=this.chat(id)
    if(this.known(chat,input))return false
    if(mode==='insert'&&!this.declared(input)&&this.deps.running(id)&&this.deps.insert(id,input)){
      if(input.clientMessageId)this.deps.accepted?.(id,input.clientMessageId,this.fingerprint(input))
      afterAccepted?.()
      return true
    }
    if((chat.queuedMessages?.length||0)>=80)throw new Error('message_queue_full')
    const queueId=randomUUID()
    this.save(id,[...(chat.queuedMessages||[]),{id:queueId,...input,taskConstraints:this.constraints(id,input,{queueId,queueRevision:0}),revision:0,createdAt:Date.now()}],chat.queuePaused===true&&Boolean(chat.queuedMessages?.length))
    if(input.clientMessageId)this.deps.accepted?.(id,input.clientMessageId,this.fingerprint(input))
    // The accepted snapshot must exist before releasing an old blocking tool,
    // and a restored idle conversation must not start its model beforehand.
    afterAccepted?.()
    await this.pump(id)
    return true
  }
  async edit(id:string,messageId:string,content:string,options?:ComposerQueueEditOptions){
    const entry=this.chat(id).queuedMessages?.find(item=>item.id===messageId)
    if(!entry)throw new Error('queued_message_not_found')
    // A legacy/plain edit must not erase a newer structured queue document.
    if(entry.document)normalizeComposerDocument(entry.document,id)
    if(this.pumping.has(id))throw new Error('queue_busy')
    const previousRevision=entry.revision||0
    if(options?.baseRevision!==undefined&&options.baseRevision!==previousRevision)throw new Error('queue_conflict')
    const document=options?.document||(entry.document?{...composerDocumentFromLegacy(id,content,entry.refs||[]),...(entry.document.declarations!==undefined?{declarations:structuredClone(entry.document.declarations)}:{})}:undefined)
    const input=await this.prepare(id,{content,refs:entry.refs,document,clientMessageId:entry.clientMessageId,modelIdentity:entry.modelIdentity})
    const current=this.chat(id).queuedMessages?.find(item=>item.id===messageId)
    if(this.pumping.has(id))throw new Error('queue_busy')
    if(!current||(current.revision||0)!==previousRevision)throw new Error('queue_conflict')
    this.save(id,(this.chat(id).queuedMessages||[]).map(item=>item.id===messageId?{...item,...input,taskConstraints:this.constraints(id,input,{queueId:messageId,queueRevision:previousRevision+1}),revision:previousRevision+1,error:undefined}:item))
  }
  remove(id:string,messageId:string){if(this.pumping.has(id))throw new Error('queue_busy');this.save(id,(this.chat(id).queuedMessages||[]).filter(item=>item.id!==messageId))}
  pause(id:string){const chat=this.deps.get(id);if(chat)this.save(id,chat.queuedMessages||[],true)}
  async resume(id:string){this.save(id,(this.chat(id).queuedMessages||[]).map(entry=>({...entry,error:undefined})),false);await this.pump(id)}
  async insert(id:string,messageId:string){
    if(this.pumping.has(id))throw new Error('queue_busy')
    const entry=this.chat(id).queuedMessages?.find(item=>item.id===messageId)
    if(!entry)throw new Error('queued_message_not_found')
    this.pumping.add(id)
    try{
      const input=await this.prepare(id,entry)
      if(this.deps.running(id)){if(this.declared(input))return;if(!this.deps.insert(id,input))throw new Error('agent_not_running')}
      else await this.deps.start(id,structuredClone(input),{queueId:entry.id,queueRevision:entry.revision||0})
      this.save(id,(this.chat(id).queuedMessages||[]).filter(item=>item.id!==messageId))
    }finally{this.pumping.delete(id)}
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
      const input=await this.prepare(id,entry)
      await this.deps.start(id,structuredClone(input),{queueId:entry.id,queueRevision:entry.revision||0});accepted=true
      if(this.deps.get(id))this.save(id,(this.chat(id).queuedMessages||[]).filter(item=>item.id!==entry.id))
    }catch(error){
      if(this.deps.get(id))this.save(id,(this.chat(id).queuedMessages||[]).map(item=>item.id===entry.id?{...item,error:error instanceof Error?error.message:'send_failed'}:item),true)
    }finally{
      this.pumping.delete(id)
      if(accepted&&!this.deps.running(id))this.finished(id)
    }
  }
}
