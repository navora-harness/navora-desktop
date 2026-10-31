<template>
  <div class="reply-artifacts" aria-label="输出文件">
    <button v-for="file in files" :key="file.id" type="button" class="reply-artifact" :data-output-path="file.path" :title="file.path" :aria-label="`预览输出文件 ${file.name}`" @click="emit('open',file.path,file.ownerChatId)">
      <span class="reply-artifact-icon"><font-awesome-icon :icon="file.kind==='image'?'image':'file-lines'" /></span>
      <span class="reply-artifact-info"><strong>{{ file.name }}</strong><small>{{ file.kind==='image'?'图片':'文件' }} · {{ fileSize(file.size) }}</small></span>
      <font-awesome-icon class="reply-artifact-open" icon="arrow-up-right-from-square" />
    </button>
  </div>
</template>
<script setup lang="ts">
import type {WorkspaceResource} from '@shared/workspace-resources'
defineProps<{files:WorkspaceResource[]}>()
const emit=defineEmits<{open:[path:string,chatId:string]}>()
function fileSize(size:number){return size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(1)} KB`:`${(size/1024/1024).toFixed(1)} MB`}
</script>
<style scoped>
.reply-artifacts{display:flex;flex-wrap:wrap;gap:9px;margin:12px 0 4px;min-width:0}
.reply-artifact{display:flex;align-items:center;gap:11px;max-width:100%;width:284px;min-width:0;min-height:66px;padding:11px 13px;background:#fff;border:1px solid #d9dfe7;border-radius:13px;text-align:left;color:#334155;transition:background-color 140ms,border-color 140ms,box-shadow 140ms}
.reply-artifact:hover{background:#f5f7fa;border-color:#aebed0;box-shadow:0 2px 7px #1e293b0a}.reply-artifact:focus-visible{outline:2px solid #5478a3;outline-offset:3px}
.reply-artifact-icon{display:grid;place-items:center;width:34px;height:38px;flex-shrink:0;background:#eff3f7;color:#5c7189;border-radius:8px}.reply-artifact-icon svg{width:17px;height:17px}
.reply-artifact-info{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}.reply-artifact-info strong{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reply-artifact-info small{font-size:11px;color:#7c8796}.reply-artifact-open{width:12px;height:12px;flex-shrink:0;color:#8591a0}
@media(prefers-reduced-motion:reduce){.reply-artifact{transition:none}}
</style>
