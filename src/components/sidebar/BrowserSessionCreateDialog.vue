<template>
  <BrowserContentDialog v-model="open" max-width="440" :persistent="busy">
    <v-card class="session-create-dialog">
      <v-card-title>新建独立浏览会话</v-card-title>
      <v-card-text>
        <p class="session-owner">所属对话：{{ ownerTitle || '当前对话' }}</p>
        <v-text-field v-model="name" label="浏览会话名称（可选）" maxlength="80" autofocus variant="outlined" density="comfortable" hide-details @keydown.enter="create" />
        <fieldset class="storage-options"><legend>网站数据</legend>
          <label><input v-model="persist" type="radio" :value="true" :disabled="busy||!!createdSession" /><span>保留会话数据<small>Cookie 和站点存储可跨重启保留，不保证网站登录仍有效。</small></span></label>
          <label><input v-model="persist" type="radio" :value="false" :disabled="busy||!!createdSession" /><span>临时会话<small>退出应用后不保留此会话。</small></span></label>
        </fieldset>
        <p v-if="error" class="session-dialog-error" role="alert">{{ error }}</p>
      </v-card-text>
      <v-card-actions><v-spacer /><v-btn :disabled="busy" @click="open=false">取消</v-btn><v-btn color="primary" :loading="busy" :disabled="!chatId" @click="create()">创建并打开页面</v-btn></v-card-actions>
    </v-card>
  </BrowserContentDialog>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BrowserContentDialog from '../BrowserContentDialog.vue'
import type { BrowserTreeSession } from '@shared/types'
const props = defineProps<{ modelValue: boolean; chatId: string; ownerTitle?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; created: [session: BrowserTreeSession] }>()
const open = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const name = ref(''), persist = ref(true), busy = ref(false), error = ref('')
const createdSession=ref<BrowserTreeSession|null>(null)
watch(() => props.modelValue, value => { if (value) { name.value=''; persist.value=true; error.value=''; createdSession.value=null } })
async function create(event?:KeyboardEvent) {
  if(event?.isComposing)return
  event?.preventDefault()
  if (busy.value || !props.chatId || !window.navora) return
  busy.value=true; error.value=''
  try {
    let session = createdSession.value || await window.navora.browser.createSession(props.chatId, { persist: persist.value })
    createdSession.value=session
    if (name.value.trim()) session = await window.navora.browser.updateSession(session.sessionId, { name: name.value })
    open.value=false; emit('created', session)
  } catch (failure) { error.value=failure instanceof Error ? failure.message : '创建会话失败' }
  finally { busy.value=false }
}
</script>
<style scoped>
.session-owner{font-size:12px;color:var(--navora-muted);margin:0 0 16px}.storage-options{border:0;padding:0;margin:20px 0 0}.storage-options legend{font-size:12px;font-weight:600;margin-bottom:8px}.storage-options label{display:flex;gap:9px;align-items:flex-start;font-size:13px;margin:12px 0;cursor:pointer}.storage-options input{margin-top:3px;accent-color:var(--navora-accent)}.storage-options small{display:block;line-height:1.65;font-size:11px;color:var(--navora-muted);margin-top:3px}.session-dialog-error{font-size:12px;color:rgb(var(--v-theme-error));margin:10px 0 0}
</style>
