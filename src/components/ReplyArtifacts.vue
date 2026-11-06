<template>
  <div class="reply-artifacts" aria-label="输出文件">
    <section v-for="(group,index) in groups" :key="group.key" class="reply-artifact-group" :class="{'is-collection':group.files.length>1}" :data-collection-key="group.files.length>1?group.key:undefined" :aria-label="group.files.length>1?'文件集':undefined">
      <button v-if="group.files.length>1" type="button" class="reply-collection-toggle" :aria-expanded="expanded.has(group.key)" :aria-controls="expanded.has(group.key)?`${panelId}-${index}`:undefined" @click="toggle(group.key)">
        <span class="reply-artifact-icon"><AppIcon :icon="expanded.has(group.key)?'folder-open':'folder'" /></span>
        <span class="reply-artifact-info"><strong>文件集 <span class="reply-collection-count">{{ group.files.length }} 个文件</span></strong><small>{{ fileSummary(group.files) }} · {{ fileSize(group.size) }}</small></span>
        <span class="reply-collection-action">{{ expanded.has(group.key)?'收起':'展开' }}<AppIcon :icon="expanded.has(group.key)?'chevron-up':'chevron-down'" /></span>
      </button>
      <div v-if="group.files.length===1||expanded.has(group.key)" :id="`${panelId}-${index}`" class="reply-artifact-list">
        <div v-for="file in group.files" :key="JSON.stringify([file.ownerChatId,file.path])" class="reply-artifact" :data-output-path="file.path" :title="filePaths.displayPath(file.ownerChatId,file.path)" @contextmenu="fileActions.show(target(file),$event)" @keydown="fileContextKey($event,file)">
          <button type="button" class="reply-artifact-primary" :title="filePaths.displayPath(file.ownerChatId,file.path)" :aria-label="`预览输出文件 ${file.name}`" @click="emit('open',file.path,file.ownerChatId)">
            <span class="reply-artifact-icon"><AppIcon :icon="file.kind==='image'?'image':'file-lines'" /></span>
            <span class="reply-artifact-info"><strong>{{ file.name }}</strong><small v-if="group.files.length===1">{{ file.kind==='image'?'图片':'文件' }} · {{ fileSize(file.size) }}</small></span>
            <small v-if="group.files.length>1" class="reply-artifact-size">{{ fileSize(file.size) }}</small>
          </button>
          <button type="button" class="reply-artifact-options" aria-label="打开方式" :title="`打开方式\n${filePaths.displayPath(file.ownerChatId,file.path)}`" aria-haspopup="menu" @click="fileActions.show(target(file),$event,'openWith')"><AppIcon icon="chevron-down" /></button>
        </div>
      </div>
    </section>
  </div>
</template>
<script setup lang="ts">
import type {WorkspaceResource} from '@shared/workspace-resources'
import {computed,ref,useId} from 'vue'
import AppIcon from './icons/AppIcon.vue'
import {useWorkspaceFileActions} from '@/composables/useWorkspaceFileActions'
import {useWorkspaceFilePaths} from '@/composables/useWorkspaceFilePaths'
const props=defineProps<{files:WorkspaceResource[];replyId:string}>()
const emit=defineEmits<{open:[path:string,chatId:string];notify:[text:string]}>()
const fileActions=useWorkspaceFileActions({open:(path,chatId)=>emit('open',path,chatId),notify:text=>emit('notify',text)})
const uniqueFiles=computed(()=>{
  const paths=new Set<string>()
  return props.files.filter(file=>{const key=JSON.stringify([file.ownerChatId,file.path]);if(paths.has(key))return false;paths.add(key);return true})
})
// Reply ownership is already established by replyArtifactGroups. Keep other chats separate,
// and keep the collection key independent of changing file revisions or new deliveries.
const groups=computed(()=>{
  const result=new Map<string,{key:string;files:WorkspaceResource[];size:number}>()
  for(const file of uniqueFiles.value){
    const key=JSON.stringify([props.replyId,file.ownerChatId]),group=result.get(key)||{key,files:[],size:0}
    group.files.push(file);group.size+=Number.isFinite(file.size)&&file.size>0?file.size:0;result.set(key,group)
  }
  return [...result.values()]
})
const panelId=useId(),expanded=ref(new Set<string>())
function toggle(key:string){const next=new Set(expanded.value);if(next.has(key))next.delete(key);else next.add(key);expanded.value=next}
const filePaths=useWorkspaceFilePaths(()=>uniqueFiles.value.map(file=>file.ownerChatId))
const target=(file:WorkspaceResource)=>({chatId:file.ownerChatId,path:file.path,revision:file.revision})
function fileContextKey(event:KeyboardEvent,file:WorkspaceResource){if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')fileActions.show(target(file),event)}
function fileSummary(files:WorkspaceResource[]){
  const counts={document:0,image:0,code:0,file:0};for(const file of files)counts[file.kind]++
  return [counts.document&&`${counts.document} 份文档`,counts.image&&`${counts.image} 张图片`,counts.code&&`${counts.code} 份代码`,counts.file&&`${counts.file} 个其他文件`].filter(Boolean).join('、')
}
function fileSize(value:number){const size=Number.isFinite(value)&&value>0?value:0;if(size<1024)return `${size} B`;const index=Math.min(Math.floor(Math.log(size)/Math.log(1024)),4);return `${(size/1024**index).toFixed(1)} ${['B','KB','MB','GB','TB'][index]}`}
</script>
<style scoped>
.reply-artifacts{display:flex;flex-wrap:wrap;align-items:flex-start;gap:9px;margin:12px 0 4px;min-width:0}
.reply-artifact-group{width:280px;max-width:100%;min-width:0}
.reply-artifact-group.is-collection{width:480px;overflow:hidden;background:var(--navora-surface);border:1px solid var(--navora-stroke);border-radius:9px}
.reply-artifact{display:flex;align-items:stretch;width:100%;min-width:0;min-height:52px;overflow:hidden;background:var(--navora-surface);border:1px solid var(--navora-stroke);border-radius:9px;text-align:left;color:var(--navora-ink);transition:background-color 140ms,border-color 140ms}
.reply-artifact:hover,.reply-artifact:focus-within{background:var(--control-hover);border-color:color-mix(in srgb,var(--navora-accent) 45%,var(--navora-stroke))}
.reply-artifact button:focus-visible,.reply-collection-toggle:focus-visible{outline:2px solid var(--navora-accent);outline-offset:-3px}
.reply-artifact-primary,.reply-collection-toggle{display:flex;align-items:center;gap:9px;min-width:0;padding:8px 10px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.reply-artifact-primary{flex:1;border-radius:8px 0 0 8px}
.reply-artifact-options{display:inline-flex;align-items:center;justify-content:center;width:32px;flex:none;align-self:stretch;padding:0;border:0;border-radius:0 8px 8px 0;background:transparent;color:var(--navora-muted);cursor:pointer}.reply-artifact-options:hover{color:var(--navora-ink)}.reply-artifact-options svg{width:12px;height:12px}
.reply-artifact-icon{display:grid;place-items:center;width:28px;height:30px;flex-shrink:0;background:var(--navora-background);color:var(--navora-muted);border-radius:6px}.reply-artifact-icon svg{width:16px;height:16px}
.reply-artifact-info{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}.reply-artifact-info strong{font-size:12px;font-weight:600;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reply-artifact-info small,.reply-artifact-size{font-size:11px;color:var(--navora-muted);line-height:16px}.reply-artifact-size{flex:none;font-variant-numeric:tabular-nums;white-space:nowrap;margin-left:8px}
.reply-collection-toggle{width:100%;min-height:54px;font:inherit;transition:background-color 140ms}.reply-collection-toggle:hover,.reply-collection-toggle:focus-visible{background:var(--control-hover)}
.reply-collection-count{margin-left:6px;font-size:11px;font-weight:400;color:var(--navora-muted)}
.reply-collection-action{display:flex;align-items:center;gap:6px;flex:none;font-size:11px;color:var(--navora-muted)}.reply-collection-action svg{width:11px;height:11px}
.is-collection .reply-artifact-list{border-top:1px solid var(--navora-stroke);padding:3px 0}.is-collection .reply-artifact{min-height:44px;border:0;border-radius:0}.is-collection .reply-artifact+.reply-artifact{border-top:1px solid color-mix(in srgb,var(--navora-stroke) 55%,transparent)}
.is-collection .reply-artifact-primary{padding:7px 10px}.is-collection .reply-artifact .reply-artifact-icon{width:24px;height:26px;background:transparent;border-radius:4px}.is-collection .reply-artifact .reply-artifact-icon svg{width:15px;height:15px}
.is-collection .reply-artifact-primary,.is-collection .reply-artifact-options{border-radius:0}
@media(prefers-reduced-motion:reduce){.reply-artifact,.reply-collection-toggle{transition:none}}
</style>
