import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeMenuPosition,nativeMenuSize} from './native-menu-position'
import {nativeAnchor,nativeMenuAppearance} from './native-ui-validation'
import type {NativeMenuItem} from './native-ui'

const appearance={width:240,fontSize:13,padding:5,itemPadding:14,rowHeight:34,separatorSpacing:12}
const items:NativeMenuItem[]=[{id:'home',label:'返回主页'},{id:'display',label:'网页尺寸'},{id:'zoom',label:'缩放',controls:[{id:'minus',type:'button',label:'−',group:1},{id:'value',type:'label',label:'100%',group:1},{id:'plus',type:'button',label:'+',group:1},{id:'reset',type:'button',label:'重置'}]},{id:'separator',type:'separator',label:''},{id:'workspace',label:'收起工作区（恢复分栏）'}]

test('conversation menu measures visible shortcut labels when aligning to its trigger',()=>{
  const menu=[{label:'打开浏览器标签页',shortcut:'CommandOrControl+Shift+B'}]
  const visible=[{label:'打开浏览器标签页',shortcut:'Ctrl+Shift+B'}]
  assert.deepEqual(nativeMenuSize(menu,appearance),nativeMenuSize(visible,appearance))
  const size=nativeMenuSize(menu,appearance)
  const position=nativeMenuPosition({anchor:{x:650,y:28,width:32,height:32},content:{width:900,height:700},items:menu,appearance,placement:'bottom-end'})
  assert.equal(position.x+size.width,682)
  assert.equal(position.y,64)
})

test('browser menu stays below its button with its right edge aligned',()=>{
  assert.deepEqual(nativeMenuSize(items,appearance),{width:250,height:158})
  assert.deepEqual(nativeMenuPosition({anchor:{x:850,y:44,width:36,height:32},content:{width:900,height:700},items,appearance,placement:'bottom-end'}),{x:636,y:80})
})
test('edge constraints translate the menu without switching its preferred side',()=>{
  assert.deepEqual(nativeMenuPosition({anchor:{x:890,y:640,width:30,height:32},content:{width:900,height:700},items,appearance,placement:'bottom-end'}),{x:642,y:534})
  assert.deepEqual(nativeMenuPosition({anchor:{x:-80,y:-20,width:20,height:20},content:{width:900,height:700},items,appearance,placement:'top-start'}),{x:8,y:8})
  assert.deepEqual(nativeMenuPosition({anchor:{x:600,y:400,width:30,height:32},content:{width:900,height:700},items,appearance,placement:'top-end'}),{x:380,y:238})
})
test('zoom is applied once and screen monitor origins never enter popup coordinates',()=>{
  const content={x:-1920,y:-400,width:900,height:700}
  const scaled=nativeMenuAppearance(appearance,1.5)
  assert.deepEqual(nativeMenuPosition({anchor:nativeAnchor({x:560,y:20,width:24,height:28},1.5),content,items,appearance:scaled,placement:'bottom-end',gap:6}),{x:500,y:78})
})
test('submenus get a right-hand lane when both levels fit within the owner',()=>{
  const nested=[{id:'open',label:'打开方式',children:[{id:'system',label:'系统默认应用'}]}]
  assert.deepEqual(nativeMenuPosition({anchor:{x:850,y:50,width:1,height:1},content:{width:900,height:700},items:nested,appearance}),{x:448,y:55})
  assert.deepEqual(nativeMenuPosition({anchor:{x:390,y:50,width:1,height:1},content:{width:400,height:700},items:nested,appearance}),{x:142,y:55})
})
test('point menus and oversized menus use nonnegative content positions',()=>{
  assert.deepEqual(nativeMenuPosition({anchor:{x:899,y:699,width:0,height:0},content:{width:900,height:700},items,appearance,gap:0}),{x:642,y:534})
  const tall=Array.from({length:100},(_,index)=>({id:String(index),label:'条目'}))
  assert.equal(nativeMenuPosition({anchor:{x:10,y:600,width:1,height:1},content:{width:900,height:700},items:tall,appearance}).y,8)
  const long=[{id:'path',label:'很长的文件路径'.repeat(12)}]
  assert.ok(nativeMenuSize(long,appearance).width>240)
  assert.equal(nativeMenuPosition({anchor:{x:10,y:600,width:1,height:1},content:{width:400,height:700},items:long,appearance}).x,8)
})
