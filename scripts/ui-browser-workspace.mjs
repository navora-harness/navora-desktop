process.env.NAVORA_UI_SUITE='browser-workspace'
process.env.NAVORA_UI_MOTION_MODE ||= 'normal'
await import('./ui-renovation.mjs')
