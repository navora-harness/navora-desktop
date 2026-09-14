<template>
  <SkillDialogShell
    :model-value="modelValue"
    kicker="技能"
    title="导出技能"
    :subtitle="subtitle"
    :max-width="780"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="name || skillId" class="hero-meta">
      <div class="hero-name">{{ name || skillId }}</div>
      <div v-if="name && skillId" class="hero-chips">
        <span class="chip">id: {{ skillId }}</span>
      </div>
    </div>

    <div class="preview-panel">
      <div class="preview-bar">
        <span>SKILL.md 预览</span>
        <span class="preview-bar-hint">导出前确认内容</span>
      </div>
      <pre class="md-preview">{{ markdown || '（空）' }}</pre>
    </div>

    <template #actions>
      <v-spacer />
      <v-btn variant="text" :disabled="saving" @click="emit('cancel')">取消</v-btn>
      <v-btn color="primary" :loading="saving" @click="emit('confirm')">
        <font-awesome-icon icon="file-export" class="btn-ic" />
        导出到文件
      </v-btn>
    </template>
  </SkillDialogShell>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SkillDialogShell from './SkillDialogShell.vue'

const props = defineProps<{
  modelValue: boolean
  name?: string
  skillId?: string
  markdown: string
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
  cancel: []
}>()

const subtitle = computed(() => {
  if (props.name || props.skillId) return '确认内容后选择保存位置'
  return '确认后选择保存位置'
})
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
  font-size: 0.7rem;
  font-weight: 650;
  padding: 2px 8px;
  border-radius: 6px;
  color: #5d6d7e;
  background: #eef3f7;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.preview-panel {
  border-radius: 12px;
  border: 1px solid #d5dee7;
  overflow: hidden;
  background: #f7fafc;
}
.preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #e8eef4;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #7a8a99;
  background: #fff;
}
.preview-bar-hint {
  font-weight: 550;
  text-transform: none;
  letter-spacing: 0;
  color: #9aa8b5;
}
.md-preview {
  margin: 0;
  padding: 12px 14px;
  max-height: 420px;
  overflow: auto;
  background: #fff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: #1b2834;
  user-select: text;
}
.btn-ic {
  margin-right: 8px;
}
</style>
