<template>
  <SkillDialogShell
    :model-value="modelValue"
    kicker="技能"
    :title="isEdit ? '编辑技能' : '新建技能'"
    :subtitle="shellSubtitle"
    :max-width="780"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="editor-grid">
      <v-text-field
        v-model="local.name"
        label="名称（英文 id 风格）"
        variant="outlined"
        density="comfortable"
        hide-details="auto"
        hint="保存时会规范化为小写字母、数字、连字符"
        persistent-hint
        color="primary"
        base-color="#c5d0db"
      />
      <v-text-field
        v-model="local.version"
        label="版本（可选）"
        variant="outlined"
        density="comfortable"
        hide-details="auto"
        hint="如 1.0.0；可留空"
        persistent-hint
        color="primary"
        base-color="#c5d0db"
        class="mt-3"
      />
      <v-textarea
        v-model="local.description"
        label="描述（何时使用）"
        variant="outlined"
        density="comfortable"
        hide-details
        rows="2"
        auto-grow
        color="primary"
        base-color="#c5d0db"
        class="mt-3"
      />
      <v-textarea
        v-model="local.body"
        label="技能正文（Markdown）"
        variant="outlined"
        density="comfortable"
        hide-details
        rows="12"
        auto-grow
        color="primary"
        base-color="#c5d0db"
        class="mt-3 skill-body-field"
      />
      <div class="switch-row mt-3">
        <div class="switch-item">
          <div class="switch-label">启用</div>
          <div class="switch-hint">关闭后不会注入系统提示</div>
          <v-switch
            v-model="local.enabled"
            color="primary"
            hide-details
            density="compact"
            class="switch-ctrl"
          />
        </div>
        <div class="switch-item">
          <div class="switch-label">需 skill_read</div>
          <div class="switch-hint">仅目录可见，使用前再读全文</div>
          <v-switch
            v-model="local.disableModelInvocation"
            color="primary"
            hide-details
            density="compact"
            class="switch-ctrl"
          />
        </div>
      </div>
    </div>
    <template #actions>
      <v-btn
        v-if="canDefer"
        variant="outlined"
        color="primary"
        :disabled="saving"
        @click="emit('defer')"
      >
        稍后处理
      </v-btn>
      <v-spacer />
      <v-btn variant="text" :disabled="saving" @click="emit('cancel')">取消</v-btn>
      <v-btn color="primary" :loading="saving" @click="onConfirm">确认保存</v-btn>
    </template>
  </SkillDialogShell>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { SkillReviewDraft } from '@shared/types'
import SkillDialogShell from './SkillDialogShell.vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    skillId?: string | null
    draft: SkillReviewDraft
    saving?: boolean
    canDefer?: boolean
    subtitle?: string
  }>(),
  { canDefer: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [draft: SkillReviewDraft]
  defer: []
  cancel: []
}>()

const isEdit = computed(() => Boolean(props.skillId))
const shellSubtitle = computed(
  () =>
    props.subtitle ||
    (isEdit.value ? `id: ${props.skillId}` : '确认后写入本地技能库'),
)
const local = reactive({
  name: '',
  description: '',
  version: '',
  body: '',
  enabled: true,
  disableModelInvocation: false,
})

watch(
  () => [props.modelValue, props.draft] as const,
  ([open]) => {
    if (!open) return
    local.name = props.draft.name || ''
    local.description = props.draft.description || ''
    local.version = props.draft.version || ''
    local.body = props.draft.body || ''
    local.enabled = props.draft.enabled !== false
    local.disableModelInvocation = Boolean(props.draft.disableModelInvocation)
  },
  { immediate: true, deep: true },
)

function onConfirm() {
  emit('confirm', {
    name: local.name.trim(),
    description: local.description.trim(),
    version: local.version.trim() || undefined,
    body: local.body,
    enabled: local.enabled,
    disableModelInvocation: local.disableModelInvocation,
  })
}
</script>

<style scoped>
.skill-body-field :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.84rem;
  line-height: 1.45;
}
.switch-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 640px) {
  .switch-row {
    grid-template-columns: 1fr;
  }
}
.switch-item {
  position: relative;
  padding: 12px 56px 12px 12px;
  border-radius: 10px;
  border: 1px solid #e0e7ee;
  background: #fafcfd;
}
.switch-label {
  font-size: 0.88rem;
  font-weight: 650;
  color: #15202b;
}
.switch-hint {
  margin-top: 2px;
  font-size: 0.75rem;
  color: #7a8a99;
  line-height: 1.35;
}
.switch-ctrl {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
}
</style>
