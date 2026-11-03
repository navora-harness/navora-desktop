import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeAnchor,nativeMenuItems,nativePanelNodes,nativePanelActionAllowed} from './native-ui-validation'
import type {NativeMenuItem,NativePanelContent} from './native-ui'

test('native anchors convert CSS zoom once and preserve negative monitor origins',()=>{
  assert.deepEqual(nativeAnchor({x:10,y:20,width:100,height:32},1.5,{x:-1920,y:-100}),{x:-1905,y:-70,width:150,height:48})
  assert.deepEqual(nativeAnchor({x:0,y:0,width:0,height:0},1.25),{x:0,y:0,width:1,height:1})
})
test('invalid native anchor geometry never reaches the window system',()=>{
  for(const bad of [NaN,Infinity,-Infinity])assert.throws(()=>nativeAnchor({x:bad,y:0,width:10,height:10},1))
  for(const zoom of [0,-1,9,NaN])assert.throws(()=>nativeAnchor({x:0,y:0,width:10,height:10},zoom))
  assert.throws(()=>nativeAnchor({x:0,y:0,width:-1,height:10},1))
})
test('menus keep nested command identity and reject duplicate commands or invalid state',()=>{
  const items:NativeMenuItem[]=[{id:'parent',label:'更多',children:[{id:'child',label:'开关',type:'checkbox',checked:true,enabled:false}]}]
  const copy=nativeMenuItems(items)
  assert.deepEqual(copy,items);assert.notEqual(copy[0]!.children,items[0]!.children)
  assert.throws(()=>nativeMenuItems([...items,{id:'child',label:'重复'}]))
  assert.throws(()=>nativeMenuItems([{id:'x',label:'x',enabled:'yes' as never}]))
})
test('oversized and deeply nested native menus fail before construction',()=>{
  assert.throws(()=>nativeMenuItems(Array.from({length:501},(_,n)=>({id:String(n),label:'item'}))))
  let item:NativeMenuItem={id:'last',label:'last'}
  for(let i=0;i<14;i++)item={id:String(i),label:'menu',children:[item]}
  assert.throws(()=>nativeMenuItems([item]))
})
test('hidden or disabled ancestors prevent late child actions',()=>{
  for(const parent of [{disabled:true},{visible:false}]){
    const nodes=nativePanelNodes({id:'root',type:'column',...parent,children:[{id:'button',type:'button',text:'执行'}]})
    assert.equal(nativePanelActionAllowed(nodes,{id:'button',type:'click'}),false)
  }
})
test('native callbacks match the control and validated option values',()=>{
  const nodes=nativePanelNodes({id:'root',type:'column',children:[{id:'toggle',type:'toggle'},{id:'input',type:'input'},{id:'button',type:'button'},{id:'option',type:'option',items:[{id:'a',label:'A',value:'allowed'},{id:'b',label:'B',disabled:true}]},{id:'text',type:'text'}]})
  assert.equal(nativePanelActionAllowed(nodes,{id:'toggle',type:'change',value:true}),true)
  assert.equal(nativePanelActionAllowed(nodes,{id:'toggle',type:'change',value:'true'}),false)
  assert.equal(nativePanelActionAllowed(nodes,{id:'input',type:'submit',value:'中文'}),true)
  assert.equal(nativePanelActionAllowed(nodes,{id:'option',type:'change',value:'allowed'}),true)
  for(const value of ['b','forged'])assert.equal(nativePanelActionAllowed(nodes,{id:'option',type:'change',value}),false)
  assert.equal(nativePanelActionAllowed(nodes,{id:'text',type:'click'}),false)
  assert.equal(nativePanelActionAllowed(nodes,{id:'missing',type:'click'}),false)
  assert.equal(nativePanelActionAllowed(nodes,{id:'button',type:'submit',value:'x'}),false)
})
test('native control trees reject duplicate identity, nonlayout children and capacity overflow',()=>{
  assert.throws(()=>nativePanelNodes({id:'root',type:'column',children:[{id:'root',type:'text'}]}))
  assert.throws(()=>nativePanelNodes({id:'root',type:'button',children:[{id:'child',type:'text'}]}))
  assert.throws(()=>nativePanelNodes({id:'root',type:'column',children:Array.from({length:2000},(_,n)=>({id:String(n),type:'text'}))}))
  let node:NativePanelContent={id:'last',type:'text'}
  for(let i=0;i<34;i++)node={id:String(i),type:'column',children:[node]}
  assert.throws(()=>nativePanelNodes(node))
})
