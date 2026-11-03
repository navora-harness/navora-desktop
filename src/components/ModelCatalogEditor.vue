<template>
  <section class="model-catalog" aria-label="模型能力配置">
    <div class="catalog-toolbar">
      <h3>模型目录 <span class="catalog-count">{{ provider.models.length }}</span></h3>
      <div class="catalog-actions">
        <button type="button" class="catalog-button" :disabled="loading" @click="fetchModels">{{ loading ? '获取中…' : '获取模型' }}</button>
        <button type="button" class="catalog-button" @click="addModel"><AppIcon icon="plus" /> 添加</button>
      </div>
    </div>
    <p v-if="feedback" class="catalog-note" role="status">{{ feedback }}</p>
    <div class="catalog-picker">
      <label>编辑模型<select v-model="selected"><option v-for="id in provider.models" :key="id" :value="id">{{ settings(id).label || id }}{{ provider.model === id ? ' · 默认' : '' }}</option></select></label>
      <button type="button" class="catalog-button" :disabled="selected === provider.model" @click="provider.model = selected">{{ selected === provider.model ? '默认模型' : '设为默认' }}</button>
    </div>
    <article v-if="active" class="model-entry">
      <div class="model-grid">
        <label>模型 ID<input :key="selected" :value="selected" @change="renameModel(selected, $event.target as HTMLInputElement)" /></label>
        <label>显示名称<input v-model="active.label" /></label>
        <label>上下文窗口<input v-model.number="active.context_window" type="number" min="1024" max="10000000" /></label>
        <label>最大输出 token<input v-model.number="active.max_output_tokens" type="number" min="1" :max="active.context_window - 1" /></label>
      </div>
      <div class="catalog-toolbar modalities">
        <span>输入类型</span><span class="input-chip">文本</span>
        <label class="inline-check"><input type="checkbox" :checked="active.input_types.includes('image')" @change="setImages(selected, ($event.target as HTMLInputElement).checked)" />图片</label>
        <button type="button" class="catalog-button danger remove-model" :disabled="provider.models.length <= 1" @click="removeModel(selected)">删除模型</button>
      </div>
      <label class="reasoning-toggle">推理档位<input v-model="active.reasoning.enabled" class="surface-toggle" type="checkbox" role="switch" /></label>
      <DisclosureTransition>
        <div v-if="active.reasoning.enabled" class="reasoning-settings">
          <div class="catalog-toolbar reasoning-controls">
            <label class="default-tier">默认档位<select v-model="active.reasoning.default"><option v-for="level in active.reasoning.levels" :key="level.id" :value="level.id">{{ level.id }}</option></select></label>
            <button type="button" class="catalog-button tier-mapping-toggle" :aria-expanded="mappingOpen" @click="mappingOpen = !mappingOpen">{{ mappingOpen ? '收起映射' : active.reasoning.levels.length + ' 个档位 · 编辑映射' }}</button>
          </div>
          <DisclosureTransition><div v-if="mappingOpen" class="tier-mappings">
          <div class="reasoning-head"><span>档位名称</span><span>API 参数值</span><span /></div>
          <div v-for="(level, index) in active.reasoning.levels" :key="index" class="reasoning-row">
            <input :value="level.id" aria-label="档位名称" maxlength="40" @change="renameTier(index, $event.target as HTMLInputElement)" />
            <input v-model="level.value" aria-label="推理 API 参数值" maxlength="100" placeholder="如 xhigh" />
            <button type="button" class="catalog-button icon-control" :aria-label="`删除档位 ${level.id}`" @click="removeReasoningLevel(active.reasoning, index)"><AppIcon icon="trash" /></button>
          </div>
          <div class="catalog-toolbar">
            <button type="button" class="catalog-button" @click="addTier"><AppIcon icon="plus" /> 添加档位</button>

          </div>
          </div></DisclosureTransition>
        </div>
      </DisclosureTransition>
    </article>
    <div class="probe-actions"><button type="button" class="catalog-button" :disabled="!!testing || pendingCredentials" @click="probe('connection')">{{ testing === 'connection' ? '连接中…' : '测试连接' }}</button><button type="button" class="catalog-button" :disabled="!!testing || pendingCredentials" @click="probe('reply')">{{ testing === 'reply' ? '等待回答…' : '测试问答' }}</button><span v-if="probeResult" class="probe-result" :class="{ failed: !probeResult.ok }" role="status">{{ probeResult.text }}{{ probeResult.ms != null ? ' · ' + (probeResult.ms / 1000).toFixed(1) + 's' : '' }}</span></div>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AiProviderConfig } from '@shared/config'
import { defaultModelCapabilities, renameReasoningLevel, removeReasoningLevel } from '@shared/model-capabilities'
import DisclosureTransition from './motion/DisclosureTransition'
const props = defineProps<{ provider: AiProviderConfig; pendingCredentials?: boolean }>()
const loading = ref(false)
const mappingOpen = ref(false)
const testing = ref('')
const probeResult = ref<{ok:boolean;text:string;ms?:number}|null>(null)
const feedback = ref('')
const selected = ref('')
watch(() => [props.provider.id, ...props.provider.models], () => {
  props.provider.model_settings ||= {}
  for (const id of props.provider.models) props.provider.model_settings[id] ||= defaultModelCapabilities(id)
  if (!props.provider.models.includes(selected.value)) selected.value = props.provider.model || props.provider.models[0] || ''
}, { immediate: true, flush: 'sync' })
const settings = (id: string) => props.provider.model_settings![id]!
const active = computed(() => props.provider.model_settings?.[selected.value])
function setImages(id: string, enabled: boolean) { settings(id).input_types = enabled ? ['text', 'image'] : ['text'] }
function addModel() {
  let id = 'new-model', i = 2
  while (props.provider.models.includes(id)) id = `new-model-${i++}`
  props.provider.models.push(id)
  selected.value = id
}
function removeModel(id: string) {
  if (props.provider.models.length <= 1) return
  if (props.provider.model === id) props.provider.model = props.provider.models.find(m => m !== id)!
  props.provider.models = props.provider.models.filter(m => m !== id)
  delete props.provider.model_settings![id]
}
function renameModel(id: string, input: HTMLInputElement) {
  const next = input.value.trim()
  if (!next || (next !== id && props.provider.models.includes(next))) {
    feedback.value = next ? '模型 ID 已存在' : '请填写模型 ID'; input.value = id; return
  }
  feedback.value = ''
  props.provider.model_settings![next] = settings(id)
  if (id !== next) delete props.provider.model_settings![id]
  if (props.provider.model === id) props.provider.model = next
  props.provider.models = props.provider.models.map(m => m === id ? next : m)
  selected.value = next
}
function renameTier(index: number, input: HTMLInputElement) {
  if (!active.value) return
  if (!renameReasoningLevel(active.value.reasoning, index, input.value)) {
    feedback.value = '档位名称不能为空或重复'; input.value = active.value.reasoning.levels[index]?.id || ''
  } else feedback.value = ''
}
function addTier() {
  if (!active.value) return
  let id = 'custom', n = 2
  while (active.value.reasoning.levels.some(l => l.id === id)) id = `custom-${n++}`
  active.value.reasoning.levels.push({ id, value: '' })
  active.value.reasoning.default ||= id
}
async function probe(kind: 'connection' | 'reply') {
  if (!window.navora || testing.value || props.pendingCredentials) return
  testing.value = kind; probeResult.value = null
  const provider = props.provider, model = selected.value
  try {
    const disk = await window.navora.config.get()
    if (JSON.stringify(disk.ai.providers.find(p => p.id === provider.id)) !== JSON.stringify(provider)) { probeResult.value = { ok: false, text: '请先应用配置' }; return }
    const result = await window.navora.models.probe(provider.id, model, kind)
    if (provider === props.provider && model === selected.value) probeResult.value = result
  } catch { probeResult.value = { ok:false, text:'测试失败，请重试' } }
  finally { testing.value = '' }
}
watch(selected, () => { probeResult.value = null; feedback.value = ''; mappingOpen.value = false })
async function fetchModels() {
  if (!window.navora || loading.value) return
  if (props.pendingCredentials) { feedback.value = '请先应用密钥'; return }
  loading.value = true
  feedback.value = ''
  const provider = props.provider
  try {
    const config = await window.navora.config.get()
    if (config.ai.providers.find(p => p.id === provider.id)?.base_url !== provider.base_url) { feedback.value = '请先应用连接配置，再获取模型。'; return }
    const result = await window.navora.models.list(provider.id)
    if (!result.ok) { feedback.value = result.error || '获取失败'; return }
    provider.models = [...new Set([...provider.models, ...(result.models || [])])]
    feedback.value = `已获取 ${result.models?.length || 0} 个模型`
  } catch (error) { feedback.value = error instanceof Error ? error.message : '获取失败' }
  finally { loading.value = false }
}
</script>
<style scoped>
.probe-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding-top:14px; margin-top:14px; border-top:1px solid var(--n-border); }
.probe-result { font-size:12px; color:#32856b; overflow-wrap:anywhere; }
.probe-result.failed { color:#b02d35; }
.reasoning-controls { padding:4px 0; }
.model-catalog { container-type:inline-size;grid-column:1 / -1; min-width:0; }
.catalog-toolbar,.catalog-actions { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.catalog-toolbar h3 { font-size:13px; font-weight:600; display:flex; align-items:center; gap:8px; }
.catalog-count { font-size:11px; color:var(--n-muted,#6b7280); font-weight:400; }
.catalog-picker { display:flex; align-items:flex-end; gap:8px; margin-top:12px; }
.catalog-picker>label { flex:1; min-width:0; }
.catalog-picker>button { height:34px; flex-shrink:0; }
.model-entry { border-top:1px solid var(--n-border,#e5e7eb); margin-top:14px; padding-top:14px; }
.model-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
label { color:var(--n-muted,#6b7280); font-size:12px; display:flex; flex-direction:column; gap:5px; }
input:not([type=checkbox]),select { width:100%; min-width:0; background:var(--n-surface,#fff); color:var(--n-text,#20252c); border:1px solid var(--n-border,#dfe3e8); padding:7px 10px; height:34px; border-radius:8px; font:inherit; font-size:13px; }
input:focus-visible,select:focus-visible { outline:2px solid var(--n-accent,#2f6df6); outline-offset:2px; }
input[type=checkbox]:not(.surface-toggle) { accent-color:var(--n-accent,#2f6df6); width:15px; height:15px; }
.modalities { justify-content:flex-start; margin:14px 0; font-size:12px; color:var(--n-muted,#6b7280); }
.inline-check { flex-direction:row; align-items:center; gap:6px; }
.input-chip { border:1px solid var(--n-border,#e5e7eb); padding:2px 7px; border-radius:5px; }
.remove-model { margin-left:auto; }
.reasoning-toggle { flex-direction:row; align-items:center; justify-content:space-between; padding-top:12px; border-top:1px solid var(--n-border,#e5e7eb); color:var(--n-text,#20252c); }
.reasoning-settings { padding-top:8px; }
.catalog-note { font-size:12px; color:var(--n-muted,#626a75); margin:10px 0; overflow-wrap:anywhere; }
.reasoning-head,.reasoning-row { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) 30px; gap:8px; align-items:center; margin:7px 0; }
.reasoning-head { color:var(--n-muted,#626a75); font-size:11px; }
.catalog-button { display:inline-flex; align-items:center; justify-content:center; gap:6px; color:var(--n-text,#39414d); border:1px solid var(--n-border,#dfe3e8); background:var(--n-surface,#fff); border-radius:7px; padding:5px 9px; font:inherit; font-size:12px; cursor:pointer; transition:background .14s,color .14s,border-color .14s; }
.catalog-button:hover:not(:disabled) { background:var(--n-hover,#f1f3f6); border-color:#cbd2dc; }
.catalog-button:disabled { opacity:.45; cursor:default; }
.catalog-button.danger { color:#b02d35; }
.icon-control { width:30px; height:30px; padding:0; }
.default-tier { flex-direction:row; align-items:center; gap:8px; }
.default-tier select { width:100px; }
@media(max-width:600px) { .model-grid { grid-template-columns:1fr; } .catalog-actions { gap:5px; } }
@container(max-width:520px){.model-grid{grid-template-columns:minmax(0,1fr)}.catalog-actions{gap:5px}.catalog-picker{flex-wrap:wrap}.catalog-picker>label{flex:1 1 150px}.modalities{gap:8px}.remove-model{margin-left:0}.default-tier{flex-wrap:wrap}.reasoning-head,.reasoning-row{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 32px}}
</style>
