<template>
  <section class="keyboard-shortcuts-panel" aria-labelledby="keyboard-shortcuts-title">
    <header class="keyboard-shortcuts-header"><div><h2 id="keyboard-shortcuts-title">键盘快捷键</h2><p>常用操作，随手可达</p></div><button type="button" class="ui-icon-button" aria-label="关闭键盘快捷键" title="关闭（Escape）" @click="emit('close')"><AppIcon icon="xmark" /></button></header>
    <div class="keyboard-shortcuts-search"><AppIcon icon="magnifying-glass" /><input ref="searchInput" v-model="query" type="search" placeholder="搜索操作或按键" aria-label="搜索快捷键" autocomplete="off" /><span>{{ visibleCount }} 项</span></div>
    <div class="keyboard-shortcuts-list" tabindex="0" aria-label="快捷键列表">
      <section v-for="group in groups" :key="group.id" class="keyboard-shortcuts-group" :aria-labelledby="`shortcut-group-${group.id}`">
        <header><h3 :id="`shortcut-group-${group.id}`">{{ group.label }}</h3><span>{{ group.configurable?'可开关':'固定快捷键' }}</span></header>
        <p v-if="group.description" class="keyboard-shortcuts-description">{{ group.description }}</p>
        <div v-for="item in group.items" :key="item.id" class="keyboard-shortcut-row" :class="{'is-disabled':item.configurable&&!shortcuts.enabled(item.id as AppCommandId)}" :data-shortcut-id="item.id">
          <label v-if="item.configurable" class="keyboard-shortcut-switch"><input type="checkbox" role="switch" class="surface-toggle" :checked="shortcuts.enabled(item.id as AppCommandId)" :disabled="shortcuts.saving.value||!shortcuts.available.value" :aria-label="`${item.label}快捷键`" @change="toggle($event,item.id as ConfigurableAppShortcutId)" /><span>{{ item.label }}<small v-if="item.hint">{{ item.hint }}</small></span></label>
          <span v-else class="keyboard-shortcut-label">{{ item.label }}<small v-if="item.hint">{{ item.hint }}</small></span>
          <span class="keyboard-shortcut-keys" :aria-label="commandShortcutLabel(item.shortcut,platform)"><kbd v-for="(key,index) in keycaps(item.shortcut)" :key="index">{{ key }}</kbd></span>
        </div>
        <ul v-if="group.id==='composer'" class="keyboard-shortcut-notes"><li>不显示固定格式工具栏。选中文字显示悬浮格式面板，Alt F10 可进入面板；列表格式作用于当前段落。</li><li>Enter 默认发送消息；在附加内容或代码块内继续编辑。Shift Enter 在普通文字中换行，在代码块内退出到下一段。</li><li>未选中文字时，在段首或空白后输入 / 打开附加菜单。链接、路径和代码中的 / 保持普通文字。</li><li>添加链接前先选中普通文字；编辑已有链接时，将光标放入链接。{{ commandShortcutLabel('Mod+K',platform) }} 用于搜索对话。</li></ul>
      </section>
      <div v-if="!groups.length" class="keyboard-shortcuts-empty"><AppIcon icon="magnifying-glass" /><p>没有找到相关快捷键</p><button type="button" class="ui-button" @click="query=''">清除搜索</button></div>
    </div>
    <footer class="keyboard-shortcuts-footer"><div role="status" aria-live="polite" :class="{'has-error':shortcuts.error.value}">{{ shortcuts.error.value|| (shortcuts.saving.value?'正在保存…':shortcuts.reading.value?'正在读取设置…':'开关自动保存，仅影响快捷键；菜单操作仍可使用。') }}</div><button v-if="!shortcuts.available.value&&shortcuts.error.value" type="button" class="ui-button" :disabled="shortcuts.reading.value" @click="shortcuts.reload()">重试读取</button><button v-else type="button" class="ui-button" :disabled="shortcuts.saving.value||!shortcuts.available.value||!shortcuts.customized.value" title="只恢复本页 4 项快捷键的启用状态" @click="shortcuts.reset()">恢复默认快捷键</button></footer>
  </section>
</template>
<script setup lang="ts">
import {computed,nextTick,onMounted,ref} from 'vue'
import {appCommands,commandShortcutLabel,type AppCommandId} from '@shared/app-commands'
import {configurableAppShortcutIds,type ConfigurableAppShortcutId} from '@shared/app-shortcuts'
import {composerFormattingShortcuts,composerEditingShortcuts} from '@shared/composer-shortcuts'
import {useAppShortcuts} from '@/composables/useAppShortcuts'
import AppIcon from './icons/AppIcon.vue'
const props=defineProps<{platform:string}>(),emit=defineEmits<{close:[]}>(),shortcuts=useAppShortcuts(),query=ref(''),searchInput=ref<HTMLInputElement>()
type Item={id:string;label:string;shortcut:string;hint?:string;configurable?:boolean}
type Group={id:string;label:string;description?:string;configurable?:boolean;items:Item[]}
const applicationItems:Item[]=configurableAppShortcutIds.map(id=>{const command=appCommands.find(command=>command.id===id)!;return {id,label:command.label.replace('…',''),shortcut:command.shortcut!,configurable:true,hint:id==='app.quit'?'主窗口；打开退出确认':'主窗口；当前没有其他弹窗时'}})
const readonlyCommands=(ids:AppCommandId[]):Item[]=>ids.map(id=>{const command=appCommands.find(command=>command.id===id)!;return {id,label:command.label.replace('…',''),shortcut:command.shortcut!}})
const catalog:Group[]=[
  {id:'application',label:'应用操作',configurable:true,description:'仅以下 4 项支持启停。开关在所有窗口同步，键盘快捷键面板始终可以打开。',items:applicationItems},
  {id:'content',label:'窗口与内容',description:'作用于相应的网页、文件或聊天。由当前内容决定是否可用。',items:[...readonlyCommands(['help.shortcuts','conversation.find','browser.new','browser.reopen','content.close','browser.reload','browser.reloadIgnoringCache','browser.mute']),{id:'browser.address',label:'定位到浏览器地址栏',shortcut:'Mod+L'},{id:'content.next',label:'下一个内容标签页',shortcut:'Mod+Tab'},{id:'content.previous',label:'上一个内容标签页',shortcut:'Mod+Shift+Tab'}]},
  {id:'text',label:'文本与剪贴板',description:'由编辑器、网页或系统处理。输入框与只读内容支持的操作有所不同。',items:[...readonlyCommands(['edit.undo','edit.redo','edit.cut','edit.copy','edit.paste','edit.pastePlain','edit.selectAll']),...(props.platform==='darwin'?[]:[{id:'edit.redoAlternative',label:'重做的另一种方式',shortcut:'Mod+Y'}])]},
  {id:'composer',label:'富文本编辑',description:'以下格式与编辑操作仅在消息编辑器获得焦点时生效。',items:[...composerFormattingShortcuts,...composerEditingShortcuts,{id:'composer.send',label:'发送消息',shortcut:'Enter'},{id:'composer.attach',label:'打开附加菜单',shortcut:'/'}]},
  {id:'annotation',label:'网页批注',description:'先从网页工具栏开启批注；点击目标或拖动选区后，使用悬浮输入框添加说明。',items:[{id:'annotation.browse',label:'按住临时操作网页',shortcut:'Space',hint:'松开返回批注；网页输入框获得焦点时保留正常输入，可点击返回批注。'},{id:'annotation.save',label:'保存当前批注',shortcut:'Mod+Enter',hint:'仅在批注输入框中生效；输入法选字时不触发。'},{id:'annotation.newline',label:'批注说明换行',shortcut:'Enter'},{id:'annotation.dismiss',label:'收起批注输入框',shortcut:'Escape',hint:'保留尚未提交的草稿。'}]},
  {id:'menu',label:'菜单与选择',items:[{id:'menu.focus',label:'定位应用菜单',shortcut:'F10',hint:'也可单独按 Alt'},{id:'menu.move',label:'在菜单中选择',shortcut:'↑+↓'},{id:'menu.accept',label:'确认选中项目',shortcut:'Enter'},{id:'menu.dismiss',label:'关闭当前菜单或面板',shortcut:'Escape'}]},
]
const normalize=(value:string)=>value.toLowerCase().replace(/[\s+⌘]/g,'').replace(/ctrl|cmd|command|control/g,'mod')
const groups=computed(()=>{
  const words=query.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if(!words.length)return catalog
  return catalog.flatMap(group=>{const items=group.items.filter(item=>words.every(word=>normalize(`${group.label} ${item.label} ${item.hint||''} ${item.shortcut} ${commandShortcutLabel(item.shortcut,props.platform)}`).includes(normalize(word))));return items.length?[{...group,items}]:[]})
})
const visibleCount=computed(()=>groups.value.reduce((sum,group)=>sum+group.items.length,0))
function keycaps(shortcut:string){return shortcut.split('+').map(key=>key==='Mod'?(props.platform==='darwin'?'⌘':'Ctrl'):key==='Shift'&&props.platform==='darwin'?'⇧':key==='Alt'&&props.platform==='darwin'?'⌥':key)}
function toggle(event:Event,id:ConfigurableAppShortcutId){const input=event.target as HTMLInputElement,value=input.checked;input.checked=shortcuts.enabled(id);void shortcuts.setEnabled(id,value)}
onMounted(()=>void nextTick(()=>searchInput.value?.focus({preventScroll:true})))
</script>
<style scoped>
.keyboard-shortcuts-panel{display:flex;flex-direction:column;box-sizing:border-box;height:min(760px,calc(100dvh - 48px));min-height:0;overflow:hidden;border:1px solid var(--navora-stroke);border-radius:18px;background:var(--navora-surface);color:var(--navora-ink)}
.keyboard-shortcuts-header{display:flex;flex:0 0 auto;align-items:flex-start;justify-content:space-between;gap:20px;padding:25px 28px 18px}.keyboard-shortcuts-header h2{margin:0;font-size:21px;line-height:1.4;font-weight:650;letter-spacing:-.3px}.keyboard-shortcuts-header p{margin:5px 0 0;color:var(--navora-muted);font-size:13px}.keyboard-shortcuts-header>.ui-icon-button{width:32px;height:32px;flex:0 0 32px}
.keyboard-shortcuts-search{display:flex;flex:0 0 auto;align-items:center;gap:9px;min-height:40px;margin:0 28px 14px;padding:0 11px;border:1px solid var(--navora-stroke);border-radius:9px;background:var(--navora-background);color:var(--navora-muted)}.keyboard-shortcuts-search:focus-within{border-color:var(--navora-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--navora-accent) 12%,transparent)}.keyboard-shortcuts-search>.app-icon{width:16px;height:16px;flex-shrink:0}.keyboard-shortcuts-search input{flex:1;min-width:0;border:0;outline:none!important;box-shadow:none!important;background:transparent;color:var(--navora-ink);font:inherit;font-size:13px}.keyboard-shortcuts-search>span{flex-shrink:0;font-size:11px}
.keyboard-shortcuts-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 28px 20px;scrollbar-gutter:stable}.keyboard-shortcuts-list:focus-visible{outline:2px solid var(--navora-accent);outline-offset:-3px}.keyboard-shortcuts-group{padding-top:14px}.keyboard-shortcuts-group+.keyboard-shortcuts-group{margin-top:22px}.keyboard-shortcuts-group>header{display:flex;align-items:center;gap:14px;justify-content:space-between;padding-bottom:8px}.keyboard-shortcuts-group h3{margin:0;font-size:13px;font-weight:650}.keyboard-shortcuts-group>header>span{color:var(--navora-muted);font-size:11px}.keyboard-shortcuts-description{margin:0 0 8px;color:var(--navora-muted);font-size:12px;line-height:1.7}
.keyboard-shortcut-row{display:flex;align-items:center;justify-content:space-between;gap:18px;min-height:56px;padding:10px 0;border-bottom:1px solid var(--navora-stroke)}.keyboard-shortcut-row.is-disabled .keyboard-shortcut-keys{opacity:.5}.keyboard-shortcut-switch{display:flex;align-items:center;gap:13px;min-width:0;flex:1;cursor:pointer}.keyboard-shortcut-switch>span,.keyboard-shortcut-label{min-width:0;font-size:13px;line-height:1.5}.keyboard-shortcut-row small{display:block;margin-top:3px;color:var(--navora-muted);font-size:11px;line-height:1.5}.keyboard-shortcut-keys{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:4px;flex-shrink:0;max-width:50%;color:var(--navora-muted)}.keyboard-shortcut-keys kbd{display:inline-flex;align-items:center;justify-content:center;min-width:26px;min-height:26px;padding:2px 7px;border:1px solid var(--navora-stroke);border-bottom-width:2px;border-radius:5px;background:var(--navora-background);font:inherit;font-size:11px;white-space:nowrap}
.keyboard-shortcut-notes{margin:14px 0 0;padding-left:16px;color:var(--navora-muted);font-size:12px;line-height:1.8}.keyboard-shortcut-notes li+li{margin-top:5px}.keyboard-shortcuts-footer{display:flex;flex:0 0 auto;align-items:center;justify-content:space-between;gap:18px;padding:16px 28px;border-top:1px solid var(--navora-stroke);background:var(--navora-surface)}.keyboard-shortcuts-footer>div{color:var(--navora-muted);font-size:11px;line-height:1.6}.keyboard-shortcuts-footer>div.has-error{color:var(--control-danger,#b65045)}.keyboard-shortcuts-footer>.ui-button{flex-shrink:0;white-space:nowrap}.keyboard-shortcuts-empty{display:grid;justify-items:center;gap:12px;padding:54px 16px;color:var(--navora-muted)}.keyboard-shortcuts-empty p{margin:0;font-size:13px}
@media(max-width:520px){.keyboard-shortcuts-panel{height:calc(100dvh - 24px);border-radius:13px}.keyboard-shortcuts-header{padding:19px 18px 15px}.keyboard-shortcuts-search{margin-inline:18px}.keyboard-shortcuts-list{padding-inline:18px}.keyboard-shortcuts-footer{padding:12px 18px;align-items:flex-start;flex-direction:column;gap:8px}.keyboard-shortcut-row{gap:8px}.keyboard-shortcut-switch{gap:10px}.keyboard-shortcut-keys{max-width:45%;gap:3px}.keyboard-shortcut-keys kbd{min-width:22px;padding-inline:5px}.keyboard-shortcuts-header h2{font-size:19px}}
</style>
