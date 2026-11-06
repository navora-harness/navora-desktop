import test from 'node:test'
import assert from 'node:assert/strict'
import {browserAddressHistoryKey,browserAddressNativePanel,browserAgentNativePanel as createAgentPanel,browserDownloadContextMenu,browserDownloadsNativePanel,browserNativeId,browserTabsNativePanel,browserZoomNativeMenuItem,browserZoomTarget} from './browser-native-panels'
import {nativePanelNodes} from './native-ui-validation'
import {createBrowserAutomationState} from './browser-automation'
import type {BrowserDownloadEntry} from './types'
import type {NativePanelContent} from './native-ui'

function nodes(root:NativePanelContent):NativePanelContent[]{return [root,...(root.children||[]).flatMap(nodes)]}
// Every Agent state exercised below must also pass the actual bridge schema.
function browserAgentNativePanel(options:Parameters<typeof createAgentPanel>[0]){const panel=createAgentPanel(options);nativePanelNodes(panel.content);return panel}
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

test('compact Agent panel shows idle intent, real lease status and distinct action hierarchy',()=>{
  const idle=browserAgentNativePanel({state:createBrowserAutomationState()}),idleNodes=nodes(idle.content)
  assert.equal(idle.content.width,300)
  assert.match(idleNodes.find(node=>node.id==='agent-hint')?.text||'',/开始操作时自动隔离输入/)
  assert.equal(idleNodes.some(node=>node.id==='agent-input-protection'),false)
  assert.equal(idleNodes.some(node=>node.id==='agent-pointer'),false)
  assert.equal(idleNodes.find(node=>node.id==='agent-primary')?.variant,'default')
  assert.equal(idleNodes.find(node=>node.id==='agent-pause')?.variant,'plain')
  assert.equal(idleNodes.find(node=>node.id==='agent-settings')?.variant,'plain')
  assert.equal(idleNodes.find(node=>node.id==='agent-settings')?.tooltip,'自动化设置')
  assert.equal(idleNodes.find(node=>node.id==='agent-pause')?.tooltip,'暂停本页 AI 操作')
  const active=browserAgentNativePanel({state:{...createBrowserAutomationState(),leaseRunId:'run',inputProtected:true,isolateInput:true,keepRendering:true,cursorVisible:false}}),activeNodes=nodes(active.content)
  assert.equal(activeNodes.find(node=>node.id==='agent-input-protection')?.text,'输入保护：已生效')
  assert.equal(activeNodes.find(node=>node.id==='agent-cursor')?.text,'光标：已隐藏')
  const selecting=browserAgentNativePanel({state:createBrowserAutomationState(),selecting:true,selectionBusy:true})
  assert.deepEqual([...selecting.actions.values()],['settings'])
  assert.match(nodes(selecting.content).find(node=>node.id==='agent-hint')?.text||'',/退出批注选择/)
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
  assert.equal(browserDownloadsNativePanel([{...a,state:'completed'}]).actions.get(`${id}-row`)?.action,'open')
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

test('download empty state has no disabled clearing bar and every state passes the native bridge',()=>{
  const empty=browserDownloadsNativePanel([]),emptyNodes=nativePanelNodes(empty.content)
  assert.equal(empty.content.width,384)
  assert.equal(emptyNodes.has('downloads-clear'),false)
  assert.equal(emptyNodes.has('downloads-list'),false)
  assert.equal(emptyNodes.get('downloads-empty-hint')?.text,'下载的文件会显示在这里')
  for(const state of ['intercepted','started','paused','completed','failed','cancelled'] as const){
    const panel=browserDownloadsNativePanel([download({state,canPause:true,canResume:true,error:'连接已中断',relPath:'下载/资料.zip'})])
    const all=nativePanelNodes(panel.content)
    for(const id of panel.actions.keys()){
      assert.ok(all.has(id),`Action ${id} must have a real native control`)
      assert.notEqual(all.get(id)?.disabled,true)
    }
    assert.equal(all.has('downloads-clear'),['completed','failed','cancelled'].includes(state))
  }
})

test('download file rows open only completed files and retain independent labeled controls',()=>{
  const id=browserNativeId('download','download-1')
  const complete=browserDownloadsNativePanel([download({state:'completed',filename:'资料'.repeat(1000)+'.zip'})],{width:280})
  const all=nativePanelNodes(complete.content)
  assert.equal(complete.content.width,280)
  assert.equal(all.get(`${id}-row`)?.type,'item')
  assert.equal(complete.actions.get(`${id}-row`)?.action,'open')
  assert.equal(all.get(`${id}-reveal`)?.type,'iconButton')
  assert.equal(all.get(`${id}-reveal`)?.accessibleName,'在文件夹中显示')
  assert.notEqual(all.get(`${id}-name`)?.singleLine,true)
  assert.equal(all.get(`${id}-name`)?.maxLines,2)
  assert.equal(all.get(`${id}-name`)?.height,undefined,'Native shaping determines line count')
  assert.equal(all.get(`${id}-row`)?.contextMenu,true)
  assert.ok(all.get(`${id}-name`)!.maxWidth!<280)
  const pending=browserDownloadsNativePanel([download({state:'started'})])
  assert.equal(pending.actions.has(`${id}-row`),false)
})

test('download context commands respect live capabilities and distinguish record removal from file deletion',()=>{
  const ids=(item:BrowserDownloadEntry)=>browserDownloadContextMenu(item).map(entry=>entry.id)
  assert.deepEqual(ids(download({state:'completed'})),['open','reveal','copy','separator','remove'])
  assert.deepEqual(ids(download({state:'started',canPause:true,canCancel:false})),['pause','copy','separator','remove'])
  assert.deepEqual(ids(download({source:'tool',state:'started'})),['stop','copy'])
  assert.deepEqual(ids(download({state:'paused',canResume:false,url:'file:///private'})),['cancel','separator','remove'])
  assert.equal(nodes(browserDownloadsNativePanel([]).content).find(node=>node.id==='downloads-heading')?.text,'下载')
})
test('address suggestions keep short stable IDs and only map current visible URL choices',()=>{
  const huge=`https://example.test/${'long'.repeat(3000)}`,a={url:huge,title:'长地址',kind:'history'},b={url:'https://b.test',title:'B',kind:'input'}
  const first=browserAddressNativePanel([a,b],1),next=browserAddressNativePanel([b,a],0)
  assert.ok(nodes(first.content).every(node=>node.id.length<=256))
  assert.equal(first.actions.get(browserNativeId('address',`history:${huge}`)),huge)
  assert.equal(next.actions.get(browserNativeId('address',`history:${huge}`)),huge)
  assert.equal(nodes(next.content).find(node=>node.id===browserNativeId('address',`input:${b.url}`))?.selected,true)
  assert.equal(nodes(next.content).find(node=>node.id===browserNativeId('address',`input:${b.url}`))?.type,'item')
  assert.equal(browserAddressNativePanel([b],-1).actions.has(browserNativeId('address',`history:${huge}`)),false)
  const matching=nodes(browserAddressNativePanel([a,{...a,kind:'input'}],-1).content)
  assert.equal(new Set(matching.map(node=>node.id)).size,matching.length)
})
test('address selection is bound to its page and query; narrow fields omit secondary text without losing the URL action',()=>{
  const choice={url:'https://example.test/complete/path',title:'A complete page title',kind:'history'}
  const first=browserAddressNativePanel([choice],0,{width:630,query:'page',contextKey:'page-1:page'}),otherQuery=browserAddressNativePanel([choice],0,{width:630,query:'complete',contextKey:'page-1:complete'}),otherPage=browserAddressNativePanel([choice],0,{contextKey:'page-2:page'})
  const id=[...first.actions.keys()][0]!
  assert.equal(otherQuery.actions.has(id),false)
  assert.equal(otherPage.actions.has(id),false)
  assert.equal(first.content.width,630)
  const title=nodes(first.content).find(node=>node.id===`${id}-title`)!
  assert.deepEqual(title.highlights,[{start:11,end:15}])
  assert.equal(title.singleLine,true)
  const narrow=browserAddressNativePanel([choice],0,{width:180})
  assert.equal(nodes(narrow.content).filter(node=>node.type==='text').length,1)
  assert.equal([...narrow.actions.values()][0],choice.url)
  assert.equal(narrow.content.scrollbarPlacement,'gutter')
  assert.equal(browserAddressNativePanel(Array.from({length:12},(_,index)=>({...choice,url:`https://example.test/${index}`})),-1,{maxHeight:120}).content.height,120)
})
test('native labels keep Unicode and valid UTF-16 highlight offsets at their display limit',()=>{
  const model=browserAddressNativePanel([{url:'https://example.test',title:'a'.repeat(3999)+'👩🏽‍💻',kind:'history'}],-1,{query:'a'})
  const label=nodes(model.content).find(node=>node.id.endsWith('-title'))!
  assert.equal(label.text?.length,3999)
  assert.ok(!/[\ud800-\udbff]$/.test(label.text!))
  assert.ok(label.highlights!.every(range=>range.start>=0&&range.end<=label.text!.length))
})
test('address history delete targets are distinct native controls, scoped to real visits and the current chat',()=>{
  const visit={chatId:'chat-a',url:'https://example.test/history',title:'曾经访问',visitedAt:1234,kind:'history'}
  const presentation=browserAddressNativePanel([visit,{...visit,kind:'input'},{...visit,kind:'link'},{...visit,url:'https://elsewhere.test',chatId:'chat-b'}],0,{chatId:'chat-a',contextKey:'page-a:query-1'})
  assert.equal(presentation.deletions.size,1)
  const [id,target]=[...presentation.deletions][0]!,all=nodes(presentation.content),control=all.find(node=>node.id===id)!
  assert.equal(control.type,'iconButton');assert.equal(control.accessibleName,'删除此历史记录')
  assert.deepEqual(target,{chatId:'chat-a',url:visit.url,title:visit.title,visitedAt:1234})
  assert.equal(presentation.actions.has(id),false,'Deleting must never route to navigation')
  const row=all.find(node=>node.type==='item'&&node.children?.some(child=>child.id===id))!
  assert.equal(row.style?.align,'center','Horizontal native rows use cross-axis centering, not top alignment')
  assert.equal(row.children?.find(child=>child.type==='icon')?.icon,'clock')
  assert.equal(row.children?.find(child=>child.id.endsWith('-title'))?.style?.align,'start','Centering the row must not center its text')
  assert.equal(browserAddressNativePanel([visit],0).deletions.size,0)
  assert.equal(browserAddressNativePanel([{...visit,url:''},{...visit,visitedAt:NaN}],0,{chatId:'chat-a'}).deletions.size,0)
})
test('address history requests reject stale query or visit IDs and pending deletion does not disable navigation',()=>{
  const visit={chatId:'chat-a',url:'https://example.test/history',title:'历史记录',visitedAt:1,kind:'history'},options={chatId:'chat-a',contextKey:'page-a:query-1'}
  const first=browserAddressNativePanel([visit],0,options),id=[...first.deletions.keys()][0]!,key=browserAddressHistoryKey(visit)
  const pending=browserAddressNativePanel([visit],0,{...options,deleting:new Set([key])})
  assert.equal(pending.deletions.has(id),false)
  assert.equal(nodes(pending.content).find(node=>node.id===id)?.disabled,true)
  assert.equal(pending.actions.size,1)
  assert.equal(browserAddressNativePanel([visit],0,{...options,contextKey:'page-a:query-2'}).deletions.has(id),false)
  assert.equal(browserAddressNativePanel([{...visit,visitedAt:2}],0,options).deletions.has(id),false)
  const failed=browserAddressNativePanel([visit],0,{...options,deletionError:'删除失败，请重试'})
  assert.equal(failed.deletions.has(id),true)
  assert.equal(nodes(failed.content).find(node=>node.id==='address-delete-error')?.text,'删除失败，请重试')
})
test('native tab search does not send a stale input value when only its results or active highlight change',()=>{
  const tabs=[{id:'a',title:'Same title',url:'https://one.test/a'},{id:'b',title:'Same title',url:'https://two.test/b'}]
  const initial=browserTabsNativePanel(tabs,'b','Same',{includeQueryValue:true,contextKey:'host-1'}),updated=browserTabsNativePanel([...tabs].reverse(),'a','Same',{contextKey:'host-1'})
  assert.equal(nodes(initial.content).find(node=>node.id==='tab-list-query')?.value,'Same')
  assert.equal(nodes(initial.content).find(node=>node.id==='tab-list-query')?.navigationTarget,'tab-list-results')
  assert.ok(nodes(initial.content).filter(node=>node.type==='item').every(node=>node.contextMenu===false))
  assert.equal('value' in nodes(updated.content).find(node=>node.id==='tab-list-query')!,false)
  assert.deepEqual([...initial.actions.keys()].sort(),[...updated.actions.keys()].sort())
  assert.equal(nodes(updated.content).filter(node=>node.type==='item'&&node.selected).length,1)
  assert.ok(nodes(updated.content).some(node=>node.text==='one.test/a'))
  const changed=browserTabsNativePanel(tabs,'b','title',{contextKey:'host-1'})
  assert.ok([...initial.actions.keys()].every(id=>!changed.actions.has(id)))
})
test('native tab filtering remains within native node limits and never maps hidden truncated entries',()=>{
  const tabs=Array.from({length:181},(_,index)=>({id:`tab-${index}`,title:`Tab ${index}`})),model=browserTabsNativePanel(tabs,'tab-0','')
  assert.equal(model.actions.size,180)
  assert.equal([...model.actions.values()].includes('tab-180'),false)
  assert.ok(nodes(model.content).length<2000)
  assert.equal(new Set(nodes(model.content).map(node=>node.id)).size,nodes(model.content).length)
  assert.ok(nodes(model.content).some(node=>node.id==='tab-list-more'))
  assert.equal(browserTabsNativePanel(tabs,'tab-0','Tab 180').actions.size,1)
  assert.equal(nodes(browserTabsNativePanel(tabs,'tab-0','',{listHeight:100}).content).find(node=>node.id==='tab-list-results')?.height,100)
})
test('native zoom controls retain a single grouped row, real percentages and independent min/max/reset actions',()=>{
  const min=browserZoomNativeMenuItem(.25),max=browserZoomNativeMenuItem(3),busy=browserZoomNativeMenuItem(1.25,true)
  assert.equal(min.controls?.find(control=>control.id==='out')?.enabled,false)
  assert.equal(max.controls?.find(control=>control.id==='in')?.enabled,false)
  assert.equal(busy.controls?.find(control=>control.id==='value')?.label,'125%')
  assert.ok(busy.controls?.filter(control=>control.type==='button').every(control=>control.enabled===false&&control.closeOnClick===false))
  assert.deepEqual(min.controls?.slice(0,3).map(control=>control.group),[1,1,1])
  assert.equal(min.controls?.at(-1)?.group,undefined)
  assert.equal(browserZoomTarget(1.14,'in'),1.25)
  assert.equal(browserZoomTarget(1.14,'out'),1.1)
  assert.equal(browserZoomTarget(.25,'out'),.25)
  assert.equal(browserZoomTarget(3,'in'),3)
  assert.equal(browserZoomTarget(.33,'reset'),1)
  assert.equal(browserZoomTarget(1,'unknown'),undefined)
  assert.equal(browserZoomTarget(NaN,'in'),undefined)
})
