<template>
  <nav v-if="items.length > 1" class="conversation-outline" aria-label="对话位置" :style="{'--outline-step-height':stepHeight+'px'}">
    <div class="outline-compact">
      <v-menu location="bottom end" max-height="360" :close-on-content-click="true">
        <template #activator="{ props: menuProps }"><button type="button" class="outline-trigger" aria-label="对话目录" v-bind="menuProps"><AppIcon icon="list-ul" /><span>{{ activeIndex + 1 }} / {{ items.length }}</span></button></template>
        <div class="outline-directory" role="menu"><button v-for="(item,index) in items" :key="item.id" type="button" role="menuitem" :class="{ current: activeId === item.id }" @click="jump(item.id)"><span>{{ index + 1 }}</span>{{ item.text }}</button></div>
      </v-menu>
    </div>
    <div ref="outlineList" class="outline-list" @keydown="onKeydown">
      <button
        v-for="(item, index) in items"
        :key="item.id"
        type="button"
        class="outline-step"
        :class="{ current: activeId === item.id }"
        :style="{ color: markerColor(index) }"
        :tabindex="activeIndex === index ? 0 : -1"
        :data-message-id="item.id"
        :aria-label="`第 ${index + 1} 轮：${item.text}`"
        :aria-current="activeId === item.id ? 'location' : undefined"
        :aria-describedby="preview?.index === index ? tooltipId : undefined"
        @mouseenter="showPreview($event, item, index)"
        @mouseleave="hidePreview"
        @focus="showPreview($event, item, index)"
        @blur="hidePreview"
        @click="jump(item.id)"
      ><svg viewBox="0 0 24 12" width="24" height="12" fill="none" aria-hidden="true"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg></button>
    </div>
    <Teleport to="body">
      <Transition name="outline-preview"><div v-if="preview" :id="tooltipId" class="outline-preview" role="tooltip" :style="preview.style">
        <span class="outline-preview-index">第 {{ preview.index + 1 }} / {{ items.length }} 轮</span>
        <div>{{ preview.text }}</div>
      </div></Transition>
    </Teleport>
  </nav>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue'
import type { ChatMessage } from '@shared/types'

const props = defineProps<{ messages: ChatMessage[]; scrollContainer: HTMLElement | null }>()
const emit = defineEmits<{ jump: [messageId: string] }>()
const items = computed(() => props.messages.filter(m => m.role === 'user').map(m => ({ id: m.id, text: m.content.trim().replace(/\s+/g, ' ') || '附带资源的提问' })))
const tooltipId='outline-tip-'+useId()
const outlineList=ref<HTMLElement|null>(null),viewportHeight=ref(600)
const stepHeight=computed(()=>Math.max(7,Math.min(22,Math.floor((viewportHeight.value*.65-14)/Math.max(1,items.value.length)))))
let previewTimer:ReturnType<typeof setTimeout>|undefined
const activeId = ref('')
const activeIndex = computed(() => Math.max(0, items.value.findIndex(item => item.id === activeId.value)))
const preview = ref<{ text: string; index: number; style: Record<string, string> } | null>(null)
let frame = 0
let detach = () => {}

function markerColor(index: number): string {
  const distance = Math.abs(index - activeIndex.value)
  const falloff = Math.max(2, Math.min(12, items.value.length * 0.08))
  const proximity = Math.exp(-distance / falloff)
  const blend = 0.12 + proximity * 0.88
  const far = [166, 177, 192]
  const near = [51, 88, 132]
  const rgb = near.map((channel, i) => Math.round(far[i]! + (channel - far[i]!) * blend))
  return `rgb(${rgb.join(' ')})`
}

function updatePosition() {
  frame = 0
  const container = props.scrollContainer
  if (!container || !items.value.length) return
  viewportHeight.value=container.clientHeight
  if (container.scrollHeight - container.clientHeight - container.scrollTop < 6) {
    activeId.value = items.value.at(-1)!.id
    return
  }
  const boundary = container.getBoundingClientRect().top + 44
  let low = 0, high = items.value.length - 1, current = 0
  // Binary search keeps a long conversation's scroll handler small.
  while (low <= high) {
    const middle = (low + high) >>> 1
    const element = container.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(items.value[middle]!.id)}"]`)
    if (element && element.getBoundingClientRect().top <= boundary) { current = middle; low = middle + 1 }
    else high = middle - 1
  }
  activeId.value = items.value[current]!.id
}
function schedulePosition() { if (!frame) frame = requestAnimationFrame(updatePosition) }
function onScroll() { clearTimeout(previewTimer); preview.value = null; schedulePosition() }
function onViewportResize() { clearTimeout(previewTimer);preview.value = null; schedulePosition() }
window.addEventListener('resize', onViewportResize)
watch(() => props.scrollContainer, container => {
  detach()
  preview.value = null
  if (!container) return
  container.addEventListener('scroll', onScroll, { passive: true })
  const resize = new ResizeObserver(schedulePosition)
  const content = new MutationObserver(schedulePosition)
  resize.observe(container)
  content.observe(container, { childList: true, subtree: true, characterData: true })
  detach = () => { container.removeEventListener('scroll', onScroll); resize.disconnect(); content.disconnect() }
  schedulePosition()
}, { immediate: true, flush: 'post' })
watch(() => items.value.map(item => item.id).join(','), () => { preview.value = null; void nextTick(schedulePosition) })

function hidePreview(){clearTimeout(previewTimer);previewTimer=setTimeout(()=>{preview.value=null},80)}
function showPreview(event: Event, item: { text: string }, index: number) {
  clearTimeout(previewTimer)
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const show=()=>{preview.value = { text: item.text, index, style: {
    left: `${Math.max(12, Math.min(innerWidth-272,rect.left - 272))}px`,
    top: `${Math.max(12, Math.min(innerHeight - 118, rect.top - 30))}px`,
  } }}
  if(preview.value||event.type==='focus')show();else previewTimer=setTimeout(show,70)
}
function jump(id: string) { clearTimeout(previewTimer);activeId.value = id; preview.value = null; emit('jump', id) }
watch(activeId,()=>void nextTick(()=>{
  const list=outlineList.value,button=list?.querySelector<HTMLElement>('.current')
  if(list&&button&&!list.matches(':hover,:focus-within'))list.scrollTop=Math.max(0,button.offsetTop-list.clientHeight/2)
}))
function onKeydown(event: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') { preview.value = null; return }
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
  buttons[index]?.focus({ preventScroll: true })
  buttons[index]?.scrollIntoView({ block: 'nearest' })
}
onUnmounted(() => { clearTimeout(previewTimer); detach(); cancelAnimationFrame(frame); window.removeEventListener('resize', onViewportResize) })
</script>

<style scoped>
.conversation-outline{position:absolute;right:8px;top:16px;bottom:16px;width:32px;display:flex;align-items:center;z-index:3;pointer-events:none}
.outline-list{position:absolute;right:0;width:32px;max-height:65%;overflow-y:auto;scrollbar-width:none;padding:6px 2px;border:0;border-radius:10px;pointer-events:auto;background:transparent;transition:background-color 160ms ease}
.outline-list:is(:hover,:focus-within){background:#f4f6f9d9}
.outline-step{position:relative;display:block;width:100%;height:var(--outline-step-height,20px);padding:0;border:0;background:transparent;color:#7c8796;border-radius:5px;cursor:pointer;transition:color 140ms ease}
.outline-step svg{position:absolute;right:2px;top:50%;width:20px;height:12px;transform:translateY(-50%) scaleX(.4);transform-origin:right center;transition:transform 180ms cubic-bezier(.22,.75,.2,1),color 140ms ease;pointer-events:none}
.outline-step.current{color:#3c638e}.outline-step.current svg{transform:translateY(-50%) scaleX(.9)}.outline-step.current path{stroke-width:2.6}
.outline-step:hover,.outline-step:focus-visible{color:#304f76}.outline-step:not(.current):hover svg{transform:translateY(-50%) scaleX(.68)}.outline-step:focus-visible{outline:2px solid #6483a8;outline-offset:-1px}
.outline-preview{position:fixed;z-index:2400;width:252px;padding:11px 13px;border:1px solid #dce4ee;border-radius:10px;background:#fff;color:#455770;box-shadow:0 8px 28px #263e5e18;font:12px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;pointer-events:none;transition:top 120ms ease}
.outline-preview-index{display:block;margin-bottom:4px;color:#8796aa;font-size:10px}.outline-preview>div{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.outline-preview-enter-active,.outline-preview-leave-active{transition:opacity 140ms ease,transform 160ms cubic-bezier(.22,.75,.2,1)}.outline-preview-enter-from,.outline-preview-leave-to{opacity:0;transform:translateX(5px)}
.outline-compact{display:none;pointer-events:auto}.outline-directory{width:min(320px,85vw);max-height:360px;overflow:auto;padding:6px;background:#fff;border:1px solid #dce4ee;border-radius:10px}.outline-directory button{display:flex;gap:10px;width:100%;padding:9px;border:0;border-radius:7px;background:transparent;color:#53657c;text-align:left;font-size:12px;cursor:pointer;transition:background-color 140ms ease,color 140ms ease}.outline-directory button.current,.outline-directory button:hover{background:#edf2f8;color:#355b87}.outline-directory button span{color:#8c9bb0;flex-shrink:0;font-variant-numeric:tabular-nums}
.outline-trigger{display:flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid #dce4ee;border-radius:8px;background:#ffffffed;color:#667a95;font-size:11px;cursor:pointer;transition:background-color 150ms ease,color 150ms ease}.outline-trigger>svg{width:12px}.outline-trigger:hover{background:#edf2f8;color:#355b87}
@media(max-width:1100px){.conversation-outline{top:8px;right:18px;bottom:auto;width:auto}.outline-list{display:none}.outline-compact{display:block}}
@media(prefers-reduced-motion:reduce){.outline-list,.outline-preview,.outline-preview-enter-active,.outline-preview-leave-active,.outline-step,.outline-step svg,.outline-trigger,.outline-directory button{transition:none}.outline-preview-enter-from,.outline-preview-leave-to{transform:none}}
</style>
