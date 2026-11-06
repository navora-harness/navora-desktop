<template>
  <component :is="embedded ? 'div' : VDialog" v-if="!embedded || opened" v-bind="embedded ? {} : {modelValue:opened,maxWidth:860,contentClass:'composer-source-dialog'}" :class="{'source-embedded-host':embedded}" @update:model-value="opened=$event" @after-leave="afterClose">
    <section ref="pickerRoot" class="composer-source-picker" :class="{'is-embedded':embedded}" aria-label="选择附加来源">
      <header v-if="!embedded"><div><h2>{{ replacing ? '更改来源' : '附加' }}</h2><p>选择来源，确认后插入消息编辑器。</p></div><button type="button" class="ui-icon-button" aria-label="关闭附加" @click="opened=false"><AppIcon icon="xmark" /></button></header>
      <div class="source-picker-body">
        <nav v-if="!embedded" aria-label="上下文来源"><button v-for="item in tabs" :key="item.id" type="button" :class="{selected:tab===item.id}" :aria-pressed="tab===item.id" @click="switchTab(item.id)"><AppIcon :icon="item.icon" />{{ item.label }}</button><button type="button" class="source-import" :disabled="busy" @click="upload?.click()"><AppIcon icon="paperclip" />导入本地文件</button></nav>
        <input ref="upload" class="source-upload" type="file" multiple @change="importFiles(Array.from(($event.target as HTMLInputElement).files||[]))" />
        <main @keydown="sourceKey">
          <div v-if="tab==='text'||tab==='url'" class="source-manual">
            <section v-if="tab==='url'" class="source-url-history" aria-label="当前聊天的网址历史">
              <label class="source-search"><AppIcon icon="magnifying-glass" /><input v-model="query" aria-label="搜索网址历史" placeholder="搜索标题或网址" /></label>
              <p class="source-history-heading">最近访问</p>
              <p v-if="loading" class="source-history-empty" role="status">正在读取网址…</p>
              <div v-else-if="matches.length" class="source-url-options" role="listbox" aria-label="网址历史">
                <button v-for="item in matches" :key="item.id" type="button" role="option" :aria-selected="url===item.source.url" @click="selectHistory(item)"><AppIcon icon="globe" /><span><b>{{ item.label }}</b><small>{{ item.detail }}</small></span><AppIcon v-if="url===item.source.url" icon="check" /></button>
              </div>
              <p v-else class="source-history-empty">{{ historyError|| (query?'没有匹配的网址，可以手动输入。':'这个聊天还没有浏览记录，可以手动输入网址。') }}</p>
            </section>
            <label>名称<input v-model="label" placeholder="为这段资料命名" maxlength="512" /></label>
            <label v-if="tab==='url'">网址<input v-model="url" placeholder="https://example.com" inputmode="url" /></label>
            <label>{{ tab==='text'?'文字或代码':'补充说明（可选）' }}<textarea v-model="manualText" :rows="tab==='url'?3:8" :placeholder="tab==='url'?'补充希望 AI 了解的内容':'粘贴后可以继续在编辑器内修改；代码可在编辑器内设为代码块。'" /></label>
          </div>
          <template v-else>
            <label :class="embedded?'composer-attachment-search':'source-search'"><AppIcon icon="magnifying-glass" /><input v-model="query" aria-label="搜索来源" :placeholder="embedded?'搜索'+(tabs.find(item=>item.id===tab)?.label||'来源'):'搜索名称或路径'" role="searchbox" :aria-controls="listId" :aria-activedescendant="selected?`${listId}-${matches.findIndex(item=>item.id===selected?.id)}`:undefined" /><button v-if="!embedded" type="button" aria-label="刷新来源" :disabled="busy" @click="load"><AppIcon icon="arrow-rotate-right" /></button></label>
            <p v-if="!embedded&&tab==='page'" class="source-help">网页、选区与截图来自已打开的页面。不会自动导航或执行任务。</p>
            <div v-if="loading" class="source-empty" role="status">正在读取来源…</div>
            <div v-else :id="listId" class="source-options" :class="{'composer-attachment-options':embedded}" role="listbox" aria-label="可用来源">
              <button v-for="(item,index) in matches" :id="`${listId}-${index}`" :key="item.id" type="button" role="option" :tabindex="embedded?-1:0" :aria-selected="selected?.id===item.id" :class="{selected:selected?.id===item.id}" @pointermove="embedded&&selected?.id!==item.id&&choose(item)" @click="embedded?confirm(item):choose(item)"><AppIcon :icon="item.icon" /><span><b>{{ item.label }}</b><small>{{ item.detail }}</small></span></button>
              <p v-if="!matches.length" class="source-empty">{{ query?'没有匹配的来源':tab==='file'?'暂无对话文件，可以导入本地文件。':tab==='page'?'当前对话没有打开的网页。':tab==='message'?'暂无可引用的历史消息。':tab==='annotation'?'当前对话还没有已保存的批注。请先在网页中添加并保存批注。':'暂无可用来源。' }}</p>
            </div>
            <template v-if="selected&&!embedded"><p v-if="selected.resourceKind" class="source-help">将所选{{ selected.resourceKind==='skill'?'技能':'插件' }}内容作为资料附加。</p>
              <p v-if="replacing?.mode==='excerpt'&&mode==='reference'" class="source-warning">确认后会用来源引用替换已编辑的摘录副本；可在编辑器中撤销恢复。</p>
              <div class="source-controls"><label>显示名称<input v-model="label" maxlength="512" /></label><label>插入方式<select v-model="mode"><option value="reference" :disabled="hasFileRange||(selected.source.kind==='message'||!!selected.resourceKind)">来源引用</option><option value="excerpt" :disabled="referenceOnly||isImage||selected.source.kind==='session'">可编辑摘录</option></select></label></div>
              <div v-if="selected.source.kind==='file'" class="source-ranges"><label>起始行<input v-model.number="startLine" type="number" min="1" step="1" placeholder="全部" :aria-invalid="!!rangeError" /></label><label>结束行<input v-model.number="endLine" type="number" min="1" step="1" placeholder="全部" :aria-invalid="!!rangeError" /></label><button type="button" :disabled="busy||!!rangeError" @click="mode='excerpt';previewSelected()">读取范围</button></div>
              <p v-if="rangeError" class="source-warning" role="status">{{ rangeError }}</p>
              <p v-else-if="rangeUnconfirmed&&!busy" class="source-warning" role="status">范围已修改，请点击“读取范围”重新确认后插入。</p>
              <div v-if="selected.source.kind==='page'" class="source-page-actions"><button type="button" :disabled="busy" @click="extractPage(false)">读取页面正文</button><button type="button" :disabled="busy" @click="extractPage(true)">读取页面选区</button><button type="button" :disabled="busy" @click="capturePage">截取当前页面</button></div>
              <div v-if="busy" class="source-empty" role="status">正在准备预览…</div>
              <template v-else><img v-if="previewImage" class="source-image" :src="previewImage" alt="所选来源预览" /><label v-if="mode==='excerpt'" class="source-preview">摘录预览<textarea v-model="previewText" rows="6" placeholder="选择范围或读取来源后，可以在这里编辑。" /></label><p v-else class="source-help">以行内引用插在文字之间，资料副本请使用摘录。{{ selected.source.kind==='session'?'会话引用包含该会话的页面，不提取可编辑正文。':isImage?'图片以对话文件引用插入。':'可切换为摘录，编辑所选资料的副本。' }}</p></template>
              <p v-if="truncated" class="source-warning">预览已截断。请缩小范围，或在插入前检查并编辑摘录。</p>
              <p v-if="referenceOnly" class="source-warning">{{ reason || '此格式目前支持文件引用，尚不能提取可编辑文字。' }}</p>
            </template>
          </template>
          <div v-if="error" class="source-error" role="alert">{{ error }} <button type="button" :disabled="busy||loading" @click="retry">{{ failedAction==='import'?'重新选择文件':'重试' }}</button></div>
        </main>
      </div>
      <footer><span>{{ embedded?'↑↓ 选择 · Enter 确认 · Esc 返回':replacing?'确认后替换原来源块；取消会保留原内容。':'内容插入后仍可修改，发送前可移除。' }}</span><button type="button" class="ui-button" @click="opened=false">取消</button><button type="button" class="ui-button source-insert" :disabled="!canInsert||busy||loading" @click="insert">{{ replacing?'替换来源':'插入编辑器' }}</button></footer>
    </section>
  </component>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import {VDialog} from 'vuetify/components'
import {browserSessionLabel} from '@shared/browser-session'
import type {BrowserTreeSession,ChatMessage} from '@shared/types'
import type {WorkspaceResource} from '@shared/workspace-resources'
import {composerLinkUrl,type ComposerContextBlock,type ComposerContextSource} from '@shared/composer-document'
import type {ComposerExcerpt,ComposerImportFile,ComposerImportedFile} from '@shared/composer-sources'
import AppIcon from './icons/AppIcon.vue'
type Tab='file'|'page'|'annotation'|'message'|'text'|'url'|'session'|'skill'|'plugin'
type Option={id:string;label:string;detail:string;icon:string;source:ComposerContextSource;version?:string|number;text?:string;pageId?:string;annotationId?:string;mime?:string;resourceKind?:'skill'|'plugin';hasReadme?:boolean}
export type ComposerSourceInsert={block:ComposerContextBlock;text?:string;preview?:string}
const props=withDefaults(defineProps<{chatId:string;files?:WorkspaceResource[];messages?:ChatMessage[];embedded?:boolean}>(),{files:()=>[],messages:()=>[]})
const emit=defineEmits<{insert:[items:ComposerSourceInsert[],replacementId?:string];notify:[message:string];closed:[];'source-change':[source:string]}>()
const tabs:{id:Tab;label:string;icon:string}[]=[{id:'file',label:'对话文件',icon:'folder-open'},{id:'page',label:'浏览器页面',icon:'globe'},{id:'annotation',label:'已有批注',icon:'annotate'},{id:'message',label:'历史消息',icon:'comments'},{id:'text',label:'文字与代码',icon:'code'},{id:'url',label:'网址',icon:'link'},{id:'session',label:'浏览器会话',icon:'window-maximize'},{id:'skill',label:'技能',icon:'book'},{id:'plugin',label:'插件',icon:'puzzle-piece'}]
const pickerRoot=ref<HTMLElement>()
const listId=`composer-source-options-${crypto.randomUUID()}`
const opened=ref(false),tab=ref<Tab>('file'),query=ref(''),options=ref<Option[]>([]),selected=ref<Option|null>(null),loading=ref(false),busy=ref(false),error=ref(''),label=ref(''),mode=ref<'reference'|'excerpt'>('reference'),manualText=ref(''),url=ref(''),previewText=ref(''),previewImage=ref(''),sourceVersion=ref<string|number|undefined>(),truncated=ref(false),referenceOnly=ref(false),reason=ref(''),startLine=ref<number|string>(''),endLine=ref<number|string>(''),replacing=ref<ComposerContextBlock|null>(null),upload=ref<HTMLInputElement>(),readRange=ref<string|null>(null),failedAction=ref<'load'|'preview'|'capture'|'import'>('load')
let generation=0,owner='',lastExcerpt:ComposerExcerpt|null=null,lastSelection=false
const historyError=ref('')
const matches=computed(()=>options.value.filter(item=>(item.label+' '+item.detail+' '+(item.source.url||'')).toLowerCase().includes(query.value.toLowerCase())))
const isImage=computed(()=>selected.value?.source.kind==='image')
const hasFileRange=computed(()=>selected.value?.source.kind==='file'&&(startLine.value!==''||endLine.value!==''))
const rangeSignature=computed(()=>JSON.stringify([startLine.value,endLine.value]))
const rangeError=computed(()=>{if(selected.value?.source.kind!=='file')return '';try{currentRange();return ''}catch{return '请填写大于零的整数行号，结束行不能早于起始行。'}})
const rangeUnconfirmed=computed(()=>selected.value?.source.kind==='file'&&readRange.value!==rangeSignature.value)
const canInsert=computed(()=>opened.value&&!!owner&&owner===props.chatId&&!error.value&&!rangeError.value&&!rangeUnconfirmed.value&&(!hasFileRange.value||mode.value==='excerpt')&&(tab.value==='text'?!!manualText.value.trim():tab.value==='url'?!!composerLinkUrl(url.value)&&/^https?:/i.test(composerLinkUrl(url.value)||''):!!selected.value&&(mode.value==='reference'||(!referenceOnly.value&&!isImage.value&&selected.value.source.kind!=='session'&&!!previewText.value.trim()))))
function alive(ticket:number){return opened.value&&ticket===generation&&owner===props.chatId}
function resetPreview(){previewText.value='';previewImage.value='';sourceVersion.value=undefined;truncated.value=false;referenceOnly.value=false;reason.value='';lastExcerpt=null;readRange.value=null;error.value=''}
function clearRange(){startLine.value='';endLine.value=''}
function fileOption(file:WorkspaceResource):Option{return {id:file.path,label:file.name,detail:file.path,icon:file.kind==='image'?'image':file.kind==='code'?'code':'file-lines',source:{kind:file.kind==='image'?'image':'file',identity:file.path,path:file.path,chatId:owner},version:file.revision}}
function includeImported(files:ComposerImportedFile[]){const items=[...files.map(importOption),...options.value.filter(item=>item.source.kind==='file'||item.source.kind==='image'),...props.files.map(fileOption)],unique=new Map<string,Option>();for(const item of items)if(!unique.has(item.id))unique.set(item.id,item);options.value=[...unique.values()]}
async function show(source='file',replacement?:ComposerContextBlock,files?:File[]){
  generation++;owner=props.chatId;opened.value=true;replacing.value=replacement||null;selected.value=null;options.value=[];query.value='';label.value=replacement?.label||'';manualText.value='';url.value='';mode.value='reference';clearRange();resetPreview();busy.value=false;loading.value=false
  tab.value=tabs.some(item=>item.id===source)?source as Tab:'file'
  if(files?.length){await importFiles(files);return}
  await load()
  if(replacement){if(tab.value==='url')url.value=replacement.source.url||'';else{const found=options.value.find(item=>item.source.identity===replacement.source.identity);if(found)await choose(found)}}
  if(source==='import')void nextTick(()=>upload.value?.click())
  await nextTick();if(opened.value&&owner===props.chatId)pickerRoot.value?.querySelector<HTMLInputElement>('main input')?.focus({preventScroll:true})
}
async function switchTab(value:Tab){generation++;busy.value=false;tab.value=value;emit('source-change',value);selected.value=null;options.value=[];query.value='';label.value='';mode.value='reference';clearRange();resetPreview();await load()}
async function load(){
  const ticket=++generation;loading.value=true;busy.value=false;selected.value=null;historyError.value='';clearRange();resetPreview();failedAction.value='load';const chatId=owner,sourceTab=tab.value
  try{
    let next:Option[]=[]
    if(sourceTab==='file'){
      const snapshot=await window.navora!.workspace.resources(chatId,true)
      next=(snapshot?.entries||props.files).map(fileOption)
    }else if(sourceTab==='url'){
      const history=(await window.navora!.browser.workspace.startPage(chatId)).history
      const seen=new Set<string>()
      next=[...history].filter(item=>item.chatId===chatId).sort((a,b)=>b.visitedAt-a.visitedAt).flatMap(item=>{
        const value=composerLinkUrl(item.url)
        if(!value||!/^https?:/i.test(value)||seen.has(value))return []
        seen.add(value)
        return [{id:value,label:item.title||new URL(value).hostname,detail:`${new URL(value).host} · ${new Date(item.visitedAt).toLocaleDateString()}`,icon:'globe',source:{kind:'url' as const,identity:value,url:value,chatId},text:value}]
      }).slice(0,40)
    }else if(sourceTab==='page'||sourceTab==='session'){
      const sessions:BrowserTreeSession[]=await window.navora!.browser.tree(chatId)
      next=sourceTab==='session'?sessions.map(session=>({id:session.sessionId,label:browserSessionLabel(session),detail:`${session.windows.length} 个页面 · ${session.scope==='default'?'共享':session.persist?'持久':'临时'}`,icon:session.scope==='default'?'globe':'layer-group',source:{kind:'session',identity:session.sessionId,chatId,browserRef:{kind:'session',sessionId:session.sessionId,sessionIndex:session.sessionIndex,label:browserSessionLabel(session)}}})):sessions.flatMap(session=>session.windows.map(page=>({id:page.windowId,pageId:page.windowId,label:page.title||page.desiredUrl||page.url||'新标签页',detail:page.desiredUrl||page.url||'空白页面',icon:'globe',source:{kind:'page' as const,identity:page.windowId,chatId,url:page.desiredUrl||page.url,browserRef:{kind:'window' as const,windowId:page.windowId,sessionId:session.sessionId,sessionIndex:session.sessionIndex,label:page.title||'网页',url:page.desiredUrl||page.url}}})))
    }else if(sourceTab==='message'){
      next=props.messages.filter(message=>message.role==='user'||message.role==='assistant').map(message=>({id:message.id,label:(message.role==='user'?'我：':'助手：')+message.content.replace(/\s+/g,' ').slice(0,64),detail:new Date(message.createdAt).toLocaleString(),icon:'comments',source:{kind:'message',identity:message.id,messageId:message.id,chatId},version:message.createdAt,text:message.content}))
    }else if(sourceTab==='annotation'){
      const annotations=(await window.navora!.browser.workspace.annotations(chatId)).sort((a,b)=>b.createdAt-a.createdAt)
      next=annotations.map(item=>({id:item.id,annotationId:item.id,label:item.comment||item.selection.title||'网页标注',detail:[item.selection.title,item.selection.url].filter(Boolean).join(' · '),icon:'annotate',source:{kind:'annotation' as const,identity:item.id,chatId,browserRef:{kind:'annotation' as const,sessionId:item.sessionId,windowId:item.pageId,annotationId:item.id,annotationRevision:item.revision,label:item.comment||'网页标注',url:item.selection.url}},version:item.revision}))
    }else if(sourceTab==='skill'){
      const skills=await window.navora!.skills.list()
      next=skills.map(item=>({id:item.id,label:item.name,detail:item.description,icon:'book',resourceKind:'skill',version:item.updatedAt,source:{kind:'text',identity:'skill:'+item.id,chatId}}))
    }else if(sourceTab==='plugin'){
      const plugins=await window.navora!.plugins.list()
      next=plugins.map(item=>({id:item.id,label:item.name,detail:item.description,icon:'puzzle-piece',resourceKind:'plugin',hasReadme:item.hasReadme,version:item.version,source:{kind:'text',identity:'plugin:'+item.id,chatId},text:[item.name,item.description,item.version?'版本：'+item.version:'',item.tools.length?'声明的工具：'+item.tools.join('、'):''].filter(Boolean).join('\n')}))
    }
    if(alive(ticket))options.value=next
  }catch(cause){if(alive(ticket)){if(sourceTab==='url')historyError.value='暂时无法读取历史，可以手动输入网址。';else error.value=message(cause)}}finally{if(alive(ticket))loading.value=false}
}
async function choose(item:Option){
  generation++;busy.value=false;selected.value=item;label.value=item.label;mode.value=item.source.kind==='message'||item.resourceKind?'excerpt':replacing.value?.mode||'reference';clearRange();resetPreview()
  if(replacing.value?.source.identity===item.source.identity){startLine.value=replacing.value.range?.startLine||'';endLine.value=replacing.value.range?.endLine||''}
  loading.value=false
  if(props.embedded&&mode.value==='reference'&&!hasFileRange.value){sourceVersion.value=item.version;readRange.value=rangeSignature.value;return}
  await previewSelected()
}
async function confirm(item:Option){await choose(item);if(selected.value===item)insert()}
function selectHistory(item:Option){selected.value=item;url.value=item.source.url||'';label.value=item.label}
function currentRange(){
  function line(value:number|string){if(value==='')return undefined;const number=Number(value);if(!Number.isSafeInteger(number)||number<1)throw Error('请填写有效的起止行号。');return number}
  const start=line(startLine.value),end=line(endLine.value)
  if(start&&end&&start>end)throw Error('请填写有效的起止行号。')
  return start||end?{startLine:start,endLine:end}:undefined
}
async function previewSelected(selection=false){
  const item=selected.value;if(!item)return
  const ticket=++generation,requestedRangeSignature=rangeSignature.value;busy.value=true;loading.value=false;resetPreview();sourceVersion.value=item.version;lastSelection=selection;failedAction.value='preview'
  try{
    if(item.resourceKind){
      let text=item.text||''
      if(item.resourceKind==='skill'){const detail=await window.navora!.skills.get(item.id);if(!detail)throw Error('此技能已移除，请刷新列表。');text=[detail.name,detail.description,detail.body].filter(Boolean).join('\n\n')}
      else if(item.hasReadme){const result=await window.navora!.plugins.readReadme(item.id);if(!result.ok)throw Error('插件说明读取失败，请重试。');text+='\n\n'+(result.markdown||'')}
      if(alive(ticket)){mode.value='excerpt';previewText.value=text.slice(0,120000);truncated.value=text.length>120000;readRange.value=requestedRangeSignature}
      return
    }
    if(item.source.kind==='message'){if(alive(ticket))previewText.value=item.text||'';return}
    if(item.source.kind==='session')return
    const result=await window.navora!.composer.contextExcerpt(owner,{kind:item.source.kind==='file'||item.source.kind==='image'?'file':item.source.kind==='annotation'?'annotation':'page',path:item.source.path,pageId:item.pageId,annotationId:item.annotationId,range:item.source.kind==='file'?currentRange():undefined,selection})
    if(!alive(ticket))return
    lastExcerpt=result;readRange.value=requestedRangeSignature;previewText.value=result.text;sourceVersion.value=result.sourceVersion;truncated.value=result.truncated;referenceOnly.value=!!result.referenceOnly;reason.value=result.reason||''
    if(result.thumbnail)previewImage.value=`data:${result.thumbnail.mime};base64,${result.thumbnail.base64}`
    if(result.referenceOnly)mode.value='reference'
    if(item.source.kind==='image'&&!result.thumbnail){const media=await window.navora!.workspace.readMedia(owner,item.source.path!);if(!alive(ticket))return;if(media.ok&&/^image\/(png|jpeg|webp|gif)$/.test(media.mime||''))previewImage.value=`data:${media.mime};base64,${media.base64}`}
  }catch(cause){if(alive(ticket))error.value=message(cause)}finally{if(alive(ticket))busy.value=false}
}
async function extractPage(selection:boolean){mode.value='excerpt';await previewSelected(selection)}
async function capturePage(){
  const item=selected.value;if(!item?.pageId)return
  const ticket=++generation;busy.value=true;error.value='';failedAction.value='capture'
  try{
    const result=await window.navora!.composer.contextExcerpt(owner,{kind:'page',pageId:item.pageId,capture:true})
    if(!alive(ticket))return
    if(!result.file)throw Error('截图未生成，请重试。')
    const imported=result.file;resetPreview();clearRange();tab.value='file';query.value='';includeImported([imported]);selected.value=importOption(imported);label.value=imported.name;mode.value='reference';sourceVersion.value=imported.sourceVersion;previewImage.value=result.thumbnail?`data:${result.thumbnail.mime};base64,${result.thumbnail.base64}`:''
  }catch(cause){if(alive(ticket))error.value=message(cause)}finally{if(alive(ticket))busy.value=false}
}
function importOption(file:ComposerImportedFile):Option{return {id:file.path,label:file.name,detail:file.path,icon:file.source.kind==='image'?'image':'file-lines',source:file.source,version:file.sourceVersion,mime:file.mime}}
async function importFiles(files:File[]){
  if(!files.length)return
  const ticket=++generation;busy.value=true;loading.value=false;error.value='';failedAction.value='import'
  try{
    if(files.length>20)throw Error('每次最多导入 20 个文件。')
    if(files.some(file=>file.size>12*1024*1024)||files.reduce((size,file)=>size+file.size,0)>32*1024*1024)throw Error('单个文件最大 12 MB，每次导入合计最大 32 MB。')
    if(files.some(file=>file.size===0))throw Error('空文件不能作为上下文导入，请选择其他文件。')
    const inputs:ComposerImportFile[]=await Promise.all(files.map(async file=>({name:file.name,mime:file.type,base64:await readFile(file)})))
    if(!alive(ticket))return
    const imported:ComposerImportedFile[]=await window.navora!.composer.importContextFiles(owner,inputs)
    if(!alive(ticket))return
    tab.value='file';query.value='';clearRange();resetPreview();includeImported(imported)
    if(imported.length===1){busy.value=false;await choose(importOption(imported[0]!))}
    else{emit('notify',`已导入 ${imported.length} 个文件，请选择需要附加的来源。`);selected.value=null}
  }catch(cause){if(alive(ticket))error.value=message(cause)}finally{if(alive(ticket))busy.value=false;if(upload.value)upload.value.value=''}
}
function readFile(file:File){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('文件读取失败。'));reader.onload=()=>resolve(String(reader.result).split(',').slice(1).join(','));reader.readAsDataURL(file)})}
function insert(){
  if(!canInsert.value||busy.value||loading.value||owner!==props.chatId)return
  let source:ComposerContextSource,text='',version=sourceVersion.value,range:ComposerContextBlock['range']
  if(tab.value==='text'){source={kind:'text',identity:crypto.randomUUID(),chatId:owner};text=manualText.value;mode.value='excerpt'}
  else if(tab.value==='url'){source={kind:'url',identity:composerLinkUrl(url.value)!,url:composerLinkUrl(url.value)!,chatId:owner};text=manualText.value;mode.value='reference'}
  else{const item=selected.value!;source=lastExcerpt?.source||item.source;text=mode.value==='excerpt'?previewText.value:'';range=lastExcerpt?.range}
  const block:ComposerContextBlock={id:replacing.value?.id||crypto.randomUUID(),source,mode:mode.value,label:(selected.value?.resourceKind?(selected.value.resourceKind==='skill'?'技能 · ':'插件 · '):'')+(label.value.trim()||(tab.value==='text'?'文字片段':tab.value==='url'?url.value:'来源')),status:'ready',...(version!==undefined?{version}:{}),...(range?{range}:{})}
  emit('insert',[{block,text,preview:previewImage.value||undefined}],replacing.value?.id);opened.value=false
}
function afterClose(){if(opened.value)return;generation++;busy.value=false;loading.value=false;emit('closed')}
function sourceKey(event:KeyboardEvent){
  if(event.isComposing||event.keyCode===229)return
  const target=event.target as HTMLElement
  if(tab.value==='url'&&target.closest('.source-url-history')){
    const items=matches.value
    if(!items.length)return
    const current=items.findIndex(item=>item.id===selected.value?.id)
    if(event.key==='Enter'){event.preventDefault();event.stopPropagation();selectHistory(items[Math.max(0,current)]!);return}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();event.stopPropagation()
      const index=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length
      selectHistory(items[index]!);pickerRoot.value?.querySelectorAll<HTMLButtonElement>('.source-url-options>button')[index]?.scrollIntoView({block:'nearest'})
    }
    return
  }
  if(!target.closest('.source-search,.composer-attachment-search,.source-options'))return
  if(props.embedded&&event.key==='Enter'){event.preventDefault();event.stopPropagation();insert();return}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||!matches.value.length)return
  event.preventDefault();event.stopPropagation()
  const buttons=[...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('.source-options>button')]
  const at=props.embedded?matches.value.findIndex(item=>item.id===selected.value?.id):buttons.indexOf(target as HTMLButtonElement)
  const index=event.key==='Home'?0:event.key==='End'?matches.value.length-1:(at+(event.key==='ArrowDown'?1:-1)+matches.value.length)%matches.value.length
  if(props.embedded)void choose(matches.value[index]!)
  else buttons[index]?.focus()
  buttons[index]?.scrollIntoView({block:'nearest'})
}
function retry(){if(failedAction.value==='import'){upload.value?.click();return}if(failedAction.value==='capture'){void capturePage();return}if(failedAction.value==='preview'&&selected.value){void previewSelected(lastSelection);return}void load()}
function message(cause:unknown){const raw=cause instanceof Error?cause.message:String(cause);if(/wrong_chat|access_denied|not_found|ENOENT|missing/i.test(raw))return '来源已失效或不属于当前对话，请重新选择。';if(/selection_empty/.test(raw))return '请先在网页中选择需要摘录的文字，再读取选区。';if(/source_changed/.test(raw))return '来源在读取期间发生变化，请重新读取并确认。';if(/source_busy/.test(raw))return '页面正在执行任务或选择标注，请完成后重试。';if(/source_timeout/.test(raw))return '页面响应超时，请稍后重试。';if(/capture_active_page_only/.test(raw))return '请先将此页面切换为所在工作区或窗口的当前标签页，再截图。';if(/capture_unavailable/.test(raw))return '页面暂时无法截图，请待页面显示完整后重试。';if(/excerpt_range_unavailable/.test(raw))return '所选起始行超出文件范围，请调整行号后重新读取。';if(/invalid_composer_range/.test(raw))return '请填写有效的起止行号。';if(/file_too_large|files_too_large/.test(raw))return '单个文件最大 12 MB，每次导入合计最大 32 MB。';return raw.replace(/^Error invoking remote method '[^']+': Error:\s*/,'')||'无法读取来源，请重试。'}
watch(opened,(open,previous)=>{if(props.embedded&&!open&&previous)afterClose()})
watch([matches,query,loading],([items,search,isLoading],previous)=>{
  if(!props.embedded||!opened.value||isLoading||tab.value==='text'||tab.value==='url')return
  if(items.length){if(search!==previous[1]||!items.some(item=>item.id===selected.value?.id))void choose(items[0]!)}
  else if(selected.value){generation++;busy.value=false;selected.value=null;label.value='';clearRange();resetPreview()}
})
onBeforeUnmount(()=>{opened.value=false;generation++})
watch(()=>props.chatId,()=>{if(opened.value)opened.value=false;generation++})
watch([startLine,endLine],()=>{if(selected.value?.source.kind==='file'&&!referenceOnly.value&&(startLine.value!==''||endLine.value!==''))mode.value='excerpt'})
defineExpose({show})
</script>
<style>
.source-url-history{min-width:0;padding-bottom:10px;border-bottom:1px solid var(--navora-stroke)}
.source-manual .source-url-history>.source-search{flex-direction:row;align-items:center;gap:8px}
.source-manual .source-url-history>.source-search input{flex:1;min-width:0;width:0;border:0;border-radius:0;padding:5px 0;background:transparent}
.source-history-heading{margin:12px 0 5px;font-size:11px;color:var(--navora-muted)}
.source-url-options{max-height:150px;overflow:auto;overscroll-behavior:contain}
.source-url-options>button{display:flex;align-items:center;gap:9px;width:100%;padding:7px 6px;text-align:left;border-radius:6px;color:var(--navora-ink)}
.source-url-options>button:hover,.source-url-options>button[aria-selected=true]{background:var(--control-hover)}
.source-url-options>button>span{min-width:0;flex:1}.source-url-options b,.source-url-options small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.source-url-options b{font-size:12px;font-weight:500}.source-url-options small,.source-history-empty{font-size:11px;line-height:1.6;color:var(--navora-muted)}
.source-history-empty{margin:8px 0}.source-url-options>button:focus-visible{outline:2px solid var(--navora-accent);outline-offset:-2px}
.composer-source-dialog{border-radius:12px!important;overflow:hidden}
.composer-source-picker{background:var(--navora-surface);color:var(--navora-ink);font-size:13px;display:flex;flex-direction:column;height:min(660px,88dvh);max-height:min(760px,88dvh);-webkit-app-region:no-drag}
.composer-source-picker>header{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--navora-stroke);gap:16px}
.composer-source-picker h2{font-size:17px;margin:0;font-weight:600}.composer-source-picker header p{margin:4px 0 0;color:var(--navora-muted);font-size:12px}
.source-picker-body{display:flex;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden}.source-picker-body nav{width:164px;flex-shrink:0;background:var(--navora-sidebar);padding:10px;border-right:1px solid var(--navora-stroke);display:flex;flex-direction:column;gap:4px;overflow:auto}
.source-picker-body nav>button,.source-advanced>button,.source-advanced>summary{display:flex;align-items:center;gap:10px;min-height:36px;padding:9px 10px;border:0;border-radius:7px;background:transparent;color:var(--navora-muted);font:inherit;text-align:left;cursor:default}
.source-picker-body svg{width:15px;height:15px;flex-shrink:0}.source-picker-body nav>button:hover:not(:disabled),.source-advanced>button:hover,.source-advanced>summary:hover{background:var(--control-hover);color:var(--navora-ink)}
.source-picker-body nav>button.selected,.source-advanced>button.selected{background:var(--control-selected);color:var(--navora-accent)}
.source-advanced{margin-top:4px;border-top:1px solid var(--navora-stroke);padding-top:4px}.source-advanced>summary{list-style:none;gap:6px;font-size:12px;user-select:none}.source-advanced>summary::-webkit-details-marker{display:none}.source-advanced>summary::after{content:'';width:6px;height:6px;margin-left:auto;border-right:1px solid currentColor;border-bottom:1px solid currentColor;transform:rotate(-45deg)}.source-advanced[open]>summary::after{transform:rotate(45deg)}.source-advanced>button{width:100%;padding-left:13px;font-size:12px}
.source-picker-body nav>.source-import{margin-top:auto;font-size:12px;border-top:1px solid var(--navora-stroke);border-radius:0;padding-top:13px}.source-upload{display:none}
.source-picker-body main{min-width:0;flex:1;padding:16px 20px;overflow:auto}.source-search{display:flex;align-items:center;border:1px solid var(--navora-stroke);border-radius:8px;padding:5px 9px;gap:8px;color:var(--navora-muted)}.source-search input{flex:1;min-width:0;outline:none;padding:5px 0;color:var(--navora-ink);background:transparent}.source-search button{width:26px;height:26px;display:grid;place-items:center;border-radius:5px}.source-search button:hover:not(:disabled){background:var(--control-hover)}
.source-options{max-height:200px;overflow:auto;margin-top:8px;border-bottom:1px solid var(--navora-stroke);padding-bottom:8px}.source-options>button{width:100%;display:flex;gap:10px;align-items:center;text-align:left;padding:8px;border-radius:7px;color:var(--navora-ink)}.source-options>button:hover{background:var(--control-hover)}.source-options>button.selected{background:var(--control-selected);color:var(--navora-accent)}.source-options span{min-width:0;flex:1}.source-options b,.source-options small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-options b{font-size:12px;font-weight:500}.source-options small{font-size:11px;color:var(--navora-muted);margin-top:2px}
.source-empty{padding:22px 8px;text-align:center;color:var(--navora-muted);font-size:12px}.source-help{font-size:12px;color:var(--navora-muted);margin:9px 0;line-height:1.6}.source-controls,.source-ranges{display:flex;gap:12px;margin:12px 0}.source-controls label:first-child{flex:1}.source-controls label,.source-ranges label,.source-manual label,.source-preview{display:flex;flex-direction:column;gap:6px;min-width:0;color:var(--navora-muted);font-size:12px}
.source-controls input,.source-controls select,.source-ranges input,.source-manual input,.source-manual textarea,.source-preview textarea{box-sizing:border-box;padding:8px;border:1px solid var(--navora-stroke);border-radius:7px;outline:none;color:var(--navora-ink);background:var(--navora-surface);width:100%;font:inherit}.composer-source-picker input::placeholder,.composer-source-picker textarea::placeholder{color:var(--navora-muted)}
.source-ranges{align-items:flex-end}.source-ranges input{max-width:100px}.source-ranges button,.source-page-actions button,.source-error button{color:var(--navora-accent);font-size:12px;padding:7px;border-radius:6px}.source-page-actions{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.source-page-actions button{background:var(--navora-header);border:1px solid var(--navora-stroke)}.source-ranges button:hover:not(:disabled),.source-page-actions button:hover:not(:disabled),.source-error button:hover:not(:disabled){background:var(--control-hover)}
.source-manual{display:flex;flex-direction:column;gap:14px}.source-preview textarea,.source-manual textarea{resize:vertical;min-height:100px;max-height:260px;line-height:1.6}.source-image{max-width:100%;max-height:220px;display:block;margin:10px auto;border:1px solid var(--navora-stroke);border-radius:8px;object-fit:contain}.source-warning{font-size:12px;color:var(--navora-ink);line-height:1.6;border-left:2px solid var(--navora-accent);padding-left:9px}
.source-error{background:color-mix(in srgb,var(--control-danger) 7%,var(--navora-surface));border:1px solid color-mix(in srgb,var(--control-danger) 32%,var(--navora-stroke));color:var(--control-danger);font-size:12px;padding:9px 12px;border-radius:7px;margin-top:12px;overflow-wrap:anywhere}
.composer-source-picker footer{flex:0 0 auto;display:flex;align-items:center;gap:8px;border-top:1px solid var(--navora-stroke);padding:12px 20px}.composer-source-picker footer>span{font-size:11px;color:var(--navora-muted);flex:1}.composer-source-picker footer button{padding:7px 12px}.composer-source-picker .source-insert{background:var(--control-selected);color:var(--navora-accent);border-color:var(--navora-accent)}.composer-source-picker button:disabled{opacity:.45}.composer-source-picker button:focus-visible,.composer-source-picker summary:focus-visible,.composer-source-picker input:focus-visible,.composer-source-picker select:focus-visible,.composer-source-picker textarea:focus-visible{outline:2px solid var(--navora-accent);outline-offset:1px}
@media(max-width:600px){.source-picker-body nav{width:122px;padding:6px}.source-picker-body nav>button,.source-advanced>button,.source-advanced>summary{padding:8px 6px;font-size:11px;gap:5px}.source-picker-body main{padding:12px}.source-controls{flex-direction:column}.composer-source-picker footer>span{display:none}}
.composer-source-picker footer button{border:1px solid var(--navora-stroke);border-radius:7px;cursor:default}.composer-source-picker footer button:hover:not(:disabled){background:var(--control-hover)}
.source-embedded-host{display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}
.composer-source-picker.is-embedded{height:auto;max-height:none;min-height:0;flex:1;width:100%;font-size:12px}
.is-embedded .source-picker-body nav{width:142px;padding:7px}.is-embedded .source-picker-body nav>button{min-height:32px;padding:7px;font-size:12px;gap:7px}
.is-embedded .source-picker-body main{display:flex;flex-direction:column;min-height:0;padding:0 7px;overflow:hidden}.is-embedded footer{padding:7px 13px;justify-content:flex-end}.is-embedded footer>span{display:block;font-size:10px}
.is-embedded .source-options{display:flex;flex-direction:column;max-height:none;margin:0;border:0;padding:3px 0;flex:1;min-height:0}.is-embedded .source-options>button{flex-shrink:0;min-height:38px;padding:7px 9px}.is-embedded .source-options b{font-size:12px;font-weight:400}.is-embedded .source-options small{font-size:10px}.is-embedded .source-manual{padding:10px 6px;overflow:auto}.is-embedded .source-preview textarea,.is-embedded .source-manual textarea{min-height:80px;max-height:180px}
.is-embedded .composer-attachment-search input:focus-visible{outline:none}.is-embedded .source-error{flex-shrink:0;margin:7px 0}.is-embedded .source-empty{font-size:12px}
@media(max-width:520px){.is-embedded .source-picker-body{flex-direction:column}.is-embedded .source-picker-body nav{flex-direction:row;flex-wrap:wrap;width:auto;max-height:116px;border-right:0;border-bottom:1px solid var(--navora-stroke);gap:2px}.is-embedded .source-picker-body nav>button{font-size:11px;padding:5px;min-height:28px}.is-embedded .source-picker-body nav>.source-import{margin:0;padding:5px;border-top:0}.is-embedded footer{justify-content:flex-end}}
</style>
