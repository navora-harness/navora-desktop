<template>
  <div class="msg inchat-card perm" data-decision-card="permission" :data-decision-state="expired?'expired':busy?'submitting':submissionError?'error':'pending'" :aria-busy="busy" role="group" aria-label="需要授权">
    <div class="msg-row">
      <div class="msg-avatar perm" aria-hidden="true">
        <StatusIcon kind="perm" />
      </div>
      <div class="msg-main">
        <div class="msg-role">
          <span>需要授权</span>
          <span v-if="chatTitle" class="perm-chat">{{ chatTitle }}</span>
        </div>
        <h3 class="inchat-title">{{ capabilityLabel }}</h3>
        <p v-if="remainingLabel && !expired" class="ask-timeout" :class="{ urgent: remainingUrgent }">
          {{ remainingLabel }}
        </p>
        <p v-if="pendingCount>1" class="perm-queue" role="status">还有 {{ pendingCount-1 }} 个此对话的授权请求等待处理</p>
        <p v-if="detailSummary" class="perm-detail-summary">{{ detailSummary }}</p>
        <details class="perm-detail-card">
          <summary>请求详情</summary>
          <div class="perm-detail-text">{{ displayDetail }}</div>
          <code class="perm-cap">{{ req.capability }}</code>
        </details>
        <label class="perm-remember"><input v-model="remember" data-permission-remember type="checkbox" :disabled="unavailable" />本次运行记住（仅此对话）</label>
        <p v-if="expired" class="decision-status" role="status">请求已失效，请等待新的请求。</p>
        <p v-else-if="busy" class="decision-status" role="status">正在提交…</p>
        <p v-else-if="submissionError" class="decision-error" role="alert">{{ submissionError }}</p>
        <div class="perm-row">
          <button type="button" class="perm-btn primary" :disabled="unavailable" @click="decide(true)">{{ remember?'允许并记住':'允许一次' }}</button>
          <button type="button" class="perm-btn ghost" :disabled="unavailable" @click="decide(false)">{{ remember?'拒绝并记住':'拒绝' }}</button>
          <button v-if="expired" type="button" class="decision-dismiss" data-decision-dismiss @click="emit('dismiss')">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import StatusIcon from '@/components/StatusIcon.vue'
import {computed,ref,watch} from 'vue'
import {permissionDetailForDisplay} from '@shared/permission-presentation'
import type { PermissionDecision, PermissionRequest } from '@shared/types'

const props=withDefaults(defineProps<{
  req: PermissionRequest
  capabilityLabel: string
  chatTitle?: string
  pendingCount?: number
  remainingLabel?: string
  remainingUrgent?: boolean
  remainingPct?: number
  busy?: boolean
  submissionError?: string
  expired?: boolean
}>(),{pendingCount:1})
const displayDetail=computed(()=>permissionDetailForDisplay(props.req.detail))
const detailSummary=computed(()=>{const first=displayDetail.value.split(/\n/).find(line=>line.trim())||'';return first.length>160?`${first.slice(0,160)}…`:first})
const remember=ref(false)
const unavailable=computed(()=>!!props.busy||!!props.expired)
watch(()=>props.req.id,()=>{remember.value=false})

const emit = defineEmits<{
  decide: [decision: PermissionDecision]
  dismiss: []
}>()
function decide(allow:boolean){if(unavailable.value)return;emit('decide',allow?(remember.value?'allow_chat':'allow'):(remember.value?'always_deny':'deny'))}
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

.perm-chat{font-weight:400;color:var(--navora-muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.perm-queue{margin:5px 0 0;color:var(--navora-muted);font-size:11px}
.perm-detail-summary{margin:6px 0 0;font-size:12px;line-height:1.6;color:var(--navora-ink);overflow-wrap:anywhere}
.perm-detail-card{margin-top:6px;font-size:11px;color:var(--navora-muted)}
.perm-detail-card summary{width:fit-content;cursor:default;border-radius:3px}
.perm-detail-card[open]{padding-bottom:2px}
.perm-detail-text{margin:6px 0;font-size:12px;color:var(--navora-muted);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.perm-cap{display:block;max-width:100%;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere;white-space:normal}
.perm-remember{display:flex;align-items:center;gap:7px;width:fit-content;min-height:26px;margin-top:8px;color:var(--navora-muted);font-size:11px;cursor:default}
.perm-remember input{width:14px;height:14px;margin:0;accent-color:var(--navora-accent)}
.perm-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:7px}
.perm-btn{min-height:32px;padding:6px 12px;border:1px solid var(--navora-stroke);border-radius:6px;font:inherit;font-size:12px;font-weight:500;cursor:default;line-height:1.4;text-align:center;box-sizing:border-box}
.perm-btn.primary{background:var(--navora-accent);border-color:var(--navora-accent);color:var(--appearance-on-accent,#fff)}
.perm-btn.primary:hover:not(:disabled){filter:brightness(.94)}
.perm-btn.ghost{background:transparent;color:var(--navora-ink)}
.perm-btn.ghost:hover:not(:disabled){background:var(--control-hover)}
@media(pointer:coarse){.perm-btn,.decision-dismiss,.perm-remember{min-height:44px}}
</style>
