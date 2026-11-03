import test from 'node:test'
import assert from 'node:assert/strict'
import {browserAddressNativePanel,browserAgentNativePanel,browserDownloadsNativePanel,browserNativeId} from './browser-native-panels'
import {createBrowserAutomationState} from './browser-automation'
import type {BrowserDownloadEntry} from './types'
import type {NativePanelContent} from './native-ui'

function nodes(root:NativePanelContent):NativePanelContent[]{return [root,...(root.children||[]).flatMap(nodes)]}
const download=(patch:Partial<BrowserDownloadEntry>={}):BrowserDownloadEntry=>({id:'download-1',chatId:'chat-a',sessionId:'session-a',state:'started',url:'https://example.test/a',filename:'a.zip',createdAt:1,updatedAt:1,source:'browser',...patch})

test('native Agent opening describes state without requesting control; only enabled explicit actions are mapped',()=>{
  const unknown=browserAgentNativePanel({})
  assert.deepEqual([...unknown.actions.values()],['settings'])
  const active=browserAgentNativePanel({state:{...createBrowserAutomationState(),activity:'acting',activeOperations:1,inputProtected:true}})
  assert.deepEqual([...active.actions.values()],['takeControl','pause','settings'])
  const busy=browserAgentNativePanel({state:createBrowserAutomationState(),pending:true})
  assert.deepEqual([...busy.actions.values()],['settings'])
  const selecting=browserAgentNativePanel({state:createBrowserAutomationState(),selectionBusy:true})
  assert.deepEqual([...selecting.actions.values()],['settings'])
})
test('Agent recovery follows confirmed release and stable controls keep the same IDs',()=>{
  const state={...createBrowserAutomationState(),owner:'paused' as const,activity:'error' as const,error:'cleanup_unconfirmed'}
  assert.equal(browserAgentNativePanel({state}).actions.get('agent-primary'),'reload')
  assert.equal(browserAgentNativePanel({state:{...state,nativeConfirmed:false}}).actions.get('agent-primary'),'retryAutomation')
  assert.equal(nodes(browserAgentNativePanel({state}).content).find(node=>node.id==='agent-primary')?.type,'button')
})
test('download IDs and progress survive reordering while actions reflect the current entry state',()=>{
  const a=download({receivedBytes:25,totalBytes:100,canPause:true}),b=download({id:'b',state:'paused',canResume:false})
  const first=browserDownloadsNativePanel([a,b]),second=browserDownloadsNativePanel([b,{...a,receivedBytes:70}])
  const id=browserNativeId('download',a.id)
  assert.equal(nodes(first.content).find(node=>node.id===`${id}-progress`)?.value,.25)
  assert.equal(nodes(second.content).find(node=>node.id===`${id}-progress`)?.value,.7)
  assert.equal(first.actions.get(`${id}-pause`)?.action,'pause')
  assert.equal(first.actions.has(`${browserNativeId('download','b')}-resume`),false)
  assert.equal(browserDownloadsNativePanel([{...a,state:'completed'}]).actions.has(`${id}-pause`),false)
  assert.equal(browserDownloadsNativePanel([{...a,state:'completed'}]).actions.get(`${id}-open`)?.action,'open')
})
test('download controls distinguish tool tasks, live cancellation and unknown byte counts',()=>{
  const tool=download({source:'tool',canPause:true,receivedBytes:-4,totalBytes:0}),native=browserDownloadsNativePanel([tool])
  const id=browserNativeId('download',tool.id)
  assert.equal(nodes(native.content).find(node=>node.id===`${id}-progress`)?.value,-1)
  assert.equal(native.actions.get(`${id}-stop`)?.action,'stop')
  assert.equal(native.actions.has(`${id}-cancel`),false)
  assert.equal(native.actions.has(`${id}-remove`),false)
  assert.equal(browserDownloadsNativePanel([download({canCancel:false})]).actions.has(`${id}-cancel`),false)
  assert.equal(nodes(browserDownloadsNativePanel([download({state:'paused'})]).content).find(node=>node.id===`${id}-progress`)?.visible,false,'Paused unknown totals do not keep an indeterminate progress animation visible')
})
test('long download lists remain entirely reachable within native tree limits',()=>{
  const entries=Array.from({length:205},(_,index)=>download({id:`entry-${index}`,state:'completed'}))
  const visited=new Set<string>()
  for(let offset=0;offset<entries.length;offset+=40){
    const panel=browserDownloadsNativePanel(entries,{offset}),all=nodes(panel.content)
    assert.ok(all.length<2000)
    assert.equal(new Set(all.map(node=>node.id)).size,all.length)
    for(const action of panel.actions.values())if('id'in action)visited.add(action.id)
    assert.equal(panel.actions.has('downloads-previous'),offset>0)
    assert.equal(panel.actions.has('downloads-more'),offset+40<entries.length)
  }
  assert.equal(visited.size,entries.length)
  assert.equal(browserDownloadsNativePanel(entries,{offset:9999}).offset,200)
})
test('address suggestions keep short stable IDs and only map current visible URL choices',()=>{
  const huge=`https://example.test/${'long'.repeat(3000)}`,a={url:huge,title:'长地址',kind:'history'},b={url:'https://b.test',title:'B',kind:'input'}
  const first=browserAddressNativePanel([a,b],1),next=browserAddressNativePanel([b,a],0)
  assert.ok(nodes(first.content).every(node=>node.id.length<=256))
  assert.equal(first.actions.get(browserNativeId('address',`history:${huge}`)),huge)
  assert.equal(next.actions.get(browserNativeId('address',`history:${huge}`)),huge)
  assert.match(nodes(next.content).find(node=>node.id===browserNativeId('address',`input:${b.url}`))?.text||'',/^› /)
  assert.equal(browserAddressNativePanel([b],-1).actions.has(browserNativeId('address',`history:${huge}`)),false)
  const matching=nodes(browserAddressNativePanel([a,{...a,kind:'input'}],-1).content)
  assert.equal(new Set(matching.map(node=>node.id)).size,matching.length)
})
