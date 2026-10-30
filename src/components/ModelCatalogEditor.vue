<template>
  <section class="model-catalog" aria-label="模型能力配置">
    <div class="catalog-toolbar">
      <h3>模型目录</h3>
      <div class="catalog-toolbar"><button type="button" class="catalog-button" :disabled="loading" @click="fetchModels">{{ loading ? '获取中…' : '获取可用模型' }}</button><button type="button" class="catalog-button" @click="addModel">＋ 添加模型</button></div>
    </div>
    <p v-if="feedback" class="catalog-note" role="status">{{ feedback }}</p>
    <article v-for="id in provider.models" :key="id" class="model-entry">
      <div class="catalog-toolbar">
        <strong>{{ settings(id).label || id }}</strong>
        <button type="button" class="catalog-button danger" :disabled="provider.models.length <= 1" :aria-label="`删除模型 ${id}`" @click="removeModel(id)">移除</button>
      </div>
      <div class="model-grid">
        <label>模型 ID<input :value="id" @change="renameModel(id, $event.target as HTMLInputElement)" /></label>
        <label>显示名称<input v-model="settings(id).label" /></label>
        <label>上下文窗口（token）<input v-model.number="settings(id).context_window" type="number" min="1024" max="10000000" /></label>
        <label>最大输出（token）<input v-model.number="settings(id).max_output_tokens" type="number" min="1" :max="settings(id).context_window - 1" /></label>
      </div>
      <div class="catalog-toolbar modalities">
        <span>输入类型</span>
        <label><input type="checkbox" checked disabled />文本</label>
        <label><input type="checkbox" :checked="settings(id).input_types.includes('image')" @change="setImages(id, ($event.target as HTMLInputElement).checked)" />图片</label>
      </div>
      <label class="reasoning-toggle"><input v-model="settings(id).reasoning.enabled" type="checkbox" />启用推理档位</label>
      <template v-if="settings(id).reasoning.enabled">
        <div class="reasoning-head"><span>档位</span><span>API 参数值</span><span /></div>
        <div v-for="(level, index) in settings(id).reasoning.levels" :key="index" class="reasoning-row">
          <input v-model="level.id" aria-label="档位名称" placeholder="如 high" />
          <input v-model="level.value" aria-label="推理 API 参数值" placeholder="如 xhigh" />
          <button type="button" class="catalog-button" aria-label="删除档位" @click="settings(id).reasoning.levels.splice(index, 1)">×</button>
        </div>
        <div class="catalog-toolbar">
          <button type="button" class="catalog-button" @click="settings(id).reasoning.levels.push({ id: '', value: '' })">＋ 添加档位</button>
          <label class="default-tier">默认档位<select v-model="settings(id).reasoning.default"><option v-for="level in settings(id).reasoning.levels" :key="level.id" :value="level.id">{{ level.id }}</option></select></label>
        </div>
      </template>
    </article>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { AiProviderConfig } from '@shared/config'
import { defaultModelCapabilities } from '@shared/model-capabilities'
const props = defineProps<{ provider: AiProviderConfig }>()
const loading = ref(false)
const feedback = ref('')
async function fetchModels() {
  if (!window.navora || loading.value) return
  loading.value = true
  feedback.value = ''
  const provider = props.provider
  try {
    const config = await window.navora.config.get()
    if (config.ai.providers.find(p => p.id === provider.id)?.base_url !== provider.base_url) { feedback.value = '请先应用服务地址和密钥，再获取模型。'; return }
    const result = await window.navora.models.list(provider.id)
    if (!result.ok) { feedback.value = result.error || '获取失败'; return }
    provider.models = [...new Set([...provider.models, ...(result.models || [])])]
    feedback.value = `已获取 ${result.models?.length || 0} 个模型`
  } catch (error) { feedback.value = error instanceof Error ? error.message : '获取失败' }
  finally { loading.value = false }
}
// Populate once per catalog change, never mutate reactive state during render.
watch(() => [props.provider.id, ...props.provider.models], () => {
  props.provider.model_settings ||= {}
  for (const id of props.provider.models) props.provider.model_settings[id] ||= defaultModelCapabilities(id)
}, { immediate: true, flush: 'sync' })
const settings = (id: string) => props.provider.model_settings![id]!
function setImages(id: string, enabled: boolean) { settings(id).input_types = enabled ? ['text', 'image'] : ['text'] }
function addModel() {
  let id = 'new-model', i = 2
  while (props.provider.models.includes(id)) id = `new-model-${i++}`
  props.provider.models.push(id)
}
function removeModel(id: string) {
  if (props.provider.models.length <= 1) return
  props.provider.models = props.provider.models.filter(m => m !== id)
  delete props.provider.model_settings![id]
  if (props.provider.model === id) props.provider.model = props.provider.models[0]!
}
function renameModel(id: string, input: HTMLInputElement) {
  const next = input.value.trim()
  if (!next || (next !== id && props.provider.models.includes(next))) {
    feedback.value = next ? '模型 ID 已存在' : '请填写模型 ID'
    input.value = id
    return
  }
  feedback.value = ''
  props.provider.model_settings![next] = settings(id)
  if (id !== next) delete props.provider.model_settings![id]
  props.provider.models = props.provider.models.map(m => m === id ? next : m)
  if (props.provider.model === id) props.provider.model = next
}
</script>

<style scoped>
.model-catalog { grid-column: 1 / -1; min-width: 0; }
.catalog-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.catalog-toolbar h3 { font-size: 15px; }
.model-entry { background: #f7f8fa; border: 1px solid #e2e5e9; border-radius: 14px; padding: 16px; margin-top: 12px; }
.model-entry strong { overflow-wrap: anywhere; }
.model-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 14px 0; }
label { color: #505761; font-size: 13px; display: flex; flex-direction: column; gap: 6px; }
input:not([type=checkbox]), select { width: 100%; min-width: 0; background: #fff; color: #20252c; border: 1px solid #cdd2da; padding: 10px 12px; border-radius: 9px; font: inherit; }
input:focus, select:focus { outline: 2px solid #4583d1; outline-offset: 1px; }
input[type=checkbox] { accent-color: #20252c; width: 16px; height: 16px; }
.modalities { justify-content: flex-start; margin: 14px 0; font-size: 13px; color: #505761; }
.modalities label, .reasoning-toggle { flex-direction: row; align-items: center; gap: 8px; }
.catalog-note { font-size: 12px; color: #626a75; margin: 12px 0; }
.reasoning-head, .reasoning-row { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) 36px; gap: 10px; align-items: center; margin: 8px 0; }
.reasoning-head { color: #626a75; font-size: 12px; }
.catalog-button { color: #39414d; border: 1px solid #d5d9df; background: #fff; border-radius: 8px; padding: 6px 10px; font: inherit; cursor: pointer; }
.catalog-button:hover { background: #e9edf2; }
.catalog-button:disabled { opacity: .45; cursor: default; }
.catalog-button.danger { color: #b02d35; }
.default-tier { flex-direction: row; align-items: center; }
.default-tier select { width: auto; }
@media(max-width:600px) { .model-grid { grid-template-columns: 1fr; } .model-entry { padding: 12px; } }
</style>
