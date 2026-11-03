<template>
  <footer class="settings-group-actions" :aria-label="label">
    <span class="settings-group-state" role="status" :class="{ error: !!error }">{{ error || (saving ? '保存中…' : dirty ? '有未保存修改' : scope || '已保存') }}</span>
    <template v-if="dirty || error">
      <button type="button" class="ui-button" :disabled="saving" @click="$emit('cancel')">取消修改</button>
      <button type="button" class="ui-button primary" :disabled="saving" @click="$emit('save')">{{ saving ? '保存中…' : label }}</button>
    </template>
  </footer>
</template>
<script setup lang="ts">
defineProps<{ label: string; dirty: boolean; saving?: boolean; error?: string; scope?: string }>()
defineEmits<{ save: []; cancel: [] }>()
</script>
<style scoped>
.settings-group-actions{grid-column:1/-1;display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:12px;border-top:1px solid var(--navora-stroke)}
.settings-group-state{margin-right:auto;color:var(--navora-muted);font-size:12px;overflow-wrap:anywhere}.settings-group-state.error{color:var(--control-danger)}
</style>
