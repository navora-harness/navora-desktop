import test from 'node:test'
import assert from 'node:assert/strict'
import {permissionDetailForDisplay} from './permission-presentation'

test('approval detail redacts credentials in JSON, headers and URLs',()=>{
  const shown=permissionDetailForDisplay('browser_fetch {"url":"https://example.test/?token=abc123","headers":{"Authorization":"Bearer top.secret","Cookie":"sid=private"},"password":"hunter2"}')
  assert.match(shown,/token=\[已隐藏\]/)
  assert.match(shown,/Authorization":"\[已隐藏\]/)
  assert.match(shown,/Cookie":"\[已隐藏\]/)
  assert.match(shown,/password":"\[已隐藏\]/)
  assert.doesNotMatch(shown,/abc123|top\.secret|sid=private|hunter2/)
})
