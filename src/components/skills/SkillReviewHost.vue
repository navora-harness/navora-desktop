<template>
  <SkillEditorDialog
    v-if="req && (req.action === 'create' || req.action === 'update')"
    v-model="editorOpen"
    :skill-id="req.action === 'update' ? req.skillId : null"
    :draft="editorDraft"
    :saving="responding"
    :can-defer="req.canDefer"
    :subtitle="editorSubtitle"
    @update:model-value="onEditorModel"
    @confirm="onEditorConfirm"
    @defer="onEditorDefer"
    @cancel="onEditorCancel"
  />
  <SkillExportDialog
    v-if="req && req.action === 'export'"
    v-model="exportOpen"
    :name="req.draft?.name"
    :skill-id="req.skillId"
    :markdown="req.markdown || ''"
    :saving="responding"
    @update:model-value="onExportModel"
    @confirm="onExportConfirm"
    @cancel="onExportCancel"
  />
  <SkillDeleteDialog
    v-if="req && req.action === 'delete'"
    v-model="deleteOpen"
    :skill-id="req.skillId"
    :name="req.draft?.name || req.existing?.name"
    :description="req.draft?.description || req.existing?.description"
    :saving="responding"
    @update:model-value="onDeleteModel"
    @confirm="onDeleteConfirm"
    @cancel="onDeleteCancel"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { SkillReviewDraft, SkillReviewRequest } from '@shared/types'
import SkillEditorDialog from './SkillEditorDialog.vue'
import SkillExportDialog from './SkillExportDialog.vue'
import SkillDeleteDialog from './SkillDeleteDialog.vue'

const req = ref<SkillReviewRequest | null>(null)
const responding = ref(false)
const editorOpen = ref(false)
const exportOpen = ref(false)
const deleteOpen = ref(false)

const editorDraft = computed<SkillReviewDraft>(() => ({
  name: req.value?.draft?.name || '',
  description: req.value?.draft?.description || '',
  version: req.value?.draft?.version || '',
  body: req.value?.draft?.body || '',
  enabled: req.value?.draft?.enabled !== false,
  disableModelInvocation: Boolean(req.value?.draft?.disableModelInvocation),
}))

const editorSubtitle = computed(() => {
  if (!req.value) return ''
  if (!req.value.wait && req.value.canDefer) {
    return '无需立即确认 · 可稍后在 设置→技能→待确�?打开'
  }
  if (!req.value.wait) return '无需立即确认 · 请在弹窗中确认或取消'
  if (req.value.canDefer) return '可改稿后确认，或稍后处理'
  return req.value.action === 'update' ? `id: ${req.value.skillId}` : '确认后写入本地技能库'
})

let unsubReq: (() => void) | undefined
let unsubCancel: (() => void) | undefined

onMounted(() => {
  unsubReq = window.navora?.skills?.onReview?.((r) => {
    req.value = r
    responding.value = false
    if (r.action === 'create' || r.action === 'update') {
      editorOpen.value = true
      exportOpen.value = false
      deleteOpen.value = false
    } else if (r.action === 'export') {
      exportOpen.value = true
      editorOpen.value = false
      deleteOpen.value = false
    } else {
      deleteOpen.value = true
      editorOpen.value = false
      exportOpen.value = false
    }
    try {
      window.focus?.()
    } catch {
      /* ignore */
    }
  })
  unsubCancel = window.navora?.skills?.onReviewCancel?.((id) => {
    if (req.value?.id === id || req.value?.proposalId === id) {
      closeAll()
      req.value = null
    }
  })
})

onUnmounted(() => {
  unsubReq?.()
  unsubCancel?.()
})

function closeAll() {
  editorOpen.value = false
  exportOpen.value = false
  deleteOpen.value = false
}

/** Esc / X：仅可搁置的新建/编辑在非阻塞时保留提案�?*/
function dismissSource(): 'deferred' | 'cancel' {
  if (req.value?.canDefer && req.value.wait === false) return 'deferred'
  return 'cancel'
}

async function respond(
  source: 'confirm' | 'cancel' | 'deferred',
  draft?: SkillReviewDraft,
  exportPath?: string,
) {
  if (!req.value || responding.value) return
  responding.value = true
  const id = req.value.proposalId || req.value.id
  try {
    await window.navora?.skills?.respondReview?.(id, { source, draft, exportPath })
  } finally {
    closeAll()
    req.value = null
    responding.value = false
  }
}

function onEditorModel(open: boolean) {
  if (!open && req.value && (req.value.action === 'create' || req.value.action === 'update')) {
    void respond(dismissSource())
  }
}

function onEditorConfirm(draft: SkillReviewDraft) {
  void respond('confirm', draft)
}

function onEditorDefer() {
  void respond('deferred')
}

function onEditorCancel() {
  void respond('cancel')
}

function onExportModel(open: boolean) {
  // responding 时为确认导出主动关窗，勿当成取消
  if (!open && req.value?.action === 'export' && !responding.value) {
    void respond('cancel')
  }
}

function onExportCancel() {
  void respond('cancel')
}

async function onExportConfirm() {
  if (!req.value?.skillId || responding.value) return
  const current = req.value
  responding.value = true
  // 先关预览再开系统另存为；responding 已置位，onExportModel 不会误取�?
  exportOpen.value = false
  try {
    const res = await window.navora?.skills?.export(current.skillId)
    if (!res || res.canceled || !res.ok) {
      await window.navora?.skills?.respondReview?.(current.proposalId || current.id, {
        source: 'cancel',
      })
      return
    }
    await window.navora?.skills?.respondReview?.(current.proposalId || current.id, {
      source: 'confirm',
      exportPath: res.path,
    })
  } catch {
    await window.navora?.skills?.respondReview?.(current.proposalId || current.id, {
      source: 'cancel',
    })
  } finally {
    closeAll()
    req.value = null
    responding.value = false
  }
}

function onDeleteModel(open: boolean) {
  if (!open && req.value?.action === 'delete') {
    void respond('cancel')
  }
}

function onDeleteCancel() {
  void respond('cancel')
}

function onDeleteConfirm() {
  void respond('confirm')
}
</script>
