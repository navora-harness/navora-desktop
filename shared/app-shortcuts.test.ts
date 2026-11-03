import test from 'node:test'
import assert from 'node:assert/strict'
import {appCommands} from './app-commands'
import {appShortcutCommand,configurableAppShortcutIds,createDefaultAppShortcuts,isAppShortcutEnabled,resolveAppShortcuts} from './app-shortcuts'

test('application shortcut catalog exposes only commands controlled end to end',()=>{
  assert.deepEqual(configurableAppShortcutIds,['conversation.new','conversation.search','conversation.openFile','app.quit'])
  for(const id of configurableAppShortcutIds){
    const command=appCommands.find(command=>command.id===id)!
    assert.ok(command.shortcut)
    assert.equal(appShortcutCommand({key:command.shortcut!.split('+').at(-1)!,control:true}),id)
    assert.equal(appShortcutCommand({key:command.shortcut!.split('+').at(-1)!,meta:true}),id)
  }
  for(const key of ['b','i','z','c','Enter','Tab','Escape','t','f'])assert.equal(appShortcutCommand({key,control:true}),undefined)
})
test('legacy defaults and individual disable never disable the help escape hatch or editor bindings',()=>{
  for(const id of configurableAppShortcutIds)assert.equal(isAppShortcutEnabled(undefined,id),true)
  const config={app:{shortcuts:{...createDefaultAppShortcuts(),'conversation.new':false}}}
  assert.equal(isAppShortcutEnabled(config,'conversation.new'),false)
  assert.equal(isAppShortcutEnabled(config,'conversation.search'),true)
  assert.equal(isAppShortcutEnabled(config,'help.shortcuts'),true)
  assert.equal(isAppShortcutEnabled(config,'edit.undo'),true)
  assert.equal(appCommands.find(command=>command.id==='help.shortcuts')?.shortcut,'Mod+/')
  assert.deepEqual(resolveAppShortcuts(null),createDefaultAppShortcuts())
  assert.deepEqual(resolveAppShortcuts({'conversation.new':false,'app.quit':'false'}),{...createDefaultAppShortcuts(),'conversation.new':false})
})
test('shortcut parser rejects composition, repeat, alternate modifiers and unmodified slash',()=>{
  assert.equal(appShortcutCommand({key:'/',control:true}),'help.shortcuts')
  assert.equal(appShortcutCommand({key:'/',meta:true}),'help.shortcuts')
  assert.equal(appShortcutCommand({key:'Unidentified',code:'Slash',control:true}),'help.shortcuts')
  assert.equal(appShortcutCommand({key:'/'}),undefined)
  for(const guard of [{isComposing:true},{repeat:true},{isAutoRepeat:true},{alt:true},{shift:true}]){
    assert.equal(appShortcutCommand({key:'/',control:true,...guard}),undefined)
    assert.equal(appShortcutCommand({key:'n',control:true,...guard}),undefined)
  }
})
