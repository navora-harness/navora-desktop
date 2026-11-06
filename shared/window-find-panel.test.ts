import test from 'node:test'
import assert from 'node:assert/strict'
import {windowFindPanel,windowFindScopeButtons,WINDOW_FIND_SURFACE} from './window-find-panel'
import {nativePanelNodes,nativePanelFirstFocusable,nativePanelPresentationTree,nativePanelActionAllowed} from './native-ui-validation'
import type {WindowFindTarget} from './window-find'
const chat:WindowFindTarget={key:'chat:a',scope:'chat',kind:'chat',label:'当前聊天',supportsCaseSensitive:true,supportsTools:true}
const browser:WindowFindTarget={key:'page:b',scope:'workspace',kind:'browser',label:'网页',supportsCaseSensitive:false}
const initial={width:448,query:'',target:chat,targets:[chat,browser],state:{status:'idle' as const,total:0,ordinal:0},options:{caseSensitive:false,includeTools:false},showOptions:false}
test('find opens as one compact row and starts native focus at the query',()=>{
  const tree=windowFindPanel({...initial,includeValue:true}),nodes=nativePanelNodes(tree)
  assert.equal(nativePanelFirstFocusable(tree)?.id,'find-query');assert.equal(nodes.has('find-results'),false)
  assert.equal(nodes.get('find-query')?.value,'');assert.ok(nodes.has('find-scope-workspace'));assert.equal(nodes.has('find-settings'),false)
})

test('one searchable scope has no redundant switcher; two scopes stay plain and compact',()=>{
  for(const targets of [[chat],[browser],[chat,{...chat,key:'chat:duplicate'}]]){
    const tree=windowFindPanel({...initial,targets,target:targets[0]!}),nodes=nativePanelNodes(tree)
    assert.deepEqual(windowFindScopeButtons(targets),[])
    assert.equal(nodes.has('find-scope-chat'),false);assert.equal(nodes.has('find-scope-workspace'),false)
    assert.equal(nodes.has('find-close-divider'),false);assert.equal(nodes.has('find-close'),true)
    assert.equal(nodes.get('find-main')!.height,28);assert.equal(nodes.get('find-query')!.height,28)
    assert.equal(tree.padding,0);assert.equal(nativePanelFirstFocusable(tree)?.id,'find-query')
  }
  const nodes=nativePanelNodes(windowFindPanel(initial))
  for(const id of ['find-scope-chat','find-scope-workspace']){
    assert.equal(nodes.get(id)!.style?.background,undefined)
    assert.equal(nativePanelActionAllowed(nodes,{id,type:'click'}),true)
  }
  assert.ok(nodes.has('find-close-divider'))
  assert.deepEqual(WINDOW_FIND_SURFACE,{contentInset:8,radius:20,shadow:false})
})
test('match footer shows counts, valid navigation and only supported scope options',()=>{
  const tree=windowFindPanel({...initial,query:'项目',state:{status:'ready',total:4,ordinal:2},showOptions:true}),nodes=nativePanelNodes(tree)
  assert.equal(nodes.get('find-count')?.text,'2 / 4 个结果');assert.equal(nativePanelActionAllowed(nodes,{id:'find-next',type:'click'}),true)
  assert.ok(nodes.has('find-tools'));assert.ok(nodes.has('find-case'))
  const browserNodes=nativePanelNodes(windowFindPanel({...initial,target:browser,query:'项目',state:{status:'ready',total:0,ordinal:0},showOptions:true}))
  assert.equal(browserNodes.has('find-tools'),false);assert.equal(browserNodes.has('find-case'),false);assert.equal(nativePanelActionAllowed(browserNodes,{id:'find-next',type:'click'}),false)
  assert.equal(browserNodes.get('find-query')?.invalid,true)
  assert.equal(browserNodes.get('find-query')?.accessibleDescription,'没有匹配结果')
  assert.equal(nodes.get('find-query')?.invalid,false)
  assert.equal(nodes.get('find-count')?.role,'status')
  assert.equal(nodes.get('find-options')?.expanded,true)
})
test('unsupported/truncated states are honest and narrow sizing survives native validation',()=>{
  const nodes=nativePanelNodes(windowFindPanel({...initial,width:220,query:'x',state:{status:'unsupported',total:0,ordinal:0,notice:'此文件类型暂不支持查找'}}))
  assert.equal(nodes.get('find-count')?.text,'此文件类型暂不支持查找');assert.equal(nodes.get('find-next')?.disabled,true)
  const tree=windowFindPanel({...initial,query:'x',state:{status:'ready',total:10,ordinal:1,truncated:true,notice:'仅查找已加载内容'}})
  assert.ok(nativePanelNodes(tree).has('find-notice'));assert.equal(tree.width,448)
})
test('live count/layout refresh omits native input values to preserve composition',()=>{
  const tree=windowFindPanel({...initial,query:'中文',includeValue:true}),presentation=nativePanelPresentationTree(tree)
  assert.equal(nativePanelNodes(tree).get('find-query')?.value,'中文')
  assert.equal('value' in nativePanelNodes(presentation).get('find-query')!,false)
  assert.equal(nativePanelFirstFocusable(presentation)?.id,'find-query')
})
