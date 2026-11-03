<template>
  <button ref="trigger" type="button" data-browser-agent-control data-ctx-menu class="browser-agent-trigger" :class="{'is-allowed':state?.owner==='ai','is-working':feedback && model.working,'has-warning':model.fault || state?.activity==='error'}" :aria-label="`Agent：${model.title}。${switchLabel}`" :title="native.error.value ? 'Agent 面板暂不可用，请重新打开' : `Agent · ${model.title}。左键：${switchLabel}；右键：打开面板`" :aria-pressed="state?.owner==='ai'" aria-haspopup="dialog" :aria-expanded="open || native.open.value" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="cancelLongPress" @pointercancel="cancelLongPress" @click.stop="click" @contextmenu.stop.prevent="show()" @keydown="triggerKey">
    <AppIcon icon="robot" />
    <AppIcon v-if="model.busy || state?.nativePending || model.fault || state?.activity==='error' || state?.owner==='paused'" class="browser-agent-indicator" :icon="indicatorIcon" :spin="model.busy || state?.nativePending" />
  </button>
  <Teleport to="body">
    <section v-if="open" ref="panel" data-browser-agent-panel data-browser-chrome-overlay data-ctx-menu class="sidebar-ctx-panel browser-agent-panel" role="dialog" aria-label="Agent控制面板" :aria-labelledby="headingId" tabindex="-1" :style="position" @pointerdown.stop @contextmenu.prevent @keydown="panelKey">
      <header><div><strong :id="headingId">Agent</strong><span :title="url">{{ pageTitle || '当前网页' }}<small v-if="hostLabel"> · {{ hostLabel }}</small></span></div><button type="button" class="ui-icon-button" aria-label="关闭 Agent 面板" title="关闭" @click="hide(true)"><AppIcon icon="xmark" /></button></header>
      <div class="browser-agent-state" :class="{'is-warning':model.fault}"><AppIcon :icon="indicatorIcon" :spin="model.busy" /><strong>{{ model.title }}</strong></div>
      <p v-if="state?.label && model.working" class="browser-agent-task">{{ state.label }}</p>
      <p class="browser-agent-hint">{{ selecting?'正在选择批注。恢复 AI 前会先退出选择。':model.hint }}</p>
      <dl><div><dt>网页输入保护</dt><dd>{{ state?.nativePending?'正在确认':!state || !state.nativeConfirmed?'尚未确认':state.inputProtected?'已启用':'未启用' }}</dd></div><div><dt>虚拟光标</dt><dd>{{ state?.cursorAvailable===false?'当前内核不支持':state?.cursorImageAvailable===false?'图像不可用':state?.cursorVisible?'图形已启用':state?.cursorEnabled?'图形已隐藏，输入保护中':'未启用' }}</dd></div><div v-if="settings"><dt>移动方式</dt><dd>{{ settings.smooth_pointer?(settings.pointer_profile==='precise'?'精确':'自然'):'直接移动' }} · {{ settings.speed_multiplier.toFixed(2) }} 倍</dd></div></dl>
      <p v-if="notice" class="browser-agent-operation-notice">{{ notice }}</p>
      <div class="browser-agent-actions">
        <button v-if="model.fault" type="button" class="browser-agent-action primary" :disabled="!model.recoveryAction || selectionBusy" @click="perform(model.recoveryAction)"><AppIcon :icon="model.reload?'arrow-rotate-right':'arrow-right'" />{{ model.reload?'重新加载页面':'重试解除控制' }}</button>
        <button v-else type="button" class="browser-agent-action primary" :disabled="!model.switchAction || selectionBusy" @click="perform(model.switchAction)"><AppIcon :icon="primaryIcon" />{{ model.busy?'正在交还…':!model.known?'正在读取状态…':state?.owner==='ai'?'我来操作':'允许新的 AI 操作' }}</button>
        <button v-if="state?.owner==='ai' && !model.fault" type="button" class="browser-agent-action" :disabled="model.busy || selectionBusy || !pageId" @click="perform('pause')"><AppIcon icon="pause-circle" />暂停本页 AI 操作</button>
        <button type="button" class="browser-agent-action" @click="hide();emit('settings')"><AppIcon icon="sliders" />自动化设置</button>
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
const props=withDefaults(defineProps<{pageId:string;pageTitle?:string;url?:string;active:boolean;state?:BrowserAutomationState;pending?:boolean;selectionBusy?:boolean;selecting?:boolean;feedback?:boolean;settings?:BrowserAutomationConfig;notice?:string}>(),{feedback:true})
const emit=defineEmits<{command:[action:BrowserAgentAction];open:[value:boolean];domOpen:[value:boolean];settings:[]}>()
const trigger=ref<HTMLButtonElement>(),panel=ref<HTMLElement>(),open=ref(false),position=ref<Record<string,string>>({})
const identity=`agent-${crypto.randomUUID()}`,headingId=`${identity}-heading`
const model=computed(()=>browserAgentControl(props.state,props.pending))
const nativePresentation=computed(()=>browserAgentNativePanel(props))
const native=useNativePanel({key:identity,sourcePageId:()=>props.pageId,contextKey:()=>`${props.pageId}:${props.active}`,onAction:action=>{
  if(action.type!=='click'||!props.active||disposed)return
  const command=nativePresentation.value.actions.get(action.id)
  if(command==='settings'){hide();emit('settings')}else perform(command)
}})
const switchLabel=computed(()=>model.value.fault?'查看恢复操作':model.value.busy?'正在交还，可右键查看详情':!model.value.known?'正在读取状态':props.state?.owner==='ai'?'切换为人工操作':'允许新的 AI 操作')
const indicatorIcon=computed(()=>model.value.busy||props.state?.nativePending?'circle-notch':model.value.fault||props.state?.activity==='error'?'triangle-exclamation':props.state?.owner==='paused'?'pause-circle':'robot')
const primaryIcon=computed(()=>props.state?.owner==='ai'?'cursor':'robot')
const hostLabel=computed(()=>{try{return new URL(props.url||'').host}catch{return ''}})
let pressTimer:ReturnType<typeof setTimeout>|undefined,suppressClickUntil=0,touchStart:{x:number;y:number}|undefined,disposed=false,displayGeneration=0
function positionPanel(){const r=trigger.value?.getBoundingClientRect();if(!r)return;const width=Math.min(316,innerWidth-16),height=Math.min(panel.value?.offsetHeight||380,innerHeight-16);position.value={width:`${width}px`,left:`${Math.max(8,Math.min(r.right-width,innerWidth-width-8))}px`,top:`${Math.max(8,Math.min(r.bottom+7,innerHeight-height-8))}px`,maxHeight:`${innerHeight-16}px`}}
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
.browser-agent-trigger>.app-icon{width:20px;height:20px}.browser-agent-trigger.is-allowed{color:var(--navora-accent);background:var(--control-selected)}.browser-agent-trigger:hover{background:var(--control-hover);color:var(--navora-ink)}.browser-agent-trigger:focus-visible{outline:2px solid var(--control-focus,var(--navora-accent));outline-offset:-1px}.browser-agent-trigger>.browser-agent-indicator{position:absolute;right:0;bottom:0;width:11px;height:11px;border-radius:4px;background:var(--navora-surface);color:var(--navora-muted)}.browser-agent-trigger.has-warning>.browser-agent-indicator{color:var(--control-danger)}.browser-agent-trigger.is-working:not(.has-warning)::after{content:'';position:absolute;right:2px;bottom:2px;width:4px;height:4px;border-radius:50%;background:var(--navora-accent)}
.browser-agent-panel{position:fixed;z-index:12010;box-sizing:border-box;overflow:auto;padding:13px;border:1px solid var(--navora-stroke);border-radius:12px;background:var(--navora-surface);color:var(--navora-ink);font-size:12px;text-align:left;-webkit-app-region:no-drag;box-shadow:0 8px 24px color-mix(in srgb,var(--navora-ink) 12%,transparent)}.browser-agent-panel:focus{outline:none}.browser-agent-panel header{display:flex;align-items:flex-start;gap:10px;justify-content:space-between;margin-bottom:15px}.browser-agent-panel header>div{display:grid;gap:5px;min-width:0}.browser-agent-panel header strong{font-size:14px;font-weight:600}.browser-agent-panel header span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:238px;color:var(--navora-muted);font-size:11px}.browser-agent-panel header small{font-size:inherit}.browser-agent-panel header>.ui-icon-button{width:26px;height:26px;min-height:26px}.browser-agent-panel header .app-icon{width:16px;height:16px}.browser-agent-state{display:flex;align-items:center;gap:7px}.browser-agent-state>.app-icon{width:16px;height:16px;color:var(--navora-accent)}.browser-agent-state.is-warning>.app-icon{color:var(--control-danger)}.browser-agent-state strong{font-size:12px;font-weight:550}.browser-agent-hint,.browser-agent-task{margin:8px 0 0;color:var(--navora-muted);font-size:12px;line-height:1.6;overflow-wrap:anywhere}.browser-agent-task{color:var(--navora-ink)}.browser-agent-panel dl{display:grid;gap:10px;margin:14px 0;padding:13px 0;border-block:1px solid var(--navora-stroke)}.browser-agent-panel dl>div{display:flex;gap:10px;justify-content:space-between}.browser-agent-panel dt{color:var(--navora-muted)}.browser-agent-panel dd{margin:0;text-align:right}.browser-agent-actions{display:grid;gap:3px}.browser-agent-action{display:flex;align-items:center;gap:9px;width:100%;padding:9px 8px;border:0;border-radius:7px;color:var(--navora-ink);background:transparent;text-align:left;font:inherit;cursor:default}.browser-agent-action>.app-icon{width:16px;height:16px}.browser-agent-action.primary{color:var(--navora-accent)}.browser-agent-action:hover:not(:disabled){background:var(--control-hover)}.browser-agent-action:focus-visible{outline:2px solid var(--control-focus,var(--navora-accent));outline-offset:-1px}.browser-agent-action:disabled{opacity:.5}.browser-agent-operation-notice{padding:9px;border-radius:6px;background:var(--navora-background);color:var(--navora-muted);font-size:11px;line-height:1.5;overflow-wrap:anywhere}
@media(pointer:coarse){.browser-agent-trigger::before{content:'';position:absolute;inset:-4px 0}}
</style>
