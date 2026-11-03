import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {ConfigService} from './config-service'
import {createSettingsCommit} from '../../shared/settings-commit'
import {createDefaultAppShortcuts,isAppShortcutEnabled} from '../../shared/app-shortcuts'

test('shortcut leaf commits persist and reset only shortcuts while retaining simultaneous setting changes',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navora-shortcut-config-'))
  try{
    const service=new ConfigService(root),base=structuredClone(service.get()),draft=structuredClone(base)
    draft.app.shortcuts={...draft.app.shortcuts,'conversation.new':false,'app.quit':false}
    service.commit(createSettingsCommit(base,draft,'disable-shortcuts'))
    assert.equal(isAppShortcutEnabled(new ConfigService(root).get(),'conversation.new'),false)
    assert.equal(isAppShortcutEnabled(service.get(),'conversation.search'),true)
    const resetBase=structuredClone(service.get()),resetDraft=structuredClone(resetBase)
    resetDraft.app.shortcuts={...resetDraft.app.shortcuts,...createDefaultAppShortcuts()}
    const reset=createSettingsCommit(resetBase,resetDraft,'reset-shortcuts')
    service.update({app:{language:'en-US'},browser:{default_width:1460}})
    const saved=service.commit(reset)
    assert.equal(saved.app.language,'en-US')
    assert.equal(saved.browser.default_width,1460)
    assert.equal(isAppShortcutEnabled(saved,'conversation.new'),true)
    assert.equal(isAppShortcutEnabled(saved,'app.quit'),true)
    assert.deepEqual(new ConfigService(root).get().app.shortcuts,createDefaultAppShortcuts())
  }finally{
    const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(root))
    if(!relative.startsWith('navora-shortcut-config-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe shortcut fixture cleanup')
    fs.rmSync(root,{recursive:true,force:true})
  }
})
