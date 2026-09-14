<template>
  <v-dialog
    :model-value="modelValue"
    :fullscreen="isMobileLayout"
    :max-width="dialogMaxWidth"
    scrollable
    persistent
    scrim="rgba(10, 18, 28, 0.42)"
    :content-class="
      isMobileLayout
        ? 'skill-dialog-content skill-dialog-content--mobile'
        : 'skill-dialog-content'
    "
    @update:model-value="onModel"
  >
    <v-card class="skill-dlg-card" :class="{ 'is-mobile': isMobileLayout }" elevation="0">
      <header class="skill-dlg-head">
        <div class="skill-dlg-head-text">
          <div v-if="kicker" class="skill-dlg-kicker">{{ kicker }}</div>
          <div class="skill-dlg-title-row">
            <h2 class="skill-dlg-title">
              <span class="skill-dlg-title-text">{{ title }}</span>
              <v-tooltip v-if="titleWarning" location="top" max-width="280">
                <template #activator="{ props: tipProps }">
                  <span
                    class="skill-dlg-title-warn"
                    v-bind="tipProps"
                    role="img"
                    :aria-label="titleWarning"
                  >
                    <font-awesome-icon icon="circle-exclamation" />
                  </span>
                </template>
                <span>{{ titleWarning }}</span>
              </v-tooltip>
            </h2>
          </div>
          <p v-if="subtitle" class="skill-dlg-sub">{{ subtitle }}</p>
        </div>
        <button
          type="button"
          class="skill-dlg-close"
          aria-label="关闭"
          @click="emit('update:modelValue', false)"
        >
          <font-awesome-icon icon="xmark" />
        </button>
      </header>
      <v-card-text class="skill-dlg-body">
        <slot />
      </v-card-text>
      <v-card-actions class="skill-dlg-actions">
        <slot name="actions" />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useMobileLayout } from '@/composables/useMobileLayout'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    subtitle?: string
    /** Small uppercase label above the title */
    kicker?: string
    /** Yellow warning icon next to title (e.g. non-HTTPS store). */
    titleWarning?: string
    maxWidth?: number | string
  }>(),
  { maxWidth: 720 },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { isMobileLayout } = useMobileLayout()
const dialogMaxWidth = computed(() => (isMobileLayout.value ? undefined : props.maxWidth))

function onModel(v: boolean) {
  emit('update:modelValue', v)
}
</script>

<style scoped>
.skill-dlg-card {
  border-radius: 14px !important;
  overflow: hidden;
  border: 1px solid #d5dee7;
  background: #fff;
  user-select: none;
  -webkit-user-select: none;
}
.skill-dlg-head,
.skill-dlg-actions {
  user-select: none;
  -webkit-user-select: none;
}
.skill-dlg-body {
  user-select: none;
  -webkit-user-select: none;
}
.skill-dlg-body :deep(.selectable),
.skill-dlg-body :deep(.md-body),
.skill-dlg-body :deep(.mono),
.skill-dlg-body :deep(.preview-desc),
.skill-dlg-body :deep(.product-desc),
.skill-dlg-body :deep(.pkg-desc),
.skill-dlg-body :deep(.conflict-meta),
.skill-dlg-body :deep(code),
.skill-dlg-body :deep(pre) {
  user-select: text;
  -webkit-user-select: text;
}
.skill-dlg-card.is-mobile {
  border-radius: 0 !important;
  border: none;
  height: 100%;
  max-height: 100dvh;
  display: flex;
  flex-direction: column;
}
.skill-dlg-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 14px;
  background: linear-gradient(180deg, #f4f8fb 0%, #fff 100%);
  border-bottom: 1px solid #e8eef4;
  flex-shrink: 0;
}
.skill-dlg-card.is-mobile .skill-dlg-head {
  padding-top: calc(14px + env(safe-area-inset-top, 0px));
  padding-left: calc(16px + env(safe-area-inset-left, 0px));
  padding-right: calc(12px + env(safe-area-inset-right, 0px));
}
.skill-dlg-head-text {
  min-width: 0;
  flex: 1;
}
.skill-dlg-kicker {
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  text-transform: none;
  color: #7f8c8d;
  opacity: 1;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-dlg-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 750;
  color: #15202b;
  line-height: 1.25;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 0.35em;
  min-width: 0;
}
.skill-dlg-title-row {
  min-width: 0;
}
.skill-dlg-title-text {
  min-width: 0;
}
.skill-dlg-title-warn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #d4a017;
  font-size: 0.95em;
  line-height: 1;
  cursor: help;
  transform: translateY(0.02em);
}
.skill-dlg-sub {
  margin: 6px 0 0;
  font-size: 0.84rem;
  color: #5d6d7e;
  line-height: 1.45;
}
.skill-dlg-close {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  margin-top: -4px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #7a8a99;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.skill-dlg-close:hover,
.skill-dlg-close:active {
  background: #eef3f7;
  color: #1b4f72;
}
.skill-dlg-body {
  padding: 16px 20px !important;
  max-height: min(68vh, 620px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.skill-dlg-card.is-mobile .skill-dlg-body {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none !important;
  padding: 14px 16px !important;
  padding-left: calc(16px + env(safe-area-inset-left, 0px)) !important;
  padding-right: calc(16px + env(safe-area-inset-right, 0px)) !important;
}
.skill-dlg-actions {
  padding: 12px 16px 16px !important;
  border-top: 1px solid #e8eef4;
  gap: 6px;
  row-gap: 8px;
  flex-wrap: wrap;
  background: #fafcfd;
  flex-shrink: 0;
}
.skill-dlg-card.is-mobile .skill-dlg-actions {
  padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px)) !important;
  padding-left: calc(12px + env(safe-area-inset-left, 0px)) !important;
  padding-right: calc(12px + env(safe-area-inset-right, 0px)) !important;
}
</style>

<style>
.skill-dialog-content {
  box-shadow: 0 16px 48px rgba(21, 32, 43, 0.16) !important;
  border-radius: 14px !important;
  overflow: hidden;
}
.skill-dialog-content--mobile {
  margin: 0 !important;
  max-width: 100% !important;
  width: 100% !important;
  height: 100% !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
.skill-dialog-content--mobile .skill-dlg-card {
  height: 100%;
  max-height: 100dvh;
}
</style>
