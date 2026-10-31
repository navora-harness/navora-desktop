<template>
  <section class="creator-workspace" @keydown.ctrl.s.prevent="save()" @keydown.meta.s.prevent="save()">
    <header class="creator-header">
      <button type="button" class="creator-back" aria-label="退出创建器" title="返回" :disabled="!!busy && busy !== 'generate'" @click="close"><font-awesome-icon icon="arrow-left" /></button>
      <font-awesome-icon :icon="kind === 'plugin' ? 'puzzle-piece' : 'book'" />
      <h1>{{ label }}创建器</h1>
      <span class="creator-save-state" :class="{ error: saveError }" role="status">{{ saveError ? '保存失败' : saving ? '保存中' : dirty ? '待保存' : project ? '已保存' : '' }}</span>
      <button v-if="saveError" type="button" @click="save()">重试保存</button>
    </header>
    <div class="creator-layout" :class="{ 'external-navigation': navigationTarget }">
      <Teleport :to="navigationTarget || 'body'" :disabled="!navigationTarget" defer>
      <nav class="creator-library" aria-label="创建器草稿">
        <div class="creator-new">
          <select v-model="template" aria-label="创建模板" :disabled="!!busy"><option value="basic">基础模板</option><option v-if="kind === 'plugin'" value="text">文本处理工具</option><option v-else value="research">资料研究技能</option></select>
          <button type="button" class="creator-primary" :disabled="!!busy" @click="create"><font-awesome-icon icon="plus" />新建</button>
        </div>
        <div v-if="loadingList" class="creator-hint" role="status">正在读取…</div>
        <button v-for="item in projects" :key="item.id" type="button" class="creator-draft" :class="{ selected: project?.id === item.id }" :disabled="!!busy" :title="`${item.name} · 修订 ${item.revision}`" @click="choose(item.id)"><span>{{ item.name }}</span><span class="creator-draft-state">{{ item.installedRevision === item.revision ? '已安装' : item.installedId ? '待更新' : '草稿' }}</span></button>
        <div v-if="!loadingList && !projects.length" class="creator-hint">从模板创建第一个{{ label }}</div>
      </nav>
      </Teleport>
      <div class="creator-editor-area">
        <div v-if="error" class="creator-error" role="alert"><span>{{ error }}</span><button type="button" aria-label="关闭提示" @click="error = ''"><font-awesome-icon icon="xmark" /></button></div>
        <template v-if="project">
          <div class="creator-project-head">
            <input v-model="name" class="creator-name" maxlength="80" aria-label="草稿名称" :readonly="!!busy" placeholder="草稿名称" />
            <span class="creator-version">修订 {{ project.revision }}</span>
          </div>
          <div class="creator-generation">
            <textarea v-model="request" aria-label="创建需求" rows="2" maxlength="6000" :readonly="!!busy" :placeholder="`描述${label}的用途、输入和预期结果…`" />
            <div class="creator-generation-actions">
              <select v-model="modelSelection" aria-label="创建器模型" :disabled="!!busy"><option v-for="option in models" :key="option.value" :value="option.value">{{ option.label }}</option><option v-if="!models.length" value="">请先配置模型</option></select>
              <button v-if="previousGeneration" type="button" :disabled="!!busy" @click="undoGeneration">撤销生成</button>
              <button v-if="busy === 'generate'" type="button" class="creator-stop" @click="cancelGenerate"><font-awesome-icon icon="stop" />停止生成</button>
              <button v-else type="button" class="creator-primary" :disabled="!!busy || !request.trim() || !models.length" @click="generate"><font-awesome-icon icon="wand-magic-sparkles" />生成草稿</button>
            </div>
          </div>
          <div class="creator-file-bar">
            <div class="creator-file-tabs" role="tablist" aria-label="工程文件"><button v-for="file in Object.keys(files)" :id="`creator-file-${file.replace(/\W/g,'-')}`" :key="file" type="button" role="tab" :aria-selected="selectedFile === file" :tabindex="selectedFile === file ? 0 : -1" :class="{ active: selectedFile === file }" @click="selectedFile = file" @keydown="fileKey($event,file)">{{ file }}</button></div>
            <button v-if="canPreview" type="button" class="creator-preview-toggle" :aria-pressed="preview" @click="preview = !preview">{{ preview ? '源码' : '预览' }}</button>
          </div>
          <div v-if="preview && canPreview" class="creator-rendered" v-html="previewHtml" @click.prevent />
          <textarea v-else v-model="files[selectedFile]" class="creator-code" :aria-label="`编辑 ${selectedFile}`" spellcheck="false" autocapitalize="off" autocomplete="off" :readonly="!!busy" @input="previousGeneration = null" @keydown.tab="indent" />
          <div v-if="validation" class="creator-validation" :class="{ failed: !validation.ok }" role="status">
            <div class="creator-validation-title"><font-awesome-icon :icon="validation.ok ? 'circle-check' : 'circle-exclamation'" /><span>{{ validation.ok ? '校验通过' : '需要修复' }}</span><span class="creator-checks">{{ validation.checks.join(' · ') }}</span></div>
            <button v-for="(issue,index) in validation.issues" :key="index" type="button" :class="issue.level" @click="selectedFile = issue.file || selectedFile">{{ issue.file }}{{ issue.file ? '：' : '' }}{{ issue.message }}</button>
          </div>
          <footer class="creator-footer">
            <input v-model="testTask" aria-label="试用任务" placeholder="试用任务（可选）" maxlength="6000" :readonly="!!busy" />
            <div class="creator-footer-actions">
              <button type="button" :disabled="!!busy" @click="check"><font-awesome-icon icon="list-check" />{{ busy === 'check' ? '校验中…' : '校验' }}</button>
              <button type="button" :disabled="!!busy || !desktop" title="导出 ZIP" @click="exportProject"><font-awesome-icon icon="download" />导出</button>
              <button type="button" :disabled="!!busy || !desktop" :title="desktop ? '' : '仅桌面端可用'" @click="trial">打开试用对话</button>
              <button type="button" class="creator-primary" :disabled="!!busy || !desktop || (!dirty && project.installedRevision === project.revision)" @click="install">{{ busy === 'install' ? '处理中…' : project.installedId ? '更新' : '安装到本机' }}</button>
            </div>
          </footer>
        </template>
        <div v-else class="creator-empty"><font-awesome-icon :icon="kind === 'plugin' ? 'puzzle-piece' : 'book'" /><h2>创建可复用的{{ label }}</h2><p>选择模板开始，再按需生成和编辑内容。</p><button type="button" class="creator-primary" :disabled="!!busy" @click="create">从模板开始</button></div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { renderMarkdown } from '@/utils/markdown'
import { creatorError, type CreatorFiles, type CreatorKind, type CreatorProject, type CreatorSummary, type CreatorValidation } from '../../shared/creators'
const props = defineProps<{ kind: CreatorKind; navigationTarget?: string }>()
const emit = defineEmits<{ close: []; trial: [result: { chatId: string; prompt: string }]; notify: [text: string, color?: string] }>()
const api = window.navora!.creators
const label = computed(() => props.kind === 'plugin' ? '插件' : '技能')
const desktop = Boolean(window.navoraElectron)
const projects = ref<CreatorSummary[]>([]), project = ref<CreatorProject | null>(null)
const files = ref<CreatorFiles>({}), name = ref(''), selectedFile = ref(''), template = ref('basic')
const request = ref(''), testTask = ref(''), error = ref(''), saveError = ref(false), saving = ref(false), busy = ref(''), loadingList = ref(false)
const validation = ref<CreatorValidation | null>(null), preview = ref(false)
const models = ref<Array<{ value: string; label: string }>>([]), modelSelection = ref('')
const previousGeneration = ref<CreatorFiles | null>(null)
const dirty = computed(() => Boolean(project.value && (name.value !== project.value.name || JSON.stringify(files.value) !== JSON.stringify(project.value.files))))
const canPreview = computed(() => /\.md$/i.test(selectedFile.value))
const previewHtml = computed(() => DOMPurify.sanitize(renderMarkdown((files.value[selectedFile.value] || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')), { FORBID_ATTR: ['style'], FORBID_TAGS: ['img','iframe','object','embed','video','audio','style','form','input','button','textarea','select'] }))
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saveChain: Promise<boolean> = Promise.resolve(true)
let disposed = false, generation = 0

async function refresh() {
  loadingList.value = true
  try { const result = await api.list(props.kind); if (!result.ok) throw new Error(result.error); projects.value = result.projects }
  catch (err) { error.value = creatorError(err) }
  finally { loadingList.value = false }
}
function apply(next: CreatorProject) {
  project.value = next; files.value = { ...next.files }; name.value = next.name
  if (!(selectedFile.value in files.value)) selectedFile.value = Object.keys(files.value)[0] || ''
  validation.value = null; error.value = ''; saveError.value = false; previousGeneration.value = null
}
function save(): Promise<boolean> {
  clearTimeout(saveTimer)
  saveChain = saveChain.then(async () => {
    if (!project.value || !dirty.value) return !saveError.value
    const current = project.value, snapshot = { ...files.value }, title = name.value
    saving.value = true
    try {
      const result = await api.save(current.id, current.revision, snapshot, title)
      if (!result.ok) throw new Error(result.error)
      if (project.value?.id === current.id) { project.value = result.project; if (name.value === title) name.value = result.project.name }
      saveError.value = false
      if (!disposed) await refresh()
      return true
    } catch (err) { saveError.value = true; error.value = creatorError(err); return false }
    finally { saving.value = false }
  })
  return saveChain
}
watch([files, name], () => { validation.value = null; clearTimeout(saveTimer); if (dirty.value && !disposed) saveTimer = setTimeout(() => { void save() }, 700) }, { deep: true })
watch(selectedFile, () => { preview.value = false })
async function choose(id: string) {
  if (busy.value || !await save()) return
  busy.value = 'open'
  try { const result = await api.get(id); if (!result.ok) throw new Error(result.error); apply(result.project) }
  catch (err) { error.value = creatorError(err) }
  finally { busy.value = '' }
}
async function create() {
  if (busy.value || !await save()) return
  busy.value = 'create'
  try { const result = await api.create(props.kind, template.value); if (!result.ok) throw new Error(result.error); apply(result.project); await refresh() }
  catch (err) { error.value = creatorError(err) }
  finally { busy.value = '' }
}
async function action(id: string, operation: () => Promise<void>) {
  if (busy.value) return
  busy.value = id; error.value = ''
  try { if (await save()) await operation() }
  catch (err) { error.value = creatorError(err) }
  finally { busy.value = '' }
}
async function checkSaved() {
  const current = project.value!
  const result = await api.validate(current.id, current.revision)
  if (!result.ok) throw new Error(result.error)
  validation.value = result.validation
  return result.validation.ok
}
const check = () => action('check', async () => { await checkSaved() })
const install = () => action('install', async () => {
  if (!await checkSaved()) return
  const current = project.value!, result = await api.install(current.id, current.revision)
  if (!result.ok) throw new Error(result.error)
  project.value = result.project; await refresh(); emit('notify', `${label.value}${current.installedId ? '已更新' : '已安装'}`, 'success')
})
const trial = () => action('trial', async () => {
  if (!await checkSaved()) return
  const current = project.value!, result = await api.trial(current.id, current.revision, testTask.value)
  if (!result.ok) throw new Error(result.error)
  emit('trial', result)
})
const exportProject = () => action('export', async () => {
  if (!await checkSaved()) return
  const current = project.value!, result = await api.export(current.id, current.revision)
  if (!result.ok) throw new Error(result.error)
  if (!result.canceled) emit('notify', '已导出', 'success')
})
async function generate() {
  if (busy.value || !request.value.trim()) return
  busy.value = 'generate'; error.value = ''
  const seq = ++generation
  try {
    if (!await save() || disposed || seq !== generation) return
    const current = project.value!, selected = JSON.parse(modelSelection.value) as [string,string]
    const result = await api.generate(current.id, current.revision, request.value, selected[0], selected[1])
    if (disposed || seq !== generation) return
    if (!result.ok) throw new Error(result.error)
    previousGeneration.value = { ...files.value }; files.value = { ...result.files }
    if (!(selectedFile.value in files.value)) selectedFile.value = Object.keys(files.value)[0] || ''
    if (await save()) await checkSaved()
  } catch (err) { if (!disposed && seq === generation) error.value = creatorError(err) }
  finally { if (seq === generation) busy.value = '' }
}
function cancelGenerate() { generation++; if (project.value) void api.cancelGenerate(project.value.id); busy.value = '' }
function undoGeneration() { if (previousGeneration.value) { files.value = { ...previousGeneration.value }; previousGeneration.value = null } }
async function close() { if (busy.value === 'generate') cancelGenerate(); if (await save()) emit('close') }
function indent(event: KeyboardEvent) {
  if (busy.value || event.shiftKey) return
  event.preventDefault()
  const textarea = event.target as HTMLTextAreaElement, start = textarea.selectionStart, end = textarea.selectionEnd
  textarea.setRangeText('  ', start, end, 'end'); textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
async function fileKey(event: KeyboardEvent, file: string) {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
  event.preventDefault()
  const names = Object.keys(files.value), index = names.indexOf(file)
  selectedFile.value = names[event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + names.length) % names.length]!
  await nextTick(); document.getElementById(`creator-file-${selectedFile.value.replace(/\W/g,'-')}`)?.focus()
}
onMounted(async () => {
  await refresh()
  if (projects.value[0]) await choose(projects.value[0].id)
  try {
    const config = await window.navora!.config.get()
    models.value = config.ai.providers.flatMap(provider => provider.models.map(model => ({ value: JSON.stringify([provider.id,model]), label: `${provider.label} · ${provider.model_settings?.[model]?.label || model}` })))
    const preferred = config.ai.providers.find(provider => provider.id === config.ai.default_provider)
    modelSelection.value = preferred ? JSON.stringify([preferred.id,preferred.model]) : models.value[0]?.value || ''
  } catch { /* Model configuration can be added later. */ }
})
onBeforeUnmount(() => { disposed = true; cancelGenerate(); clearTimeout(saveTimer); void save() })
</script>

<style scoped>
.creator-workspace { display:flex; flex-direction:column; min-height:0; height:100%; background:#fff; color:#344052; animation:creator-enter 180ms ease-out; }
.creator-header { height:46px; min-height:46px; display:flex; align-items:center; gap:10px; padding:6px 20px; border-bottom:1px solid #e9edf2; }
.creator-header > svg { width:15px; color:#69798e; }
h1 { font-size:14px; font-weight:600; }
.creator-back { width:28px; height:28px; padding:6px; display:grid; place-items:center; }
.creator-save-state { margin-left:auto; font-size:11px; color:#7e8999; }
.creator-save-state.error { color:#ad4350; }
.creator-layout { display:grid; grid-template-columns:190px minmax(0,1fr); flex:1; min-height:0; }
.creator-layout.external-navigation { grid-template-columns:minmax(0,1fr); }
.creator-library { padding:12px; background:#f8f9fb; border-right:1px solid #e9edf2; overflow:auto; }
.creator-new { display:flex; gap:5px; margin-bottom:14px; }
.creator-new select { min-width:0; width:100%; }
button,select { border:1px solid transparent; border-radius:7px; color:inherit; font-size:12px; transition:background-color 140ms ease,border-color 140ms ease; }
button { cursor:pointer; padding:6px 9px; display:inline-flex; align-items:center; justify-content:center; gap:6px; white-space:nowrap; }
button > svg { width:13px; height:13px; }
button:hover:not(:disabled) { background:#eaf0f6; border-color:#dce4ee; }
button:disabled { opacity:.45; cursor:default; }
.creator-primary { background:#3269ac; border-color:#3269ac; color:white; }
.creator-primary:hover:not(:disabled) { background:#2a5d9b; border-color:#2a5d9b; }
.creator-draft { width:100%; display:flex; justify-content:space-between; gap:6px; margin-bottom:4px; padding:8px; text-align:left; }
.creator-draft > span:first-child { overflow:hidden; text-overflow:ellipsis; }
.creator-draft.selected { background:#e7edf5; border-color:#dce5ef; color:#2d517e; }
.creator-draft-state { font-size:9px; color:#7a8697; flex-shrink:0; }
.creator-hint { padding:16px 4px; color:#8a94a1; font-size:12px; text-align:center; }
.creator-editor-area { display:flex; flex-direction:column; min-height:0; min-width:0; overflow:hidden; }
.creator-project-head { display:flex; align-items:center; gap:12px; padding:12px 22px 8px; }
.creator-name { min-width:0; flex:1; font-size:16px; font-weight:600; padding:4px 0; border-bottom:1px solid transparent; }
.creator-name:focus { outline:none; border-color:#89a6c9; }
.creator-version { color:#8b94a1; font-size:10px; flex-shrink:0; }
.creator-generation { margin:0 22px 14px; padding:10px; background:#f7f9fb; border:1px solid #e5eaf0; border-radius:9px; }
.creator-generation > textarea { display:block; width:100%; resize:vertical; min-height:48px; max-height:130px; padding:2px; color:#42526a; font-size:12px; line-height:1.7; font-family:inherit; }
.creator-generation-actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; margin-top:5px; }
.creator-generation-actions select { margin-right:auto; max-width:50%; min-width:0; font-size:10px; color:#748195; text-overflow:ellipsis; }
.creator-stop { color:#a23d48; border-color:#eed6da; }
.creator-file-bar { display:flex; justify-content:space-between; align-items:center; min-height:36px; border-block:1px solid #e9edf2; padding:3px 14px; background:#fafbfc; gap:6px; }
.creator-file-tabs { display:flex; min-width:0; overflow:auto; scrollbar-width:none; gap:3px; }
.creator-file-tabs button { font-size:11px; color:#7b8593; }
.creator-file-tabs button.active { background:#e8edf3; border-color:#dfe5ed; color:#3a5374; }
.creator-preview-toggle { flex-shrink:0; font-size:11px; }
.creator-code { flex:1; min-height:100px; width:100%; padding:18px 22px; resize:none; white-space:pre; overflow:auto; tab-size:2; font:12px/1.8 Consolas,monospace; background:white; color:#344052; outline:none; }
.creator-rendered { flex:1; min-height:100px; padding:18px 24px; overflow:auto; font-size:13px; line-height:1.8; overflow-wrap:anywhere; }
.creator-rendered :deep(p),.creator-rendered :deep(h1),.creator-rendered :deep(h2),.creator-rendered :deep(ol),.creator-rendered :deep(ul) { margin-bottom:.75em; }
.creator-rendered :deep(ol),.creator-rendered :deep(ul) { padding-left:22px; }
.creator-rendered :deep(pre) { overflow:auto; padding:12px; background:#f6f8fa; border-radius:7px; }
.creator-validation { border-top:1px solid #e7edf2; background:#f7faf9; padding:9px 22px; max-height:160px; overflow:auto; font-size:11px; }
.creator-validation.failed { background:#fcf7f7; }
.creator-validation-title { display:flex; gap:7px; align-items:center; color:#398162; }
.failed .creator-validation-title { color:#b15560; }
.creator-checks { color:#7c8b91; font-size:10px; }
.creator-validation button { display:block; padding:4px 0; font-size:11px; text-align:left; white-space:normal; }
.creator-validation .error { color:#ad4350; }
.creator-validation .warning { color:#95703e; }
.creator-footer { border-top:1px solid #e9edf2; padding:10px 22px 14px; }
.creator-footer input { width:100%; padding:5px 0 10px; font-size:11px; }
.creator-footer-actions { display:flex; align-items:center; gap:7px; justify-content:flex-end; }
.creator-footer-actions > button:first-child { margin-right:auto; }
.creator-footer-actions > button:not(.creator-primary) { border-color:#e2e7ef; }
.creator-error { display:flex; align-items:center; justify-content:space-between; gap:10px; color:#a64954; background:#fdf4f4; padding:8px 20px; font-size:12px; flex-shrink:0; }
.creator-empty { margin:auto; padding:30px; text-align:center; color:#8290a2; }
.creator-empty > svg { width:30px; height:30px; margin-bottom:15px; }
.creator-empty h2 { font-size:18px; color:#42536a; margin-bottom:8px; }
.creator-empty p { font-size:12px; margin-bottom:20px; }
button:focus-visible,select:focus-visible,textarea:focus-visible { outline:2px solid #6d93bf; outline-offset:-2px; }
@keyframes creator-enter { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:none; } }
@media(max-width:1000px) { .creator-layout { grid-template-columns:150px minmax(0,1fr); } .creator-new { flex-wrap:wrap; } .creator-new button { width:100%; } .creator-library { padding:9px; } }
@media(max-width:650px) {
  .creator-header { padding:6px 12px; }
  .creator-layout { display:flex; flex-direction:column; }
  .creator-library { display:flex; align-items:center; gap:6px; min-height:52px; height:52px; flex-shrink:0; border-right:0; border-bottom:1px solid #e9edf2; overflow:auto; padding:7px; }
  .creator-new { margin:0; flex-wrap:nowrap; flex-shrink:0; }
  .creator-new select { display:none; }
  .creator-draft { width:auto; max-width:180px; flex-shrink:0; margin:0; }
  .creator-hint { padding:0 8px; white-space:nowrap; }
  .creator-editor-area { flex:1; }
  .creator-project-head { padding:8px 12px; }
  .creator-generation { margin:0 12px 10px; }
  .creator-generation-actions { flex-wrap:wrap; }
  .creator-generation-actions select { max-width:55%; }
  .creator-code { padding:12px; }
  .creator-footer { padding:8px 12px; }
  .creator-footer-actions { flex-wrap:wrap; gap:5px; }
  .creator-footer-actions button { padding:6px; font-size:11px; }
  .creator-checks { display:none; }
  .creator-file-bar { padding-inline:8px; }
}
@media(prefers-reduced-motion:reduce) { .creator-workspace { animation:none; } button,select { transition:none; } }
</style>
