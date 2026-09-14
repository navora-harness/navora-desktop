<template>
  <v-dialog
    :model-value="modelValue"
    :fullscreen="isMobileLayout"
    :max-width="isMobileLayout ? undefined : 1420"
    :width="isMobileLayout ? undefined : '94vw'"
    scrollable
    class="settings-dialog-root"
    :content-class="isMobileLayout ? 'settings-dialog-content settings-dialog-content--mobile' : 'settings-dialog-content'"
    scrim="rgba(10, 18, 28, 0.34)"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <SettingsPage
      v-if="modelValue"
      embedded
      :mobile="isMobileLayout"
      @close="$emit('update:modelValue', false)"
    />
  </v-dialog>
</template>

<script setup lang="ts">
import SettingsPage from '../pages/SettingsPage.vue'
import { useMobileLayout } from '../composables/useMobileLayout'

defineProps<{
  modelValue: boolean
}>()

defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { isMobileLayout } = useMobileLayout()
</script>

<style>
.settings-dialog-content {
  margin: 24px auto !important;
  max-height: calc(100vh - 48px);
  overflow: visible !important;
}

.settings-dialog-content--mobile {
  margin: 0 !important;
  max-height: 100% !important;
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
  overflow: hidden !important;
  border-radius: 0 !important;
}

.settings-dialog-content--mobile .v-card,
.settings-dialog-content--mobile > .settings-page {
  height: 100%;
  max-height: 100dvh;
}
</style>
