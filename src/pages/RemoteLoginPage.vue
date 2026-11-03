<template>
  <div class="login-page">
    <form class="card" @submit.prevent="submit">
      <span class="login-mark"><AppIcon icon="globe" /></span>
      <h1>Navora 远程访问</h1>
      <p class="sub">登录后查看对话、管理设置与操控浏览器页面。</p>
      <v-text-field
        v-model="username"
        label="用户名"
        variant="outlined"
        density="comfortable"
        autocomplete="username"
        hide-details="auto"
        class="mt-4"
      />
      <v-text-field
        v-model="password"
        label="密码"
        type="password"
        variant="outlined"
        density="comfortable"
        autocomplete="current-password"
        hide-details="auto"
        class="mt-3"
      />
      <v-alert v-if="error" type="error" density="compact" class="mt-3" variant="tonal">
        {{ error }}
      </v-alert>
      <v-btn type="submit" color="primary" block class="mt-4 login-btn" :loading="loading">
        登录
      </v-btn>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getStoredToken, remoteAuthMe, remoteLogin } from '../remote-api'

const router = useRouter()
const route = useRoute()
const username = ref('admin')
const password = ref('')
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  const qToken = String(route.query.token || '')
  const token = qToken || getStoredToken()
  if (token && (await remoteAuthMe(token))) {
    const redirect = String(route.query.redirect || '/')
    await router.replace(redirect)
  }
})

async function submit() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await remoteLogin(username.value.trim(), password.value)
    if (!res.ok) {
      error.value = '用户名或密码错误'
      return
    }
    const redirect = String(route.query.redirect || '/')
    await router.replace(redirect)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  height:100dvh;
  min-height:0;
  overflow-y:auto;
  overscroll-behavior:contain;
  display:flex;
  flex-direction:column;
  align-items:center;
  padding:
    calc(24px + env(safe-area-inset-top, 0px))
    calc(20px + env(safe-area-inset-right, 0px))
    calc(24px + env(safe-area-inset-bottom, 0px))
    calc(20px + env(safe-area-inset-left, 0px));
  background:#f7f9fc;
  box-sizing: border-box;
}
.card {
  flex-shrink:0;
  margin-block:auto;
  box-sizing:border-box;
  width: min(400px, 100%);
  background: #fff;
  border: 1px solid #e0e6ee;
  border-radius: 12px;
  padding: 28px 24px;
  box-shadow:0 4px 20px #22395406;
}
h1 {
  margin: 0;
  font-size: 20px;
  color: #15202b;
}
.sub {
  margin: 8px 0 0;
  color: #5d6d7e;
  font-size: 12px;
  line-height: 1.7;
}
.login-btn {
  min-height: 44px;
}
.login-mark{display:grid;place-items:center;width:38px;height:38px;border:1px solid #e1e9f3;border-radius:10px;background:#edf3fa;color:#5b7da5;margin-bottom:18px}.login-mark svg{width:20px;height:20px}
@media(max-width:420px){.card{padding:22px 18px}.login-page{padding-inline:14px}h1{font-size:18px}}
</style>
