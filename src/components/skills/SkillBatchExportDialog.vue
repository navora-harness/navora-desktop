<template>
  <SkillDialogShell
    :model-value="modelValue"
    kicker="技能"
    title="批量导出技能"
    subtitle="将所选技能导出为独立的 SKILL.md 到同一文件夹"
    :max-width="520"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="hero-meta">
      <div class="hero-name">已选 {{ items.length }} 个技能</div>
      <p class="hero-hint">确认后选择导出文件夹；每个技能写入一个 .md 文件。</p>
    </div>

    <ul class="export-list" role="list">
      <li v-for="it in items" :key="it.id" role="listitem">
        <span class="export-name">{{ it.name || it.id }}</span>
        <span class="export-id">{{ it.id }}</span>
      </li>
    </ul>

    <template #actions>
      <v-spacer />
      <v-btn variant="text" :disabled="saving" @click="emit('cancel')">取消</v-btn>
      <v-btn
        color="primary"
        :loading="saving"
        :disabled="!items.length"
        @click="emit('confirm')"
      >
        <font-awesome-icon icon="file-export" class="btn-ic" />
        导出到文件夹（{{ items.length }}）
      </v-btn>
    </template>
  </SkillDialogShell>
</template>

<script setup lang="ts">
import SkillDialogShell from './SkillDialogShell.vue'

defineProps<{
  modelValue: boolean
  items: Array<{ id: string; name?: string }>
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
  cancel: []
}>()
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
.hero-hint {
  margin: 6px 0 0;
  color: #5d6d7e;
  font-size: 0.86rem;
  line-height: 1.45;
}
.export-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 280px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-radius: 12px;
  border: 1px solid #d5dee7;
  background: #f7fafc;
  padding: 8px;
}
.export-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #e8eef4;
}
.export-name {
  font-size: 0.9rem;
  font-weight: 650;
  color: #15202b;
}
.export-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.72rem;
  color: #7a8a99;
}
.btn-ic {
  margin-right: 8px;
}
</style>
