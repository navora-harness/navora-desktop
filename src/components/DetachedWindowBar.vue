<template>
  <header class="detached-window-bar" :class="{'platform-mac':platform==='darwin','platform-win':platform==='win32'}">
    <slot />
    <div class="detached-caption-space" aria-hidden="true" />
  </header>
</template>
<script setup lang="ts">
const platform=window.navora?.app.platform
</script>
<style>
.detached-window-bar{display:flex;align-items:center;gap:5px;height:44px;min-height:44px;flex-shrink:0;padding:4px 0 4px 8px;border-bottom:1px solid var(--navora-stroke);background:var(--navora-chrome,var(--navora-background));-webkit-app-region:drag;user-select:none}
.detached-window-bar.platform-mac{padding-left:80px;padding-right:8px}
.detached-window-bar.platform-win{--detached-caption-width:max(138px,calc(100vw - env(titlebar-area-x,0px) - env(titlebar-area-width,calc(100vw - 138px))));padding-right:calc(var(--detached-caption-width) + 46px)}
.detached-window-bar [role=tablist]{-webkit-app-region:drag}
.detached-window-bar :is(button,[role=tab],.workspace-tab-item){-webkit-app-region:no-drag;pointer-events:auto}
.detached-caption-space{min-width:36px;align-self:stretch;flex:0 0 36px}
.detached-window-bar.platform-win .detached-caption-space{display:none}
</style>
