<template>
  <section v-if="entries.length||editing" ref="root" class="message-queue" :class="{'has-editor':!!editing,'is-expanded':expanded}" aria-label="队列">
    <header class="queue-header">
      <button ref="toggleButton" type="button" class="queue-toggle" :aria-controls="listId" :aria-expanded="expanded" :aria-label="`${expanded?'收起':'展开'}队列，${entries.length} 条消息`" @click="toggleExpanded">
        <AppIcon icon="list-ul" class="queue-title-icon" />
        <span class="queue-title">队列</span><span class="queue-count">{{ entries.length }}</span>
        <span v-if="newEntryCount" class="queue-new">新增 {{ newEntryCount }}</span>
        <span v-else-if="editing" class="queue-hint">{{ expanded?'编辑中':'保留的编辑' }}</span>
        <span v-else-if="failedCount" class="queue-hint queue-failed">{{ failedCount }} 条待重试</span>
        <span v-else-if="paused" class="queue-hint">已暂停</span>
        <span v-else-if="expanded" class="queue-hint">运行结束后发送</span>
        <AppIcon icon="chevron-down" class="queue-chevron" />
      </button>
      <button v-if="paused&&entries.length" type="button" class="queue-resume" :disabled="busy" title="继续发送队列中的消息" @click="emit('resume')">继续队列</button>
    </header>
    <span class="queue-announcement" role="status" aria-live="polite" aria-atomic="true">{{ queueAnnouncement }}</span>
    <ol v-show="expanded" :id="listId">
      <li v-for="entry in displayedEntries" :key="entry.id" :data-queue-id="entry.id">
        <template v-if="editing===entry.id&&document">
          <p v-if="orphaned||conflicted" class="queue-edit-conflict" role="status">{{ orphaned?'原队列消息已开始执行或被移除，当前编辑副本已保留。':'队列消息已在其他位置更新，当前编辑副本已保留。' }}</p>
          <div class="queue-document-container" @keydown.capture="onSaveShortcut($event,entry.id)" @keydown="onEditorKey"><ComposerEditor :ref="bindEditor" v-model="document" :chat-id="chatId" :disabled="busy||saving" :submit-on-enter="false" :context-previews="previews" placeholder="编辑待发送消息，输入 / 附加…" @attach="attach" @open-source="emit('open-source',$event)" @refresh-source="replaceSource" @change-source="replaceSource" @notify="emit('notify',$event)" /></div>
          <div class="queue-edit-actions"><button type="button" class="queue-attach" aria-label="附加" title="附加文件、网页或会话，也可输入 /" :disabled="busy||saving" @mousedown.prevent="captureSelection" @click="attach()"><AppIcon icon="paperclip" /></button><span class="queue-edit-count" :class="{invalid:compiled.content.length>maxChars}">{{ compiled.content.length }} / {{ maxChars }}{{ compiled.contexts.length?` · ${compiled.contexts.length} 项上下文`:'' }}</span><button type="button" @click="cancelEdit">取消</button><button v-if="orphaned||conflicted" type="button" :disabled="busy||saving||recovered" @click="recover">{{ recovered?'已放入消息编辑器':'放入消息编辑器' }}</button><button v-else type="button" :disabled="!canSave" @click="save(entry.id)">保存</button></div>
        </template>
        <template v-else><span v-if="entryDeclarationLabel(entry)" class="queue-declarations">{{ entryDeclarationLabel(entry) }}</span><p :title="entry.content">{{ entry.content || '附加内容' }}</p><div class="queue-item-actions"><button type="button" title="编辑" aria-label="编辑队列消息" :disabled="busy" @click="beginEdit(entry)"><AppIcon icon="pen-to-square" /></button><button type="button" :title="entryDeclarationLabel(entry)?'任务声明按队列顺序执行':'直接插入'" aria-label="直接插入队列消息" :disabled="busy||!!entryDeclarationLabel(entry)" @click="emit('insert',entry.id)"><AppIcon icon="arrow-up" /></button><button type="button" title="删除" aria-label="删除队列消息" :disabled="busy" @click="emit('remove',entry.id)"><AppIcon icon="xmark" /></button></div><span v-if="entry.error" class="queue-error">{{ /composer_document|invalid_composer|task_declaration/.test(entry.error)?'原始消息格式已保留，请使用兼容版本恢复':'发送失败，可编辑后继续' }}</span></template>
      </li>
    </ol>
    <ComposerAttachmentMenu :chat-id="chatId" :context-key="editing" :files="files||[]" :messages="messages||[]" @insert="insertSources" ref="attachmentMenu" :selected-declarations="selectedDeclarations" @declaration="selectDeclaration" @select="selectAttachmentSource" @creator="createFromAttachment" @closed="attachmentClosed" />
  </section>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,useId,watch} from 'vue'
import type {ChatMessage,QueuedMessage} from '@shared/types'
import type {WorkspaceResource} from '@shared/workspace-resources'
import {normalizeTaskDeclarations,taskDeclarationsLabel,taskDeclarationsSupported,type TaskDeclarationId} from '@shared/task-declarations'
import {previewComposerDocument,composerDocumentsHaveSameContent,composerDocumentEmpty,composerDocumentFromLegacy,normalizeComposerDocument,type ComposerContextBlock,type ComposerDocument} from '@shared/composer-document'
import type {ComposerEditorHandle,ComposerSelectionBookmark} from '@/editor/composer-editor-registry'
import {queueEditorDraft,queueEditorDraftUnsupported,removeQueueEditorDraft,saveQueueEditorDraft} from '@/editor/queue-editor-drafts'
import AppIcon from './icons/AppIcon.vue'
import ComposerEditor from './ComposerEditor.vue'
import ComposerAttachmentMenu from './ComposerAttachmentMenu.vue'
const props=defineProps<{entries:QueuedMessage[];paused:boolean;busy:boolean;maxChars:number;chatId:string;files?:WorkspaceResource[];messages?:ChatMessage[];contextPreviews?:Record<string,string>}>()
const emit=defineEmits<{edit:[id:string,content:string,document:ComposerDocument,baseRevision?:number];insert:[id:string];remove:[id:string];resume:[];recover:[document:ComposerDocument];'open-source':[block:ComposerContextBlock];creator:[kind:'plugin'|'skill'];notify:[message:string]}>()
const editing=ref(''),document=ref<ComposerDocument|null>(null),editingEntry=ref<QueuedMessage|null>(null),saving=ref(false),root=ref<HTMLElement>(),editor=ref<ComposerEditorHandle>(),baseRevision=ref<number|undefined>(),orphaned=ref(false),conflicted=ref(false),localPreviews=ref<Record<string,string>>({})
const recovered=ref(false)
const listId=`message-queue-${useId()}`,expanded=ref(false),toggleButton=ref<HTMLButtonElement>(),newEntryIds=ref<string[]>([]),queueAnnouncement=ref('')
const newEntryCount=computed(()=>newEntryIds.value.length),failedCount=computed(()=>props.entries.filter(entry=>entry.error).length)
const attachmentMenu=ref<InstanceType<typeof ComposerAttachmentMenu>>()
let bookmark:ComposerSelectionBookmark|null=null,pickerTarget:{entryId:string;documentId:string;chatId:string}|null=null,persistTimer:ReturnType<typeof setTimeout>|undefined
const compiled=computed(()=>document.value?previewComposerDocument(document.value):{content:'',refs:[],contexts:[]}),previews=computed(()=>({...props.contextPreviews,...localPreviews.value}))
const canSave=computed(()=>!props.busy&&!saving.value&&!orphaned.value&&!conflicted.value&&!!document.value&&taskDeclarationsSupported(document.value.declarations)&&!composerDocumentEmpty(document.value)&&compiled.value.content.length<=props.maxChars)
const displayedEntries=computed(()=>editing.value&&editingEntry.value&&!props.entries.some(entry=>entry.id===editing.value)?[...props.entries,editingEntry.value]:props.entries)
function bindEditor(value:unknown){editor.value=value?value as ComposerEditorHandle:undefined}
function snapshot(){if(document.value&&editingEntry.value)saveQueueEditorDraft({chatId:props.chatId,entry:editingEntry.value,document:document.value,baseRevision:baseRevision.value,updatedAt:Date.now()})}
function toggleExpanded(){
  if(expanded.value){snapshot();attachmentMenu.value?.hide();expanded.value=false;void nextTick(()=>toggleButton.value?.focus({preventScroll:true}))}
  else{expanded.value=true;newEntryIds.value=[]}
}
function beginEdit(entry:QueuedMessage){
  if(props.busy)return
  try{if(queueEditorDraftUnsupported(props.chatId,entry.id))throw Error('composer_document_version');if(entry.document)normalizeComposerDocument(entry.document,props.chatId)}catch{emit('notify','这条队列消息或本地编辑副本的原始格式已完整保留，请升级到兼容版本后编辑或发送。');return}
  if(editing.value)snapshot()
  const cached=queueEditorDraft(props.chatId,entry.id)
  expanded.value=true;newEntryIds.value=[]
  editingEntry.value=JSON.parse(JSON.stringify(cached?.entry||entry));document.value=cached?.document?normalizeComposerDocument(cached.document,props.chatId):entry.document?normalizeComposerDocument(entry.document,props.chatId):composerDocumentFromLegacy(props.chatId,entry.content,entry.refs||[])
  baseRevision.value=cached?(cached.entry.revision||0):(entry.revision||0);editing.value=entry.id;orphaned.value=false;conflicted.value=cached?(entry.revision||0)!==baseRevision.value:false;saving.value=false;localPreviews.value={};recovered.value=false
  void nextTick(()=>editor.value?.focus())
}
function cancelEdit(){const id=editing.value;if(id)removeQueueEditorDraft(props.chatId,id);editing.value='';document.value=null;editingEntry.value=null;bookmark=null;pickerTarget=null;saving.value=false;orphaned.value=false;conflicted.value=false;void nextTick(()=>root.value?.querySelector<HTMLButtonElement>(`[data-queue-id="${CSS.escape(id)}"] [aria-label="编辑队列消息"]`)?.focus({preventScroll:true}))}
function save(id:string){if(!canSave.value||!document.value||editing.value!==id)return;saving.value=true;snapshot();emit('edit',id,compiled.value.content,normalizeComposerDocument(document.value,props.chatId),baseRevision.value)}
function recover(){if(document.value){emit('recover',normalizeComposerDocument(document.value,props.chatId));recovered.value=true;snapshot()}}
function captureSelection(){bookmark=editor.value?.saveSelection()||null}
async function showSource(source='file',replacement?:ComposerContextBlock,files?:File[]){const anchor=root.value?.querySelector<HTMLElement>('.queue-document-container');if(anchor)await attachmentMenu.value?.showSource(anchor,source,replacement,files)}
function attach(request?:{source?:string;files?:File[]}){if(!document.value||props.busy||saving.value)return;captureSelection();pickerTarget={entryId:editing.value,documentId:document.value.id,chatId:props.chatId};if(request?.source||request?.files?.length){void showSource(request.source,undefined,request.files);return}const anchor=root.value?.querySelector<HTMLElement>('.queue-document-container');if(anchor)attachmentMenu.value?.show(anchor)}
const selectedDeclarations=computed(()=>{try{return normalizeTaskDeclarations(document.value?.declarations).ids}catch{return []}})
function entryDeclarationLabel(entry:QueuedMessage){return taskDeclarationsLabel(entry.document?.declarations??entry.taskConstraints?.declarations)}
function selectDeclaration(id:TaskDeclarationId){if(!validPickerTarget())return;if(bookmark)editor.value?.restoreSelection(bookmark);editor.value?.toggleDeclaration(id);pickerTarget=null;bookmark=null}
function validPickerTarget(){return !!document.value&&!!pickerTarget&&pickerTarget.chatId===props.chatId&&pickerTarget.entryId===editing.value&&pickerTarget.documentId===document.value.id}
function selectAttachmentSource(source:string){if(!validPickerTarget()){emit('notify','队列编辑目标已变化，请重新附加。');return}editor.value?.consumeAttachmentTrigger();captureSelection();void showSource(source)}
function createFromAttachment(kind:'plugin'|'skill'){if(!validPickerTarget())return;editor.value?.consumeAttachmentTrigger();snapshot();pickerTarget=null;bookmark=null;emit('creator',kind)}
function attachmentClosed(committed:boolean){if(!committed){editor.value?.cancelAttachmentTrigger();afterPickerClose()}}
function replaceSource(block:ComposerContextBlock){if(!document.value)return;captureSelection();pickerTarget={entryId:editing.value,documentId:document.value.id,chatId:props.chatId};const source=block.source.identity.startsWith('skill:')?'skill':block.source.identity.startsWith('plugin:')?'plugin':block.source.kind;void showSource(source,block)}
function insertSources(items:{block:ComposerContextBlock;text?:string;preview?:string}[],replacementId?:string){
  if(!document.value||!pickerTarget||pickerTarget.chatId!==props.chatId||pickerTarget.entryId!==editing.value||pickerTarget.documentId!==document.value.id){emit('notify','队列编辑目标已变化，未插入上下文。');return}
  if(replacementId){const first=items[0];if(first){editor.value?.updateContext(replacementId,{block:first.block,text:first.text});if(first.preview)localPreviews.value={...localPreviews.value,[replacementId]:first.preview}}}
  else{if(bookmark&&!editor.value?.restoreSelection(bookmark)){emit('notify','原插入位置已变化，请重新附加。');return}for(const item of items){if(editor.value?.insertContext(item.block,item.text)&&item.preview)localPreviews.value={...localPreviews.value,[item.block.id]:item.preview}}}
  pickerTarget=null;bookmark=null;void nextTick(()=>editor.value?.focus())
}
function afterPickerClose(){if(pickerTarget&&document.value?.id===pickerTarget.documentId&&props.chatId===pickerTarget.chatId&&bookmark)editor.value?.restoreSelection(bookmark);pickerTarget=null;bookmark=null}
function onSaveShortcut(event:KeyboardEvent,id:string){if(event.isComposing||event.keyCode===229)return;if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.stopPropagation();save(id)}}
function onEditorKey(event:KeyboardEvent){if(event.isComposing||event.keyCode===229)return;if(event.key==='Escape'){// ProseMirror prevents native Escape by keyCode even when no editor command handles it.
  // Inner source/link/menu handlers stop propagation when Escape belongs to them.
  event.preventDefault();event.stopPropagation();cancelEdit()}}
watch(document,()=>{recovered.value=false;clearTimeout(persistTimer);if(editing.value)persistTimer=setTimeout(snapshot,180)},{deep:false})
watch(()=>props.entries.map(entry=>entry.id),(ids,previous)=>{
  const added=ids.filter(id=>!previous.includes(id))
  newEntryIds.value=expanded.value?[]:[...new Set([...newEntryIds.value.filter(id=>ids.includes(id)),...added])]
  if(added.length)queueAnnouncement.value=`队列新增 ${added.length} 条消息，共 ${ids.length} 条。`
  else if(!ids.length){newEntryIds.value=[];queueAnnouncement.value='队列已清空。'}
})
watch([()=>props.entries,()=>props.busy],()=>{
  if(!editing.value)return
  const entry=props.entries.find(entry=>entry.id===editing.value)
  if(!entry){orphaned.value=true;saving.value=false;snapshot();return}
  if(saving.value&&!props.busy){if(document.value&&entry.document&&composerDocumentsHaveSameContent(entry.document,document.value)){cancelEdit();return}saving.value=false}
  if((entry.revision||0)!==(baseRevision.value||0)){conflicted.value=true;snapshot()}
})
onMounted(()=>{const cached=queueEditorDraft(props.chatId);if(!cached)return;const entry=props.entries.find(entry=>entry.id===cached.entry.id);beginEdit(entry||cached.entry);if(!entry)orphaned.value=true})
onBeforeUnmount(()=>{clearTimeout(persistTimer);snapshot()})
</script>
<style scoped>
.message-queue{width:min(720px,100%);min-width:0;box-sizing:border-box;border:1px solid var(--navora-stroke,#d9e1eb);border-radius:10px;background:var(--appearance-well,#f8fafc);margin-bottom:8px;padding:3px;color:var(--navora-muted,#56677e);font-size:11px;overflow:hidden;max-height:214px;display:flex;flex-direction:column}
.message-queue.has-editor.is-expanded{max-height:min(440px,45dvh)}
.queue-header{display:flex;align-items:center;gap:5px;min-height:30px;flex-shrink:0}
.queue-toggle{display:flex;align-items:center;gap:7px;flex:1;min-width:0;min-height:30px;padding:4px 8px;border:0;border-radius:7px;background:transparent;color:inherit;text-align:left;cursor:pointer}
.queue-title-icon{width:15px;height:15px;flex-shrink:0}.queue-title{font-size:12px;font-weight:600;color:var(--navora-ink,#345576)}
.queue-count{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:18px;padding:0 5px;border-radius:5px;background:color-mix(in srgb,var(--navora-muted,#56677e) 10%,transparent);font-size:10px;font-variant-numeric:tabular-nums}
.queue-hint{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.queue-new{font-size:10px;color:var(--navora-accent,#3e6c9b);white-space:nowrap}.queue-failed{color:var(--control-danger,#b46760)}
.queue-chevron{width:12px;height:12px;margin-left:auto;flex-shrink:0;transform:rotate(-90deg);transition:transform 140ms ease}.is-expanded .queue-chevron{transform:rotate(0)}
.queue-resume{min-height:28px;margin-right:3px;padding:3px 8px;border:0;border-radius:6px;white-space:nowrap;color:var(--navora-accent,#3e6c9b);font-size:11px;cursor:pointer}
.queue-announcement{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
ol{list-style:none;margin:2px 5px 0;padding:2px 3px 1px;overflow:auto;min-height:0;border-top:1px solid var(--navora-stroke,#e4e9f0);scrollbar-width:thin}li{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-height:34px;border-top:1px solid var(--navora-stroke,#e4e9f0)}li:first-child{border-top:0}li>p{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0}.queue-item-actions{display:flex;gap:2px}.queue-item-actions button{width:26px;height:26px;display:grid;place-items:center;border:1px solid transparent;border-radius:6px;color:inherit;cursor:pointer}.queue-item-actions svg{width:14px;height:14px}button:hover:not(:disabled){background:var(--control-hover,#e9eef5);color:var(--navora-ink,#345576)}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:2px solid var(--navora-accent,#537ab9);outline-offset:-2px}
.queue-document-container{width:100%;margin:6px 0 0;padding:5px 7px;box-sizing:border-box;border:1px solid var(--appearance-composer-edge,#c5d2e1);border-radius:8px;background:var(--navora-surface,#fff)}
.queue-document-container :deep(.composer-richtext){min-height:70px;max-height:170px;font-size:13px}
.queue-edit-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;width:100%;gap:6px;padding-bottom:5px}.queue-edit-actions button{padding:4px 8px;border-radius:5px;color:var(--navora-accent,#416a96);cursor:default}.queue-edit-actions .queue-attach{display:flex;align-items:center;gap:5px;margin-right:auto}.queue-attach>.app-icon{width:14px;height:14px}.queue-edit-count{font-size:10px;margin-right:4px}.queue-edit-count.invalid{color:var(--control-danger,#b46760)}
.queue-declarations{font-size:10px;padding:2px 5px;border-radius:4px;background:var(--control-selected);color:var(--navora-accent)}
.queue-error{flex-basis:100%;padding-bottom:4px;font-size:10px;color:var(--control-danger,#b46760)}li>p.queue-edit-conflict{flex:0 0 100%;white-space:normal;padding:5px 0;color:var(--control-danger,#b46760);font-size:11px;line-height:1.5}
button{transition:background-color 140ms ease,color 140ms ease}@media(prefers-reduced-motion:reduce){button,.queue-chevron{transition:none}}
</style>
