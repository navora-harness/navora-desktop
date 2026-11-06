<template>
  <v-app class="navora-app">
    <main class="fixture-backdrop"><h1>技能与插件</h1><p>安装确认与通用弹窗外壳检查</p></main>
    <PluginImportDialog v-if="kind === 'plugin'" v-model="open" :preview="preview" :saving="saving" @confirm="confirmed = $event" />
    <SkillDialogShell v-else v-model="open" kicker="技能商店" title="安装技能" subtitle="确认后即可在对话中使用" :max-width="640">
      <p>通用技能、插件与商店弹窗共用此表头及底栏。</p>
      <template #actions><v-spacer /><v-btn variant="text">取消</v-btn><v-btn color="primary">安装技能</v-btn></template>
    </SkillDialogShell>
  </v-app>
</template>
<script setup lang="ts">
import {nextTick,ref} from 'vue'
import type {NavoraApi} from '../../electron/preload'
import type {PluginImportPreview} from '../../shared/plugins'
import {createDefaultConfig} from '../../shared/config'
import {useAppearance} from '../../src/composables/useAppearance'
import PluginImportDialog from '../../src/components/plugins/PluginImportDialog.vue'
import SkillDialogShell from '../../src/components/skills/SkillDialogShell.vue'
const open=ref(true),kind=ref('plugin'),saving=ref(false),confirmed=ref<unknown>(),preview=ref<PluginImportPreview|null>(null)
const config=createDefaultConfig(),listeners=new Set<(value:typeof config)=>void>()
config.app.window_acrylic=false
window.navora={app:{platform:'win32'},config:{get:async()=>config,onChanged:(callback:(value:typeof config)=>void)=>{listeners.add(callback);return()=>listeners.delete(callback)}},plugins:{onImportProgress:()=>()=>{}}} as unknown as NavoraApi
useAppearance()
const base:PluginImportPreview={id:'reference-organizer-with-a-long-package-id',name:'资料整理助手 / Reference Organizer',description:'整理资料与本地文本，保留原始来源并提供可核对的结果。'.repeat(12),version:'1.2.3',main:'main.cjs',sourcePath:'D:\\资料与文档\\插件下载\\很长的来源路径\\reference-organizer-with-a-long-file-name.zip',sourceLabel:'reference-organizer-with-a-long-file-name.zip',mode:'zip',source:'压缩包安装',sizeBytes:2701234}
async function show(mode='normal'){
  open.value=false;await nextTick();saving.value=mode==='saving';confirmed.value=undefined;kind.value=mode==='shell'?'shell':'plugin'
  preview.value={...base,...(mode==='overwrite'?{existing:{id:base.id,name:'已安装的资料整理助手',version:'1.0.0',source:'压缩包安装'}}:{}),...(mode==='suite'||mode==='blocked'?{suite:'reference-tools',suiteConflicts:[{id:'reference-tools-previous',name:'已有套件变体',version:'1.0.0',source:'压缩包安装',bundled:mode==='blocked'}]}:{})}
  await nextTick();open.value=true;await nextTick()
}
;(window as any).skillDialogFixture={show,theme(mode:'light'|'dark',theme='mist'){config.app.appearance_mode=mode;config.app.appearance_theme=theme as typeof config.app.appearance_theme;for(const listener of listeners)listener(config)},get confirmed(){return JSON.parse(JSON.stringify(confirmed.value??null))},get open(){return open.value}}
void show()
</script>
<style>
html,body,#app{height:100%;margin:0;overflow:hidden;font-family:'Segoe UI','Microsoft YaHei',sans-serif}.fixture-backdrop{padding:48px;color:var(--navora-ink);background:var(--navora-header);height:100%}.fixture-backdrop h1{font-size:22px}.fixture-backdrop p{font-size:13px;color:var(--navora-muted)}.v-application__wrap{height:100%;min-height:0!important}
</style>
