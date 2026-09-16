<template>
  <div class="msg inchat-card perm" role="group" aria-label="需要授权">
    <div class="msg-row">
      <div class="msg-avatar perm" aria-hidden="true">
        <font-awesome-icon icon="shield-halved" />
      </div>
      <div class="msg-main">
        <div class="msg-role">
          <span>需要授权</span>
          <span v-if="chatTitle" class="perm-chat">{{ chatTitle }}</span>
        </div>
        <h3 class="inchat-title">{{ capabilityLabel }}</h3>
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
        <div v-if="req.detail" class="perm-detail-card">
          <div class="perm-detail-text">{{ req.detail }}</div>
          <code class="perm-cap">{{ req.capability }}</code>
        </div>
        <div class="perm-group">
          <div class="perm-group-label">本次操作</div>
          <div class="perm-row">
            <button type="button" class="perm-btn primary" :disabled="busy" @click="emit('decide', 'allow')">
              允许一次
            </button>
            <button type="button" class="perm-btn ghost" :disabled="busy" @click="emit('decide', 'deny')">
              拒绝
            </button>
          </div>
        </div>
        <div class="perm-group">
          <div class="perm-group-label">记住选择</div>
          <div class="perm-stack">
            <button type="button" class="perm-btn tonal" :disabled="busy" @click="emit('decide', 'allow_chat')">
              本 Chat 内允许
            </button>
            <button type="button" class="perm-btn tonal" :disabled="busy" @click="emit('decide', 'always_allow')">
              本会话始终允许
            </button>
            <button type="button" class="perm-btn danger-ghost" :disabled="busy" @click="emit('decide', 'always_deny')">
              本会话始终拒绝
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PermissionDecision, PermissionRequest } from '@shared/types'

defineProps<{
  req: PermissionRequest
  capabilityLabel: string
  chatTitle?: string
  remainingLabel?: string
  remainingUrgent?: boolean
  remainingPct?: number
  busy?: boolean
}>()

const emit = defineEmits<{
  decide: [decision: PermissionDecision]
}>()
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
  background: #e8f8f0;
  color: #1e8449;
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
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.78rem;
  font-weight: 650;
  color: #1e8449;
  margin-bottom: 8px;
}
.perm-chat {
  font-weight: 600;
  color: #7f8c8d;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inchat-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: #15202b;
  line-height: 1.4;
  overflow-wrap: anywhere;
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
  background: #5d8aa8;
  transition: width 0.45s linear;
}
.ask-countdown-bar.urgent .ask-countdown-bar-fill {
  background: #c0392b;
}
.perm-detail-card {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f4f8fb;
  border: 1px solid #e2ebf2;
}
.perm-detail-text {
  font-size: 0.86rem;
  color: #5d6d7e;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.perm-cap {
  align-self: flex-start;
  max-width: 100%;
  padding: 3px 8px;
  border-radius: 6px;
  background: #eef3f7;
  color: #5d6d7e;
  font-size: 0.72rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-wrap: anywhere;
  white-space: normal;
}
.perm-group {
  margin-top: 16px;
}
.perm-group-label {
  font-size: 0.72rem;
  font-weight: 650;
  color: #7f8c8d;
  margin-bottom: 8px;
  letter-spacing: 0.02em;
}
.perm-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.perm-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.perm-btn {
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 12px 16px;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  line-height: 1.3;
  text-align: center;
  box-sizing: border-box;
}
.perm-row .perm-btn {
  flex: 1 1 140px;
  min-width: 120px;
}
.perm-stack .perm-btn {
  width: 100%;
  text-align: left;
}
.perm-btn.primary {
  background: #1b4f72;
  color: #fff;
}
.perm-btn.primary:hover:not(:disabled) {
  background: #163f5b;
}
.perm-btn.ghost {
  background: #fff;
  border-color: #d5dde5;
  color: #5d6d7e;
}
.perm-btn.ghost:hover:not(:disabled) {
  background: #f4f6f8;
}
.perm-btn.tonal {
  background: #eaf3fa;
  color: #1b4f72;
}
.perm-btn.tonal:hover:not(:disabled) {
  background: #dceaf4;
}
.perm-btn.danger-ghost {
  background: #fdf6f5;
  color: #c0392b;
}
.perm-btn.danger-ghost:hover:not(:disabled) {
  background: #f8e6e4;
}
.perm-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
