<template>
  <button ref="trigger" type="button" data-browser-agent-control data-ctx-menu class="browser-agent-trigger" :class="{'is-allowed':state?.owner==='ai','is-working':feedback && model.working,'has-warning':model.fault || state?.activity==='error'}" :aria-label="`Agent：${model.title}。${switchLabel}`" aria-description="右键或按向下键查看状态" :title="native.error.value ? '面板不可用，请重试' : `${switchLabel}；右键查看状态`" :aria-pressed="state?.owner==='ai'" aria-haspopup="dialog" :aria-expanded="open || native.open.value" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="cancelLongPress" @pointercancel="cancelLongPress" @click.stop="click" @contextmenu.stop.prevent="show()" @keydown="triggerKey">
    <AppIcon icon="robot" class="browser-agent-main-icon" />
    <span v-if="indicatorKind" class="browser-agent-status" :class="`is-${indicatorKind}`"><AppIcon v-if="indicatorKind!=='working'" class="browser-agent-status-icon" :icon="indicatorIcon" :spin="indicatorKind==='busy'&&model.spinning" /></span>
  </button>
  <Teleport to="body">
    <section v-if="open" ref="panel" data-browser-agent-panel :data-agent-status="model.status" data-browser-chrome-overlay data-ctx-menu class="sidebar-ctx-panel browser-agent-panel" role="dialog" aria-label="Agent控制面板" :aria-labelledby="headingId" tabindex="-1" :style="position" @pointerdown.stop @contextmenu.prevent @keydown="panelKey">
      <header><strong :id="headingId">Agent</strong><button type="button" data-agent-action="settings" class="browser-agent-settings" aria-label="自动化设置" @click="hide();emit('settings')"><AppIcon icon="sliders" />设置</button><button type="button" class="ui-icon-button" aria-label="关闭 Agent 面板" title="关闭" @click="hide(true)"><AppIcon icon="xmark" /></button></header>
      <p class="browser-agent-page" :title="url">{{ pageTitle || hostLabel || '当前网页' }}</p>
      <div class="browser-agent-state" :class="{'is-warning':model.fault||model.overdue}"><AppIcon :icon="indicatorIcon" :spin="indicatorKind==='busy'&&model.spinning" /><strong>{{ model.title }}</strong></div>
      <p v-if="state?.label && model.working" class="browser-agent-task">{{ state.label }}</p>
      <p class="browser-agent-hint">{{ selecting?'允许 AI 前会退出批注选择。':model.hint }}</p>
      <dl v-if="model.showNativeStatus"><div><dt>输入保护</dt><dd>{{ model.protectionText }}</dd></div><div><dt>光标</dt><dd>{{ model.cursorText }}</dd></div></dl>
      <p v-if="notice" class="browser-agent-operation-notice">{{ notice }}</p>
      <div class="browser-agent-actions">
        <button type="button" data-agent-action="primary" class="browser-agent-action primary" :disabled="!(model.fault?model.recoveryAction:model.switchAction) || selectionBusy" @click="perform(model.fault?model.recoveryAction:model.switchAction)"><AppIcon :icon="model.fault?(model.reload?'arrow-rotate-right':'arrow-right'):primaryIcon" />{{ model.primaryLabel }}</button>
        <button v-if="state?.owner==='ai' && !model.fault" type="button" data-agent-action="pause" class="browser-agent-action secondary" aria-label="暂停本页 AI 操作" :disabled="model.busy || selectionBusy || !pageId" @click="perform('pause')"><AppIcon icon="pause-circle" />暂停</button>
      </div>
    </section>
  </Teleport>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import AppIcon from './icons/AppIcon.vue'
import {browserAgentControl,type BrowserAgentAction} from '@shared/browser-agent-control'
import type {BrowserAutomationConfig,BrowserAutomationState} from '@shared/browser-automation'
import {BROWSER_CHROME_OPEN,requestBrowserChromeOpen} from '@shared/browser-chrome-events'
import {NATIVE_UI_OPEN} from '@shared/native-ui'
import {browserAgentNativePanel} from '@shared/browser-native-panels'
import {useNativePanel} from '@/composables/useNativeUi'
import {useSafeBrowserPopup} from '@/utils/browser-popup-placement'
const props=withDefaults(defineProps<{pageId:string;pageTitle?:string;url?:string;active:boolean;state?:BrowserAutomationState;pending?:boolean|BrowserAgentAction;selectionBusy?:boolean;selecting?:boolean;feedback?:boolean;settings?:BrowserAutomationConfig;notice?:string}>(),{feedback:true})
const emit=defineEmits<{command:[action:BrowserAgentAction];open:[value:boolean];domOpen:[value:boolean];settings:[]}>()
const trigger=ref<HTMLButtonElement>(),panel=ref<HTMLElement>(),open=ref(false),position=ref<Record<string,string>>({})
useSafeBrowserPopup(()=>open.value?panel.value:null,()=>hide(true))
const identity=`agent-${crypto.randomUUID()}`,headingId=`${identity}-heading`
const model=computed(()=>browserAgentControl(props.state,props.pending))
const nativePresentation=computed(()=>browserAgentNativePanel(props))
const native=useNativePanel({key:identity,sourcePageId:()=>props.pageId,contextKey:()=>`${props.pageId}:${props.active}`,onAction:action=>{
  if(action.type!=='click'||!props.active||disposed)return
  const command=nativePresentation.value.actions.get(action.id)
  if(command==='settings'){hide();emit('settings')}else perform(command)
}})
const switchLabel=computed(()=>model.value.fault?'查看恢复操作':model.value.busy?'等待控制确认':model.value.primaryLabel)
const indicatorKind=computed(()=>model.value.blocked||model.value.fault||model.value.overdue||props.state?.activity==='error'?'warning':model.value.busy||model.value.spinning?'busy':props.state?.owner==='paused'?'paused':props.feedback&&model.value.working?'working':'')
const indicatorIcon=computed(()=>indicatorKind.value==='warning'?'triangle-exclamation':indicatorKind.value==='busy'?'circle-notch':indicatorKind.value==='paused'?'pause-circle':'robot')
const primaryIcon=computed(()=>props.state?.owner==='ai'?'cursor':'robot')
const hostLabel=computed(()=>{try{return new URL(props.url||'').host}catch{return ''}})
let pressTimer:ReturnType<typeof setTimeout>|undefined,suppressClickUntil=0,touchStart:{x:number;y:number}|undefined,disposed=false,displayGeneration=0
function positionPanel(){const r=trigger.value?.getBoundingClientRect();if(!r)return;const width=Math.min(300,innerWidth-16),height=Math.min(panel.value?.offsetHeight||240,innerHeight-16);position.value={width:`${width}px`,left:`${Math.max(8,Math.min(r.right-width,innerWidth-width-8))}px`,top:`${Math.max(8,Math.min(r.bottom+7,innerHeight-height-8))}px`,maxHeight:`${innerHeight-16}px`}}
async function show(){cancelLongPress();if(disposed||!props.active)return;const composing=document.activeElement instanceof HTMLElement&&document.activeElement.dataset.browserAddressComposing==='true',pageId=props.pageId,generation=++displayGeneration;requestBrowserChromeOpen(identity);const shown=trigger.value&&await native.show(nativePresentation.value.content,trigger.value,{placement:'bottom-end'}).catch(()=>false);if(disposed||!props.active||props.pageId!==pageId||generation!==displayGeneration){void native.hide();return}if(shown||native.supported.value)return;open.value=true;await nextTick();if(!open.value||disposed||!props.active||props.pageId!==pageId||generation!==displayGeneration)return;positionPanel();if(!composing)panel.value?.focus({preventScroll:true})}
function hide(focus=false){const wasOpen=open.value,generation=++displayGeneration,pageId=props.pageId;open.value=false;void native.hide();suppressClickUntil=0;cancelLongPress();if(focus&&wasOpen&&props.active&&!disposed)void nextTick(()=>{if(!disposed&&props.active&&props.pageId===pageId&&generation===displayGeneration&&!open.value)trigger.value?.focus({preventScroll:true})})}
function perform(action?:BrowserAgentAction){if(!action||!props.pageId||!props.active||props.selectionBusy||model.value.busy)return;emit('command',action)}
function click(){if(performance.now()<suppressClickUntil)return;if(model.value.fault){void show();return}perform(model.value.switchAction)}
function triggerKey(event:KeyboardEvent){if(event.isComposing||event.repeat&&(event.key==='Enter'||event.key===' ')){event.preventDefault();return}if(event.key==='ArrowDown'||event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();void show()}else if(event.key==='Escape'&&open.value){event.preventDefault();event.stopPropagation();hide(true)}}
function panelKey(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide(true)}else if(event.key==='Tab'){const nodes=[...panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]];if(!nodes.length)return;const first=nodes[0]!,last=nodes.at(-1)!;if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.value)){event.preventDefault();last.focus()}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel.value)){event.preventDefault();first.focus()}}}
function cancelLongPress(){clearTimeout(pressTimer);pressTimer=undefined;touchStart=undefined}
function pointerDown(event:PointerEvent){if(event.pointerType!=='touch'){event.preventDefault();return}touchStart={x:event.clientX,y:event.clientY};pressTimer=setTimeout(()=>{suppressClickUntil=performance.now()+800;void show();suppressClickUntil=performance.now()+800},500)}
function pointerMove(event:PointerEvent){if(touchStart&&Math.hypot(event.clientX-touchStart.x,event.clientY-touchStart.y)>8)cancelLongPress()}
function outside(event:PointerEvent){if(open.value&&!panel.value?.contains(event.target as Node)&&!trigger.value?.contains(event.target as Node))hide()}
function otherChrome(event:Event){if((event as CustomEvent<string>).detail!==identity)hide()}
function nativeChrome(event:Event){if((event as CustomEvent<{id:string}>).detail?.id===native.id)open.value=false;else hide()}
watch([open,native.open],([dom,value])=>{emit('open',dom||value);emit('domOpen',dom)},{flush:'sync'})
watch(nativePresentation,value=>{if(native.open.value)void native.update(value.content)})
watch(()=>[props.active,props.pageId],()=>{hide()})
onMounted(()=>{document.addEventListener('pointerdown',outside,true);window.addEventListener(BROWSER_CHROME_OPEN,otherChrome);window.addEventListener(NATIVE_UI_OPEN,nativeChrome);window.addEventListener('resize',positionPanel)})
onBeforeUnmount(()=>{disposed=true;hide();document.removeEventListener('pointerdown',outside,true);window.removeEventListener(BROWSER_CHROME_OPEN,otherChrome);window.removeEventListener(NATIVE_UI_OPEN,nativeChrome);window.removeEventListener('resize',positionPanel)})
defineExpose({show,hide})
</script>
<style scoped>
.browser-agent-trigger{position:relative;display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--navora-muted);cursor:default;-webkit-app-region:no-drag;touch-action:manipulation}
.browser-agent-trigger>.browser-agent-main-icon{width:var(--browser-agent-icon-size,20px);height:var(--browser-agent-icon-size,20px)}
.browser-agent-trigger.is-allowed{color:var(--navora-accent);background:var(--control-selected)}
.browser-agent-trigger:hover{background:var(--control-hover);color:var(--navora-ink)}
.browser-agent-trigger:focus-visible{outline:2px solid var(--control-focus,var(--navora-accent));outline-offset:-1px}
.browser-agent-status{position:absolute;display:grid;place-items:center;right:0;bottom:0;width:12px;height:12px;border:1px solid var(--navora-surface);border-radius:5px;background:var(--navora-surface);color:var(--navora-muted);pointer-events:none}
.browser-agent-status>.browser-agent-status-icon{display:block;width:10px;height:10px;vertical-align:0}
.browser-agent-status.is-warning{color:var(--control-danger)}
.browser-agent-status.is-working{right:1px;bottom:1px;width:6px;height:6px;border-radius:50%;background:var(--navora-accent)}
.browser-agent-panel{position:fixed;z-index:12010;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--navora-stroke);border-radius:10px;background:var(--navora-surface);color:var(--navora-ink);font-size:12px;text-align:left;-webkit-app-region:no-drag;box-shadow:0 6px 18px color-mix(in srgb,var(--navora-ink) 10%,transparent)}
.browser-agent-panel:focus{outline:none}
.browser-agent-panel header{display:flex;align-items:center;gap:6px}
.browser-agent-panel header strong{flex:1;font-size:12px;font-weight:600}
.browser-agent-settings{display:flex;align-items:center;gap:5px;height:28px;padding:0 7px;border:0;border-radius:6px;background:transparent;color:var(--navora-muted);font:inherit;font-size:11px}
.browser-agent-settings .app-icon{width:14px;height:14px}
.browser-agent-settings:hover{background:var(--control-hover);color:var(--navora-ink)}
.browser-agent-panel header>.ui-icon-button{width:24px;height:24px;min-height:24px}
.browser-agent-panel header>.ui-icon-button .app-icon{width:14px;height:14px}
.browser-agent-page{margin:0;color:var(--navora-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.browser-agent-state{display:flex;align-items:center;gap:7px}
.browser-agent-state>.app-icon{width:16px;height:16px;color:var(--navora-accent)}
.browser-agent-state.is-warning>.app-icon{color:var(--control-danger)}
.browser-agent-state strong{font-size:13px;font-weight:600}
.browser-agent-hint,.browser-agent-task{margin:0;color:var(--navora-muted);font-size:12px;line-height:1.6;overflow-wrap:anywhere}
.browser-agent-task{color:var(--navora-ink)}
.browser-agent-panel dl{display:flex;gap:12px;margin:0;font-size:11px;color:var(--navora-muted)}
.browser-agent-panel dl>div{display:flex;gap:5px;min-width:0}
.browser-agent-panel dd{margin:0;color:var(--navora-ink)}
.browser-agent-actions{display:flex;gap:6px;padding-top:2px}
.browser-agent-action{display:flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:6px 10px;border:1px solid transparent;border-radius:6px;color:var(--navora-ink);background:transparent;font:inherit;cursor:default}
.browser-agent-action>.app-icon{width:15px;height:15px}
.browser-agent-action.primary{flex:1;color:var(--navora-accent);background:var(--control-selected);border-color:color-mix(in srgb,var(--navora-accent) 24%,var(--navora-stroke));font-weight:600}
.browser-agent-action.secondary{color:var(--navora-muted)}
.browser-agent-action:hover:not(:disabled){background:var(--control-hover)}
.browser-agent-action:focus-visible,.browser-agent-settings:focus-visible{outline:2px solid var(--control-focus,var(--navora-accent));outline-offset:-1px}
.browser-agent-action:disabled{opacity:.5}
.browser-agent-operation-notice{margin:0;padding:7px;border-radius:6px;background:var(--navora-background);color:var(--navora-muted);font-size:11px;line-height:1.5;overflow-wrap:anywhere}
@media(pointer:coarse){.browser-agent-trigger::before{content:'';position:absolute;inset:-4px 0}.browser-agent-action,.browser-agent-settings{min-height:44px}}
</style>
