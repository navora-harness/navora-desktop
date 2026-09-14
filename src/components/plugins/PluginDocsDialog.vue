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
      <div class="preview-bar">
        <span>说明预览</span>
        <span class="preview-bar-hint">来自插件目录 README.md / docs.md</span>
      </div>
      <div v-if="loading" class="md-empty">加载中…</div>
      <div v-else-if="error" class="md-empty error">{{ error }}</div>
      <div v-else class="md-body" v-html="html" />
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
.preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid #e8eef3;
  background: #f7fafc;
  font-size: 0.78rem;
  font-weight: 650;
  color: #3d5163;
}
.preview-bar-hint {
  font-weight: 500;
  color: #8a9aab;
}
.md-body {
  max-height: min(58vh, 520px);
  overflow: auto;
  padding: 14px 16px 18px;
  font-size: 0.92rem;
  line-height: 1.55;
  color: #243447;
}
.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3) {
  margin: 0.9em 0 0.4em;
  line-height: 1.25;
  color: #15202b;
}
.md-body :deep(h1) {
  font-size: 1.25rem;
}
.md-body :deep(h2) {
  font-size: 1.1rem;
}
.md-body :deep(h3) {
  font-size: 1rem;
}
.md-body :deep(p),
.md-body :deep(ul),
.md-body :deep(ol) {
  margin: 0.45em 0;
}
.md-body :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.86em;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: #eef3f7;
}
.md-body :deep(pre) {
  overflow: auto;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f3f7fa;
  border: 1px solid #e4ebf1;
}
.md-body :deep(pre code) {
  padding: 0;
  background: transparent;
}
.md-body :deep(a) {
  color: #1f6feb;
}
.md-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid #e0e7ee;
  padding: 6px 8px;
  text-align: left;
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
