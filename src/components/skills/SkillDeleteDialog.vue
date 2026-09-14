<template>
  <SkillDialogShell
    :model-value="modelValue"
    :kicker="kicker"
    :title="dialogTitle"
    :subtitle="subtitle"
    :max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="danger-panel">
      <div class="danger-icon" aria-hidden="true">
        <font-awesome-icon icon="trash" />
      </div>
      <div class="danger-body">
        <template v-if="isBatch">
          <p class="msg">
            确定{{ actionVerb }}选中的
            <strong>{{ items.length }}</strong>
            个{{ entityLabel }}吗？
          </p>
          <ul class="batch-names">
            <li v-for="it in items" :key="it.id">
              <span class="batch-name">{{ it.name || it.id }}</span>
              <span class="batch-id">{{ it.id }}</span>
            </li>
          </ul>
        </template>
        <template v-else>
          <p class="msg">
            确定{{ actionVerb }}{{ entityLabel }}
            <strong>{{ name || skillId }}</strong>
            吗？
          </p>
          <p v-if="skillId" class="id">id: {{ skillId }}</p>
          <p v-if="description" class="desc">{{ description }}</p>
        </template>
      </div>
    </div>

    <template #actions>
      <v-spacer />
      <v-btn variant="text" :disabled="saving" @click="emit('cancel')">取消</v-btn>
      <v-btn color="error" :loading="saving" @click="emit('confirm')">
        {{ isBatch ? `确认${actionVerb}（${items.length}）` : `确认${actionVerb}` }}
      </v-btn>
    </template>
  </SkillDialogShell>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SkillDialogShell from './SkillDialogShell.vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    skillId?: string
    name?: string
    description?: string
    /** Batch targets; when length > 0, use batch UI. */
    items?: Array<{ id: string; name?: string }>
    saving?: boolean
    kicker?: string
    entityLabel?: string
    subtitle?: string
    /** e.g. 删除 / 卸载 */
    actionVerb?: string
  }>(),
  {
    kicker: '技能',
    entityLabel: '技能',
    subtitle: '删除后不可恢复，请确认目标无误',
    actionVerb: '删除',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
  cancel: []
}>()

const items = computed(() => props.items || [])
const isBatch = computed(() => items.value.length > 0)
const dialogTitle = computed(() =>
  isBatch.value
    ? `批量${props.actionVerb}${props.entityLabel}`
    : `${props.actionVerb}${props.entityLabel}`,
)
</script>

<style scoped>
.danger-panel {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid #f0cfc9;
  background: linear-gradient(180deg, #fdf6f5 0%, #fff 100%);
}
.danger-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fdecea;
  color: #c0392b;
  font-size: 0.95rem;
}
.danger-body {
  min-width: 0;
  flex: 1;
}
.msg {
  margin: 0 0 8px;
  color: #15202b;
  font-size: 0.95rem;
  line-height: 1.45;
}
.id {
  margin: 0 0 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.78rem;
  color: #7a8a99;
}
.desc {
  margin: 0;
  color: #5d6d7e;
  font-size: 0.86rem;
  line-height: 1.5;
}
.batch-names {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 220px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.batch-names li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #f0e0dc;
}
.batch-name {
  font-size: 0.88rem;
  font-weight: 650;
  color: #15202b;
}
.batch-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.72rem;
  color: #7a8a99;
}
</style>
