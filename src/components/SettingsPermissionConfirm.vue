<template>
  <SkillDialogShell v-model="opened" title="切换为放手模式？" :max-width="460" content-class="settings-permission-confirm-overlay" aria-label="切换为放手模式确认" @after-enter="focusCancel" @keydown.esc.stop.prevent="confirmation.cancel()">
    <section class="settings-permission-confirm" data-settings-permission-confirm>
      <p class="permission-confirm-lead"><AppIcon icon="shield-halved" aria-hidden="true"/><span>Agent 将可直接修改文件、执行系统命令，并进行网络与浏览器操作，大多数操作不再逐次询问。</span></p>
      <p>用于新对话，以及仍继承默认设置的空对话。</p>
      <p class="permission-confirm-scope">已有消息的对话保留各自权限设置，不受此次切换影响。技能新增与修改仍会单独确认。</p>
      <p class="permission-confirm-scope">确认切换后自动保存。</p>
    </section>
    <template #actions><div class="permission-confirm-actions"><button id="settings-permission-keep" ref="cancelButton" type="button" class="ui-button" @click="confirmation.cancel()">保留当前设置</button><button id="settings-permission-switch" type="button" class="ui-button primary" @click="confirmation.decide(requestId,true)">切换为放手模式</button></div></template>
  </SkillDialogShell>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import {createSettingsPermissionConfirmation} from '@shared/settings-permission-confirm'
import SkillDialogShell from './skills/SkillDialogShell.vue'
import AppIcon from './icons/AppIcon.vue'
const props=withDefaults(defineProps<{active?:boolean}>(),{active:true})
const requestId=ref(''),cancelButton=ref<HTMLButtonElement>()
const confirmation=createSettingsPermissionConfirmation(id=>{requestId.value=id})
const opened=computed({get:()=>!!requestId.value,set:value=>{if(!value)confirmation.cancel()}})
async function focusCancel(){await nextTick();if(opened.value&&props.active)cancelButton.value?.focus({preventScroll:true})}
function ask(){return props.active?confirmation.ask():Promise.resolve(false)}
watch(()=>props.active,value=>{if(!value)confirmation.cancel()})
onBeforeUnmount(()=>confirmation.cancel())
defineExpose({ask,get pending(){return opened.value}})
</script>
<style>
.settings-permission-confirm-overlay .skill-dlg-card,.settings-permission-confirm-overlay .skill-dlg-head,.settings-permission-confirm-overlay .skill-dlg-actions{background:var(--navora-surface)!important;color:var(--navora-ink);border-color:var(--navora-stroke)!important}
.settings-permission-confirm-overlay .skill-dlg-title{color:var(--navora-ink)}
.settings-permission-confirm-overlay .skill-dlg-close{color:var(--navora-muted);background:transparent;border-color:var(--navora-stroke)}
.settings-permission-confirm-overlay .skill-dlg-close:hover{color:var(--navora-ink);background:var(--control-hover)}
.settings-permission-confirm p{margin:0 0 14px;color:var(--navora-ink);font-size:13px;line-height:1.75}
.settings-permission-confirm p:last-child{margin-bottom:0}
.settings-permission-confirm .permission-confirm-lead{display:flex;align-items:flex-start;gap:10px}
.permission-confirm-lead>.app-icon{width:20px;height:20px;flex:0 0 20px;margin-top:2px;color:var(--navora-accent)}
.settings-permission-confirm .permission-confirm-scope{color:var(--navora-muted);font-size:12px}
.permission-confirm-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;width:100%}
.permission-confirm-actions .ui-button{min-height:34px;padding:6px 12px}
</style>
