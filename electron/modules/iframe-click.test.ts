import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WebFrameMain } from 'electron'
import { collectFrames } from './iframe-click'

test('frame enumeration terminates when framesInSubtree contains the current frame', () => {
  const root = {} as WebFrameMain
  const child = {} as WebFrameMain
  Object.defineProperty(root,'framesInSubtree',{value:[root,child]})
  Object.defineProperty(child,'framesInSubtree',{value:[child]})
  assert.deepEqual(collectFrames(root),[root,child])
})

test('frame enumeration visits shared descendants once and tolerates detached frames', () => {
  const root = {} as WebFrameMain
  const child = {} as WebFrameMain
  const detached = {} as WebFrameMain
  Object.defineProperty(root,'framesInSubtree',{value:[root,child,detached]})
  Object.defineProperty(child,'framesInSubtree',{value:[child,detached]})
  Object.defineProperty(detached,'framesInSubtree',{get(){throw new Error('disposed')}})
  assert.deepEqual(collectFrames(root),[root,child,detached])
})
