<template>
  <v-app>
    <router-view v-slot="{ Component }">
      <keep-alive include="ChatPage">
        <component :is="Component" />
      </keep-alive>
    </router-view>
    <OnboardingWizard v-model="wizardOpen" :manual="wizardManual" />
    <StoreUiHost />
  </v-app>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import OnboardingWizard from './components/OnboardingWizard.vue'
import StoreUiHost from './components/store/StoreUiHost.vue'
import { useOnboarding } from './composables/useOnboarding'

const { open: wizardOpen, manual: wizardManual, show: showWizard } = useOnboarding()

onMounted(async () => {
  if (!window.navora) return
  try {
    const cfg = await window.navora.config.get()
    if (cfg.app?.onboarding_completed !== true) {
      showWizard({ manual: false })
    }
  } catch (e) {
    console.warn('[onboarding] check failed', e)
  }
})
</script>

<style>
html,
body,
#app {
  height: 100%;
  min-height: 100%;
  margin: 0;
}
@supports (height: 100dvh) {
  html,
  body,
  #app {
    min-height: 100dvh;
  }
}
html {
  /* 覆盖 Vuetify reset 的 overflow-y: scroll，仅在需要时显示滚动条 */
  overflow-y: auto;
  overflow-x: hidden;
}
body {
  overflow-x: hidden;
}
.v-application {
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.v-application,
.v-application__wrap {
  min-height: 100%;
}
@supports (height: 100dvh) {
  .v-application,
  .v-application__wrap {
    min-height: 100dvh;
  }
}

/* 选中高亮：贴合主色 */
::selection {
  background: rgba(27, 79, 114, 0.28);
  color: #15202b;
}
::-moz-selection {
  background: rgba(27, 79, 114, 0.28);
  color: #15202b;
}

/* 全局滚动条：细轨、圆角，贴合主色 #1b4f72 */
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(27, 79, 114, 0.35) transparent;
}
*::-webkit-scrollbar {
  width: 7px;
  height: 7px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background: rgba(27, 79, 114, 0.28);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
*::-webkit-scrollbar-thumb:hover {
  background: rgba(27, 79, 114, 0.48);
  border: 2px solid transparent;
  background-clip: padding-box;
}
*::-webkit-scrollbar-corner {
  background: transparent;
}

/* 深色侧栏：浅色半透明滑块 */
.sidebar,
.sidebar * {
  scrollbar-color: rgba(236, 240, 241, 0.28) transparent;
}
.sidebar::-webkit-scrollbar-thumb,
.sidebar *::-webkit-scrollbar-thumb {
  background: rgba(236, 240, 241, 0.22);
  border: 2px solid transparent;
  background-clip: padding-box;
}
.sidebar::-webkit-scrollbar-thumb:hover,
.sidebar *::-webkit-scrollbar-thumb:hover {
  background: rgba(236, 240, 241, 0.4);
  border: 2px solid transparent;
  background-clip: padding-box;
}

/* v-select 下拉菜单（teleport 到 body） */
.navora-select-menu {
  border-radius: 10px !important;
  border: 1px solid #d5dde5;
  box-shadow: 0 8px 24px rgba(21, 32, 43, 0.12) !important;
  overflow: hidden;
}
.navora-select-menu .v-list {
  padding: 6px !important;
  background: #fff;
}
.navora-select-menu .v-list-item {
  border-radius: 7px !important;
  min-height: 36px !important;
  margin: 1px 0;
  padding-inline: 10px !important;
  font-size: 0.875rem;
  color: #1b2834;
}
.navora-select-menu .v-list-item:hover {
  background: #eef3f7 !important;
}
.navora-select-menu .v-list-item--active {
  background: rgba(27, 79, 114, 0.1) !important;
  color: #1b4f72 !important;
  font-weight: 600;
}
.navora-select-menu .v-list-item-title {
  font-size: 0.875rem;
  letter-spacing: 0;
}
</style>
