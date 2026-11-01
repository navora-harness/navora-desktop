<template>
  <SkillDialogShell
    :model-value="modelValue"
    kicker="插件"
    title="插件说明"
    :subtitle="subtitle"
    :max-width="780"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="name || pluginId" class="hero-meta">
      <div class="hero-name">{{ name || pluginId }}</div>
      <div v-if="name && pluginId" class="hero-chips">
        <span class="chip">id: {{ pluginId }}</span>
        <span v-if="fileName" class="chip">{{ fileName }}</span>
      </div>
    </div>

    <div class="preview-panel">
      <div v-if="loading" class="md-empty">加载中…</div>
      <div v-else-if="error" class="md-empty error">{{ error }}</div>
      <PluginMarkdown v-else class="plugin-doc-viewer" :html="html" />
    </div>

    <template #actions>
      <v-spacer />
      <v-btn color="primary" variant="tonal" @click="emit('update:modelValue', false)">关闭</v-btn>
    </template>
  </SkillDialogShell>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SkillDialogShell from '../skills/SkillDialogShell.vue'
import { renderMarkdown } from '@/utils/markdown'
import PluginMarkdown from './PluginMarkdown.vue'

const props = defineProps<{
  modelValue: boolean
  name?: string
  pluginId?: string
  markdown?: string
  fileName?: string
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const html = ref('')

const subtitle = computed(() => {
  if (props.name || props.pluginId) return '查看插件作者提供的说明'
  return '查看说明'
})

watch(
  () => props.markdown,
  (md) => {
    html.value = renderMarkdown(md || '')
  },
  { immediate: true },
)
</script>

<style scoped>
.hero-meta {
  margin-bottom: 14px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid #e0e7ee;
  background: linear-gradient(180deg, #f7fafc 0%, #fff 100%);
}
.hero-name {
  font-size: 1.05rem;
  font-weight: 750;
  color: #15202b;
  letter-spacing: -0.01em;
}
.hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef3f7;
  color: #5a6b7a;
  font-size: 0.75rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.preview-panel {
  border: 1px solid #e0e7ee;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.plugin-doc-viewer {
  padding: 20px 22px 26px;
}
.md-empty {
  padding: 28px 16px;
  text-align: center;
  color: #8a9aab;
  font-size: 0.9rem;
}
.md-empty.error {
  color: #c0392b;
}
</style>
