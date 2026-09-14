<template>
  <SkillDialogShell
    :model-value="modelValue"
    kicker="技能"
    title="导入技能"
    :subtitle="conflictHint"
    :max-width="780"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="hero-meta">
      <div class="hero-name">{{ preview?.name || '未命名' }}</div>
      <div class="hero-chips">
        <span v-if="preview?.sourceLabel" class="chip">{{ preview.sourceLabel }}</span>
        <span v-if="preview?.version && conflictKind !== 'update'" class="chip">
          v{{ preview.version }}
        </span>
        <span
          v-if="conflictBadge"
          class="chip"
          :class="conflictKind === 'update' ? 'info' : 'warn'"
        >
          {{ conflictBadge }}
        </span>
        <span v-if="preview?.disableModelInvocation" class="chip info">需 skill_read</span>
      </div>
      <p class="hero-desc">{{ preview?.description || '（无描述）' }}</p>
    </div>

    <div class="preview-panel">
      <div class="preview-bar">
        <span>正文预览</span>
        <span class="preview-bar-hint">Markdown</span>
      </div>
      <pre class="md-preview">{{ preview?.body || '（无正文）' }}</pre>
    </div>

    <template #actions>
      <v-spacer />
      <v-btn variant="text" :disabled="saving" @click="emit('update:modelValue', false)">取消</v-btn>
      <v-btn
        color="primary"
        :loading="saving"
        @click="emit('confirm', { overwrite: Boolean(preview?.existing) })"
      >
        {{ confirmLabel }}
      </v-btn>
    </template>
  </SkillDialogShell>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  skillImportConflictBadge,
  skillImportConflictKind,
  type SkillImportPreview,
} from '@shared/skills'
import SkillDialogShell from './SkillDialogShell.vue'

const props = defineProps<{
  modelValue: boolean
  preview: SkillImportPreview | null
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [opts: { overwrite: boolean }]
}>()

const conflictKind = computed(() =>
  skillImportConflictKind(props.preview?.existing, props.preview?.version),
)

const conflictBadge = computed(() =>
  skillImportConflictBadge(props.preview?.existing, props.preview?.version),
)

const confirmLabel = computed(() => {
  if (conflictKind.value === 'update') return '更新导入'
  if (conflictKind.value === 'overwrite') return '覆盖导入'
  return '确认导入'
})

const conflictHint = computed(() => {
  const ex = props.preview?.existing
  if (!ex) return '确认后写入本地技能库'
  if (conflictKind.value === 'update' && conflictBadge.value) {
    return `「${ex.name}」${conflictBadge.value}（id: ${ex.id}），启用状态保持不变`
  }
  return `将覆盖已有技能「${ex.name}」（id: ${ex.id}），启用状态保持不变`
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
}
.chip.warn {
  color: #a93226;
  background: #fdecea;
}
.chip.info {
  color: #1b4f72;
  background: #e8f1f7;
}
.hero-desc {
  margin: 10px 0 0;
  color: #314556;
  font-size: 0.88rem;
  line-height: 1.5;
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
  max-height: 360px;
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
</style>
