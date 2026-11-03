import test from 'node:test'
import assert from 'node:assert/strict'
import {annotationEditorPlacement} from './browser-annotation-position'
test('annotation editor chooses a nearby side and stays inside narrow and edge viewports',()=>{
  for(const bounds of [{x:100,y:70,width:800,height:600},{x:0,y:0,width:280,height:190}])for(const anchor of [{x:110,y:80,width:40,height:25},{x:850,y:630,width:100,height:100},{x:-100,y:-100,width:10,height:10}]){
    const result=annotationEditorPlacement(anchor,bounds,{width:344,height:240})
    assert.ok(result.x>=bounds.x+8);assert.ok(result.y>=bounds.y+8)
    assert.ok(result.x+result.width<=bounds.x+bounds.width-8)
    assert.ok(result.y+Math.min(240,result.maxHeight)<=bounds.y+bounds.height-8)
  }
  assert.equal(annotationEditorPlacement({x:130,y:100,width:50,height:50},{x:100,y:70,width:800,height:600},{width:344,height:240}).x,190)
})
