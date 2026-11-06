<template>
  <div class="msg inchat-card ask" data-decision-card="question" :data-decision-state="expired?'expired':busy?'submitting':submissionError?'error':'pending'" :aria-busy="busy" role="group" :aria-label="eyebrow">
    <div class="msg-row">
      <div class="msg-avatar pending-ask" aria-hidden="true">
        <StatusIcon kind="ask" />
      </div>
      <div class="msg-main">
        <div class="msg-role">
          <span>{{ eyebrow }}</span>
          <span v-if="progress" class="pending-ask-step">{{ progress }}</span>
        </div>
        <h3 class="inchat-title">{{ heading }}</h3>
        <p v-if="questionBody" class="inchat-body">{{ questionBody }}</p>
        <p v-if="headMeta" class="inchat-meta">{{ headMeta }}</p>

        <p v-if="remainingLabel && !expired" class="ask-timeout" :class="{ urgent: remainingUrgent }">
          {{ remainingLabel }}
        </p>

        <details v-if="priorAnswers.length" class="ask-prior-details"><summary>已回答 {{ priorAnswers.length }} 项</summary><ul class="ask-prior">
          <li v-for="(p, i) in priorAnswers" :key="i">
            <span class="ask-prior-q">{{ p.question }}</span>
            <span class="ask-prior-a">{{ p.answer }}</span>
          </li>
        </ul></details>

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

        <p v-if="expired" class="decision-status" role="status">请求已失效，请等待新的请求。</p>
        <p v-else-if="busy" class="decision-status" role="status">正在提交…</p>
        <p v-else-if="submissionError" class="decision-error" role="alert">{{ submissionError }}</p>
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
            :disabled="unavailable"
            @click="chooseOption(opt.label)"
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
              aria-label="自行填写决定"
              :disabled="unavailable"
              @keydown.enter.prevent="submitCustom"
            />
            <button
              type="button"
              class="ask-opt-custom-submit"
              :disabled="unavailable || !custom.trim()"
              @click.prevent="submitCustom"
            >
              确认
            </button>
          </label>
        </div>
        <div v-if="expired || req.kind === 'user_choice'" class="ask-footer">
          <button v-if="expired" type="button" class="decision-dismiss" data-decision-dismiss @click="emit('dismiss')">关闭</button>
          <button
            v-else-if="req.kind === 'user_choice'"
            type="button"
            class="ask-deny"
            :disabled="unavailable"
            @click="deny()"
          >
            拒绝回答
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import StatusIcon from '@/components/StatusIcon.vue'
import { computed } from 'vue'
import {useDecisionDraft} from '@/composables/useDecisionDraft'
import type { AgentAskOption, AgentAskRequest } from '@shared/types'

const props = defineProps<{
  req: AgentAskRequest
  remainingLabel?: string
  remainingUrgent?: boolean
  remainingPct?: number
  busy?: boolean
  submissionError?: string
  expired?: boolean
}>()

const emit = defineEmits<{
  option: [label: string]
  custom: [text: string]
  deny: []
  dismiss: []
}>()

const custom = useDecisionDraft(() => props.req.id)
const unavailable = computed(() => !!props.busy || !!props.expired)

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
        : '需要你决定'
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
  return ''
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

function chooseOption(label:string) {
  if (!unavailable.value) emit('option', label)
}
function deny() {
  if (!unavailable.value) emit('deny')
}
function submitCustom(event?:Event) {
  if (unavailable.value || event instanceof KeyboardEvent && event.isComposing) return
  const text = custom.value.trim()
  if (!text) return
  emit('custom', text)
}
</script>

<style scoped>
.inchat-card{width:100%;max-width:100%;margin:4px 0 8px;box-sizing:border-box;color:var(--navora-ink)}
.msg-row{display:flex;gap:8px;align-items:flex-start;width:100%;min-width:0}
.msg-avatar{flex-shrink:0;width:26px;height:26px;display:grid;place-items:center;background:transparent;color:var(--navora-accent);font-size:14px}
.msg-main{flex:1 1 auto;min-width:0;width:100%;padding:12px 14px;border-radius:9px;background:var(--navora-surface);border:1px solid var(--navora-stroke);box-shadow:none;box-sizing:border-box}
.msg-role{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;font-size:11px;font-weight:500;color:var(--navora-muted);margin-bottom:4px}
.inchat-title{margin:0;font-size:14px;font-weight:600;color:var(--navora-ink);line-height:1.5;overflow-wrap:anywhere}
.ask-timeout{margin:5px 0 0;font-size:11px;color:var(--navora-muted)}
.ask-timeout.urgent{color:var(--appearance-warning,var(--control-danger))}
.decision-status,.decision-error{margin:9px 0 0;font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.decision-status{color:var(--navora-muted)}
.decision-error{color:var(--control-danger)}
.decision-dismiss{margin-left:auto;border:0;border-radius:5px;background:transparent;padding:5px 8px;color:var(--navora-muted);font:inherit;font-size:12px;cursor:default}
.decision-dismiss:hover{background:var(--control-hover);color:var(--navora-ink)}
button:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid var(--control-focus,var(--navora-accent));outline-offset:2px}
button:disabled{opacity:.5;cursor:default}

.pending-ask-step{font-weight:400;color:var(--navora-muted)}
.inchat-body,.inchat-meta{margin:5px 0 0;font-size:12px;color:var(--navora-muted);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.inchat-meta{font-size:11px}
.ask-prior-details{margin-top:7px;font-size:11px;color:var(--navora-muted)}
.ask-prior-details summary{width:fit-content;cursor:default;border-radius:3px}
.ask-prior{margin:6px 0 0;padding:0;list-style:none;display:grid;gap:5px;font-size:11px}
.ask-prior li{display:flex;flex-wrap:wrap;gap:4px 8px;overflow-wrap:anywhere}
.ask-prior-q{color:var(--navora-muted)}
.ask-prior-a{color:var(--navora-ink);font-weight:500}
.ask-dl-detail,.ask-evidence{margin-top:8px;padding:8px 10px;border-radius:6px;background:var(--control-hover);font-size:12px}
.ask-dl-row{display:grid;grid-template-columns:42px minmax(0,1fr);gap:8px;line-height:1.6}
.ask-dl-k{color:var(--navora-muted)}
.ask-dl-v{color:var(--navora-ink);overflow-wrap:anywhere}
.ask-evidence-label{font-size:10px;color:var(--navora-muted);margin-bottom:3px}
.ask-evidence-title,.ask-evidence-url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ask-evidence-title{font-size:12px;font-weight:500;color:var(--navora-ink)}
.ask-evidence-url{font-size:11px;color:var(--navora-muted)}
.ask-options{margin-top:9px;display:grid;gap:6px}
.ask-opt{min-height:36px;border:1px solid var(--navora-stroke);border-radius:6px;padding:8px 10px;font:inherit;font-size:12px;font-weight:500;cursor:default;line-height:1.5;text-align:left;background:transparent;color:var(--navora-ink);display:flex;flex-direction:column;gap:2px;min-width:0;overflow-wrap:anywhere}
.ask-opt:hover:not(:disabled){background:var(--control-hover);border-color:color-mix(in srgb,var(--navora-accent) 45%,var(--navora-stroke))}
.ask-opt.recommended,.ask-opt.primary{box-shadow:inset 2px 0 0 var(--navora-accent)}
.ask-opt.danger{color:var(--control-danger)}
.ask-opt.danger:hover:not(:disabled){background:color-mix(in srgb,var(--control-danger) 7%,var(--navora-surface))}
.ask-opt-main{display:flex;align-items:center;flex-wrap:wrap;gap:7px;min-width:0}
.ask-opt-badge{font-size:10px;font-weight:400;padding:0 5px;border-radius:4px;color:var(--navora-accent);background:var(--control-selected);white-space:nowrap}
.ask-opt-hint{font-size:11px;font-weight:400;color:var(--navora-muted)}
.ask-opt-custom{flex-direction:row;align-items:center;gap:6px;cursor:text}
.ask-opt-custom:focus-within{outline:2px solid var(--control-focus,var(--navora-accent));outline-offset:1px}
.ask-opt-custom-input{flex:1;min-width:0;border:0;background:transparent;color:var(--navora-ink);font:inherit;font-weight:400;outline:none}
.ask-opt-custom-input:focus-visible{outline:none}
.ask-opt-custom-input::placeholder{color:var(--navora-muted)}
.ask-opt-custom-submit{min-height:26px;border:0;border-radius:5px;padding:3px 8px;font:inherit;font-size:11px;font-weight:500;cursor:default;background:var(--control-selected);color:var(--navora-accent)}
.ask-opt-custom-submit:hover:not(:disabled){background:var(--control-hover)}
.ask-footer{display:flex;justify-content:flex-end;margin-top:6px}
.ask-deny{min-height:26px;border:0;border-radius:5px;background:transparent;font:inherit;font-size:11px;color:var(--navora-muted);cursor:default;padding:4px 6px}
.ask-deny:hover:not(:disabled){background:var(--control-hover);color:var(--control-danger)}
@media(pointer:coarse){.ask-opt,.ask-opt-custom-submit,.ask-deny,.decision-dismiss{min-height:44px}}
</style>
