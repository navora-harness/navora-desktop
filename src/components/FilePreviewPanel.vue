<template>
  <aside class="file-preview" :class="{embedded}" aria-label="文件预览" :style="{ '--preview-width': `${width}px` }">
    <div v-if="!embedded" class="preview-resizer" role="separator" aria-label="调整文件预览宽度" aria-orientation="vertical" :aria-valuenow="width" aria-valuemin="280" aria-valuemax="maximum" tabindex="0" @pointerdown="beginResize" @keydown="resizeKey" />
    <header class="preview-head">
      <font-awesome-icon v-if="!tabbed" icon="file" />
      <div v-if="!tabbed" class="preview-name" :title="path">{{ name }}</div>
      <span v-if="tabbed" class="preview-name">{{ data?.kind==='image'?'图片':data?.kind==='markdown'?'Markdown':data?.kind==='text'?'文本':'文件' }}</span>
      <select v-if="data?.kind==='image'" v-model="imageZoom" class="preview-zoom" aria-label="图片缩放"><option value="fit">适应窗口</option><option value="50">50%</option><option value="100">100%</option><option value="150">150%</option><option value="200">200%</option></select>
      <button type="button" title="刷新预览" aria-label="刷新预览" :disabled="loading" @click="load(true)"><font-awesome-icon icon="arrow-rotate-right" /></button>
      <button type="button" title="在系统中打开" aria-label="在系统中打开" @click="systemOpen"><font-awesome-icon icon="arrow-up-right-from-square" /></button>
      <SidebarMoreMenu v-if="!tabbed" label="文件预览" hide-label="隐藏文件侧栏" hide-aria-label="关闭文件预览" @hide="emit('close')" />
    </header>
    <div v-if="data?.ok" class="preview-tools">
      <span>{{ formatSize(data.size || 0) }}</span>
      <span v-if="loading" role="status">更新中…</span>
      <span v-if="data.truncated">仅显示前 256 KB</span>
      <span class="preview-spacer" />
      <button v-if="data.kind === 'markdown'" type="button" :aria-pressed="!source" @click="source = !source">{{ source ? '预览' : '源码' }}</button>
      <button v-if="data.content !== undefined" type="button" @click="copy">{{ copied ? '已复制' : '复制' }}</button>
    </div>
    <div class="preview-content" :aria-busy="loading">
      <div v-if="loading && !data" class="preview-empty" role="status">正在读取…</div>
      <div v-else-if="error" class="preview-empty" role="alert"><span>{{ error }}</span><button type="button" @click="load()">重试</button></div>
      <template v-else-if="data">
        <div v-if="data.kind === 'image'" class="preview-image" :class="imageZoom==='fit'?'fit':'zoomed'"><img :style="imageZoom==='fit'?{}:{width:`${imageNaturalWidth*Number(imageZoom)/100}px`,maxWidth:'none'}" @load="imageNaturalWidth=($event.target as HTMLImageElement).naturalWidth" :src="`data:${data.mime};base64,${data.base64}`" :alt="name" @error="error = '无法显示此图片'" /></div>
        <div v-else-if="data.kind === 'markdown' && !source" class="preview-markdown" v-html="markdown" @click="onLink" />
        <pre v-else-if="data.content !== undefined" class="preview-code" tabindex="0"><code>{{ data.content || '（空文件）' }}</code></pre>
        <div v-else class="preview-empty"><font-awesome-icon icon="file" /><span>此文件暂不支持预览</span><button type="button" @click="systemOpen">在系统中打开</button></div>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onActivated, onDeactivated, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { renderMarkdown } from '@/utils/markdown'
import SidebarMoreMenu from './sidebar/SidebarMoreMenu.vue'
import {workspaceLinkPath} from '@shared/file-tabs'
import type { WorkspacePreview } from '../../shared/workspace-preview'

const props = defineProps<{ chatId: string; path: string; width: number; embedded?: boolean; tabbed?: boolean }>()
const emit = defineEmits<{ close: []; resize: [width: number]; notify: [text: string, color?: string]; openFile:[path:string] }>()
const data = ref<WorkspacePreview | null>(null)
const loading = ref(false)
const error = ref('')
const source = ref(false)
const imageZoom=ref('fit'),imageNaturalWidth=ref(0)
let active=true,dirty=false
const copied = ref(false)
const maximum = ref(Math.max(280, Math.min(800, innerWidth - 360)))
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
watch(() => [props.chatId, props.path], () => { source.value = false; copied.value = false; imageZoom.value='fit'; void load() }, { immediate: true })
async function systemOpen() {
  try {
    const result = await window.navora!.workspace.open(props.chatId, props.path)
    if (!result.ok) throw new Error(result.error)
  } catch { emit('notify', '无法打开此文件') }
}
async function copy() {
  const content = data.value?.content
  if (content === undefined) return
  try {
    await navigator.clipboard.writeText(content)
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = false }, 1500)
  } catch { emit('notify', '复制失败') }
}
function onLink(event: MouseEvent) {
  const anchor = (event.target as Element).closest('a')
  if (!anchor) return
  event.preventDefault()
  const url = anchor.getAttribute('href') || ''
  if (/^https?:\/\//i.test(url)) void window.navora?.app.openExternal(url)
  else if(url.startsWith('#')){
    try{(event.currentTarget as Element).querySelector(`#${CSS.escape(decodeURIComponent(url.slice(1)))}`)?.scrollIntoView({block:'nearest'})}catch{/* Unknown anchors stay in this document. */}
  }else { const path=workspaceLinkPath(url,props.path); if(path)emit('openFile',path);else emit('notify','无法打开此文件链接') }
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
  if (!active || event.key !== 'Escape' || event.defaultPrevented) return
  const target = event.target as Element
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
onDeactivated(()=>{active=false})
onActivated(()=>{active=true;if(dirty){dirty=false;void load(true)}})
onBeforeUnmount(() => { disposed = true; sequence++; stopResize?.(); unsubscribe?.(); clearTimeout(reloadTimer); clearTimeout(copiedTimer); window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey, true) })
</script>

<style scoped>
.file-preview { position:absolute; inset:44px 0 0 auto; width:var(--preview-width); max-width:100%; display:flex; flex-direction:column; background:#fff; border-left:1px solid #e5e8ee; z-index:5; min-height:0; contain:layout style paint; animation:preview-enter 180ms ease-out; }
.file-preview.embedded { position:relative; inset:auto; width:100%; max-width:100%; flex:1; border:0; border-radius:0 0 12px 12px; overflow:hidden; box-shadow:none; animation:none; }
.preview-head { min-height:44px; display:flex; align-items:center; gap:6px; padding:6px 10px; border-bottom:1px solid #eceef2; color:#596475; }
.preview-head > svg { width:14px; margin-right:3px; }
.preview-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:600; }
.preview-head button { flex-shrink:0; width:28px; height:28px; padding:6px; display:grid; place-items:center; }
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
.preview-empty button { border-color:#dfe4eb; padding:6px 12px; }
.preview-resizer { position:absolute; inset:0 auto 0 0; width:7px; cursor:col-resize; touch-action:none; z-index:2; }
.preview-resizer:hover { background:#537ab929; }
@keyframes preview-enter { from { opacity:0; transform:translateX(10px); } to { opacity:1; transform:translateX(0); } }
@media(max-width:1100px) { .file-preview { width:min(560px,100%); box-shadow:-10px 0 30px #263b4b12; } .preview-resizer { display:none; } }
@media(prefers-reduced-motion:reduce) { .file-preview { animation:none; } button { transition:none; } }
</style>
