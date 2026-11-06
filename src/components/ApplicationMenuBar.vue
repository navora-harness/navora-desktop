<template>
  <nav v-if="showLabels" ref="bar" class="application-menu-bar" :class="{'transient':transient,'compact':mode==='compact'}" role="menubar" aria-label="应用菜单" @keydown="barKey">
    <button v-for="(menu,index) in menus" :key="menu.id" :ref="element=>setTrigger(element,index)" type="button" class="application-menu-trigger" role="menuitem" aria-haspopup="menu" :aria-expanded="opened===menu.id" :aria-controls="`${uid}-${menu.id}`" :tabindex="focused===index?0:-1" :class="{selected:opened===menu.id}" :title="`${menu.label}（Alt ${menu.accessKey.toUpperCase()}）`" @mousedown.prevent @click="toggle(menu.id)" @mouseenter="opened&&openMenu(menu.id)">{{ menu.label }}</button>
  </nav>
  <Teleport to="body">
    <section v-if="opened&&!nativeOpen" :id="`${uid}-${opened}`" ref="panel" class="sidebar-ctx-panel application-menu-panel" role="menu" :aria-label="`${menus.find(menu=>menu.id===opened)?.label||''}菜单`" :style="{left:`${position.x}px`,top:`${position.y}px`}" @keydown="panelKey" @contextmenu.prevent>
      <template v-for="(command,index) in entries" :key="command.id">
        <div v-if="index>0&&entries[index-1]?.group!==command.group" class="application-menu-separator" role="separator" />
        <button type="button" :data-command="command.id" :role="command.state.checked===undefined?'menuitem':'menuitemcheckbox'" :aria-checked="command.state.checked" class="application-menu-command" :class="{danger:command.danger}" :disabled="!command.state.enabled||busy" :title="!command.state.enabled?command.state.reason:!shortcutPreferences.enabled(command.id)?'此快捷键已关闭；仍可点击菜单使用':undefined" @mousedown.prevent @click="run(command.id)"><span class="application-menu-check" aria-hidden="true">{{ command.state.checked?'✓':'' }}</span><span class="application-menu-label">{{ command.state.label||command.label }}</span><kbd v-if="command.shortcut" :class="{'shortcut-off':!shortcutPreferences.enabled(command.id)}">{{ commandShortcutLabel(command.shortcut,platform) }}</kbd></button>
      </template>
    </section>
  </Teleport>
  <BrowserContentDialog v-model="localDialog" :max-width="localHelp==='help.shortcuts'?780:620" :content-class="localHelp==='help.shortcuts'?'application-help-dialog application-shortcuts-dialog':'application-help-dialog'" @after-leave="restoreFocus">
    <KeyboardShortcutsPanel v-if="localHelp==='help.shortcuts'" :platform="platform" @close="localDialog=false" />
    <section v-else class="application-help-content" role="document"><header><h2>{{ localTitle }}</h2><button type="button" class="ui-icon-button" aria-label="关闭帮助" @click="localDialog=false"><AppIcon icon="xmark" /></button></header>
      <template v-if="localHelp==='help.guide'"><ol><li>在左侧切换对话、对话文件、浏览器资源与插件。</li><li>在消息编辑器中描述任务，通过附加加入相关资料；在段首或空白后输入 / 也可以打开附加菜单。</li><li>选中文字可打开悬浮格式面板，也可使用快捷键设置加粗等格式。完整说明见「帮助 → 键盘快捷键」中的「富文本编辑」。</li><li>使用工作区查看文件和网页；数量按钮可以显示或隐藏工作区。</li><li>文件、编辑、视图和帮助菜单提供相应操作。不可用命令会显示原因。</li></ol></template>
      <footer><button type="button" class="ui-button" @click="localDialog=false">关闭</button></footer>
    </section>
  </BrowserContentDialog>
</template>
<script setup lang="ts">
import {computed,getCurrentInstance,nextTick,onBeforeUnmount,onMounted,ref,useId,watch,type ComponentPublicInstance} from 'vue'
import {appCommands,appMenus,commandShortcutLabel,type AppCommandContext,type AppCommandHandlers,type AppCommandId,type AppCommandStateMap,type AppMenuId,type AppMenuMode} from '@shared/app-commands'
import {appShortcutCommand,isConfigurableAppShortcut} from '@shared/app-shortcuts'
import {useAppShortcuts} from '@/composables/useAppShortcuts'
import KeyboardShortcutsPanel from './KeyboardShortcutsPanel.vue'
import BrowserContentDialog from './BrowserContentDialog.vue'
import {hasVisibleUi} from '@/utils/visible-ui'
import {BROWSER_CHROME_OPEN,requestBrowserChromeOpen} from '@shared/browser-chrome-events'
import AppIcon from './icons/AppIcon.vue'
import {useNativeUi} from '@/composables/useNativeUi'
import {NATIVE_UI_OPEN,type NativeMenuItem} from '@shared/native-ui'
import {useSafeBrowserPopup} from '@/utils/browser-popup-placement'

const props=withDefaults(defineProps<{commandState:AppCommandStateMap;handlers?:AppCommandHandlers;contextKey?:string;appVersion?:string;mode?:AppMenuMode;platform?:string;nativeMenu?:boolean;collapsed?:boolean;shortcutsActive?:boolean;captureTarget?:(nativePageId?:string)=>unknown;restoreTarget?:(bookmark:unknown)=>void|boolean}>(),{mode:'main',platform:window.navora?.app.platform||'win32',appVersion:'',nativeMenu:false,collapsed:false,shortcutsActive:true})
const emit=defineEmits<{command:[id:AppCommandId,context:AppCommandContext];beforeopen:[nativePageId?:string];open:[value:boolean];error:[message:string]}>()
const uid=`application-menu-${useId()}`,chromeId=`application-menu-${crypto.randomUUID()}`,instance=getCurrentInstance()
const bar=ref<HTMLElement>(),panel=ref<HTMLElement>(),triggers:HTMLButtonElement[]=[],opened=ref<AppMenuId|null>(null),focused=ref(0),keyboardMode=ref(false),busy=ref(false),position=ref({x:8,y:40})
const localDialog=ref(false),localHelp=ref<AppCommandId>('help.guide')
const native=useNativeUi(),nativeOpen=ref(false)
useSafeBrowserPopup(()=>opened.value&&!nativeOpen.value?panel.value:null,()=>close())
let nativeGeneration=0
const shortcutPreferences=useAppShortcuts()
const builtins=new Set<AppCommandId>(['help.shortcuts','help.guide','help.about'])
const transient=computed(()=>props.collapsed||props.mode==='detached'||props.mode==='file')
const showLabels=computed(()=>!props.nativeMenu&&(!transient.value||keyboardMode.value||!!opened.value))
const hasCommandListener=()=>!!instance?.vnode.props?.onCommand
const commands=computed(()=>appCommands.filter(command=>!command.modes||command.modes.includes(props.mode)).flatMap(command=>{
  const raw=props.commandState[command.id],defined=Object.prototype.hasOwnProperty.call(props.commandState,command.id),own=!!props.handlers?.[command.id],builtin=builtins.has(command.id)
  if(raw&&typeof raw==='object'&&raw.visible===false)return []
  if(!own&&!builtin&&(!defined||!hasCommandListener()))return []
  const state=typeof raw==='boolean'?{enabled:raw}:raw?{...raw,enabled:raw.enabled!==false}:{enabled:builtin||own}
  return [{...command,state}]
}))
const menus=computed(()=>appMenus.filter(menu=>commands.value.some(command=>command.menu===menu.id)))
const entries=computed(()=>commands.value.filter(command=>command.menu===opened.value))
const localTitle=computed(()=>localHelp.value==='help.about'?'关于 Navora':localHelp.value==='help.guide'?'使用引导':'键盘快捷键')
type DomBookmark={element:HTMLElement|null;selection?:{start:number;end:number;direction:'forward'|'backward'|'none'|null};range?:Range}
let bookmark:DomBookmark|null=null,targetBookmark:unknown,savedContextKey:string|undefined,resizeObserver:ResizeObserver|undefined,altOnly=false,disposed=false,nativeUnsub:(()=>void)|undefined,nativePageId:string|undefined
function setTrigger(element:Element|ComponentPublicInstance|null,index:number){if(element instanceof HTMLButtonElement)triggers[index]=element}
function capture(){
  if(bookmark)return
  emit('beforeopen',nativePageId)
  const element=document.activeElement instanceof HTMLElement?document.activeElement:null
  bookmark={element};savedContextKey=props.contextKey;targetBookmark=props.captureTarget?.(nativePageId)??(nativePageId?{nativePageId}:undefined)
  if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement){if(element.selectionStart!==null&&element.selectionEnd!==null)bookmark.selection={start:element.selectionStart,end:element.selectionEnd,direction:element.selectionDirection}}
  else if(!props.captureTarget){const selection=window.getSelection();if(selection?.rangeCount)bookmark.range=selection.getRangeAt(0).cloneRange()}
}
function restoreFocus(){
  const native=nativePageId;nativePageId=undefined
  if(savedContextKey!==props.contextKey){bookmark=null;targetBookmark=undefined;return}
  if(props.restoreTarget){const restored=props.restoreTarget(targetBookmark);if(restored!==false){bookmark=null;return}}
  const saved=bookmark;bookmark=null
  if(native){requestAnimationFrame(()=>requestAnimationFrame(()=>{void window.navora?.browser.workspace.command(native,'focus').catch(()=>{})}));return}
  if(!saved?.element?.isConnected)return
  saved.element.focus({preventScroll:true})
  if(saved.selection&&(saved.element instanceof HTMLInputElement||saved.element instanceof HTMLTextAreaElement)){try{saved.element.setSelectionRange(saved.selection.start,saved.selection.end,saved.selection.direction||undefined)}catch{/* Unsupported input selection. */}}
  else if(saved.range?.startContainer.isConnected&&saved.range.endContainer.isConnected){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(saved.range)}
}
function clamp(){
  if(!panel.value||!opened.value)return
  const index=menus.value.findIndex(menu=>menu.id===opened.value),anchor=triggers[index]?.getBoundingClientRect(),bounds=panel.value.getBoundingClientRect(),pad=8
  const x=anchor?.left??8,y=anchor?.bottom??40
  position.value={x:Math.max(pad,Math.min(x,window.innerWidth-pad-bounds.width)),y:Math.max(pad,Math.min(y+3,window.innerHeight-pad-bounds.height))}
}
function enabledButtons(){return [...panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]]}
function modalActive(){return hasVisibleUi('.v-dialog.v-overlay--active')}
async function openMenu(id:AppMenuId,focus=true){
  if(props.nativeMenu||modalActive()||!menus.value.some(menu=>menu.id===id))return
  const generation=++nativeGeneration
  capture();await native.ready();if(disposed||generation!==nativeGeneration)return
  keyboardMode.value=true;focused.value=menus.value.findIndex(menu=>menu.id===id)
  if(native.menusSupported.value){
    nativeOpen.value=true;opened.value=id;await nextTick()
    if(disposed||generation!==nativeGeneration)return
    const anchor=triggers[focused.value]||bar.value,contextKey=props.contextKey,items:NativeMenuItem[]=[]
    for(const command of entries.value){const previous=items.at(-1);if(previous){const previousCommand=commands.value.find(item=>item.id===previous.id);if(previousCommand&&previousCommand.group!==command.group)items.push({id:`separator-${command.id}`,label:'',type:'separator'})}items.push({id:command.id,label:command.state.label||command.label,enabled:command.state.enabled&&!busy.value,...(command.state.checked===undefined?{}:{type:'checkbox',checked:command.state.checked}),reason:!shortcutPreferences.enabled(command.id)?'此快捷键已关闭；仍可点击菜单使用':command.state.reason,shortcut:command.shortcut?.replace('Mod','CommandOrControl')})}
    try{
      const result=await native.popupMenu(items,anchor||{x:8,y:40,width:0,height:0},{contextKey:contextKey||chromeId,placement:'bottom-start'})
      if(disposed||generation!==nativeGeneration||contextKey!==props.contextKey)return
      nativeOpen.value=false
      if(!result.supported){requestBrowserChromeOpen(chromeId);await nextTick();clamp();if(focus)enabledButtons()[0]?.focus({preventScroll:true});return}
      if(result.selectedId&&commands.value.some(command=>command.id===result.selectedId&&command.menu===id&&command.state.enabled))await run(result.selectedId as AppCommandId)
      else if(result.reason===undefined||result.reason==='dismissed')close()
      else{close(false);bookmark=null;targetBookmark=undefined;nativePageId=undefined}
    }catch{if(!disposed&&generation===nativeGeneration){nativeOpen.value=false;requestBrowserChromeOpen(chromeId);await nextTick();clamp();if(focus)enabledButtons()[0]?.focus({preventScroll:true})}}
    return
  }
  requestBrowserChromeOpen(chromeId);opened.value=id
  await nextTick();clamp();if(focus)enabledButtons()[0]?.focus({preventScroll:true})
}
function toggle(id:AppMenuId){if(opened.value===id)close();else void openMenu(id)}
function close(restore=true){nativeGeneration++;if(nativeOpen.value){nativeOpen.value=false;void native.closeMenu()}opened.value=null;keyboardMode.value=false;if(restore)void nextTick(restoreFocus)}
async function focusMenu(){
  if(props.nativeMenu||modalActive()||!menus.value.length)return
  capture();keyboardMode.value=true;focused.value=Math.min(focused.value,menus.value.length-1)
  await nextTick();triggers[focused.value]?.focus({preventScroll:true})
}
async function run(id:AppCommandId){
  const command=commands.value.find(item=>item.id===id)
  if(!command?.state.enabled||busy.value)return
  if(savedContextKey!==props.contextKey){close(false);bookmark=null;emit('error','当前内容已切换，请重新打开菜单。');return}
  const context:AppCommandContext={contextKey:savedContextKey,target:targetBookmark,menu:command.menu,source:'menu',...(nativePageId?{nativePageId}:{})}
  close(false);await nextTick()
  const destination=id==='help.about'||id==='app.settings'
  const localBuiltin=builtins.has(id)&&!props.handlers?.[id]&&!(hasCommandListener()&&Object.prototype.hasOwnProperty.call(props.commandState,id))&&id!=='help.about'
  if(!destination&&!localBuiltin)restoreFocus()
  else if(destination){bookmark=null;targetBookmark=undefined;nativePageId=undefined}
  if(context.contextKey!==props.contextKey){emit('error','当前内容已切换，请重新打开菜单。');return}
  const handler=props.handlers?.[id]
  try{
    busy.value=true
    if(handler)await handler(context)
    else if(hasCommandListener()&&Object.prototype.hasOwnProperty.call(props.commandState,id))emit('command',id,context)
    else if(id==='help.about'){
      const result=await window.navora?.app.openSettings('about')
      if(!result?.ok)throw Error(result?.error||'无法打开关于，请再次选择此菜单重试。')
    }
    else if(builtins.has(id)){localHelp.value=id;localDialog.value=true}
  }catch(error){emit('error',error instanceof Error?error.message:'操作未完成，请重试。')}
  finally{busy.value=false}
}
function toggleShortcuts(){
  if(localDialog.value){if(localHelp.value==='help.shortcuts')localDialog.value=false;return}
  if(modalActive())return
  capture();requestBrowserChromeOpen(chromeId);close(false);localHelp.value='help.shortcuts';localDialog.value=true
}
async function runShortcut(id:AppCommandId,pageId?:string){
  if(id==='help.shortcuts'){if(!localDialog.value&&modalActive())return;if(!localDialog.value)nativePageId=pageId;toggleShortcuts();return}
  if(!isConfigurableAppShortcut(id)||!props.shortcutsActive||modalActive()||hasVisibleUi('.v-menu.v-overlay--active,.sidebar-ctx-panel:not([data-browser-tab-preview])'))return
  if(!shortcutPreferences.available.value||!shortcutPreferences.enabled(id))return
  const command=commands.value.find(command=>command.id===id)
  if(!command?.state.enabled||busy.value)return
  nativePageId=pageId;capture()
  const context:AppCommandContext={contextKey:props.contextKey,target:targetBookmark,menu:command.menu,source:'shortcut',...(pageId?{nativePageId:pageId}:{})}
  try{busy.value=true;const handler=props.handlers?.[id];if(handler)await handler(context);else emit('command',id,context)}catch(error){emit('error',error instanceof Error?error.message:'操作未完成，请重试。')}
  finally{busy.value=false;bookmark=null;targetBookmark=undefined;nativePageId=undefined}
}
function switchMenu(direction:number,open:boolean){const count=menus.value.length;if(!count)return;focused.value=(focused.value+direction+count)%count;const menu=menus.value[focused.value]!;if(open)void openMenu(menu.id);else triggers[focused.value]?.focus({preventScroll:true})}
function barKey(event:KeyboardEvent){
  if(event.isComposing)return
  if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Home'||event.key==='End'){focused.value=event.key==='Home'?0:menus.value.length-1;triggers[focused.value]?.focus()}else switchMenu(event.key==='ArrowRight'?1:-1,false)}
  else if(['ArrowDown','Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();const menu=menus.value[focused.value];if(menu)void openMenu(menu.id)}
  else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}
}
function panelKey(event:KeyboardEvent){
  if(event.isComposing)return
  if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();event.stopPropagation();close();return}
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();switchMenu(event.key==='ArrowRight'?1:-1,true);return}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
  event.preventDefault();event.stopPropagation();const buttons=enabledButtons();if(!buttons.length)return
  const at=buttons.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:at<0?0:(at+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length
  buttons[next]?.focus({preventScroll:true})
}
function keydown(event:KeyboardEvent){
  if(props.nativeMenu||event.isComposing||event.keyCode===229||event.repeat)return
  const shortcut=appShortcutCommand({key:event.key,code:event.code,control:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,alt:event.altKey})
  if(shortcut){
    if(shortcut==='help.shortcuts'&&(localDialog.value&&localHelp.value==='help.shortcuts'||!modalActive())||shortcut!=='help.shortcuts'&&props.shortcutsActive&&(props.mode==='main'||props.mode==='compact')&&!modalActive()){
      event.preventDefault();event.stopImmediatePropagation();void runShortcut(shortcut);return
    }
  }
  if(modalActive()){altOnly=false;return}
  if(event.key==='Alt'&&!event.ctrlKey&&!event.metaKey){altOnly=true;return}
  if(event.key!=='Alt')altOnly=false
  if(event.key==='F10'&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();event.stopImmediatePropagation();if(opened.value||keyboardMode.value)close();else void focusMenu();return}
  if(event.altKey&&!event.ctrlKey&&!event.metaKey){const menu=menus.value.find(item=>item.accessKey===event.key.toLowerCase());if(menu){event.preventDefault();event.stopImmediatePropagation();void openMenu(menu.id)}}
  else if(opened.value&&['Escape','Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){panelKey(event);event.stopImmediatePropagation()}
}
function keyup(event:KeyboardEvent){if(event.key!=='Alt'||!altOnly||props.nativeMenu)return;altOnly=false;if(modalActive())return;event.preventDefault();event.stopImmediatePropagation();if(opened.value||keyboardMode.value)close();else void focusMenu()}
function otherChrome(event:Event){if((event as CustomEvent<string>).detail!==chromeId){close(false);bookmark=null;targetBookmark=undefined;nativePageId=undefined}}
function otherNative(){if(!nativeOpen.value){nativeGeneration++;opened.value=null;keyboardMode.value=false;bookmark=null;targetBookmark=undefined;nativePageId=undefined}}
function outside(event:PointerEvent){if(!opened.value||bar.value?.contains(event.target as Node)||panel.value?.contains(event.target as Node))return;event.preventDefault();event.stopImmediatePropagation();close()}
watch(opened,async value=>{emit('open',!!value);if(value){await nextTick();if(disposed)return;resizeObserver||=new ResizeObserver(clamp);if(panel.value)resizeObserver.observe(panel.value)}else resizeObserver?.disconnect()})
watch(()=>props.contextKey,()=>{close(false);bookmark=null;targetBookmark=undefined;nativePageId=undefined})
// Capturing a page's edit state is asynchronous. An edit-menu update must not
// dismiss a different menu that the user has just opened.
watch(()=>Object.fromEntries(appMenus.map(menu=>[menu.id,JSON.stringify(commands.value.filter(command=>command.menu===menu.id).map(command=>({id:command.id,state:command.state})))])),(next,previous)=>{
  const id=opened.value
  if(nativeOpen.value&&id&&next[id]!==previous[id]){close(false);bookmark=null;targetBookmark=undefined;nativePageId=undefined}
})
async function nativeMenu(payload:{menu?:AppMenuId;pageId:string;command?:AppCommandId}){
  if(payload.command){
    const state=await window.navora?.browser.workspace.state().catch(()=>null)
    const page=state?.pages.flatMap(session=>session.windows).find(page=>page.windowId===payload.pageId)
    if(disposed||!page?.hostActive)return
    void runShortcut(payload.command,payload.pageId);return
  }
  nativePageId=payload.pageId;if(payload.menu)void openMenu(payload.menu);else void focusMenu()
}
onMounted(()=>{void native.ready();window.addEventListener('keydown',keydown,true);window.addEventListener('keyup',keyup,true);window.addEventListener('resize',clamp);window.addEventListener('pointerdown',outside,true);window.addEventListener(BROWSER_CHROME_OPEN,otherChrome);window.addEventListener(NATIVE_UI_OPEN,otherNative);nativeUnsub=window.navora?.browser.workspace.onApplicationMenu?.(nativeMenu)})
onBeforeUnmount(()=>{disposed=true;close(false);resizeObserver?.disconnect();nativeUnsub?.();window.removeEventListener('keydown',keydown,true);window.removeEventListener('keyup',keyup,true);window.removeEventListener('resize',clamp);window.removeEventListener('pointerdown',outside,true);window.removeEventListener(BROWSER_CHROME_OPEN,otherChrome);window.removeEventListener(NATIVE_UI_OPEN,otherNative)})
defineExpose({openMenu,focusMenu,close,restoreFocus,toggleShortcuts})
</script>
<style scoped>
.application-menu-bar{display:flex;align-items:center;gap:2px;min-width:0;height:32px;flex:0 0 auto;-webkit-app-region:no-drag;user-select:none}
.application-menu-trigger{height:28px;padding:0 10px;min-width:42px;border:0;border-radius:6px;background:transparent;color:var(--navora-ink);font:inherit;font-size:13px;cursor:default;-webkit-app-region:no-drag}
.application-menu-trigger:is(:hover,.selected){background:var(--control-hover,var(--navora-hover));color:var(--navora-ink)}
.application-menu-trigger:focus-visible,.application-menu-command:focus-visible{outline:2px solid var(--navora-accent);outline-offset:-2px}
.application-menu-bar.transient{position:fixed;top:4px;left:8px;z-index:12002;padding:0 4px;border:1px solid var(--navora-stroke);border-radius:7px;background:var(--navora-chrome)}
.application-menu-panel{position:fixed;z-index:12001;min-width:260px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);padding:6px;overflow:auto;overscroll-behavior:contain;border:1px solid var(--navora-stroke);border-radius:12px;background:var(--navora-surface);color:var(--navora-ink);-webkit-app-region:no-drag}
.application-menu-command{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:7px 10px 7px 5px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:default}
.application-menu-command:hover:not(:disabled){background:var(--control-hover,var(--navora-hover))}.application-menu-command:disabled{color:var(--navora-muted);opacity:.55}.application-menu-command.danger:not(:disabled){color:var(--control-danger,#ad3341)}
.application-menu-check{flex:0 0 16px;width:16px;text-align:center;color:var(--navora-accent)}.application-menu-label{flex:1}.application-menu-command kbd{margin-left:20px;color:var(--navora-muted);font:inherit;font-size:11px;white-space:nowrap}.application-menu-separator{height:1px;margin:5px 8px;background:var(--navora-stroke)}
.application-menu-command kbd.shortcut-off{text-decoration:line-through;opacity:.5}
.application-help-content{max-height:calc(100dvh - 48px);overflow:auto;overscroll-behavior:contain;background:var(--navora-surface);color:var(--navora-ink);padding:20px 24px;border:1px solid var(--navora-stroke);border-radius:12px}.application-help-content header{display:flex;align-items:center;justify-content:space-between;gap:16px}.application-help-content h2{margin:0;font-size:18px}.application-help-content p,.application-help-content li{font-size:14px;line-height:1.8}.application-help-content ol{padding-left:22px}.application-help-content footer{display:flex;justify-content:flex-end;padding-top:16px}.application-about-name{font-weight:600}.application-about-name span{margin-left:8px;color:var(--navora-muted);font-size:13px}.application-shortcuts{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px 20px;font-size:13px}.application-shortcuts dt,.application-shortcuts dd{margin:0;overflow-wrap:anywhere}.application-shortcuts dd{color:var(--navora-muted);text-align:right}.application-shortcut-section+.application-shortcut-section{margin-top:20px;padding-top:18px;border-top:1px solid var(--navora-stroke)}.application-shortcut-section h3{margin:0 0 10px;font-size:14px}.application-shortcut-section p{margin:0 0 12px;color:var(--navora-muted);font-size:13px}.application-shortcut-notes{margin:14px 0 0;padding-left:18px}.application-shortcut-notes li{color:var(--navora-muted);font-size:12px}
@media(max-width:640px){.application-menu-trigger{min-width:36px;padding:0 7px}.application-menu-bar{gap:0}}
</style>
