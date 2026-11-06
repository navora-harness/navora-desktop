process.env.NAVORA_QUESTIONNAIRE_EXTENSIONS='1'
process.env.NAVORA_UI_OUTPUT ||= '../_planning/questionnaire-extensions-ui'
await import('./ui-questionnaire.mjs')
