import { createRouter, createWebHashHistory } from 'vue-router'
import ChatPage from './pages/ChatPage.vue'
import RemoteLoginPage from './pages/RemoteLoginPage.vue'
import RemoteBridgePage from './pages/RemoteBridgePage.vue'
import RemoteHomePage from './pages/RemoteHomePage.vue'
import { ensureRemoteNavora } from './navora-remote-shim'
import { getStoredToken, isWebRemote, remoteAuthMe, setStoredToken } from './remote-api'

const desktopRoutes = [
  { path: '/', name: 'chat', component: ChatPage },
  { path: '/settings', redirect: { path: '/', query: { settings: '1' } } },
]

const remoteExtraRoutes = [
  { path: '/login', name: 'remote-login', component: RemoteLoginPage, meta: { public: true } },
  { path: '/remote', name: 'remote-home', component: RemoteHomePage },
  { path: '/remote/:windowId', name: 'remote-bridge', component: RemoteBridgePage },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes: isWebRemote()
    ? [
        ...remoteExtraRoutes,
        { path: '/', name: 'chat', component: ChatPage },
        { path: '/settings', redirect: { path: '/', query: { settings: '1' } } },
        { path: '/:pathMatch(.*)*', redirect: '/' },
      ]
    : [
        ...desktopRoutes,
        ...remoteExtraRoutes,
        { path: '/:pathMatch(.*)*', redirect: '/' },
      ],
})

if (isWebRemote()) {
  router.beforeEach(async (to) => {
    if (to.meta.public) return true
    const qToken = String(to.query.token || '')
    if (qToken) setStoredToken(qToken)
    const token = getStoredToken()
    if (!token || !(await remoteAuthMe(token))) {
      return { path: '/login', query: { redirect: to.fullPath } }
    }
    try {
      await ensureRemoteNavora(token)
    } catch {
      return { path: '/login', query: { redirect: to.fullPath } }
    }
    return true
  })
}
