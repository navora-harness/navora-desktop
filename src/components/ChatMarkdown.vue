<template>
  <div class="chat-md-wrap" :data-chat-id="chatId">
    <div
      class="msg-body md"
      :class="{ shimmer, 'has-footer': Boolean($slots.footer) }"
    >
      <div
        ref="rootRef"
        class="msg-md-content"
        v-html="html"
        @click="onClick"
        @contextmenu="onFileContext"
        @keydown="onFileKey"
      />
      <div v-if="$slots.footer" class="msg-body-footer">
        <slot name="footer" />
      </div>
    </div>
    <div v-if="fallbackMedia.length" class="msg-media-strip">
      <button
        v-for="item in fallbackMedia"
        :key="item.path"
        type="button"
        class="msg-media-item"
        :class="{'is-inline-file':!inlineMedia}"
        :title="filePaths.displayPath(chatId,item.path)"
        @click="emit('openFile',item.path)"
        @contextmenu="fileActions.show({chatId,path:item.path},$event)"
        @keydown.shift.f10="fileActions.show({chatId,path:item.path},$event)"
      >
        <img v-if="inlineMedia&&item.url" :src="item.url" :alt="item.path" loading="lazy" />
        <AppIcon v-else icon="image" />
        <span>{{ item.path.split(/[\\/]/).at(-1)||item.path }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { renderMarkdown } from '@/utils/markdown'
import {workspaceLinkPath} from '@shared/file-tabs'
import AppIcon from './icons/AppIcon.vue'
import {decorateWorkspaceLinks} from '@/utils/workspace-file-links'
import {useWorkspaceFileActions} from '@/composables/useWorkspaceFileActions'
import {useWorkspaceFilePaths} from '@/composables/useWorkspaceFilePaths'
import {
  extractWorkspaceImagePathsFromText,
  isHttpOrDataUrl,
  looksLikeWorkspaceImagePath,
  resolveWorkspaceMediaUrl,
} from '@/utils/chat-media'

const props = defineProps<{
  chatId: string
  content: string
  shimmer?: boolean
  artifactPaths?: string[]
  inlineMedia?: boolean
}>()

const emit = defineEmits<{
  openMedia: [payload: { src: string; alt?: string }]
  openFile:[path:string]
  notify:[text:string]
}>()

const rootRef = ref<HTMLElement | null>(null)
const html = ref('')
const fallbackMedia = ref<Array<{ path: string; url: string }>>([])
const filePaths=useWorkspaceFilePaths(()=>[props.chatId])
let hydrateSeq = 0
const fileActions=useWorkspaceFileActions({open:(path,chatId)=>{if(chatId!==props.chatId){emit('notify','来源对话已切换，请重新打开文件。');return}emit('openFile',path)},notify:text=>emit('notify',text)})

watch(
  () => [props.chatId, props.content,props.inlineMedia,filePaths.workspaceRoot(props.chatId)] as const,
  () => {
    html.value = decorateWorkspaceLinks(renderMarkdown(props.content || ''),props.inlineMedia,filePaths.workspaceRoot(props.chatId))
  },
  { immediate: true },
)

async function hydrateImages(): Promise<void> {
  const seq = ++hydrateSeq
  const root = rootRef.value
  const chatId = props.chatId
  if (!root || !chatId) return
  if(!props.inlineMedia){
    const linked=new Set([...root.querySelectorAll<HTMLElement>('[data-workspace-path]')].map(element=>element.dataset.workspacePath))
    const artifacts=new Set(props.artifactPaths||[])
    fallbackMedia.value=[...new Set(extractWorkspaceImagePathsFromText(props.content||''))].filter(path=>!linked.has(path)&&!artifacts.has(path)).map(path=>({path,url:''}))
    return
  }

  const hydrated = new Set<string>()
  const imgs = [...root.querySelectorAll('img')]
  for (const img of imgs) {
    if (seq !== hydrateSeq) return
    const attrSrc = (img.getAttribute('data-src') || img.getAttribute('src') || '').trim()
    // Prefer original relative path; property .src may already be page-absolute.
    let rel = attrSrc
    if (isHttpOrDataUrl(rel) || rel.startsWith('blob:')) {
      const data = img.getAttribute('data-src') || ''
      if (looksLikeWorkspaceImagePath(data)) rel = data
      else {
        img.classList.add('chat-media', 'ready')
        continue
      }
    }
    if (!looksLikeWorkspaceImagePath(rel)) continue
    const cleaned = rel.replace(/^\.\//, '').replace(/\\/g, '/')
    img.setAttribute('data-src', cleaned)
    img.classList.add('chat-media', 'loading')
    img.classList.remove('broken', 'ready')
    img.alt = img.alt || cleaned
    const url = await resolveWorkspaceMediaUrl(chatId, cleaned)
    if (seq !== hydrateSeq) return
    if (!url) {
      img.classList.remove('loading')
      img.classList.add('broken')
      continue
    }
    img.src = url
    img.classList.remove('loading')
    img.classList.add('ready')
    hydrated.add(cleaned)
  }

  // Paths mentioned as plain text / code but not rendered as <img>
  const mentioned = extractWorkspaceImagePathsFromText(props.content || '')
  const extras: Array<{ path: string; url: string }> = []
  for (const p of mentioned) {
    if (hydrated.has(p)) continue
    const url = await resolveWorkspaceMediaUrl(chatId, p)
    if (seq !== hydrateSeq) return
    if (url) extras.push({ path: p, url })
  }
  fallbackMedia.value = extras
}

watch(
  () => [html.value, props.chatId, props.content,props.artifactPaths,props.inlineMedia] as const,
  () => {
    void hydrateImages()
  },
  { flush: 'post', immediate: true },
)

onMounted(() => {
  void hydrateImages()
})

function onClick(e: MouseEvent) {
  const t = e.target
  if(t instanceof Element){const link=t.closest<HTMLElement>('[data-workspace-path]');if(link){e.preventDefault();const path=workspaceLinkPath(link.dataset.workspacePath||'');if(path)emit('openFile',path);else emit('notify','文件链接无效或不在工作区内');return}}
  if(t instanceof Element){
    const anchor=t.closest('a'),href=anchor?.getAttribute('href')||''
    if(anchor&&href&&!/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)){
      e.preventDefault()
      const path=workspaceLinkPath(href)
      if(path)emit('openFile',path);else emit('notify','文件链接无效或不在工作区内')
      return
    }
  }
  if (!(t instanceof HTMLImageElement)) return
  const src = t.currentSrc || t.src
  if (!src || t.classList.contains('broken') || t.classList.contains('loading')) return
  e.preventDefault()
  const path=t.getAttribute('data-src')||''
  if(looksLikeWorkspaceImagePath(path)){emit('openFile',path);return}
  emit('openMedia', { src, alt: t.alt || t.getAttribute('data-src') || '' })
}
function onFileContext(event:MouseEvent){const link=(event.target as Element)?.closest<HTMLElement>('[data-workspace-path]'),path=workspaceLinkPath(link?.dataset.workspacePath||'');if(path)void fileActions.show({chatId:props.chatId,path},event)}
function onFileKey(event:KeyboardEvent){const link=(event.target as Element)?.closest<HTMLElement>('[data-workspace-path]'),path=workspaceLinkPath(link?.dataset.workspacePath||'');if(!path)return;if(event.key==='F10'&&event.shiftKey)void fileActions.show({chatId:props.chatId,path},event);else if(event.key==='Enter'||event.key===' '){event.preventDefault();emit('openFile',path)}}
</script>

<style scoped>
.msg-md-content :deep(.chat-file-link){display:inline-flex;align-items:center;gap:5px;max-width:100%;vertical-align:baseline;text-decoration:none;overflow-wrap:anywhere}
.msg-md-content :deep(.chat-file-link-icon){width:14px;height:14px;flex:none;color:var(--navora-muted)}
.msg-md-content :deep(.chat-file-link:focus-visible){outline:2px solid var(--navora-accent);outline-offset:3px;border-radius:3px}
.chat-md-wrap {
  display: grid;
  gap: 8px;
  max-width: 100%;
  min-width: 0;
}
.msg-body {
  line-height: 1.5;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #e1e7ee;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  word-break: break-word;
  overflow-x: auto;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
  font-size: 0.92rem;
  color: #1b2834;
}
.msg-body.md {
  white-space: normal;
}
.msg-body.md :deep(*) {
  max-width: 100%;
}
.msg-body.md :deep(p) {
  margin: 0 0 0.8em;
}
.msg-body.md :deep(p:last-child) {
  margin-bottom: 0;
}
.msg-body.md :deep(ul),
.msg-body.md :deep(ol) {
  margin: 0.4em 0 0.65em;
  padding-left: 1.35em;
}
.msg-body.md :deep(li) {
  margin: 0.2em 0;
}
.msg-body.md :deep(h1),
.msg-body.md :deep(h2),
.msg-body.md :deep(h3),
.msg-body.md :deep(h4) {
  margin: 0.75em 0 0.4em;
  font-weight: 650;
  line-height: 1.3;
  color: #1b2834;
  overflow-wrap: anywhere;
}
.msg-body.md :deep(h1) {
  font-size: 1.15rem;
}
.msg-body.md :deep(h2) {
  font-size: 1.05rem;
}
.msg-body.md :deep(h3),
.msg-body.md :deep(h4) {
  font-size: 0.95rem;
}
.msg-body.md :deep(code) {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.84em;
  background: rgba(27, 79, 114, 0.08);
  padding: 0.1em 0.35em;
  border-radius: 4px;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.msg-body.md :deep(pre) {
  margin: 0.85em 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: #15202b;
  color: #ecf0f1;
  overflow-x: auto;
  overflow-y: auto;
  max-width: 100%;
  max-height: min(360px, 45vh);
  font-size: 0.8rem;
  line-height: 1.6;
  box-sizing: border-box;
}
.msg-body.md :deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: inherit;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
}
.msg-body.md :deep(blockquote) {
  margin: 0.8em 0;
  padding: 8px 12px;
  border-left: 3px solid #d1d9e5;
  border-radius: 0 8px 8px 0;
  background: #f7f8fa;
  color: #5c6878;
}
.msg-body.md :deep(a) {
  color: #1b4f72;
  text-decoration-line: none;
  text-decoration-style: dashed;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  word-break: break-all;
}
.msg-body.md :deep(a:hover),
.msg-body.md :deep(a:focus-visible) {
  text-decoration-line: underline;
}
.msg-body.md :deep(.md-table-scroll) {
  width: 100%;
  margin: 0.85em 0;
  border: 1px solid #e2e6ed;
  border-radius: 10px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: #bdc6d2 transparent;
}
.msg-body.md :deep(.md-table-scroll:focus-visible) {
  outline: 2px solid #537ab9;
  outline-offset: 2px;
}
.msg-body.md :deep(table) {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  margin: 0;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
}
.msg-body.md :deep(th),
.msg-body.md :deep(td) {
  border: 0;
  border-bottom: 1px solid #e8ebf0;
  padding: 9px 12px;
  text-align: left;
  white-space: nowrap;
}
.msg-body.md :deep(th) {
  background: #f5f6f8;
  color: #4d596b;
  font-weight: 600;
}
.msg-body.md :deep(tbody tr:last-child td) { border-bottom: 0; }
.msg-body.md :deep(tbody tr:hover) { background: #fafbfd; }
@media(max-width:600px) {
  .msg-body.md :deep(table) { font-size: 12px; }
  .msg-body.md :deep(th), .msg-body.md :deep(td) { padding: 8px 10px; }
}
.msg-body.md :deep(hr) {
  border: 0;
  border-top: 1px solid #d5dde5;
  margin: 0.85em 0;
}
.msg-body.md :deep(img) {
  max-width: min(100%, 520px);
  height: auto;
  border-radius: 10px;
  border: 1px solid #d5dde5;
  display: block;
  margin: 0.55em 0;
  cursor: zoom-in;
  background: #f4f7fa;
}
.msg-body.md :deep(img.chat-media.loading) {
  min-height: 72px;
  opacity: 0.55;
}
.msg-body.md :deep(img.chat-media.broken) {
  outline: 1px dashed #c0392b;
  cursor: default;
}
.msg-body.md.shimmer {
  background: linear-gradient(90deg, #ffffff 25%, #eef3f7 50%, #ffffff 75%);
  background-size: 200% 100%;
  animation: md-shimmer 1.2s ease infinite;
}
.msg-body.has-footer {
  padding-bottom: 8px;
}
.msg-md-content {
  min-width: 0;
  max-width: 100%;
}
.msg-body-footer {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
@keyframes md-shimmer {
  to {
    background-position: -200% 0;
  }
}
.msg-media-strip {
  display: grid;
  gap: 8px;
}
.msg-media-item.is-inline-file{display:inline-flex;align-items:center;gap:5px;width:fit-content;max-width:100%;border:0;border-radius:4px;background:transparent;color:var(--navora-accent);font:inherit;font-size:13px;cursor:pointer}
.msg-media-item.is-inline-file .app-icon{width:14px;height:14px;color:var(--navora-muted)}
.msg-media-item.is-inline-file span{padding:0;color:inherit;font-size:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.msg-media-item.is-inline-file:is(:hover,:focus-visible) span{text-decoration:underline dashed;text-underline-offset:3px}
.msg-media-item {
  display: grid;
  gap: 6px;
  text-align: left;
  border: 1px solid #d5dde5;
  border-radius: 10px;
  background: #0f1720;
  padding: 0;
  overflow: hidden;
  cursor: zoom-in;
}
.msg-media-item img {
  display: block;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  background: #0f1720;
}
.msg-media-item span {
  padding: 6px 10px;
  font-size: 0.72rem;
  color: #5d6d7e;
  background: #f7fafc;
  font-family: ui-monospace, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
