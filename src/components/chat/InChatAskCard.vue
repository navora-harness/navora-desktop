<template>
  <div class="msg inchat-card ask" role="group" :aria-label="eyebrow">
    <div class="msg-row">
      <div class="msg-avatar pending-ask" aria-hidden="true">
        <font-awesome-icon icon="circle-question" />
      </div>
      <div class="msg-main">
        <div class="msg-role">
          <span>{{ eyebrow }}</span>
          <span v-if="progress" class="pending-ask-step">{{ progress }}</span>
        </div>
        <h3 class="inchat-title">{{ heading }}</h3>
        <p v-if="questionBody" class="inchat-body">{{ questionBody }}</p>
        <p v-if="headMeta" class="inchat-meta">{{ headMeta }}</p>

        <div
          v-if="req.kind === 'user_choice' && forkTotal"
          class="ask-fork-steps"
          role="progressbar"
          :aria-valuenow="forkStep"
          :aria-valuemin="1"
          :aria-valuemax="forkTotal"
        >
          <span
            v-for="n in forkTotal"
            :key="n"
            class="ask-fork-step-dot"
            :class="{ done: n < forkStep, current: n === forkStep }"
          />
        </div>

        <p v-if="remainingLabel" class="ask-timeout" :class="{ urgent: remainingUrgent }">
          {{ remainingLabel }}
        </p>
        <div
          v-if="remainingLabel"
          class="ask-countdown-bar"
          :class="{ urgent: remainingUrgent }"
        >
          <div class="ask-countdown-bar-fill" :style="{ width: `${remainingPct}%` }" />
        </div>

        <ul v-if="priorAnswers.length" class="ask-prior">
          <li v-for="(p, i) in priorAnswers" :key="i">
            <span class="ask-prior-q">{{ p.question }}</span>
            <span class="ask-prior-a">{{ p.answer }}</span>
          </li>
        </ul>

        <div v-if="downloadDetail" class="ask-dl-detail">
          <div class="ask-dl-row">
            <span class="ask-dl-k">文件</span>
            <span class="ask-dl-v">{{ downloadDetail.filename }}</span>
          </div>
          <div class="ask-dl-row">
            <span class="ask-dl-k">保存到</span>
            <span class="ask-dl-v">{{ downloadDetail.relPath }}</span>
          </div>
          <div v-if="downloadDetail.url" class="ask-dl-row">
            <span class="ask-dl-k">来源</span>
            <span class="ask-dl-v">{{ downloadDetail.url }}</span>
          </div>
        </div>
        <div v-else-if="req.evidence?.url" class="ask-evidence">
          <div class="ask-evidence-label">当前页面</div>
          <div class="ask-evidence-title">{{ req.evidence.title || req.evidence.url }}</div>
          <div class="ask-evidence-url">{{ req.evidence.url }}</div>
        </div>

        <div class="ask-options">
          <button
            v-for="opt in optionItems"
            :key="opt.label"
            type="button"
            class="ask-opt"
            :class="{
              primary: req.kind === 'continue_rounds' && opt.label.startsWith('再继续'),
              recommended: opt.recommended,
              danger: req.kind === 'download_confirm' && opt.label === '拒绝',
            }"
            :disabled="busy"
            @click="emit('option', opt.label)"
          >
            <span class="ask-opt-main">
              <span class="ask-opt-label">{{ opt.label }}</span>
              <span v-if="opt.recommended" class="ask-opt-badge">推荐</span>
            </span>
            <span v-if="opt.hint" class="ask-opt-hint">{{ opt.hint }}</span>
          </button>
          <label v-if="req.allowCustom" class="ask-opt ask-opt-custom">
            <input
              v-model="custom"
              class="ask-opt-custom-input"
              type="text"
              placeholder="输入你的决定…"
              :disabled="busy"
              @keydown.enter.prevent="submitCustom"
            />
            <button
              type="button"
              class="ask-opt-custom-submit"
              :disabled="busy || !custom.trim()"
              @click.prevent="submitCustom"
            >
              提交
            </button>
          </label>
        </div>
        <div v-if="req.kind !== 'download_confirm'" class="ask-footer">
          <button
            v-if="req.kind === 'user_choice'"
            type="button"
            class="ask-deny"
            :disabled="busy"
            @click="emit('deny')"
          >
            拒绝回答
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AgentAskOption, AgentAskRequest } from '@shared/types'

const props = defineProps<{
  req: AgentAskRequest
  remainingLabel?: string
  remainingUrgent?: boolean
  remainingPct?: number
  busy?: boolean
}>()

const emit = defineEmits<{
  option: [label: string]
  custom: [text: string]
  deny: []
}>()

const custom = ref('')
watch(
  () => props.req.id,
  () => {
    custom.value = ''
  },
)

const optionItems = computed((): AgentAskOption[] => {
  if (props.req.optionItems?.length) return props.req.optionItems
  return (props.req.options || []).map((label) => ({ label }))
})

const eyebrow = computed(() => {
  const kind =
    props.req.kind === 'continue_rounds'
      ? '推理轮数'
      : props.req.kind === 'download_confirm'
        ? '文件下载'
        : '询问/决策'
  if (props.req.parentChatId && props.req.subChatTitle) {
    return `${kind} · 子任务「${props.req.subChatTitle}」`
  }
  return kind
})

const heading = computed(() => {
  if (props.req.kind === 'download_confirm') {
    return String(props.req.question || '是否保存到工作区？').trim()
  }
  if (props.req.kind === 'user_choice') {
    const forkTitle = props.req.meta?.forkTitle?.trim()
    if (forkTitle) return forkTitle
  }
  return String(props.req.question || '').trim().split(/\n/)[0]?.trim() || ''
})

const questionBody = computed(() => {
  const q = String(props.req.question || '').trim()
  if (!q || props.req.kind === 'download_confirm') return ''
  if (props.req.kind === 'user_choice') {
    const forkTitle = props.req.meta?.forkTitle?.trim()
    if (forkTitle) {
      if (q === forkTitle) return ''
      const lines = q.split(/\n/).map((s) => s.trim()).filter(Boolean)
      if (lines[0] === forkTitle) return lines.slice(1).join('\n')
      return q
    }
  }
  const lines = q.split(/\n/).map((s) => s.trim()).filter(Boolean)
  if (lines.length <= 1) return ''
  return lines.slice(1).join('\n')
})

const headMeta = computed(() => {
  if (props.req.kind !== 'continue_rounds') return ''
  const used = props.req.meta?.roundsUsed
  if (!used) return ''
  const extra = props.req.meta?.continueBy
  return extra ? `已用 ${used} 轮 · 本次建议再加 ${extra}` : `已用 ${used} 轮`
})

const progress = computed(() => {
  const step = props.req.meta?.step
  const total = props.req.meta?.totalSteps
  if (typeof step === 'number' && step >= 1 && typeof total === 'number' && total >= 1) {
    return `${Math.floor(step)}/${Math.floor(total)}`
  }
  if (typeof step === 'number' && step >= 1) return `第 ${Math.floor(step)} 步`
  if (props.req.kind === 'continue_rounds') return '推理轮数'
  if (props.req.kind === 'download_confirm') return '被动文件下载'
  return ''
})

const forkStep = computed(() => {
  const s = props.req.meta?.step
  return typeof s === 'number' && s >= 1 ? Math.floor(s) : 0
})
const forkTotal = computed(() => {
  const t = props.req.meta?.totalSteps
  return typeof t === 'number' && t >= 1 ? Math.floor(t) : 0
})
const priorAnswers = computed(() =>
  Array.isArray(props.req.meta?.priorAnswers) ? props.req.meta!.priorAnswers! : [],
)

const downloadDetail = computed(() => {
  if (props.req.kind !== 'download_confirm') return null
  const filename = String(props.req.meta?.downloadFilename || props.req.evidence?.title || '').trim()
  const relPath = String(props.req.meta?.downloadRelPath || '').trim()
  const url = String(props.req.meta?.downloadUrl || props.req.evidence?.url || '').trim()
  if (!filename && !relPath && !url) return null
  return {
    filename: filename || 'download',
    relPath: relPath || 'downloads/',
    url,
  }
})

function submitCustom() {
  const text = custom.value.trim()
  if (!text) return
  emit('custom', text)
}
</script>

<style scoped>
.inchat-card {
  width: 100%;
  max-width: 100%;
  margin: 4px 0 8px;
  box-sizing: border-box;
}
.msg-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  width: 100%;
  min-width: 0;
}
.msg-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: #eaf3fa;
  color: #1b4f72;
  font-size: 0.9rem;
}
.msg-main {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  padding: 16px 18px 18px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid #cfe0ec;
  box-shadow: 0 4px 16px rgba(21, 32, 43, 0.06);
  box-sizing: border-box;
}
.msg-role {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.78rem;
  font-weight: 650;
  color: #1b4f72;
  margin-bottom: 6px;
}
.pending-ask-step {
  font-weight: 600;
  color: #7f8c8d;
}
.inchat-title {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 700;
  color: #15202b;
  line-height: 1.35;
}
.inchat-body,
.inchat-meta {
  margin: 6px 0 0;
  font-size: 0.84rem;
  color: #5d6d7e;
  line-height: 1.45;
  white-space: pre-wrap;
}
.inchat-meta {
  font-size: 0.78rem;
}
.ask-timeout {
  margin: 8px 0 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: #7f8c8d;
}
.ask-timeout.urgent {
  color: #b9770e;
}
.ask-countdown-bar {
  margin-top: 6px;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: #e4ecf2;
  overflow: hidden;
}
.ask-countdown-bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #5d8aa8;
  transition: width 0.45s linear, background-color 0.2s ease;
}
.ask-countdown-bar.urgent .ask-countdown-bar-fill {
  background: #c0392b;
}
.ask-fork-steps {
  margin-top: 10px;
  display: flex;
  gap: 6px;
}
.ask-fork-step-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #d5e2ec;
}
.ask-fork-step-dot.done {
  background: #7f9bb0;
}
.ask-fork-step-dot.current {
  width: 18px;
  background: #1b4f72;
}
.ask-prior {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
  font-size: 0.78rem;
}
.ask-prior-q {
  color: #7f8c8d;
  margin-right: 8px;
}
.ask-prior-a {
  color: #1b4f72;
  font-weight: 600;
}
.ask-dl-detail,
.ask-evidence {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(27, 79, 114, 0.06);
  border: 1px solid #d5e2ec;
}
.ask-dl-row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 8px;
  font-size: 0.82rem;
}
.ask-dl-k {
  color: #7f8c8d;
  font-weight: 700;
}
.ask-dl-v {
  color: #1b4f72;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ask-evidence-label {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #5d6d7e;
  margin-bottom: 4px;
}
.ask-evidence-title,
.ask-evidence-url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ask-evidence-title {
  font-size: 0.84rem;
  font-weight: 650;
  color: #15202b;
}
.ask-evidence-url {
  font-size: 0.72rem;
  color: #7f8c8d;
}
.ask-options {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}
.ask-opt {
  border: 1px solid #d5dde5;
  border-radius: 9px;
  padding: 11px 14px;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  line-height: 1.25;
  text-align: left;
  background: #f7fafc;
  color: #1b4f72;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ask-opt:hover:not(:disabled) {
  background: #eaf3fa;
  border-color: #9fc0d8;
}
.ask-opt.recommended {
  border-color: #7eaccc;
  background: #eef6fb;
}
.ask-opt.primary {
  background: #1b4f72;
  border-color: #1b4f72;
  color: #fff;
}
.ask-opt.primary:hover:not(:disabled) {
  background: #163f5b;
}
.ask-opt.danger:hover:not(:disabled) {
  background: #fdf6f5;
}
.ask-opt:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ask-opt-main {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ask-opt-badge {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(27, 79, 114, 0.12);
}
.ask-opt-hint {
  font-size: 0.76rem;
  font-weight: 500;
  color: #7f8c8d;
}
.ask-opt.primary .ask-opt-hint {
  color: rgba(255, 255, 255, 0.78);
}
.ask-opt-custom {
  flex-direction: row;
  align-items: center;
  cursor: text;
}
.ask-opt-custom-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-weight: 600;
  outline: none;
}
.ask-opt-custom-submit {
  border: 0;
  border-radius: 7px;
  padding: 6px 10px;
  font-weight: 700;
  cursor: pointer;
  background: #1b4f72;
  color: #fff;
}
.ask-opt-custom-submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ask-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.ask-deny {
  border: 0;
  background: transparent;
  font-size: 0.8rem;
  color: #c0392b;
  cursor: pointer;
  padding: 4px 0;
}
</style>
