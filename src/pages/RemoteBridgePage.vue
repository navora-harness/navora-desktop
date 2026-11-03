<template>
  <div class="bridge-page">
    <header class="toolbar">
      <div class="toolbar-left">
        <button type="button" class="tool-btn" aria-label="返回对话" title="返回对话" @click="$router.push('/')">
          <AppIcon icon="arrow-left" />
          <span class="tool-btn-label">对话</span>
        </button>
        <button type="button" class="tool-btn" aria-label="返回远程页面列表" title="远程页面列表" @click="$router.push('/remote')">
          <AppIcon icon="list-ul" />
          <span class="tool-btn-label">页面</span>
        </button>
      </div>
      <div class="titles">
        <h1>远程页面</h1>
        <p class="meta" :title="pageUrl">{{ pageTitle || windowId }}</p>
      </div>
      <span class="status" role="status" :title="statusText">{{ statusText }}</span>
    </header>

    <div
      ref="stageRef"
      class="stage"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel.prevent="onWheel"
      @contextmenu.prevent
    >
      <img
        v-if="frameUrl"
        ref="imgRef"
        class="frame"
        :src="frameUrl"
        alt="远程窗口画面"
        draggable="false"
      />
      <div v-else class="empty" role="status">{{ emptyText }}</div>
    </div>

    <p class="hint">点击、拖动画面可远程操作；双指滚动页面请直接在画面上滑动。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  getBridgeClient,
  getStoredToken,
  remoteAuthMe,
  setStoredToken,
} from '../remote-api'

const route = useRouter()
const vueRoute = useRoute()
const windowId = computed(() => String(vueRoute.params.windowId || ''))
const frameUrl = ref('')
const hasWindow = ref(false)
const statusDetail = ref('')
const pageTitle = ref('')
const pageUrl = ref('')
const imgRef = ref<HTMLImageElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
let pointerId: number | null = null
const client = getBridgeClient()

const statusText = computed(() => {
  if (!hasWindow.value) return statusDetail.value || '等待窗口…'
  return '已连接'
})

const emptyText = computed(() => {
  if (!hasWindow.value) return statusDetail.value || '窗口不存在或已关闭'
  return statusDetail.value || '正在拉取画面…'
})

function mapNorm(e: PointerEvent | WheelEvent): { nx: number; ny: number } | null {
  const img = imgRef.value
  if (!img || !img.naturalWidth) return null
  const rect = img.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const nx = (e.clientX - rect.left) / rect.width
  const ny = (e.clientY - rect.top) / rect.height
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null
  return { nx, ny }
}

function sendInput(
  action: 'down' | 'move' | 'up' | 'wheel',
  e: PointerEvent | WheelEvent,
) {
  const n = mapNorm(e)
  if (!n) return
  const payload: {
    action: typeof action
    nx: number
    ny: number
    deltaY?: number
    buttons?: number
  } = { action, nx: n.nx, ny: n.ny }
  if (action === 'wheel' && 'deltaY' in e) payload.deltaY = (e as WheelEvent).deltaY
  if ('buttons' in e) payload.buttons = (e as PointerEvent).buttons
  client.input(payload)
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  pointerId = e.pointerId
  stageRef.value?.setPointerCapture?.(e.pointerId)
  sendInput('down', e)
}

function onPointerMove(e: PointerEvent) {
  if (pointerId == null || e.pointerId !== pointerId) return
  sendInput('move', e)
}

function onPointerUp(e: PointerEvent) {
  if (pointerId == null || e.pointerId !== pointerId) return
  sendInput('up', e)
  pointerId = null
}

function onWheel(e: WheelEvent) {
  sendInput('wheel', e)
}

onMounted(async () => {
  const qToken = String(vueRoute.query.token || '')
  if (qToken) setStoredToken(qToken)
  const token = qToken || getStoredToken()
  if (!token || !(await remoteAuthMe(token))) {
    await route.replace({
      path: '/login',
      query: { redirect: vueRoute.fullPath },
    })
    return
  }

  client.setHandlers({
    onStatus: (msg) => {
      if (msg.type === 'bridge.status') {
        hasWindow.value = Boolean(msg.hasWindow)
        statusDetail.value = String(msg.detail || '')
        pageTitle.value = String(msg.title || '')
        pageUrl.value = String(msg.url || '')
      }
    },
    onFrame: (frame) => {
      frameUrl.value = frame.blobUrl
      hasWindow.value = true
    },
  })

  try {
    await client.connect(token)
    client.subscribe(windowId.value, 8)
    client.status(windowId.value)
  } catch (e) {
    statusDetail.value = e instanceof Error ? e.message : '连接失败'
  }
})

onUnmounted(() => {
  client.unsubscribe()
  client.disconnect()
})
</script>

<style scoped>
.bridge-page {
  min-width:0;
  min-height:0;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #f7f9fc;
  color: #46566c;
}
.toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 10px;
  border-bottom: 1px solid #e1e7ef;
  background: #fff;
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #dce4ee;
  background: transparent;
  color: #617b9b;
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 0.82rem;
  min-height: 38px;
}
.tool-btn:active {
  background: #eef3f8;
}
.titles {
  min-width: 0;
  flex: 1;
}
.titles h1 {
  white-space:nowrap;
  margin: 0;
  font-size: 0.95rem;
  font-weight: 650;
}
.meta {
  margin: 2px 0 0;
  font-size: 0.72rem;
  color: #95a5a6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status {
  flex-shrink: 0;
  font-size: 0.72rem;
  color: #a9cce3;
  max-width: 28vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stage {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  background: #0b1218;
  cursor: crosshair;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.frame {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.empty {
  color: #7f8c8d;
  font-size: 0.95rem;
  padding: 24px;
  text-align: center;
}
.hint {
  flex-shrink: 0;
  margin: 0;
  padding: 8px 14px calc(12px + env(safe-area-inset-bottom, 0px));
  font-size: 0.72rem;
  color: #7f8c8d;
  line-height: 1.45;
}
.tool-btn>svg{width:14px;height:14px;flex-shrink:0}.status{color:#728aa5}.toolbar .meta{color:#8c98a8}.stage{overflow:hidden}.hint{border-top:1px solid #e1e7ef;background:#fff;color:#8995a5}

@media (max-width: 768px) {
  .tool-btn-label {
    display: none;
  }
  .tool-btn {
    width: 38px;
    height: 38px;
    padding: 0;
    justify-content: center;
  }
  .titles h1 {
    font-size: 0.88rem;
  }
  .status {
    display: none;
  }
}
</style>
