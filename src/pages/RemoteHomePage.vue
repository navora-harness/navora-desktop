<template>
  <div class="remote-home">
    <header class="top">
      <div class="top-row">
        <h1>远程窗口</h1>
        <button type="button" class="back-chat" :disabled="refreshing" @click="refresh">{{ refreshing ? '刷新中…' : '刷新' }}</button>
        <button type="button" class="back-chat" @click="$router.push('/')">返回 Chat</button>
      </div>
      <p>选择一个窗口进行画面查看与操控</p>
    </header>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="loading" class="muted">加载中…</div>
    <div v-else-if="!windows.length && !error" class="muted empty">暂无 Agent 浏览器窗口</div>
    <div v-else class="win-list">
      <button
        v-for="w in windows"
        :key="w.windowId"
        type="button"
        class="win"
        @click="$router.push(`/remote/${encodeURIComponent(w.windowId)}`)"
      >
        <div class="title">{{ w.title || '无标题' }}</div>
        <div class="url">{{ w.url }}</div>
        <div class="meta">
          <span v-if="w.loading">加载中</span>
          <span v-else-if="!w.visible">已隐藏</span>
          <span v-else>可操控</span>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getStoredToken } from '../remote-api'

const router = useRouter()
const route = useRoute()
const loading = ref(true)
const error = ref('')
const windows = ref<
  Array<{ windowId: string; title: string; url: string; visible: boolean; loading: boolean }>
>([])

const refreshing = ref(false)
let controller: AbortController | null = null
let timer: ReturnType<typeof setInterval> | undefined
let disposed = false
async function refresh() {
  if (refreshing.value || disposed) return
  const token = getStoredToken()
  refreshing.value = true
  controller = new AbortController()
  const timeout = setTimeout(() => controller?.abort(), 12000)
  try {
    const res = await fetch('/api/windows', { headers: { Authorization: 'Bearer ' + token }, signal: controller.signal })
    if (res.status === 401 || res.status === 403) {
      await router.replace({ path: '/login', query: { redirect: route.fullPath } }); return
    }
    if (!res.ok) throw new Error('无法获取窗口列表')
    const data = await res.json() as { windows?: typeof windows.value }
    if (!disposed) { windows.value = data.windows || []; error.value = '' }
  } catch {
    if (!disposed) error.value = '连接中断，请刷新重试' + (windows.value.length ? ' · 保留上次窗口' : '')
  } finally { clearTimeout(timeout); refreshing.value = false; loading.value = false }
}
function onVisibility() { if (!document.hidden) void refresh() }
onMounted(async () => {
  const token = getStoredToken()
  if (!token) {
    if (!disposed) await router.replace({ path: '/login', query: { redirect: route.fullPath } })
    return
  }
  if (disposed) return
  await refresh()
  if (disposed) return
  timer = setInterval(() => { if (!document.hidden) void refresh() }, 5000)
  document.addEventListener('visibilitychange', onVisibility)
})
onUnmounted(() => { disposed = true; clearInterval(timer); controller?.abort(); document.removeEventListener('visibilitychange', onVisibility) })

</script>

<style scoped>
.remote-home {
  min-height: 100dvh;
  padding:
    calc(20px + env(safe-area-inset-top, 0px))
    calc(16px + env(safe-area-inset-right, 0px))
    calc(24px + env(safe-area-inset-bottom, 0px))
    calc(16px + env(safe-area-inset-left, 0px));
  background: #eef2f5;
  box-sizing: border-box;
}
.top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.top h1 {
  margin: 0;
  font-size: 1.2rem;
  color: #15202b;
}
.top p {
  margin: 6px 0 18px;
  color: #5d6d7e;
  font-size: 0.88rem;
}
.back-chat {
  flex-shrink: 0;
  border: 1px solid #c5d4e4;
  background: #fff;
  color: #1b4f72;
  border-radius: 10px;
  padding: 8px 12px;
  min-height: 38px;
  font-size: 0.84rem;
  cursor: pointer;
}
.back-chat:active {
  background: #eef3f7;
}
.muted,
.err,
.empty {
  color: #5d6d7e;
  padding: 12px 2px;
}
.err {
  color: #c0392b;
}
.win-list {
  display: grid;
  gap: 10px;
}
.win {
  display: grid;
  gap: 4px;
  width: 100%;
  text-align: left;
  border: 1px solid #d5dde5;
  background: #fff;
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  min-height: 44px;
}
.win:active {
  border-color: #1b4f72;
  background: #f7fafc;
}
.title {
  font-weight: 600;
  color: #1b2834;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.url {
  font-size: 0.8rem;
  color: #7f8c8d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  font-size: 0.72rem;
  color: #1b4f72;
  font-weight: 600;
}
</style>
