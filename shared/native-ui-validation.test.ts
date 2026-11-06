import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeAnchor,nativeMenuItems,nativeMenuRefreshCompatible,nativeMenuControlAllowed,nativeMenuAppearance,nativePanelNodes,nativePanelActionAllowed,nativePanelInteraction,nativePanelShouldDismiss,nativePanelFirstFocusable,nativePanelScale,nativePanelPresentationTree,nativePanelOptions,nativeUiKeys,nativeUiTheme,nativePanelTreePatch} from './native-ui-validation'
import type {NativeMenuItem,NativePanelContent} from './native-ui'

test('v2 themes retain tint and state tokens while scaling inherited typography once',()=>{
  const theme=nativeUiTheme({mode:'dark',background:'#202020',materialTint:'#B3202020',tokens:{panelHover:'#24FFFFFF'},styles:{row:{fontSize:12,lineHeight:18,hover:{background:'$panelHover'},verticalAlign:'top'}}},1.5)
  assert.equal(theme.materialTint,'#B3202020');assert.equal(theme.styles?.row?.fontSize,18);assert.equal(theme.styles?.row?.lineHeight,27)
  assert.deepEqual(theme.styles?.row?.hover,{background:'$panelHover'})
  assert.throws(()=>nativeUiTheme({tokens:{a:'$b',b:'$a'}}))
})
test('v2 busy ancestors block late actions and editors retain their editing context unless opted in',()=>{
  const tree:NativePanelContent={id:'root',type:'column',busy:true,children:[{id:'query',type:'input',value:'draft',navigationTarget:'results'},{id:'results',type:'list',role:'listbox',children:[{id:'result',type:'item',contextMenu:false,children:[]}]}]}
  assert.equal(nativePanelActionAllowed(nativePanelNodes(tree),{id:'query',type:'change',value:'late'}),false)
  tree.busy=false
  const nodes=nativePanelNodes(tree)
  assert.equal(nativePanelActionAllowed(nodes,{id:'query',type:'contextMenu'}),false)
  assert.equal(nativePanelActionAllowed(nodes,{id:'result',type:'contextMenu'}),false)
  assert.equal(nativePanelActionAllowed(nativePanelNodes({...tree.children![0]!,contextMenu:true}),{id:'query',type:'contextMenu'}),true)
})
test('fixed row virtual lists accept large data without allowing stateful editor rows',()=>{
  const list:NativePanelContent={id:'virtual',type:'list',height:240,gap:0,padding:0,virtual:{itemHeight:32,overscan:3},children:Array.from({length:2100},(_,i)=>({id:`row-${i}`,type:'item',height:32,children:[{id:`label-${i}`,type:'text',text:`Row ${i}`}]}))}
  assert.equal(nativePanelNodes(list).size,4201)
  assert.throws(()=>nativePanelNodes({...list,virtual:undefined}))
  assert.throws(()=>nativePanelNodes({...list,gap:2}))
  assert.throws(()=>nativePanelNodes({...list,children:[{id:'editor-row',type:'item',height:32,children:[{id:'draft',type:'input',value:'draft'}]}]}))
})
test('node transactions validate the candidate atomically and cannot change identity through set',()=>{
  const tree:NativePanelContent={id:'root',type:'column',children:[{id:'draft',type:'input',value:'saved'},{id:'status',type:'text',text:'Ready'}]}
  const next=nativePanelTreePatch(tree,[{op:'set',id:'status',properties:{text:'Busy'}},{op:'insert',id:'root',index:2,node:{id:'progress',type:'progress',value:.5}}])
  assert.equal(next.children?.[0]?.value,'saved');assert.equal(next.children?.[1]?.text,'Busy');assert.equal(tree.children?.[1]?.text,'Ready')
  assert.throws(()=>nativePanelTreePatch(tree,[{op:'set',id:'status',properties:{text:'Changed'}},{op:'remove',id:'missing'}]))
  assert.equal(tree.children?.[1]?.text,'Ready')
  assert.throws(()=>nativePanelTreePatch(tree,[{op:'set',id:'status',properties:{id:'new'} as never}]))
  assert.throws(()=>nativePanelTreePatch(tree,[{op:'remove',id:'root'}]))
})

test('hover-only native buttons retain keyboard actions and reject nonboolean visibility hints',()=>{
  const button:NativePanelContent={id:'more',type:'iconButton',icon:'ellipsis',accessibleName:'更多',hoverOnly:true}
  assert.equal(nativePanelActionAllowed(nativePanelNodes(button),{id:'more',type:'click'}),true)
  assert.equal(nativePanelScale(button,2).hoverOnly,true)
  assert.throws(()=>nativePanelNodes({...button,hoverOnly:'true' as never}))
  assert.throws(()=>nativePanelNodes({id:'text',type:'text',text:'file',hoverOnly:true}))
})

test('context menus belong to visible enabled item rows rather than their child controls',()=>{
  const tree:NativePanelContent={id:'root',type:'column',children:[{id:'row',type:'item',children:[{id:'name',type:'text',text:'file.zip'},{id:'remove',type:'iconButton',icon:'xmark',accessibleName:'移除'}]},{id:'disabled',type:'item',disabled:true,children:[]},{id:'hidden',type:'item',visible:false,children:[]}]}
  const nodes=nativePanelNodes(tree)
  assert.equal(nativePanelActionAllowed(nodes,{id:'row',type:'contextMenu'}),true)
  for(const id of ['name','remove','disabled','hidden','missing'])assert.equal(nativePanelActionAllowed(nodes,{id,type:'contextMenu'}),false)
  assert.equal(nativePanelActionAllowed(nodes,{id:'row',type:'contextMenu',value:'untrusted'}),false)
})

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

test('search interaction keeps outside clicks and blur while allowing Escape',()=>{
  assert.deepEqual(nativePanelInteraction({role:'search'}),{role:'search',focusMode:'input',dismissOnEscape:true,dismissOnOutsideClick:false})
  assert.deepEqual(nativePanelInteraction({role:'editor'}),{role:'editor',focusMode:'menu',dismissOnEscape:true,dismissOnOutsideClick:true})
  for(const invalid of [{focusMode:'none' as const},{focusMode:'menu' as const},{dismissOnOutsideClick:true},{dismissOnEscape:false}])assert.throws(()=>nativePanelInteraction({role:'search',...invalid}),/search/)
  assert.throws(()=>nativePanelInteraction({role:'passive',focusMode:'input'}),/focus/)
  assert.throws(()=>nativePanelInteraction({dismissOnEscape:'false' as never}),/dismiss/)
})

test('search survives ordinary popups but a new explicit search replaces it',()=>{
  for(const incoming of [undefined,'transient','editor','passive'] as const)assert.equal(nativePanelShouldDismiss('search',incoming),false)
  assert.equal(nativePanelShouldDismiss('search','search'),true)
  for(const current of ['transient','editor','passive'] as const){
    assert.equal(nativePanelShouldDismiss(current,'search'),true)
    assert.equal(nativePanelShouldDismiss(current),true)
  }
  assert.equal(nativePanelShouldDismiss('editor','passive'),false)
  assert.equal(nativePanelShouldDismiss('passive','passive'),true)
})

test('initial focus traversal skips inherited hidden and disabled controls',()=>{
  const tree:NativePanelContent={id:'root',type:'column',children:[{id:'title',type:'text',text:'查找'},{id:'hidden',type:'row',visible:false,children:[{id:'hidden-button',type:'button',text:'隐藏'}]},{id:'disabled',type:'row',disabled:true,children:[{id:'disabled-button',type:'button',text:'禁用'}]},{id:'query',type:'input'},{id:'close',type:'button',text:'关闭'}]}
  assert.equal(nativePanelFirstFocusable(tree)?.id,'query')
  assert.equal(nativePanelFirstFocusable({id:'empty',type:'column',children:[{id:'text',type:'text',text:'只读'}]}),undefined)
  assert.equal(nativePanelFirstFocusable({id:'link',type:'text',text:'链接',linkRange:{start:0,end:2}})?.id,'link')
})
test('native callbacks match the control and validated option values',()=>{
  const nodes=nativePanelNodes({id:'root',type:'column',children:[{id:'toggle',type:'toggle',text:'Toggle',checked:false},{id:'input',type:'input'},{id:'button',type:'button',text:'Button'},{id:'option',type:'option',items:[{id:'a',label:'A',value:'allowed'},{id:'b',label:'B',disabled:true}]},{id:'text',type:'text',text:'Text'}]})
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
  assert.throws(()=>nativePanelNodes({id:'root',type:'column',children:[{id:'root',type:'text',text:''}]}))
  assert.throws(()=>nativePanelNodes({id:'root',type:'button',text:'',children:[{id:'child',type:'text',text:''}]}))
  assert.throws(()=>nativePanelNodes({id:'root',type:'column',children:Array.from({length:2000},(_,n)=>({id:String(n),type:'text',text:''}))}))
  let node:NativePanelContent={id:'last',type:'text',text:''}
  for(let i=0;i<34;i++)node={id:String(i),type:'column',children:[node]}
  assert.throws(()=>nativePanelNodes(node))
})

test('native row controls preserve command membership across repeated refreshes',()=>{
  const items:NativeMenuItem[]=[{id:'zoom',label:'缩放',controls:[{id:'minus',type:'button',label:'−',group:1},{id:'value',type:'label',label:'100%',group:1},{id:'plus',type:'button',label:'+',group:1},{id:'reset',type:'button',icon:'reload',accessibleName:'重置',enabled:false}]}]
  const refreshed=nativeMenuItems([{...items[0]!,controls:items[0]!.controls!.map(control=>({...control,...(control.id==='value'?{label:'110%'}:{}),...(control.id==='reset'?{enabled:true}:{})}))}])
  assert.equal(nativeMenuRefreshCompatible(items,refreshed),true)
  assert.equal(nativeMenuControlAllowed(items,{itemId:'zoom',controlId:'minus'})?.id,'minus')
  assert.equal(nativeMenuControlAllowed(items,{itemId:'zoom',controlId:'value'}),undefined)
  assert.equal(nativeMenuControlAllowed(items,{itemId:'zoom',controlId:'reset'}),undefined)
  assert.equal(nativeMenuControlAllowed(refreshed,{itemId:'zoom',controlId:'reset'})?.id,'reset')
  assert.equal(nativeMenuControlAllowed([{id:'parent',label:'parent',enabled:false,children:refreshed}],{itemId:'zoom',controlId:'minus'}),undefined)
  for(const change of [{id:'other'},{type:'label' as const},{group:2}]){
    const changed=nativeMenuItems([{...items[0]!,controls:[{...items[0]!.controls![0]!,...change},...items[0]!.controls!.slice(1)]}])
    assert.equal(nativeMenuRefreshCompatible(items,changed),false)
  }
  assert.throws(()=>nativeMenuItems([{...items[0]!,type:'checkbox'}]))
  assert.throws(()=>nativeMenuItems([{...items[0]!,controls:[{id:'icon',type:'button',icon:'reload'}]}]))
  assert.throws(()=>nativeMenuItems([{...items[0]!,controls:[{id:'x',type:'button',label:'x',group:1.5}]}]))
  assert.throws(()=>nativeMenuItems([{id:'x',label:'X',role:'quit'} as NativeMenuItem]))
})

test('rich item children and editor actions keep their separate meanings',()=>{
  const nodes=nativePanelNodes({id:'root',type:'column',children:[{id:'item',type:'item',selected:true,children:[{id:'label',type:'text',text:'A😀BC',singleLine:true,maxWidth:200,highlights:[{start:1,end:3}]},{id:'close',type:'iconButton',icon:'close',accessibleName:'关闭'}]},{id:'editor',type:'textarea',value:'第一行\n第二行',submitOnEnter:true,scrollbarPlacement:'gutter'},{id:'notes',type:'textarea',submitOnEnter:false},{id:'link',type:'text',text:'设置',linkRange:{start:0,end:2}}]})
  for(const id of ['item','close','link'])assert.equal(nativePanelActionAllowed(nodes,{id,type:'click'}),true)
  assert.equal(nativePanelActionAllowed(nodes,{id:'label',type:'click'}),false)
  assert.equal(nativePanelActionAllowed(nodes,{id:'item',type:'change',value:'forged'}),false)
  assert.equal(nativePanelActionAllowed(nodes,{id:'editor',type:'submit',value:'第一行\n第二行'}),true)
  assert.equal(nativePanelActionAllowed(nodes,{id:'notes',type:'submit',value:'全文'}),false)
  assert.equal(nativePanelActionAllowed(nodes,{id:'notes',type:'change',value:'组合输入草稿😀'}),true)
  assert.equal(nativePanelActionAllowed(nodes,{id:'editor',type:'submit',value:true}),false)
  assert.equal(nativePanelActionAllowed(nodes,{id:'close',type:'click',value:'forged'}),false)
})

test('native schema rejects cross-node fields and does not expose panel material',()=>{
  const invalid:NativePanelContent[]=[{id:'x',type:'input',submitOnEnter:true},{id:'x',type:'row',scrollbarPlacement:'gutter',children:[]},{id:'x',type:'text',text:'x',selected:true},{id:'x',type:'text',text:'x',highlights:[{start:0,end:2}]},{id:'x',type:'text',text:'x',singleLine:true,linkRange:{start:0,end:1}},{id:'x',type:'iconButton',icon:'close'},{id:'x',type:'button',text:'x',style:{opacity:.5} as never}]
  for(const node of invalid)assert.throws(()=>nativePanelNodes(node))
  assert.throws(()=>nativeUiKeys({contentInset:4,backgroundMaterial:'acrylic'},['contentInset']))
  assert.throws(()=>nativePanelNodes({id:'x',type:'input',maxLength:2.5}))
  assert.throws(()=>nativePanelNodes({id:'x',type:'text',text:'x',style:{background:'red'}}))
})

test('all geometry scales once while text offsets and independent scrollbar modes stay intact',()=>{
  const original:NativePanelContent={id:'root',type:'list',width:300,maxWidth:400,height:100,padding:3,gap:2,scrollbarPlacement:'gutter',style:{radius:9,borderWidth:1,paddingTop:2,paddingRight:4,paddingBottom:6,paddingLeft:8,fontWeight:'medium'},children:[{id:'text',type:'text',text:'😀xyz',fontSize:12,maxWidth:200,flex:1,highlights:[{start:0,end:2}]},{id:'edit',type:'textarea',value:'x\ny',maxLength:4000,submitOnEnter:true,scrollbarPlacement:'overlay'}]}
  const scaled=nativePanelScale(original,1.5);nativePanelNodes(scaled)
  assert.deepEqual([scaled.width,scaled.maxWidth,scaled.height,scaled.padding,scaled.gap],[450,600,150,4.5,3])
  assert.deepEqual(scaled.style,{radius:13.5,borderWidth:1.5,paddingTop:3,paddingRight:6,paddingBottom:9,paddingLeft:12,fontWeight:'medium'})
  assert.equal(scaled.children![0]!.fontSize,18);assert.equal(scaled.children![0]!.maxWidth,300);assert.equal(scaled.children![0]!.flex,1)
  assert.deepEqual(scaled.children![0]!.highlights,[{start:0,end:2}]);assert.equal(scaled.children![1]!.maxLength,4000)
  assert.equal(scaled.scrollbarPlacement,'gutter');assert.equal(scaled.children![1]!.scrollbarPlacement,'overlay')
  assert.equal(original.width,300);assert.equal(original.style!.paddingRight,4)
  assert.deepEqual(nativePanelOptions({contentInset:5,radius:12,scrollbarPlacement:'gutter'},1.5),{contentInset:8,radius:18,scrollbarPlacement:'gutter'})
  assert.deepEqual(nativeMenuAppearance({fontSize:13,width:240,rowHeight:34,padding:5,background:'#ffffff'},1.25),{fontSize:16,width:300,rowHeight:43,padding:6,background:'#ffffff'})
})

test('cosmetic panel refreshes omit native editor values without changing submitted drafts',()=>{
  const original:NativePanelContent={id:'root',type:'column',children:[{id:'input',type:'input',value:'旧查询'},{id:'textarea',type:'textarea',value:'组合输入前的草稿',submitOnEnter:true},{id:'option',type:'option',value:'a',items:[{id:'a',label:'A'}]},{id:'progress',type:'progress',value:.5}]}
  const presentation=nativePanelPresentationTree(original);nativePanelNodes(presentation)
  assert.equal('value' in presentation.children![0]!,false)
  assert.equal('value' in presentation.children![1]!,false)
  assert.equal(presentation.children![2]!.value,'a');assert.equal(presentation.children![3]!.value,.5)
  assert.equal(original.children![0]!.value,'旧查询');assert.equal(original.children![1]!.value,'组合输入前的草稿')
})

test('native panel shadow is an optional strict boolean and never scales with zoom',()=>{
  assert.deepEqual(nativePanelOptions({}),{})
  for(const zoom of [1,1.25,2])for(const shadow of [false,true])assert.equal(nativePanelOptions({shadow,contentInset:4},zoom).shadow,shadow)
  for(const shadow of ['false',0,1,null,{}])assert.throws(()=>nativePanelOptions({shadow:shadow as never}),/boolean/)
})
