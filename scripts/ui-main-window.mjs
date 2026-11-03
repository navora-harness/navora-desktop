process.env.NAVORA_UI_SUITE='main-window'
process.env.NAVORA_UI_MOTION_MODE ||= 'normal'
await import('./ui-renovation.mjs')
