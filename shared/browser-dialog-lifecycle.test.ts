import test from 'node:test'
import assert from 'node:assert/strict'
import {createBrowserDialogLifecycle} from './browser-dialog-lifecycle'
test('late leave cannot clear a reopened dialog, including close/reopen/close',()=>{
  const life=createBrowserDialogLifecycle(),first=life.setOpen(true)
  life.setOpen(false)
  const second=life.setOpen(true);life.setOpen(false)
  assert.equal(life.afterLeave(first),false)
  assert.equal(life.afterLeave(second),true)
  assert.equal(life.afterLeave(second),false)
})
test('layout-only hides and docking remounts do not emit logical leave or repeated enter',()=>{
  const life=createBrowserDialogLifecycle(),first=life.setOpen(true)
  assert.equal(life.afterEnter(first),true)
  const docked=life.changePresentation()
  assert.equal(life.afterLeave(first),false)
  assert.equal(life.afterLeave(docked),false)
  assert.equal(life.afterEnter(docked),false)
  life.setOpen(false);assert.equal(life.afterLeave(docked),true)
})
test('canceling an opening that never painted still settles once',()=>{
  const life=createBrowserDialogLifecycle(),first=life.setOpen(true)
  life.setOpen(false);assert.equal(life.afterLeave(first),true)
  assert.equal(life.afterEnter(first),false);assert.equal(life.afterLeave(first),false)
})
