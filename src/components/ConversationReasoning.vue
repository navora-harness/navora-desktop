<template>
  <section class="transcript-activity transcript-reasoning" :class="{'is-open':open}">
    <button type="button" class="transcript-activity-trigger" :aria-expanded="open" :aria-controls="detailId" @click="open=!open">
      <AppIcon icon="lightbulb" /><span>{{ label }}</span><AppIcon class="activity-chevron" icon="chevron-right" />
    </button>
    <div v-if="open" :id="detailId" class="transcript-activity-detail reasoning-detail">
      <pre>{{ text.slice(0,24000) }}</pre>
      <p v-if="text.length>24000" class="output-truncated">思考内容较长，当前显示前 24,000 字。</p>
    </div>
  </section>
</template>
<script setup lang="ts">
import {ref,useId} from 'vue'
import AppIcon from './icons/AppIcon.vue'
withDefaults(defineProps<{text:string;label?:string}>(),{label:'思考过程'})
const open=ref(false),detailId=`reasoning-${useId()}`
</script>
<style>
.transcript-reasoning{margin:0 0 8px}
.transcript-reasoning .reasoning-detail pre{font-family:inherit;font-size:12px;color:var(--navora-muted)}
</style>
