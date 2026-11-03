<template>
  <main class="literature-page">
    <header class="literature-header">
      <button class="icon-button" type="button" aria-label="返回对话" title="返回对话" @click="router.push('/')"><AppIcon icon="arrow-left" /></button>
      <div><h1>文献检索</h1><p>并发查询多个学术来源，结果会边到边显示。</p></div>
    </header>

    <form class="search-panel" @submit.prevent="startSearch">
      <label class="query-label" for="literature-query">研究主题或关键词</label>
      <div class="query-row">
        <input id="literature-query" v-model="query" autofocus maxlength="500" placeholder="例如：large language models in education" :disabled="busy" />
        <button class="primary-button" type="submit" :disabled="!query.trim() || busy">{{ busy ? '检索中…' : '开始检索' }}</button>
        <button v-if="busy" class="secondary-button" type="button" @click="cancelSearch">取消</button>
      </div>
      <div class="filters-row">
        <label>年份从 <input v-model="fromYear" type="number" min="1500" max="2200" placeholder="不限" :disabled="busy" /></label>
        <label>到 <input v-model="toYear" type="number" min="1500" max="2200" placeholder="不限" :disabled="busy" /></label>
        <label>每来源最多 <select v-model.number="limit" :disabled="busy"><option :value="20">20</option><option :value="40">40</option><option :value="80">80</option></select> 条</label>
      </div>
      <div class="provider-row" aria-label="检索来源">
        <label v-for="provider in providerOptions" :key="provider.id" class="provider-toggle">
          <input v-model="selectedProviders" type="checkbox" :value="provider.id" :disabled="busy" />{{ provider.label }}
        </label>
      </div>
    </form>

    <section v-if="hasRun" class="results-section" aria-live="polite">
      <div class="results-heading">
        <div><h2>检索结果</h2><p>{{ works.length }} 条去重结果 <span v-if="elapsed">· 用时 {{ (elapsed / 1000).toFixed(1) }} 秒</span></p></div>
        <button v-if="works.length" class="secondary-button" type="button" @click="exportCsv">导出 CSV</button>
      </div>
      <div class="provider-statuses">
        <div v-for="provider in selectedProviders" :key="provider" class="provider-status" :class="`state-${statuses[provider]?.state || 'queued'}`">
          <span class="status-dot" />{{ providerLabel(provider) }}<span>{{ statusLabel(statuses[provider]?.state) }}</span>
          <small v-if="statuses[provider]?.resultCount !== undefined">{{ statuses[provider]?.resultCount }} 条</small>
          <small v-if="statuses[provider]?.message" class="status-error">{{ statuses[provider]?.message }}</small>
        </div>
      </div>
      <div v-if="!works.length && !busy && !failedCount" class="empty-results">没有找到结果。可以尝试更短的关键词，或更换来源。</div>
      <div v-if="!works.length && busy" class="empty-results">正在等待首批结果…</div>
      <article v-for="item in sortedWorks" :key="item.id" class="paper-card">
        <h3><a v-if="item.url" :href="item.url" @click.prevent="openWork(item.url)">{{ item.title }}</a><span v-else>{{ item.title }}</span></h3>
        <p class="paper-meta">{{ item.authors.slice(0, 6).join(', ') }}{{ item.authors.length > 6 ? ' 等' : '' }}<span v-if="item.year"> · {{ item.year }}</span><span v-if="item.venue"> · {{ item.venue }}</span></p>
        <p v-if="item.abstract" class="paper-abstract">{{ item.abstract }}</p>
        <div class="paper-footer">
          <span class="source-chip" v-for="source in item.sources" :key="source">{{ providerLabel(source) }}</span>
          <span v-if="item.doi" class="doi">DOI: {{ item.doi }}</span>
          <span v-if="item.citationCount !== undefined" class="citation-count">被引 {{ item.citationCount }}</span>
          <span v-if="item.openAccess" class="oa-badge">开放获取</span>
        </div>
      </article>
      <div v-if="!busy && failedCount" class="partial-warning">{{ works.length ? '部分来源未能完成，已保留成功来源的结果。' : '所有来源都未能完成，请稍后重试。' }}</div>
    </section>
    <p v-else class="search-hint">选择来源后提交检索。来源请求会并发启动，单个来源失败不会丢失其他来源的结果。</p>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/icons/AppIcon.vue'
import type { LiteratureProvider, LiteratureSearchEvent, LiteratureWork } from '@shared/literature-search'

const router = useRouter()
const providerOptions: Array<{ id: LiteratureProvider; label: string }> = [
  { id: 'openalex', label: 'OpenAlex' },
  { id: 'crossref', label: 'Crossref' },
  { id: 'semanticscholar', label: 'Semantic Scholar' },
]
const providerLabels: Record<LiteratureProvider, string> = { openalex: 'OpenAlex', crossref: 'Crossref', semanticscholar: 'Semantic Scholar' }
const query = ref('')
const selectedProviders = ref<LiteratureProvider[]>(providerOptions.map(item => item.id))
const fromYear = ref<number | ''>('')
const toYear = ref<number | ''>('')
const limit = ref(40)
const works = ref<LiteratureWork[]>([])
const statuses = ref<Partial<Record<LiteratureProvider, { state: string; resultCount?: number; message?: string }>>>({})
const currentId = ref('')
const busy = ref(false)
const hasRun = ref(false)
const startedAt = ref(0)
const elapsed = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
const failedCount = computed(() => Object.values(statuses.value).filter(item => item?.state === 'failed').length)
const sortedWorks = computed(() => [...works.value].sort((a, b) => (b.year || 0) - (a.year || 0)))
const providerLabel = (provider: LiteratureProvider) => providerLabels[provider]
const statusLabel = (state?: string) => ({ running: '查询中', complete: '完成', failed: '失败', cancelled: '已取消', queued: '等待中' }[state || 'queued'] || '等待中')

function mergeBatch(incoming: LiteratureWork[]) {
  const map = new Map(works.value.map(item => [item.id, item]))
  for (const item of incoming) {
    const previous = map.get(item.id)
    if (!previous) { map.set(item.id, item); continue }
    previous.sources = [...new Set([...previous.sources, ...item.sources])]
    Object.assign(previous.sourceIds, item.sourceIds)
    if (!previous.abstract && item.abstract) previous.abstract = item.abstract
    if (!previous.venue && item.venue) previous.venue = item.venue
    if (!previous.url && item.url) previous.url = item.url
    if (!previous.doi && item.doi) previous.doi = item.doi
    if (previous.authors.length < item.authors.length) previous.authors = item.authors
    if (item.citationCount !== undefined) previous.citationCount = Math.max(previous.citationCount || 0, item.citationCount)
    previous.openAccess ||= item.openAccess
  }
  works.value = [...map.values()]
}

function onSearchEvent(event: LiteratureSearchEvent) {
  if (event.searchId !== currentId.value) return
  if (event.type === 'provider-status') {
    statuses.value[event.provider] = { state: event.state, resultCount: event.resultCount, message: event.message }
  } else if (event.type === 'results-batch') mergeBatch(event.results)
  else {
    busy.value = false
    elapsed.value = Date.now() - startedAt.value
    if (timer) clearInterval(timer)
    if (event.state === 'cancelled') busy.value = false
  }
}

const offEvent = window.navora?.literature.onEvent(onSearchEvent)
onBeforeUnmount(() => { offEvent?.(); if (timer) clearInterval(timer); if (busy.value && currentId.value) void window.navora?.literature.cancel(currentId.value) })

async function startSearch() {
  if (!query.value.trim() || !selectedProviders.value.length || !window.navora?.literature) return
  if (busy.value && currentId.value) await window.navora.literature.cancel(currentId.value)
  currentId.value = ''
  works.value = []
  statuses.value = Object.fromEntries(selectedProviders.value.map(provider => [provider, { state: 'queued' }]))
  busy.value = true
  hasRun.value = true
  startedAt.value = Date.now()
  elapsed.value = 0
  if (timer) clearInterval(timer)
  timer = setInterval(() => { if (busy.value) elapsed.value = Date.now() - startedAt.value }, 250)
  try {
    const result = await window.navora.literature.search({ query: query.value.trim(), providers: selectedProviders.value, fromYear: fromYear.value || undefined, toYear: toYear.value || undefined, limit: limit.value })
    currentId.value = result.searchId
  } catch (error) {
    busy.value = false
    statuses.value = Object.fromEntries(selectedProviders.value.map(provider => [provider, { state: 'failed', message: error instanceof Error ? error.message : '检索启动失败' }]))
  }
}

async function cancelSearch() { if (currentId.value) await window.navora?.literature.cancel(currentId.value) }
function openWork(url: string) { if (/^https?:\/\//i.test(url)) void window.navora?.app.openExternal(url) }
function exportCsv() {
  const rows = [['Title', 'Authors', 'Year', 'Venue', 'DOI', 'URL', 'Sources', 'Abstract'], ...works.value.map(item => [item.title, item.authors.join('; '), item.year || '', item.venue || '', item.doi || '', item.url || '', item.sources.join('; '), item.abstract || ''])]
  const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }))
  link.download = `literature-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}
</script>

<style scoped>
.literature-page{height:100%;min-height:0;overflow:auto;padding:32px clamp(20px,5vw,72px);background:#f7f8fa;color:#202631}.literature-header{display:flex;align-items:center;gap:16px;max-width:1080px;margin:0 auto 24px}.literature-header h1{font-size:24px;margin:0 0 5px;font-weight:650}.literature-header p,.results-heading p{margin:0;color:#68717d;font-size:13px}.icon-button{display:grid;place-items:center;width:36px;height:36px;border:1px solid #dfe3e9;border-radius:9px;background:#fff;color:#344154;cursor:pointer}.search-panel,.results-section,.search-hint{max-width:1080px;margin:0 auto}.search-panel{padding:22px;background:#fff;border:1px solid #e1e5eb;border-radius:14px;box-shadow:0 4px 18px #17203308}.query-label{display:block;font-size:13px;font-weight:600;margin-bottom:8px}.query-row{display:flex;gap:9px}.query-row input{flex:1;min-width:0;height:42px;padding:0 12px;border:1px solid #cfd6e0;border-radius:8px;font:inherit}.primary-button,.secondary-button{height:38px;padding:0 15px;border-radius:8px;border:1px solid #d5dbe4;background:white;color:#374151;font-weight:550;cursor:pointer}.primary-button{height:42px;border-color:#3a6597;background:#3a6597;color:white}.primary-button:disabled,.secondary-button:disabled{opacity:.5;cursor:default}.filters-row,.provider-row{display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin-top:16px;color:#566171;font-size:12px}.filters-row label{display:flex;align-items:center;gap:7px}.filters-row input,.filters-row select{height:30px;padding:0 8px;border:1px solid #d7dce4;border-radius:6px;background:#fff;color:#333;width:90px}.filters-row select{width:70px}.provider-row{gap:18px;padding-top:13px;border-top:1px solid #eef0f3}.provider-toggle{display:flex;align-items:center;gap:7px;cursor:pointer}.provider-toggle input{accent-color:#456f9e}.results-section{padding:25px 0}.results-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}.results-heading h2{font-size:18px;margin:0 0 4px}.provider-statuses{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:15px}.provider-status{display:flex;align-items:center;gap:7px;border:1px solid #e0e4e9;background:white;border-radius:8px;padding:7px 10px;font-size:12px;color:#45505f}.provider-status>span:nth-last-child(2){color:#68717d}.provider-status small{color:#76808d}.status-dot{width:7px;height:7px;border-radius:50%;background:#9aa3ae}.state-running .status-dot{background:#b6852e;animation:pulse 1s infinite}.state-complete .status-dot{background:#39855b}.state-failed .status-dot{background:#bd4a47}.status-error{color:#a43d3a!important}.paper-card{padding:17px 18px;margin-bottom:10px;border:1px solid #e1e5eb;background:#fff;border-radius:11px}.paper-card h3{font-size:15px;line-height:1.45;margin:0 0 7px;font-weight:620}.paper-card h3 a{color:#285b8f;text-decoration:none}.paper-card h3 a:hover{text-decoration:underline}.paper-meta,.paper-abstract{margin:0 0 8px;color:#66717f;font-size:12px;line-height:1.5}.paper-abstract{color:#47515e;font-size:13px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.paper-footer{display:flex;align-items:center;flex-wrap:wrap;gap:8px;color:#78818c;font-size:11px}.source-chip,.oa-badge{padding:3px 7px;border-radius:10px;background:#eef2f6;color:#4d6077}.oa-badge{background:#e8f5ed;color:#36784d}.doi{font-family:ui-monospace,monospace}.empty-results,.search-hint,.partial-warning{padding:18px;color:#68717d;font-size:13px;text-align:center}.partial-warning{color:#8a6124;background:#fff8e8;border-radius:8px;text-align:left;margin-top:12px}.search-hint{margin-top:25px}@keyframes pulse{50%{opacity:.35}}@media(max-width:640px){.literature-page{padding:18px 14px}.query-row{flex-wrap:wrap}.query-row input{flex-basis:100%}.filters-row{gap:10px}.paper-card{padding:14px}}
</style>
