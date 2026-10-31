<template>
  <section class="async-panel-state" :class="{overlay}" :aria-busy="!error" :aria-label="label">
    <StatusIcon :kind="error?'error':'running'" />
    <span :role="error?'alert':'status'">{{ error?`${label}未能加载`:`正在加载${label}…` }}</span>
    <div><button v-if="error" type="button" @click="emit('retry')">重试</button><button type="button" @click="emit('close')">返回对话</button></div>
  </section>
</template>
<script setup lang="ts">
import StatusIcon from './StatusIcon.vue'
defineProps<{label:string;error?:boolean;overlay?:boolean}>()
const emit=defineEmits<{retry:[];close:[]}>()
</script>
<style scoped>
.async-panel-state{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:240px;color:#708199;background:#fafbfd;font-size:13px}.async-panel-state.overlay{position:fixed;inset:44px 0 0 52px;z-index:1001}.async-panel-state>svg{width:22px;height:22px}.async-panel-state>div{display:flex;gap:8px}.async-panel-state button{border:1px solid #ccd7e4;border-radius:7px;background:#fff;padding:6px 12px;color:#4e6b8e}.async-panel-state button:hover{background:#edf2f7;border-color:#9cb1cb;color:#304d71}.async-panel-state button:focus-visible{outline:2px solid #6487b1;outline-offset:2px}
</style>
