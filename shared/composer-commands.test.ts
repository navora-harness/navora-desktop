import test from 'node:test'
import assert from 'node:assert/strict'
import {composerToken} from './composer-commands'
test('context commands target the caret and never consume surrounding text or URLs',()=>{
  assert.deepEqual(composerToken('请查看 /文件 note 后续',12),{start:4,end:12,kind:'file',query:'note'})
  assert.equal(composerToken('https://example.com/file',24),null)
  assert.equal(composerToken('folder/file',11),null)
  assert.equal(composerToken('/unknown words',14),null)
  assert.equal(composerToken('请看 @浏览器',7)?.kind,'window')
  assert.equal(composerToken('/session 登录',11)?.query,'登录')
})
