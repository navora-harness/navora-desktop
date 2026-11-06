<template>
  <Teleport to="body">
    <div v-if="message" class="ui-notice-host" role="alert" :title="message"><span>{{ message }}</span><button type="button" aria-label="关闭操作提示" @click="message=''">×</button></div>
  </Teleport>
</template>
<script setup lang="ts">
import {onBeforeUnmount,onMounted,ref} from 'vue'
const message=ref('')
let timer:ReturnType<typeof setTimeout>|undefined
function receive(event:Event){
  const value=(event as CustomEvent<{message?:unknown}>).detail?.message
  if(typeof value!=='string'||!value.trim())return
  message.value=value.trim().slice(0,240);clearTimeout(timer)
  timer=setTimeout(()=>{message.value=''},6000)
}
onMounted(()=>window.addEventListener('navora:ui-notice',receive))
onBeforeUnmount(()=>{window.removeEventListener('navora:ui-notice',receive);clearTimeout(timer)})
</script>
<style scoped>
.ui-notice-host{position:fixed;z-index:30000;top:5px;left:16px;max-width:calc(100vw - 180px);height:32px;box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:4px 8px 4px 12px;border:1px solid var(--navora-stroke);border-radius:9px;background:var(--navora-surface);color:var(--navora-ink);box-shadow:0 2px 10px #00000012;font-size:12px;-webkit-app-region:no-drag}.ui-notice-host>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ui-notice-host button{flex:none;width:23px;height:23px;border-radius:5px;font-size:18px;line-height:1}.ui-notice-host button:hover{background:var(--control-hover)}
</style>
