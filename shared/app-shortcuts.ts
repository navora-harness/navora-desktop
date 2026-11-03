import type {AppCommandId} from './app-commands'

/** Only bindings owned end-to-end by Navora can be disabled here. */
export const configurableAppShortcutIds=['conversation.new','conversation.search','conversation.openFile','app.quit'] as const
export type ConfigurableAppShortcutId=typeof configurableAppShortcutIds[number]
export type AppShortcutPreferences=Partial<Record<ConfigurableAppShortcutId,boolean>>
export function createDefaultAppShortcuts():AppShortcutPreferences{
  return Object.fromEntries(configurableAppShortcutIds.map(id=>[id,true]))
}
export function resolveAppShortcuts(value:unknown):AppShortcutPreferences{
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
  return {...source,...Object.fromEntries(configurableAppShortcutIds.map(id=>[id,source[id]!==false]))}
}
export function isConfigurableAppShortcut(id:AppCommandId):id is ConfigurableAppShortcutId{
  return (configurableAppShortcutIds as readonly string[]).includes(id)
}
export function isAppShortcutEnabled(config:{app?:{shortcuts?:AppShortcutPreferences}}|null|undefined,id:AppCommandId):boolean{
  return !isConfigurableAppShortcut(id)||config?.app?.shortcuts?.[id]!==false
}
export type AppShortcutInput={key:string;code?:string;control?:boolean;meta?:boolean;shift?:boolean;alt?:boolean;isComposing?:boolean;repeat?:boolean;isAutoRepeat?:boolean}
export function appShortcutCommand(input:AppShortcutInput):ConfigurableAppShortcutId|'help.shortcuts'|undefined{
  if(input.isComposing||input.repeat||input.isAutoRepeat||input.alt||input.shift||!input.control&&!input.meta)return
  const key=input.key.toLowerCase()
  if(key==='/'||input.code==='Slash')return 'help.shortcuts'
  return ({n:'conversation.new',k:'conversation.search',o:'conversation.openFile',q:'app.quit'} as const)[key as 'n'|'k'|'o'|'q']
}
