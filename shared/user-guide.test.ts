import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readGuideReading,resolveGuideTarget,searchUserGuide,userGuide} from './user-guide'

test('guide links have unique chapter and section targets',()=>{
  assert.equal(userGuide.length,16)
  assert.equal(new Set(userGuide.map(chapter=>chapter.id)).size,userGuide.length)
  for(const chapter of userGuide){assert.ok(chapter.sections.length);assert.equal(new Set(chapter.sections.map(section=>section.id)).size,chapter.sections.length);assert.ok(chapter.sections.every(section=>section.paragraphs.length))}
})
test('guide search includes instruction steps and applies every query term',()=>{
  assert.ok(searchUserGuide('接口地址 密钥').some(chapter=>chapter.id==='start'))
  assert.ok(searchUserGuide('问卷 草稿').some(chapter=>chapter.id==='drafts'))
  assert.equal(searchUserGuide('问卷 不存在的检索词').length,0)
})
test('guide search normalizes fullwidth shortcuts and case',()=>{
  assert.deepEqual(searchUserGuide('ＣＴＲＬ＋Ｆ').map(chapter=>chapter.id),searchUserGuide('ctrl+f').map(chapter=>chapter.id))
  assert.equal(searchUserGuide('   ').length,userGuide.length)
})

test('reading restoration accepts known chapters and finite positions, rejecting invalid or future state',()=>{
  const valid=readGuideReading(JSON.stringify({version:1,chapter:'files',positions:{files:240,start:0,missing:300,chat:-1,drafts:'100',models:null}}))
  assert.equal(valid.chapter,'files');assert.deepEqual(valid.positions,{files:240,start:0})
  assert.equal(readGuideReading('{broken').chapter,'start')
  assert.deepEqual(readGuideReading(JSON.stringify({version:99,chapter:'files',positions:{files:240}})),{version:1,chapter:'start',positions:{}})
  assert.equal(readGuideReading(JSON.stringify({chapter:'missing'})).chapter,'start')
})
test('deep links resolve only exact known chapter and section identities',()=>{
  assert.deepEqual(resolveGuideTarget('drafts','autosave'),{chapter:'drafts',section:'autosave'})
  assert.deepEqual(resolveGuideTarget('drafts','missing'),{chapter:'drafts'})
  assert.deepEqual(resolveGuideTarget('missing','autosave'),{chapter:'start'})
})
