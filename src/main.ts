import { createApp, h } from 'vue'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@postpile/ui/styles.css'
import './styles/postpile-theme.css'
import './styles/switch-controls.css'
import './styles/conversation-activity.css'
import './styles/control-system.css'
import './styles/main-window-layout.css'
import './styles/icon-system.css'
import './styles/appearance-themes.css'
import './styles/appearance-hover.css'
import './styles/interface-followup.css'
import { ButtonMenuTransition, DialogTransition } from './components/motion/SurfaceTransitions'
import AppIcon from './components/icons/AppIcon.vue'
import {vuetifyIconAliases} from '../shared/ui-icons'
import type {IconSet} from 'vuetify'
import App from './App.vue'
import { router } from './router'

const navoraIconSet:IconSet={component:props=>h(props.tag,{},[h(AppIcon,{icon:String(props.icon||''),class:'v-icon__svg'})])}

const vuetify = createVuetify({
  icons:{defaultSet:'navora',aliases:vuetifyIconAliases,sets:{navora:navoraIconSet}},
  defaults: {
    VBtn: { rounded: 'lg', elevation: 0 },
    VCard: { elevation: 0, rounded: 'lg' },
    VTextField: { rounded: 'lg', variant: 'outlined', density: 'compact' },
    VTextarea: { rounded: 'lg', variant: 'outlined' },
    VSelect: { rounded: 'lg', variant: 'outlined' },
    VSwitch: { inset: true, density: 'compact' },
    VMenu: { origin: 'overlap', maxHeight: 440, transition: { component: ButtonMenuTransition } },
    VDialog: { transition: { component: DialogTransition } },
    VSnackbar: { transition: 'fade-transition' },
  },
  theme: {
    defaultTheme: 'navoraLight',
    themes: {
      navoraLight: {
        dark: false,
        colors: {
          background: '#f5f6f8',
          surface: '#ffffff',
          primary: '#3269ac',
          secondary: '#5c6b7a',
          'on-surface': '#1a2332',
          error: '#af3946',
          success: '#4f806d',
          warning: '#a27d43',
          info: '#5d7fa6',
        },
      },
    },
  },
})

createApp(App).use(router).use(vuetify).component('AppIcon', AppIcon).mount('#app')
