import {createApp,h} from 'vue'
import {createVuetify} from 'vuetify'
import {VApp} from 'vuetify/components'
import 'vuetify/styles'
import '@postpile/ui/styles.css'
import '../src/styles/postpile-theme.css'
import '../src/styles/switch-controls.css'
import '../src/styles/conversation-activity.css'
import '../src/styles/control-system.css'
import '../src/styles/main-window-layout.css'
import '../src/styles/icon-system.css'
import '../src/styles/appearance-themes.css'
import '../src/styles/appearance-hover.css'
import '../src/styles/interface-followup.css'
import '../src/styles/window-material.css'
import {useAppearance} from '../src/composables/useAppearance'

const role=location.hash.slice(1)
const label=(text)=>h('span',{},text)
const main=()=>h('div',{class:'shell main-shell frameless'},[
  h('header',{class:'window-titlebar'},[label('Navora · 材质验收'),h('button',{},'窗口菜单')]),
  h('nav',{class:'activity-rail'},[label('⌂'),label('◷'),label('⚙')]),
  h('div',{class:'content-surface'},[
    h('aside',{class:'sidebar'},[h('h3',{},'浏览器资源'),h('button',{},'默认会话'),h('p',{},'半透明停靠侧栏'),h('p',{},'文本保持不透明')]),
    h('main',{class:'main'},[h('h2',{},'正文保持清晰'),h('p',{},'标题栏和左侧图标栏露出原生材质。'),h('input',{placeholder:'输入和焦点不因材质切换而重建'})]),
  ]),
])
const detached=()=>h('main',{class:role==='browser'?'browser-host-page':'file-host-page'},[
  h('header',{class:'detached-window-bar browser-host-tabs'},[h('button',{},'移回工作区'),h('button',{},'置顶窗口'),h('button',{class:'workspace-tab-item'},role==='browser'?'真实网页 · Live':'文件 · 预览')]),
  role==='browser'?h('div',{class:'browser-tab-toolbar'},'https://localhost.invalid/ · 不透明地址工具行'):null,
  h('div',{class:role==='browser'?'guest-target':'file-host-content'},[h('h2',{},'不透明内容区'),h('p',{},'材质开关不重载网页或文件。')]),
])
const vuetify=createVuetify({theme:{defaultTheme:'navoraLight',themes:{navoraLight:{dark:false,colors:{primary:'#1766a9',secondary:'#667',background:'#fff',surface:'#fff','on-surface':'#223'}}}}})
createApp({setup(){useAppearance();return()=>h(VApp,{class:'navora-app'},()=>role==='main'?main():detached())}}).use(vuetify).mount('#app')
