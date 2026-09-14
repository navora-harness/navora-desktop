<template>
  <SkillDialogShell
    :model-value="modelValue"
    kicker="技能"
    title="批量导入技能"
    :subtitle="shellSubtitle"
    :max-width="880"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="batch-toolbar">
      <div class="batch-toolbar-left">
        <button type="button" class="tool-link" @click="selectAll(true)">全选</button>
        <span class="tool-sep" aria-hidden="true">·</span>
        <button type="button" class="tool-link" @click="selectAll(false)">全不选</button>
        <button type="button" class="tool-link" @click="expandAll(true)">全部展开</button>
        <span class="tool-sep" aria-hidden="true">·</span>
        <button type="button" class="tool-link" @click="expandAll(false)">全部收起</button>
      </div>
      <span class="sel-pill" :class="{ ready: selectedCount > 0 }">
        已选 {{ selectedCount }} / {{ local.length }}
      </span>
    </div>

    <div class="batch-list" role="list">
      <article
        v-for="(it, idx) in local"
        :key="idx"
        class="batch-card"
        :class="{ selected: it.selected, expanded: it.expanded, conflict: !!it.preview.existing }"
        role="listitem"
      >
        <div class="batch-card-main">
          <label class="batch-check">
            <input v-model="it.selected" type="checkbox" class="batch-check-input" />
            <span class="batch-check-box" aria-hidden="true">
              <font-awesome-icon v-if="it.selected" icon="check" />
            </span>
          </label>

          <button type="button" class="batch-toggle" @click="it.expanded = !it.expanded">
            <div class="batch-title-row">
              <span class="batch-name">{{ it.preview.name }}</span>
              <span
                v-if="conflictBadge(it.preview)"
                class="conflict-badge"
                :class="{ update: conflictKind(it.preview) === 'update' }"
              >
                {{ conflictBadge(it.preview) }}
              </span>
              <span
                v-if="it.preview.version && conflictKind(it.preview) !== 'update'"
                class="flag-badge"
              >
                v{{ it.preview.version }}
              </span>
              <span v-if="it.preview.disableModelInvocation" class="flag-badge">需 skill_read</span>
            </div>
            <p class="batch-desc">{{ it.preview.description || '（无描述）' }}</p>
            <div class="batch-meta">
              <span v-if="it.preview.sourceLabel" class="meta-chip">{{ it.preview.sourceLabel }}</span>
              <span v-if="it.preview.existing" class="meta-chip" :class="conflictKind(it.preview) === 'update' ? 'info' : 'warn'">
                {{
                  conflictKind(it.preview) === 'update'
                    ? `已有 id: ${it.preview.existing.id}`
                    : `将覆盖 id: ${it.preview.existing.id}`
                }}
              </span>
              <span class="meta-chip ghost">{{ bodyLines(it.preview.body) }} 行正文</span>
            </div>
          </button>

          <button
            type="button"
            class="expand-btn"
            :aria-expanded="it.expanded"
            :title="it.expanded ? '收起预览' : '展开预览'"
            @click="it.expanded = !it.expanded"
          >
            <font-awesome-icon :icon="it.expanded ? 'chevron-down' : 'chevron-right'" />
          </button>
        </div>

        <div v-show="it.expanded" class="batch-preview-wrap">
          <div class="preview-bar">
            <span>SKILL.md 正文</span>
            <span class="preview-bar-hint">只读预览</span>
          </div>
          <pre class="md-preview">{{ it.preview.body || '（无正文）' }}</pre>
        </div>
      </article>
    </div>

    <template #actions>
      <v-spacer />
      <v-btn variant="text" :disabled="saving" @click="emit('update:modelValue', false)">取消</v-btn>
      <v-btn
        color="primary"
        :loading="saving"
        :disabled="selectedCount === 0"
        @click="onConfirm"
      >
        导入所选（{{ selectedCount }}）
      </v-btn>
    </template>
  </SkillDialogShell>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import {
  skillImportConflictBadge,
  skillImportConflictKind,
  type SkillImportPreview,
} from '@shared/skills'
import SkillDialogShell from './SkillDialogShell.vue'

const props = defineProps<{
  modelValue: boolean
  items: SkillImportPreview[]
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [selected: SkillImportPreview[]]
}>()

type Row = { preview: SkillImportPreview; selected: boolean; expanded: boolean }
const local = reactive<Row[]>([])

watch(
  () => [props.modelValue, props.items] as const,
  ([open]) => {
    if (!open) return
    local.splice(
      0,
      local.length,
      ...props.items.map((p) => ({
        preview: p,
        selected: true,
        expanded: false,
      })),
    )
  },
  { immediate: true, deep: true },
)

const selectedCount = computed(() => local.filter((r) => r.selected).length)

const shellSubtitle = computed(() => {
  const n = local.length
  if (!n) return '没有可导入的技能'
  const updates = local.filter((r) => conflictKind(r.preview) === 'update').length
  const overwrites = local.filter((r) => conflictKind(r.preview) === 'overwrite').length
  const parts: string[] = [`共 ${n} 项，默认全选`]
  if (updates) parts.push(`${updates} 项版本更新`)
  if (overwrites) parts.push(`${overwrites} 项将覆盖`)
  return `${parts.join('，')} · 勾选后导入，点击行可展开预览正文`
})

function conflictKind(preview: SkillImportPreview) {
  return skillImportConflictKind(preview.existing, preview.version)
}

function conflictBadge(preview: SkillImportPreview) {
  return skillImportConflictBadge(preview.existing, preview.version)
}

function selectAll(v: boolean) {
  for (const r of local) r.selected = v
}

function expandAll(v: boolean) {
  for (const r of local) r.expanded = v
}

function bodyLines(body?: string): number {
  const t = String(body || '').replace(/\s+$/, '')
  if (!t) return 0
  return t.split(/\r?\n/).length
}

function onConfirm() {
  emit(
    'confirm',
    local.filter((r) => r.selected).map((r) => r.preview),
  )
}
</script>

<style scoped>
.batch-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.batch-toolbar-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px 0;
}
.tool-link {
  border: none;
  background: transparent;
  color: #1b4f72;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 650;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}
.tool-link:hover {
  background: #e8f1f7;
}
.tool-sep {
  color: #c5d0db;
  padding: 0 2px;
  user-select: none;
}
.sel-pill {
  font-size: 0.75rem;
  font-weight: 650;
  color: #7a8a99;
  background: #eef3f7;
  border-radius: 999px;
  padding: 4px 10px;
  letter-spacing: 0.01em;
}
.sel-pill.ready {
  color: #1b4f72;
  background: #e8f1f7;
}
.batch-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.batch-card {
  border: 1px solid #d5dee7;
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  transition:
    border-color 0.14s ease,
    box-shadow 0.14s ease,
    background 0.14s ease;
}
.batch-card.selected {
  border-color: #9bb6c9;
  background: #fbfcfd;
}
.batch-card.expanded {
  box-shadow: 0 4px 16px rgba(21, 32, 43, 0.06);
}
.batch-card.conflict.selected {
  border-color: #e0b4ae;
}
.batch-card-main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 12px 12px 12px 10px;
}
.batch-check {
  display: flex;
  align-items: center;
  padding-top: 2px;
  cursor: pointer;
}
.batch-check-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.batch-check-box {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1.5px solid #b7c5d1;
  background: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 0.7rem;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}
.batch-check-input:checked + .batch-check-box {
  background: #1b4f72;
  border-color: #1b4f72;
}
.batch-check-input:focus-visible + .batch-check-box {
  outline: 2px solid rgba(27, 79, 114, 0.35);
  outline-offset: 2px;
}
.batch-toggle {
  border: none;
  background: transparent;
  text-align: left;
  padding: 0;
  cursor: pointer;
  min-width: 0;
  font: inherit;
  color: inherit;
}
.batch-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  margin-bottom: 4px;
}
.batch-name {
  font-size: 0.95rem;
  font-weight: 700;
  color: #15202b;
  letter-spacing: -0.01em;
}
.conflict-badge,
.flag-badge {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  letter-spacing: 0.02em;
}
.conflict-badge {
  color: #a93226;
  background: #fdecea;
}
.conflict-badge.update {
  color: #1b4f72;
  background: #e8f1f7;
}
.flag-badge {
  color: #1b4f72;
  background: #e8f1f7;
}
.batch-desc {
  margin: 0 0 8px;
  font-size: 0.84rem;
  color: #5d6d7e;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.batch-card.expanded .batch-desc {
  -webkit-line-clamp: unset;
  display: block;
}
.batch-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.meta-chip {
  font-size: 0.7rem;
  font-weight: 600;
  color: #5d6d7e;
  background: #eef3f7;
  border-radius: 6px;
  padding: 2px 7px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-chip.warn {
  color: #a93226;
  background: #fdecea;
}
.meta-chip.info {
  color: #1b4f72;
  background: #e8f1f7;
}
.meta-chip.ghost {
  background: transparent;
  border: 1px solid #e0e7ee;
  color: #7a8a99;
}
.expand-btn {
  width: 32px;
  height: 32px;
  border: 1px solid #d5dee7;
  border-radius: 8px;
  background: #fff;
  color: #5d6d7e;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.12s ease,
    color 0.12s ease,
    border-color 0.12s ease;
}
.expand-btn:hover {
  background: #e8f1f7;
  color: #1b4f72;
  border-color: #9bb6c9;
}
.batch-preview-wrap {
  border-top: 1px solid #e8eef4;
  background: linear-gradient(180deg, #f7fafc 0%, #f4f8fb 100%);
  animation: preview-in 0.16s ease;
}
@keyframes preview-in {
  from {
    opacity: 0.4;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #7a8a99;
}
.preview-bar-hint {
  font-weight: 550;
  text-transform: none;
  letter-spacing: 0;
  color: #9aa8b5;
}
.md-preview {
  margin: 8px 12px 12px;
  padding: 12px 14px;
  max-height: 240px;
  overflow: auto;
  border-radius: 10px;
  border: 1px solid #d5dee7;
  background: #fff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.78rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: #1b2834;
  user-select: text;
}
</style>
