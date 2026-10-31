import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'
import { CreatorService } from './creator-service'
import type { SkillStore } from './skill-store'
import type { SkillDetail, SkillWriteInput } from '../../shared/skills'
import type { ChatStore } from './chat-store'
import type { SecretsStore } from './secrets'
import { createDefaultConfig } from '../../shared/config'
import type { PluginStore } from './plugin-store'

function fixture(t:TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'navora-creator-service-'))
  t.after(() => {
    const relative = path.relative(path.resolve(os.tmpdir()),path.resolve(root))
    assert.ok(relative.startsWith('navora-creator-service-')&&!relative.includes(path.sep))
    fs.rmSync(root,{recursive:true,force:true})
  })
  const skillRecords = new Map<string,SkillDetail>(), chatRecords = new Map<string,any>()
  const skills = {
    list:() => [...skillRecords.values()], get:(id:string) => skillRecords.get(id),
    create:(input:SkillWriteInput) => { const record = {...input,id:'skill-'+skillRecords.size} as SkillDetail; skillRecords.set(record.id,record); return record },
    update:(id:string,input:SkillWriteInput) => { const record={...skillRecords.get(id),...input,id} as SkillDetail; skillRecords.set(id,record);return record },
    exportMarkdown:(id:string) => JSON.stringify(skillRecords.get(id)),
  } as unknown as SkillStore
  const chats = {
    create:(title:string) => { const chat={id:'trial-'+chatRecords.size,title};chatRecords.set(chat.id,chat);return chat },
    list:() => [...chatRecords.values()], delete:(id:string) => chatRecords.delete(id),
  } as unknown as ChatStore
  const plugins = { linkSessionPlugin:() => ({ok:false,error:'invalid_module_exports'}), unloadSessionPlugin:() => true } as unknown as PluginStore
  const service = new CreatorService(root,{skills,chats,plugins,secrets:{get:() => null} as unknown as SecretsStore,getConfig:createDefaultConfig})
  return {service,skills,chats}
}
test('skill installation updates its own identity and protects outside edits', async t => {
  const {service,skills} = fixture(t)
  let project = service.store.create('skill','basic')
  project = await service.install(project.id, project.revision)
  assert.equal(skills.list().length,1)
  const installedId = project.installedId!
  project = service.save(project.id, project.revision, { 'SKILL.md':project.files['SKILL.md']+'\n更新内容' }, '更新技能')
  project = await service.install(project.id, project.revision)
  assert.equal(project.installedId, installedId)
  assert.ok(skills.get(installedId)!.body.includes('更新内容'))
  skills.update(installedId,{...skills.get(installedId)!,body:'来自其他编辑器的内容'})
  project = service.save(project.id, project.revision, { 'SKILL.md':project.files['SKILL.md']+'\n再次更新' }, '再次更新')
  await assert.rejects(service.install(project.id,project.revision),/installed_target_conflict/)
  assert.equal(skills.get(installedId)!.body,'来自其他编辑器的内容')
})
test('failed trial loading removes its empty chat and does not mark a project installed', t => {
  const {service,chats} = fixture(t)
  const project = service.store.create('plugin','basic'), before = chats.list().length
  assert.throws(() => service.trial(project.id, project.revision, ''), /validation_failed/)
  assert.equal(chats.list().length,before)
  assert.equal(service.store.get(project.id).installedId,undefined)
})
