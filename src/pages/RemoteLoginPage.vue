<template>
  <div class="login-page">
    <div class="card">
      <h1>Navora 远程访问</h1>
      <p class="sub">登录后可使用 Chat、设置与 Agent 能力；浏览器窗口可通过远程画面查看与操控</p>
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
        @keyup.enter="submit"
      />
      <v-alert v-if="error" type="error" density="compact" class="mt-3" variant="tonal">
        {{ error }}
      </v-alert>
      <v-btn color="primary" block class="mt-4 login-btn" :loading="loading" @click="submit">
        登录
      </v-btn>
    </div>
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
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding:
    calc(24px + env(safe-area-inset-top, 0px))
    calc(20px + env(safe-area-inset-right, 0px))
    calc(24px + env(safe-area-inset-bottom, 0px))
    calc(20px + env(safe-area-inset-left, 0px));
  background:
    radial-gradient(900px 420px at 20% -10%, rgba(27, 79, 114, 0.12), transparent 55%),
    #eef2f5;
  box-sizing: border-box;
}
.card {
  width: min(400px, 100%);
  background: #fff;
  border: 1px solid #d9e2ea;
  border-radius: 14px;
  padding: 28px 24px;
  box-shadow: 0 10px 28px rgba(21, 32, 43, 0.08);
}
h1 {
  margin: 0;
  font-size: 1.35rem;
  color: #15202b;
}
.sub {
  margin: 8px 0 0;
  color: #5d6d7e;
  font-size: 0.9rem;
  line-height: 1.5;
}
.login-btn {
  min-height: 44px;
}
</style>
