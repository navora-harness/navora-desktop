<template>
  <aside class="file-preview" :data-chat-id="chatId" :class="{embedded}" aria-label="文件预览" :style="{ '--preview-width': `${width}px` }">
    <div v-if="!embedded" class="preview-resizer" role="separator" aria-label="调整文件预览宽度" aria-orientation="vertical" :aria-valuenow="width" aria-valuemin="280" aria-valuemax="maximum" tabindex="0" @pointerdown="beginResize" @keydown="resizeKey" />
    <Teleport :to="toolbarTarget||'body'" :disabled="!toolbarTarget||!headerActive"><header class="preview-head" :class="{'is-workspace-tools':!!toolbarTarget&&headerActive&&!windowToolbar,'is-window-tools':windowToolbar}" @contextmenu="fileActions.show({chatId,path},$event)">
      <AppIcon v-if="!tabbed" icon="file" />
      <div v-if="!tabbed" class="preview-name" :title="path">{{ name }}</div>
      <button v-if="tabbed&&nativeMenus.menusSupported.value" type="button" class="preview-type" aria-label="文件显示方式" aria-haspopup="menu" :aria-expanded="nativeMenuOpen==='display'" @click="showNativeMenu('display',$event)"><AppIcon :icon="data?.kind==='image'?'image':'file-lines'" />{{ data?.kind==='image'?'图像':data?.kind==='markdown'?(source?'源码':'Markdown'):data?.kind==='text'?'文本':'文件' }}<AppIcon icon="chevron-down" /></button>
      <v-menu v-else-if="tabbed" location="bottom start" origin="auto" :offset="6"><template #activator="{props:menuProps}"><button v-bind="menuProps" type="button" class="preview-type" aria-label="文件显示方式"><AppIcon :icon="data?.kind==='image'?'image':'file-lines'" />{{ data?.kind==='image'?'图像':data?.kind==='markdown'?(source?'源码':'Markdown'):data?.kind==='text'?'文本':'文件' }}<AppIcon icon="chevron-down" /></button></template><div class="preview-open-menu" role="menu"><button v-if="data?.kind==='markdown'" type="button" role="menuitem" @click="source=false">Markdown 预览</button><button v-if="data?.content!==undefined" type="button" role="menuitem" @click="source=true">文本源码</button><span v-if="data?.content===undefined">{{ data?.kind==='image'?'图像预览':'使用默认应用打开此文件' }}</span></div></v-menu>
      <div v-if="windowToolbar" class="preview-name" :title="path">{{ path }}</div>
      <span v-if="windowToolbar&&data?.ok" class="preview-file-info" :title="data.truncated?'仅显示前 256 KB':formatSize(data.size||0)">{{ data.truncated?'前 256 KB':formatSize(data.size||0) }}</span>
      <span v-if="tabbed&&!windowToolbar" class="preview-spacer" />
      <select v-if="data?.kind==='image'" v-model="imageZoom" class="preview-zoom" aria-label="图片缩放"><option value="fit">适应窗口</option><option value="50">50%</option><option value="100">100%</option><option value="150">150%</option><option value="200">200%</option></select>
      <button type="button" title="刷新预览" aria-label="刷新预览" :disabled="loading" @click="load(true)"><AppIcon icon="arrow-rotate-right" /></button>
      <div class="preview-open-group"><button type="button" class="preview-open-default" title="使用默认应用打开" aria-label="在系统中打开" @click="systemOpen"><AppIcon icon="folder-open" /><span>系统打开</span></button><button v-if="nativeMenus.menusSupported.value" type="button" aria-label="打开文件选项" aria-haspopup="menu" :aria-expanded="nativeMenuOpen==='open'" @click="showNativeMenu('open',$event)"><AppIcon icon="chevron-down" /></button><v-menu v-else location="bottom end" origin="auto" :offset="6"><template #activator="{props:menuProps}"><button v-bind="menuProps" type="button" aria-label="打开文件选项"><AppIcon icon="chevron-down" /></button></template><div class="preview-open-menu" role="menu"><button type="button" role="menuitem" @click="reveal">打开所在文件夹</button><button type="button" role="menuitem" :disabled="saving" @click="saveAs">另存为…</button></div></v-menu></div>
      <button v-if="windowToolbar" type="button" class="preview-more" aria-label="文件更多操作" title="文件更多操作" aria-haspopup="menu" @click="fileActions.show({chatId,path},$event)"><AppIcon icon="ellipsis" /></button>
      <SidebarMoreMenu v-if="!tabbed" label="文件预览" hide-label="隐藏文件侧栏" hide-aria-label="关闭文件预览" @hide="emit('close')" />
    </header></Teleport>
    <div v-if="data?.ok&&!windowToolbar" class="preview-tools">
      <span>{{ formatSize(data.size || 0) }}</span>
      <span v-if="loading" role="status">更新中…</span>
      <span v-if="data.truncated">仅显示前 256 KB</span>
      <span class="preview-spacer" />
      <button v-if="data.kind === 'markdown' && !tabbed" type="button" :aria-pressed="!source" @click="source = !source">{{ source ? '预览' : '源码' }}</button>
      <button v-if="data.content !== undefined" type="button" @click="copy">{{ copied ? '已复制' : '复制' }}</button>
    </div>
    <div ref="previewContent" class="preview-content" :aria-busy="loading">
      <div v-if="loading && !data" class="preview-empty" role="status">正在读取…</div>
      <div v-else-if="error" class="preview-empty" role="alert"><span>{{ error }}</span><button type="button" @click="load()">重试</button></div>
      <template v-else-if="data">
        <div v-if="data.kind === 'image'" class="preview-image" :class="imageZoom==='fit'?'fit':'zoomed'"><img :style="imageZoom==='fit'?{}:{width:`${imageNaturalWidth*Number(imageZoom)/100}px`,maxWidth:'none'}" @load="imageNaturalWidth=($event.target as HTMLImageElement).naturalWidth" :src="`data:${data.mime};base64,${data.base64}`" :alt="name" @error="error = '无法显示此图片'" /></div>
        <div v-else-if="data.kind === 'markdown' && !source" class="preview-markdown" v-html="markdown" @click="onLink" />
        <pre v-else-if="data.content !== undefined" class="preview-code" tabindex="0"><code>{{ data.content || '（空文件）' }}</code></pre>
        <div v-else class="preview-empty"><AppIcon icon="file" /><span>此文件暂不支持预览</span><p class="preview-format-hint">{{unsupportedHint}}</p><button type="button" @click="systemOpen">在系统中打开</button></div>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onActivated, onDeactivated, ref, useId, watch } from 'vue'
import DOMPurify from 'dompurify'
import { renderMarkdown } from '@/utils/markdown'
import SidebarMoreMenu from './sidebar/SidebarMoreMenu.vue'
import {workspaceLinkPath} from '@shared/file-tabs'
import type { WorkspacePreview } from '../../shared/workspace-preview'
import {useNativeUi} from '@/composables/useNativeUi'
import type {NativeMenuItem} from '@shared/native-ui'
import {useWorkspaceFileActions} from '@/composables/useWorkspaceFileActions'
import {openWindowFind,registerWindowFindTarget} from '@/composables/useWindowFind'
import {findConversationText} from '@shared/conversation-find'
import {createPreviewRangeIndex} from '@shared/preview-find'
import type {WindowFindOptions,WindowFindState} from '@shared/window-find'

const props = defineProps<{ chatId: string; path: string; width: number; embedded?: boolean; tabbed?: boolean; active?:boolean; toolbarTarget?:HTMLElement|null;windowToolbar?:boolean }>()
const emit = defineEmits<{ close: []; resize: [width: number]; notify: [text: string, color?: string]; openFile:[path:string,chatId:string] }>()
const data = ref<WorkspacePreview | null>(null)
const loading = ref(false)
const error = ref('')
const source = ref(false)
const imageZoom=ref('fit'),imageNaturalWidth=ref(0)
let active=true,dirty=false
const copied = ref(false)
const saving=ref(false)
const headerActive=ref(true)
const previewContent=ref<HTMLElement|null>(null),previewRevision=ref(0)
const nativeMenus=useNativeUi(),nativeMenuOpen=ref('')
const fileActions=useWorkspaceFileActions({open:(path,chatId)=>{if(chatId!==props.chatId){emit('notify','来源对话已切换，请重新打开文件。');return}emit('openFile',path,chatId)},notify:text=>emit('notify',text),isCurrent:target=>!disposed&&active&&props.active!==false&&headerActive.value&&target.chatId===props.chatId&&target.path===props.path})
let nativeMenuEpoch=0
const maximum = ref(Math.max(280, Math.min(800, innerWidth - 360)))
const unsupportedHint=computed(()=>data.value?.reason==='image_too_large'?'图片超过 12 MB，请使用系统应用打开。':data.value?.reason==='encoding'?'仅支持 UTF-8 和带 BOM 的 UTF-16 文本，请使用系统应用打开此编码。':'支持文本、Markdown 和常见图片；PDF、Office、音视频及压缩包请使用系统应用打开。')
const name = computed(() => props.path.split(/[\\/]/).at(-1) || props.path)
const markdown = computed(() => DOMPurify.sanitize(renderMarkdown(data.value?.content || ''), { FORBID_ATTR: ['style'], FORBID_TAGS: ['img', 'video', 'audio', 'iframe', 'object', 'embed', 'style', 'form', 'input', 'button', 'textarea', 'select'] }))
let sequence = 0
let disposed = false
let copiedTimer: ReturnType<typeof setTimeout> | undefined
let reloadTimer: ReturnType<typeof setTimeout> | undefined
let stopResize: (() => void) | undefined
let unsubscribe: (() => void) | undefined

async function load(preserve=false) {
  const seq = ++sequence
  previewRevision.value++
  loading.value = true
  error.value = ''
  if(!preserve)data.value = null
  const chatId = props.chatId, path = props.path
  try {
    const result = await window.navora!.workspace.preview(chatId, path)
    if (disposed || seq !== sequence) return
    if (!result.ok) throw new Error(result.error || 'preview_failed')
    data.value = result
  } catch (err) {
    if (disposed || seq !== sequence) return
    data.value=null
    const message = String(err)
    error.value = /ENOENT|not_found/.test(message) ? '文件已移走或删除' : /outside_workspace/.test(message) ? '文件不在当前工作区内' : '无法读取此文件'
  } finally { if (!disposed && seq === sequence) loading.value = false }
}
watch(() => [props.chatId, props.path], () => { nativeMenuEpoch++;nativeMenuOpen.value='';void nativeMenus.closeMenu();source.value = false; copied.value = false; imageZoom.value='fit'; void load() }, { immediate: true })
async function showNativeMenu(kind:'display'|'open',event:MouseEvent){
  if(kind==='open'){await fileActions.show({chatId:props.chatId,path:props.path},event,'openWith');return}
  if(nativeMenuOpen.value===kind){nativeMenuOpen.value='';nativeMenuEpoch++;await nativeMenus.closeMenu();return}
  const epoch=++nativeMenuEpoch,chatId=props.chatId,path=props.path,anchor=event.currentTarget as HTMLElement
  const items:NativeMenuItem[]=[
    ...(data.value?.kind==='markdown'?[{id:'preview',label:'Markdown 预览',type:'radio' as const,checked:!source.value}]:[]),
    ...(data.value?.content!==undefined?[{id:'source',label:'文本源码',type:'radio' as const,checked:data.value.kind!=='markdown'||source.value}]:[])
  ]
  if(!items.length)items.push({id:'info',label:data.value?.kind==='image'?'图像预览':'使用默认应用打开此文件',enabled:false})
  nativeMenuOpen.value=kind
  try{
    const result=await nativeMenus.popupMenu(items,anchor,{placement:'bottom-start',contextKey:`file:${chatId}:${path}`})
    if(disposed||epoch!==nativeMenuEpoch||props.chatId!==chatId||props.path!==path||!headerActive.value||!result.supported)return
    if(result.selectedId==='preview'&&data.value?.kind==='markdown')source.value=false
    else if(result.selectedId==='source'&&data.value?.content!==undefined)source.value=true
    else if(result.selectedId==='reveal')await reveal()
    else if(result.selectedId==='save'&&!saving.value)await saveAs()
  }catch{if(!disposed&&epoch===nativeMenuEpoch)emit('notify','菜单暂时无法打开，请重试。')}
  finally{if(epoch===nativeMenuEpoch)nativeMenuOpen.value=''}
}
async function systemOpen() {
  try {
    await fileActions.perform({chatId:props.chatId,path:props.path},'system')
  } catch { emit('notify', '无法打开此文件') }
}
async function reveal(){try{const result=await window.navora!.workspace.reveal(props.chatId,props.path);if(!result.ok)throw Error()}catch{emit('notify','无法打开所在文件夹')}}
async function saveAs(){if(saving.value)return;saving.value=true;try{await fileActions.perform({chatId:props.chatId,path:props.path},'saveAs')}catch(error){emit('notify',error instanceof Error?error.message:'无法保存此文件')}finally{saving.value=false}}
async function copy() {
  const content = data.value?.content
  if (content === undefined) return
  try {
    await fileActions.perform({chatId:props.chatId,path:props.path},'copyContent')
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = false }, 1500)
  } catch(error) { emit('notify', error instanceof Error?error.message:'复制失败') }
}
function onLink(event: MouseEvent) {
  const anchor = (event.target as Element).closest('a')
  if (!anchor) return
  event.preventDefault()
  const url = anchor.getAttribute('href') || ''
  if (/^https?:\/\//i.test(url)) void window.navora?.app.openExternal(url)
  else if(url.startsWith('#')){
    try{(event.currentTarget as Element).querySelector(`#${CSS.escape(decodeURIComponent(url.slice(1)))}`)?.scrollIntoView({block:'nearest'})}catch{/* Unknown anchors stay in this document. */}
  }else { const path=workspaceLinkPath(url,props.path); if(path)emit('openFile',path,props.chatId);else emit('notify','无法打开此文件链接') }
}
function formatSize(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB` }
function clampWidth(value: number) { emit('resize', Math.max(280, Math.min(maximum.value, value))) }
function onResize() { if (props.embedded) return; maximum.value = Math.max(280, Math.min(800, innerWidth - 360)); if (props.width > maximum.value) clampWidth(props.width) }
function resizeKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  clampWidth(event.key === 'Home' ? 400 : event.key === 'End' ? maximum.value : props.width + (event.key === 'ArrowLeft' ? 20 : -20))
}
function beginResize(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  stopResize?.()
  const handle = event.currentTarget as HTMLElement
  const start = event.clientX, startWidth = props.width
  const move = (next: PointerEvent) => { clampWidth(startWidth + start - next.clientX) }
  const end = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    handle.removeEventListener('lostpointercapture', end)
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    stopResize = undefined
  }
  handle.setPointerCapture(event.pointerId)
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  handle.addEventListener('lostpointercapture', end)
  stopResize = end
}
function onKey(event: KeyboardEvent) {
  if (!active || props.active===false || event.defaultPrevented || event.isComposing) return
  const target = event.target as Element
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='f'&&target.closest('.file-preview')){event.preventDefault();event.stopPropagation();openWindowFind('workspace');return}
  if(event.key!=='Escape')return
  if (target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return
  if (target.closest('.file-preview')) { event.stopPropagation(); event.preventDefault(); emit('close') }
}
onMounted(() => {
  onResize()
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKey, true)
  unsubscribe = window.navora?.workspace.onChanged?.(event => {
    if (event.chatId !== props.chatId) return
    if (!active) { dirty=true; return }
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => { void load(true) }, 200)
  })
})
onDeactivated(()=>{active=false;headerActive.value=false;stopPreviewFind();nativeMenuEpoch++;nativeMenuOpen.value='';void nativeMenus.closeMenu()})
onActivated(()=>{active=true;headerActive.value=true;if(dirty){dirty=false;void load(true)}})
onBeforeUnmount(() => { disposed = true; sequence++; stopResize?.(); unsubscribe?.(); clearTimeout(reloadTimer); clearTimeout(copiedTimer); window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey, true) })

const previewFindState=ref<WindowFindState>({status:'idle',total:0,ordinal:0})
const findActive=computed(()=>props.active!==false&&headerActive.value&&!disposed)
const findContext=computed(()=>`${props.chatId}:${props.path}:${source.value?'source':'preview'}:${previewRevision.value}`)
const findUnavailable=computed(()=>loading.value?'正在读取文件，请稍后查找':error.value?error.value:!data.value?'正在准备文件预览':data.value.content===undefined?(data.value.kind==='image'?'图片预览不支持文字查找':'此文件暂不支持页内查找，请使用系统应用打开'):'')
const findUid=useId().replace(/[^a-zA-Z0-9_-]/g,'-'),highlightNames=[`navora-file-find-${findUid}`,`navora-file-find-active-${findUid}`]
type HighlightCtor=new(...ranges:Range[])=>unknown
const highlightHost=globalThis as unknown as {Highlight?:HighlightCtor;CSS?:{highlights?:Map<string,unknown>}}
let previewFindEngaged=false,previewFindQuery='',previewFindOptions:WindowFindOptions={caseSensitive:false,includeTools:false},previewFindGeneration=0,previewRanges:Range[]=[],previewMatchIndex=0,highlightStyle:HTMLStyleElement|undefined
function clearPreviewHighlights(){for(const name of highlightNames)highlightHost.CSS?.highlights?.delete(name)}
function stopPreviewFind(){previewFindEngaged=false;previewFindGeneration++;previewFindQuery='';previewRanges=[];previewMatchIndex=0;clearPreviewHighlights();previewFindState.value={status:'idle',total:0,ordinal:0}}
function highlightPreview(scroll=false){
  clearPreviewHighlights()
  const selected=previewRanges[previewMatchIndex]
  if(!findActive.value||!previewFindEngaged)return
  if(highlightHost.Highlight&&highlightHost.CSS?.highlights){
    if(!highlightStyle){highlightStyle=document.createElement('style');highlightStyle.textContent=`::highlight(${highlightNames[0]}){background:var(--control-selected);color:var(--navora-ink)}::highlight(${highlightNames[1]}){background:var(--navora-accent);color:var(--navora-surface)}`;document.head.append(highlightStyle)}
    highlightHost.CSS.highlights.set(highlightNames[0],new highlightHost.Highlight(...previewRanges))
    highlightHost.CSS.highlights.set(highlightNames[1],new highlightHost.Highlight(...(selected?[selected]:[])))
  }
  if(scroll&&selected&&previewContent.value){const box=previewContent.value.getBoundingClientRect(),rect=selected.getClientRects()[0]||selected.getBoundingClientRect();previewContent.value.scrollTop+=rect.top-box.top-box.height/3;if(rect.left<box.left||rect.right>box.right)previewContent.value.scrollLeft+=rect.left-box.left-16}
}
async function setPreviewFindQuery(query:string,options:WindowFindOptions){
  previewFindEngaged=true;previewFindQuery=query;previewFindOptions={...options}
  const generation=++previewFindGeneration,context=findContext.value
  clearPreviewHighlights();previewRanges=[];previewMatchIndex=0
  previewFindState.value={status:query.trim()?'searching':'idle',total:0,ordinal:0}
  if(!query.trim()||!findActive.value||findUnavailable.value)return
  await nextTick()
  if(generation!==previewFindGeneration||context!==findContext.value||!findActive.value||findUnavailable.value)return
  const root=previewContent.value?.querySelector<HTMLElement>('.preview-markdown,.preview-code')
  if(!root){previewFindState.value={status:'blocked',total:0,ordinal:0,notice:'当前预览尚未准备好，请稍后重试'};return}
  // The empty-file placeholder belongs to the UI, not to the file contents.
  if(data.value?.content===''){previewFindState.value={status:'ready',total:0,ordinal:0};return}
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes:Text[]=[],visibility=new Map<Element,boolean>();let node:Node|null
  while((node=walker.nextNode())){const parent=node.parentElement;if(!parent||parent.closest('script,style,noscript,template,[hidden],[aria-hidden="true"]'))continue;let visible=visibility.get(parent);if(visible===undefined){visible=parent.checkVisibility({checkVisibilityCSS:true,checkOpacity:true});visibility.set(parent,visible)}if(visible&&node.textContent)nodes.push(node as Text)}
  const result=findConversationText([{id:'preview',text:nodes.map(node=>node.data).join('')}],query,options.caseSensitive,10000),locate=createPreviewRangeIndex(nodes.map(node=>node.length))
  for(const match of result.matches){const offsets=locate(match.from,match.to);if(!offsets)continue;const range=document.createRange();range.setStart(nodes[offsets.start.index]!,offsets.start.offset);range.setEnd(nodes[offsets.end.index]!,offsets.end.offset);previewRanges.push(range)}
  previewFindState.value={status:'ready',total:previewRanges.length,ordinal:previewRanges.length?1:0,truncated:result.truncated,notice:data.value?.truncated?'仅查找当前预览的前 256 KB':undefined}
  highlightPreview(true)
}
function stepPreviewFind(direction:1|-1){if(!findActive.value||findUnavailable.value||!previewFindEngaged||!previewRanges.length)return;previewMatchIndex=(previewMatchIndex+direction+previewRanges.length)%previewRanges.length;previewFindState.value={...previewFindState.value,ordinal:previewMatchIndex+1};highlightPreview(true)}
const unregisterFind=registerWindowFindTarget({
  target:()=>findActive.value?{key:findContext.value,scope:'workspace',kind:'file',label:name.value,supportsCaseSensitive:true}:null,
  state:()=>findUnavailable.value?{status:error.value?'error':loading.value||!data.value?'blocked':'unsupported',total:0,ordinal:0,notice:findUnavailable.value}:previewFindState.value,
  setQuery:setPreviewFindQuery,step:stepPreviewFind,stop:stopPreviewFind,
})
watch([findContext,findUnavailable],()=>{if(previewFindEngaged&&findActive.value)void setPreviewFindQuery(previewFindQuery,previewFindOptions)},{flush:'post'})
watch(findActive,value=>{if(!value)stopPreviewFind()})
onBeforeUnmount(()=>{unregisterFind();stopPreviewFind();highlightStyle?.remove()})
defineExpose({refresh:()=>load(true)})
</script>

<style scoped>
.file-preview { position:absolute; inset:44px 0 0 auto; width:var(--preview-width); max-width:100%; display:flex; flex-direction:column; background:#fff; border-left:1px solid #e5e8ee; z-index:5; min-height:0; contain:layout style paint; animation:preview-enter 180ms ease-out; }
.file-preview.embedded { position:relative; inset:auto; width:100%; max-width:100%; flex:1; border:0; border-radius:0 0 12px 12px; overflow:hidden; box-shadow:none; animation:none; }
.preview-head { min-height:44px; display:flex; align-items:center; gap:6px; padding:6px 10px; border-bottom:1px solid #eceef2; color:#596475; }
.preview-head > svg { width:14px; margin-right:3px; }
.preview-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:600; }
.preview-head button { flex-shrink:0; width:28px; height:28px; padding:6px; display:grid; place-items:center; }
.preview-head .preview-type{display:flex;gap:7px;width:auto;padding:6px 9px;border-color:#dbe2eb;background:#fff;border-radius:16px;white-space:nowrap}.preview-type svg{width:12px;height:12px}.preview-type svg:last-child{width:9px}
.preview-open-group{display:flex;align-items:center;flex-shrink:0;border:1px solid #dbe2eb;border-radius:16px;background:white;overflow:hidden}.preview-head .preview-open-default{width:auto;display:flex;gap:6px;padding:5px 9px}.preview-open-group>button{border-radius:0}.preview-open-group svg{width:12px;height:12px}
.preview-open-menu{min-width:185px;padding:5px;border:1px solid #d5deea;border-radius:10px;background:#fff;box-shadow:0 8px 24px #243b581c;font-size:12px;color:#4a5d76}.preview-open-menu button{display:block;width:100%;padding:9px 11px;text-align:left;border-radius:6px}.preview-open-menu button:hover{background:#eaf0f7}.preview-open-menu>span{display:block;padding:9px 11px;font-size:11px;color:#7d8ba0}.preview-open-rule{height:1px;background:#dfe5ed;margin:5px}.preview-head{flex-wrap:wrap}
button { border:1px solid transparent; border-radius:7px; color:#596475; transition:background-color 140ms ease,border-color 140ms ease; cursor:pointer; font-size:12px; }
button:hover:not(:disabled) { background:#eef1f5; border-color:#dfe4eb; color:#293b53; }
button:focus-visible,.preview-resizer:focus-visible { outline:2px solid #537ab9; outline-offset:-2px; }
button:disabled { opacity:.45; cursor:default; }
.preview-tools { min-height:34px; display:flex; align-items:center; gap:8px; padding:4px 12px; font-size:10px; color:#7d8795; background:#fafbfc; border-bottom:1px solid #f0f2f5; }
.preview-tools button { padding:3px 6px; font-size:11px; }
.preview-spacer { flex:1; }
.preview-content { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; }
.preview-code { margin:0; padding:16px; font:12px/1.75 Consolas,monospace; tab-size:2; color:#344052; min-height:100%; }
.preview-markdown { padding:18px; font-size:13px; line-height:1.8; overflow-wrap:anywhere; color:#344052; }
.preview-markdown :deep(h1),.preview-markdown :deep(h2),.preview-markdown :deep(h3) { line-height:1.4; margin:1em 0 .5em; }
.preview-markdown :deep(p),.preview-markdown :deep(ul),.preview-markdown :deep(ol) { margin:0 0 .8em; }
.preview-markdown :deep(ul),.preview-markdown :deep(ol) { padding-left:22px; }
.preview-markdown :deep(pre) { overflow:auto; background:#f5f7f9; padding:10px; border-radius:6px; }
.preview-markdown :deep(table) { border-collapse:collapse; font-size:12px; }
.preview-markdown :deep(th),.preview-markdown :deep(td) { padding:6px 9px; border:1px solid #e2e7ed; }
.preview-markdown :deep(a) { color:#31628f; text-decoration:underline; }
.preview-image { display:flex; align-items:center; justify-content:center; min-height:100%; padding:16px; background:repeating-conic-gradient(#f2f4f7 0% 25%,#fff 0% 50%) 0 0 / 16px 16px; }
.preview-image img { display:block; max-width:100%; height:auto; flex-shrink:0; }
.preview-image.fit{height:100%;min-height:0}.preview-image.fit img{max-height:100%;object-fit:contain}
.preview-image.zoomed{display:block;min-width:fit-content}.preview-image.zoomed img{margin:auto}
.preview-zoom{font-size:11px;border:1px solid #d8dfe8;border-radius:6px;padding:4px 5px;color:#58677b;max-width:110px}
.preview-empty { min-height:180px; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:12px; color:#7c8694; font-size:12px; padding:24px; text-align:center; }
.preview-empty > svg { width:28px; height:28px; }
.preview-format-hint{max-width:360px;margin:0;color:var(--navora-muted);font-size:12px;line-height:1.7}
.preview-empty button { border-color:#dfe4eb; padding:6px 12px; }
.preview-resizer { position:absolute; inset:0 auto 0 0; width:7px; cursor:col-resize; touch-action:none; z-index:2; }
.preview-resizer:hover { background:#537ab929; }
@keyframes preview-enter { from { opacity:0; transform:translateX(10px); } to { opacity:1; transform:translateX(0); } }
@media(max-width:1100px) { .file-preview { width:min(560px,100%); box-shadow:-10px 0 30px #263b4b12; } .preview-resizer { display:none; } }
@media(prefers-reduced-motion:reduce) { .file-preview { animation:none; } button { transition:none; } }
.preview-head.is-workspace-tools{min-height:0;padding:0;border:0;flex-wrap:nowrap;background:transparent;gap:3px}.preview-head.is-workspace-tools .preview-spacer{display:none}.preview-head.is-workspace-tools .preview-open-default>span{display:none}.preview-head.is-workspace-tools .preview-type{font-size:11px;padding:4px 6px}.preview-head.is-workspace-tools .preview-open-group{border:0;background:transparent}.preview-head.is-workspace-tools .preview-open-default{width:28px;padding:6px}
.preview-head.is-window-tools{width:100%;min-width:0;min-height:44px;box-sizing:border-box;flex-wrap:nowrap;gap:7px;border:0;padding:5px 10px;background:var(--navora-header,var(--navora-surface));color:var(--navora-ink)}.is-window-tools .preview-name{font-weight:450;color:var(--navora-muted);font-size:12px}.is-window-tools .preview-file-info{flex:none;font-size:10px;color:var(--navora-muted);white-space:nowrap}.is-window-tools .preview-type,.is-window-tools .preview-open-group{border-radius:7px}.is-window-tools .preview-type{max-width:160px;font-size:11px}.is-window-tools .preview-zoom{flex:none;max-width:100px}.is-window-tools .preview-open-default{white-space:nowrap}.is-window-tools .preview-more{width:30px;height:30px}@media(max-width:760px){.is-window-tools .preview-file-info,.is-window-tools .preview-open-default>span{display:none}.preview-head.is-window-tools{gap:3px;padding-inline:6px}}
</style>
