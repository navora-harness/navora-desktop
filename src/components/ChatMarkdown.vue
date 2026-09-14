<template>
  <div class="chat-md-wrap">
    <div
      class="msg-body md"
      :class="{ shimmer, 'has-footer': Boolean($slots.footer) }"
    >
      <div
        ref="rootRef"
        class="msg-md-content"
        v-html="html"
        @click="onClick"
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
        :title="item.path"
        @click="emit('openMedia', { src: item.url, alt: item.path })"
      >
        <img :src="item.url" :alt="item.path" loading="lazy" />
        <span>{{ item.path }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { renderMarkdown } from '@/utils/markdown'
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
}>()

const emit = defineEmits<{
  openMedia: [payload: { src: string; alt?: string }]
}>()

const rootRef = ref<HTMLElement | null>(null)
const html = ref('')
const fallbackMedia = ref<Array<{ path: string; url: string }>>([])
let hydrateSeq = 0

watch(
  () => [props.chatId, props.content] as const,
  () => {
    html.value = renderMarkdown(props.content || '')
  },
  { immediate: true },
)

async function hydrateImages(): Promise<void> {
  const seq = ++hydrateSeq
  const root = rootRef.value
  const chatId = props.chatId
  if (!root || !chatId) return

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
  () => [html.value, props.chatId, props.content] as const,
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
  if (!(t instanceof HTMLImageElement)) return
  const src = t.currentSrc || t.src
  if (!src || t.classList.contains('broken') || t.classList.contains('loading')) return
  e.preventDefault()
  emit('openMedia', { src, alt: t.alt || t.getAttribute('data-src') || '' })
}
</script>

<style scoped>
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
  margin: 0 0 0.65em;
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
  margin: 0.5em 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #15202b;
  color: #ecf0f1;
  overflow-x: auto;
  overflow-y: auto;
  max-width: 100%;
  max-height: min(360px, 45vh);
  font-size: 0.8rem;
  line-height: 1.45;
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
  margin: 0.5em 0;
  padding: 0.25em 0 0.25em 0.85em;
  border-left: 3px solid #9fc0d8;
  color: #5d6d7e;
}
.msg-body.md :deep(a) {
  color: #1b4f72;
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}
.msg-body.md :deep(table) {
  border-collapse: collapse;
  width: max-content;
  max-width: 100%;
  display: block;
  overflow-x: auto;
  margin: 0.5em 0;
  font-size: 0.85rem;
}
.msg-body.md :deep(th),
.msg-body.md :deep(td) {
  border: 1px solid #d5dde5;
  padding: 6px 8px;
  text-align: left;
}
.msg-body.md :deep(th) {
  background: #f0f4f8;
  font-weight: 600;
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
  justify-content: flex-end;
  align-items: center;
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
