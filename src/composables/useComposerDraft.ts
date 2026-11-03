import {computed,nextTick,onBeforeUnmount,ref,watch,type Ref} from 'vue'
import type {ChatSession} from '@shared/types'
import {compileComposerDocument,composerDocumentFromLegacy,createComposerDocument,normalizeComposerDocument,composerDocumentEmpty,composerErrorMessage,type ComposerDocument} from '@shared/composer-document'

/** One versioned document owns text and sources, including while a save is in flight. */
export function useComposerDraft(owner:Ref<string|null>,notify:(message:string)=>void){
  const document=ref<ComposerDocument>(createComposerDocument('')),touchedAt=ref(0),conflict=ref<ChatSession|null>(null),unsupported=ref(false)
  const bases=new Map<string,number>(),cache=new Map<string,ComposerDocument>(),dirty=new Set<string>(),blocked=new Set<string>(),tails=new Map<string,Promise<void>>()
  const unreadable=new Set<string>()
  let quiet=false,timer:ReturnType<typeof setTimeout>|undefined,disposed=false
  const clone=(value:ComposerDocument)=>JSON.parse(JSON.stringify(value)) as ComposerDocument
  const sameContent=(left:ComposerDocument|undefined,right:ComposerDocument|undefined)=>!!left&&!!right&&left.id===right.id&&JSON.stringify(left.content)===JSON.stringify(right.content)
  const ownClear=(chat:ChatSession,local:ComposerDocument,revision:number)=>chat.draftClearedFromRevision===revision&&chat.draftDocument?.id===local.id&&composerDocumentEmpty(chat.draftDocument)
  function replace(value:ComposerDocument){quiet=true;document.value=clone(value);touchedAt.value=value.updatedAt;void nextTick(()=>{quiet=false})}
  function load(chat:ChatSession|null){
    const id=chat?.id||owner.value||'',cached=cache.get(id)
    const remoteRevision=chat?.draftRevision||0
    let unreadableDocument=chat?.draftUnsupportedDocument!==undefined
    if(chat?.draftDocument)try{normalizeComposerDocument(chat.draftDocument,id)}catch{unreadableDocument=true}
    if(unreadableDocument){
      unreadable.add(id);unsupported.value=true;conflict.value=null;bases.set(id,remoteRevision)
      if(cached&&dirty.has(id))void window.navora?.chats.saveDraftRecovery(id,clone(cached),'conflict').catch(()=>{})
      const fallback=cached||composerDocumentFromLegacy(id,chat?.draft||'');fallback.revision=remoteRevision;cache.set(id,clone(fallback));replace(fallback);return
    }
    unreadable.delete(id);unsupported.value=false
    if(chat&&remoteRevision<(bases.get(id)||0)){if(cached&&owner.value===id)replace(cached);return}
    if(cached&&dirty.has(id)){
      const base=bases.get(id)||0
      if(chat&&ownClear(chat,cached,base))bases.set(id,Math.max(base,remoteRevision))
      else if(chat&&bases.has(id)&&base!==remoteRevision&&!sameContent(chat.draftDocument,cached)){blocked.add(id);conflict.value=chat;void window.navora?.chats.saveDraftRecovery(id,clone(cached),'conflict').catch(()=>{})}
      replace(cached);return
    }
    bases.set(id,remoteRevision)
    const next=chat?.draftDocument?normalizeComposerDocument(chat.draftDocument,id):composerDocumentFromLegacy(id,chat?.draft||'')
    next.revision=chat?.draftRevision||next.revision;next.updatedAt=chat?.draftUpdatedAt||next.updatedAt
    cache.set(id,clone(next));replace(next);conflict.value=chat?.draftConflict?chat:null
  }
  function applyText(text:string,updatedAt=Date.now(),supplied?:ComposerDocument){
    const id=owner.value||document.value.chatId
    if(unreadable.has(id)){notify('原始草稿格式暂不支持，请升级到兼容版本后恢复。');return}
    const next=supplied?normalizeComposerDocument(supplied,id):composerDocumentFromLegacy(id,text)
    next.updatedAt=updatedAt;cache.set(id,clone(next));replace(next)
  }
  function edited(next:ComposerDocument){if(unreadable.has(owner.value||next.chatId))return;document.value=normalizeComposerDocument(next,owner.value||next.chatId);schedule(true)}
  async function save(id:string){
    if(!id||unreadable.has(id)||!window.navora?.chats.setDraft)return
    if(blocked.has(id)){
      const snapshot=cache.get(id)
      if(snapshot)try{await window.navora.chats.saveDraftRecovery(id,clone(snapshot),'conflict')}catch{notify('本地冲突副本暂时无法保存，当前编辑内容仍保留。')}
      return
    }
    const previous=tails.get(id)||Promise.resolve()
    const task=previous.catch(()=>{}).then(async()=>{
      if(unreadable.has(id)||blocked.has(id)||!dirty.has(id))return
      const pending=cache.get(id);if(!pending)return
      const snapshot=clone(pending),base=bases.get(id)||0,compiled=compileComposerDocument(snapshot)
      try{
        const chat=await window.navora!.chats.setDraft(id,compiled.content,{document:snapshot,baseRevision:base,updatedAt:snapshot.updatedAt})
        if(!chat)return
        if((chat.draftRevision||0)<(bases.get(id)||0))return
        bases.set(id,Math.max(bases.get(id)||0,chat.draftRevision||0))
        if(chat.draftConflict){blocked.add(id);if(owner.value===id)conflict.value=chat;notify('草稿在另一处有更新，两份内容都已保留。');return}
        const latest=cache.get(id)
        if(latest&&latest.id===snapshot.id&&latest.revision===snapshot.revision&&JSON.stringify(latest.content)===JSON.stringify(snapshot.content)&&latest.updatedAt===snapshot.updatedAt){
          dirty.delete(id)
          const accepted=chat.draftDocument?normalizeComposerDocument(chat.draftDocument,id):{...snapshot,revision:chat.draftRevision||snapshot.revision}
          cache.set(id,accepted)
          if(owner.value===id&&!disposed)replace(accepted)
        }
      }catch(error){notify(composerErrorMessage(error)||'草稿暂时无法保存，当前编辑内容仍保留。')}
    })
    tails.set(id,task);await task;if(tails.get(id)===task)tails.delete(id)
  }
  function schedule(force=false){
    if((quiet&&!force)||!document.value.chatId||unreadable.has(document.value.chatId))return
    const id=document.value.chatId
    const snapshot=clone(document.value);snapshot.updatedAt=Math.max(snapshot.updatedAt,Date.now());touchedAt.value=snapshot.updatedAt
    cache.set(id,snapshot);dirty.add(id)
    clearTimeout(timer);timer=setTimeout(()=>void save(id),350)
  }
  async function flush(id=owner.value){
    await nextTick()
    clearTimeout(timer);if(!id)return
    if(unreadable.has(id))throw Error('composer_document_version')
    await save(id)
    if(dirty.has(id)&&!blocked.has(id))await save(id)
    if(blocked.has(id))throw Error('composer_draft_conflict')
    if(dirty.has(id))throw Error('composer_draft_not_saved')
  }
  function acceptRemote(chat:ChatSession){
    const id=chat.id
    if(chat.draftUnsupportedDocument!==undefined){if(owner.value===id)load(chat);return}
    if(chat.draftDocument)try{normalizeComposerDocument(chat.draftDocument,id)}catch{if(owner.value===id)load(chat);return}
    if((chat.draftRevision||0)<(bases.get(id)||0))return
    if(chat.draftConflict){blocked.add(id);if(owner.value===id)conflict.value=chat;return}
    if(dirty.has(id)||tails.has(id))return
    bases.set(id,Math.max(bases.get(id)||0,chat.draftRevision||0))
    if(owner.value===id)load(chat)
  }
  async function resolveConflict(useLocal:boolean){
    const chat=conflict.value,id=chat?.id;if(!chat||!id||unreadable.has(id))return
    const local=cache.get(id),snapshot=local?clone(local):undefined
    try{
      // Choosing the synchronized version keeps the editable local copy available
      // in recovery until the user explicitly removes it.
      if(snapshot)await window.navora!.chats.saveDraftRecovery(id,snapshot,'conflict')
      if(useLocal&&snapshot){
        bases.set(id,Math.max(bases.get(id)||0,chat.draftRevision||0));blocked.delete(id);conflict.value=null;dirty.add(id);await save(id)
        return
      }
      const latest=await window.navora!.chats.get(id)
      if(!latest)throw Error('chat_not_found')
      const synced=latest.draftDocument?normalizeComposerDocument(latest.draftDocument,id):composerDocumentFromLegacy(id,latest.draft||'')
      const confirmed=await window.navora!.chats.setDraft(id,compileComposerDocument(synced).content,{document:synced,baseRevision:latest.draftRevision||0,updatedAt:latest.draftUpdatedAt||synced.updatedAt})
      if(!confirmed)throw Error('chat_not_found')
      const edited=cache.get(id)
      if(confirmed.draftConflict||snapshot&&edited&&(edited.id!==snapshot.id||edited.revision!==snapshot.revision||edited.updatedAt!==snapshot.updatedAt||JSON.stringify(edited.content)!==JSON.stringify(snapshot.content))){
        if(edited)await window.navora!.chats.saveDraftRecovery(id,clone(edited),'conflict')
        blocked.add(id);if(owner.value===id)conflict.value=confirmed
        notify(confirmed.draftConflict?'同步版本再次更新，请重新选择。':'本地草稿又有编辑，内容已保留，请重新选择版本。');return
      }
      blocked.delete(id);dirty.delete(id);bases.set(id,Math.max(bases.get(id)||0,confirmed.draftRevision||0));cache.delete(id)
      if(owner.value===id){conflict.value=null;load(confirmed)}
      else{const document=confirmed.draftDocument?normalizeComposerDocument(confirmed.draftDocument,id):composerDocumentFromLegacy(id,confirmed.draft||'');cache.set(id,document)}
    }catch(error){blocked.add(id);if(owner.value===id)conflict.value=chat;notify(composerErrorMessage(error)||'暂时无法确认草稿版本，两份内容仍保留。')}
  }
  function markDirty(){schedule(true)}
  function acknowledge(chat:ChatSession,sent:ComposerDocument){
    const base=bases.get(chat.id)||0,revision=chat.draftRevision||0
    if(revision<base)return
    const latest=cache.get(chat.id)
    if(latest&&dirty.has(chat.id)&&revision>base&&!ownClear(chat,sent,sent.revision)&&!sameContent(latest,chat.draftDocument)){
      // A receipt can include a different client's newer draft. It is not an
      // acknowledgement of our local edits and must not advance their CAS base.
      blocked.add(chat.id);if(owner.value===chat.id)conflict.value=chat
      void window.navora?.chats.saveDraftRecovery(chat.id,clone(latest),'conflict').catch(()=>{})
      notify('提交已接收，但另一处更新了草稿；当前输入与同步版本均已保留。');return
    }
    bases.set(chat.id,Math.max(base,revision))
    if(latest&&!dirty.has(chat.id)&&chat.draftDocument&&!sameContent(latest,chat.draftDocument)){
      const synchronized=normalizeComposerDocument(chat.draftDocument,chat.id);cache.set(chat.id,synchronized)
      if(owner.value===chat.id)replace(synchronized)
      return
    }
    if(!latest||latest.id!==sent.id||latest.revision!==sent.revision||JSON.stringify(latest.content)!==JSON.stringify(sent.content))return
    const empty=chat.draftDocument?normalizeComposerDocument(chat.draftDocument,chat.id):createComposerDocument(chat.id)
    cache.set(chat.id,empty);dirty.delete(chat.id)
    if(owner.value===chat.id)replace(empty)
  }
  const text=computed(()=>compileComposerDocument(document.value).content),refs=computed(()=>compileComposerDocument(document.value).refs)
  watch(document,()=>{if(!quiet)schedule()},{deep:true})
  watch(owner,id=>{clearTimeout(timer);conflict.value=null;unsupported.value=unreadable.has(id||'');const saved=cache.get(id||'')||createComposerDocument(id||'');replace(saved)},{flush:'sync'})
  const beforeUnload=()=>{const id=owner.value;if(id)void save(id)}
  window.addEventListener('beforeunload',beforeUnload)
  onBeforeUnmount(()=>{disposed=true;clearTimeout(timer);window.removeEventListener('beforeunload',beforeUnload);for(const id of dirty)void save(id)})
  return {document,text,refs,touchedAt,conflict,unsupported,load,applyText,edited,schedule:markDirty,flush,acceptRemote,resolveConflict,acknowledge,baseRevision:()=>bases.get(owner.value||'')||0}
}
