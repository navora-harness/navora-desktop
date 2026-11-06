import assert from 'node:assert/strict'
import {test} from 'node:test'
import {chatSearchPanel,readSourcesPanel,workspacePickerPanel,fitNativeDialogContent,nativeDialogMetrics} from './native-dialog-panels'
import {nativePanelNodes,nativePanelFirstFocusable} from './native-ui-validation'
import type {WorkspaceResource} from './workspace-resources'
const resource=(index:number,owner='chat-a'):WorkspaceResource=>({id:`file-${index}`,ownerChatId:owner,path:`docs/${index}.md`,name:`${index}.md`,kind:'document',size:1,mtimeMs:index,revision:`revision-${index}`,...(index%2?{evidence:{messageId:`message-${index}`,turnId:`turn-${index}`,answerId:`answer-${index}`,createdAt:1,operation:'file_write'}}:{})})
function picker(entries:WorkspaceResource[],extra:Partial<Parameters<typeof workspacePickerPanel>[0]>={}){return workspacePickerPanel({title:'文件',chatId:'chat-a',query:'',kind:'all',entries,loading:false,error:false,snapshot:{ok:true,entries,truncated:false,unavailable:0},page:0,showLocate:true,...extra})}
test('workspace native picker scopes resources and preserves evidence target priority',()=>{
  const result=picker([resource(1),resource(2),resource(3,'other-chat')])
  assert.deepEqual(result.matches.map(item=>item.id),['file-2','file-1'])
  const locate=[...result.actions.values()].find(item=>item.kind==='locate')!
  assert.equal(locate.messageId,'answer-1');assert.equal(locate.path,'docs/1.md')
  assert.ok(![...result.actions.values()].some(item=>item.path==='docs/3.md'))
  assert.equal(picker([resource(1),resource(2)],{kind:'artifact'}).matches.length,1)
  assert.equal(picker([resource(1)],{showLocate:false}).actions.size,1)
  nativePanelNodes(result.content)
})
test('native file pagination reaches every indexed file within the native node limit',()=>{
  const entries=Array.from({length:121},(_,index)=>resource(index)),seen=new Set<string>()
  for(let page=0;page<5;page++){
    const result=picker(entries,{page}),nodes=nativePanelNodes(result.content)
    assert.ok(nodes.size<300)
    for(const action of result.actions.values())if(action.kind==='open')seen.add(action.resourceId)
  }
  assert.equal(seen.size,entries.length)
  assert.equal(picker(entries,{page:999}).page,4)
  assert.equal(picker(entries,{query:'docs/120.md',page:4}).page,0)
})
test('native file actions change identity with owner or resource revision',()=>{
  const entry=resource(1),first=picker([entry]),next=picker([{...entry,revision:'changed'}]),other=picker([{...entry,ownerChatId:'chat-b'}],{chatId:'chat-b'})
  assert.notEqual([...first.actions.keys()][0],[...next.actions.keys()][0])
  assert.notEqual([...first.actions.keys()][0],[...other.actions.keys()][0])
  assert.equal([...next.actions.values()][0]!.revision,'changed')
})
test('unrelated native dialog refreshes omit input value to preserve live input and IME',()=>{
  const initial=picker([resource(1)],{query:'draft',includeValue:true}),update=picker([resource(1)],{query:'draft'})
  assert.equal(nativePanelNodes(initial.content).get('workspace-picker-query')!.value,'draft')
  assert.equal(Object.hasOwn(nativePanelNodes(update.content).get('workspace-picker-query')!,'value'),false)
  const hits=[{id:'chat-a',title:'会话',snippet:'命中的消息',relative:'刚刚'}]
  assert.equal(nativePanelNodes(chatSearchPanel(hits,'输入','chat-a',true).content).get('chat-search-query')!.value,'输入')
  assert.equal(Object.hasOwn(nativePanelNodes(chatSearchPanel(hits,'输入','chat-a').content).get('chat-search-query')!,'value'),false)
})

test('chat and file search put their query before close, refresh, filters and results',()=>{
  for(const includeValue of [false,true]){
    for(const hits of [[],[{id:'chat-a',title:'会话',snippet:'结果',relative:'刚刚'}]]){
      const tree=chatSearchPanel(hits,'输入','chat-a',includeValue).content
      assert.equal(nativePanelFirstFocusable(tree)?.id,'chat-search-query')
      assert.equal(nativePanelNodes(tree).get('chat-search-query')?.style?.borderless,true)
      assert.equal(nativePanelNodes(tree).get('chat-search-query')?.navigationTarget,hits.length?'chat-search-results':undefined)
    }
    for(const state of [{},{loading:true},{error:true},{entries:[]}]){
      const result=picker([resource(1)],{...state,includeValue})
      assert.equal(nativePanelFirstFocusable(result.content)?.id,'workspace-picker-query')
      assert.equal(nativePanelNodes(result.content).get('workspace-picker-close')?.type,'iconButton')
      assert.equal(nativePanelNodes(result.content).get('workspace-picker-query')?.navigationTarget,result.matches.length?'workspace-picker-results':undefined)
    }
  }
})
test('source pagination preserves order and duplicate URLs without retargeting a row',()=>{
  const sources=Array.from({length:67},(_,index)=>({url:`https://example.test/${Math.floor(index/2)}`,title:`来源 ${index}`,snippet:'摘要'})),seen:string[]=[]
  for(let page=0;page<3;page++){
    const result=readSourcesPanel(sources,'chat-a:answer-a',page);nativePanelNodes(result.content);seen.push(...result.actions.values())
  }
  assert.deepEqual(seen,sources.map(source=>source.url))
  assert.notEqual([...readSourcesPanel(sources,'chat-a:answer-a').actions.keys()][0],[...readSourcesPanel(sources,'chat-b:answer-b').actions.keys()][0])
  assert.equal(readSourcesPanel(sources,'context',999).page,2)
})
test('large read-only labels stay valid native previews while exact action URLs remain intact',()=>{
  const title='a'.repeat(8191)+'😀'+'b'.repeat(70000),url='https://example.test/full'
  const result=readSourcesPanel([{url,title,snippet:title}],'context'),nodes=nativePanelNodes(result.content)
  for(const node of nodes.values())if(node.type==='text')assert.equal(node.text?.includes('\uD83D…'),false)
  assert.deepEqual([...result.actions.values()],[url])
  nativePanelNodes(chatSearchPanel([{id:'chat-a',title,snippet:'',relative:'刚刚'}],'',null).content)
})
test('empty selectors omit result space and short lists grow with their contents',()=>{
  assert.equal(nativePanelNodes(chatSearchPanel([],'missing',null).content).has('chat-search-results'),false)
  assert.equal(nativePanelNodes(readSourcesPanel([],'context').content).has('read-sources-results'),false)
  assert.equal(nativePanelNodes(picker([]).content).has('workspace-picker-results'),false)
  const hit={id:'chat-a',title:'会话',snippet:'消息摘要',relative:'刚刚'},one=chatSearchPanel([hit],'','chat-a').content,many=chatSearchPanel(Array.from({length:20},(_,index)=>({...hit,id:String(index)})),'',null).content
  assert.ok(nativePanelNodes(one).get('chat-search-results')!.height!<100)
  assert.equal(nativePanelNodes(many).get('chat-search-results')!.height,240)
  const nodes=nativePanelNodes(one),heading=[...nodes.values()].find(node=>node.id.endsWith('-heading'))!
  assert.ok(heading.children!.some(node=>node.id.endsWith('-title')))
  assert.ok(heading.children!.some(node=>node.id.endsWith('-time')))
  assert.ok(nativePanelNodes(picker([resource(1)]).content).get('workspace-picker-results')!.height!<100)
  assert.equal(nativePanelNodes(picker(Array.from({length:20},(_,index)=>resource(index))).content).get('workspace-picker-results')!.height,300)
})
test('source rows show a fallback label once and keep the full URL in their tooltip',()=>{
  for(const source of [{url:'https://www.example.test/'},{url:'https://www.example.test/',siteName:'example.test',title:'https://www.example.test/'},{url:'https://www.example.test/',siteName:'Example',title:'Example',snippet:'Example'}]){
    const presentation=readSourcesPanel([source],'context'),nodes=nativePanelNodes(presentation.content),row=[...nodes.values()].find(node=>node.type==='item')!,texts=[...nodes.values()].filter(node=>node.type==='text'&&node.id.startsWith(row.id))
    assert.equal(texts.length,1)
    assert.equal(row.tooltip,source.url)
    assert.ok(nodes.get('read-sources-results')!.height!<70)
    assert.deepEqual([...presentation.actions.values()],[source.url])
  }
})
test('source summaries stay within two lines after narrowing, retaining the action identity',()=>{
  const source={url:'https://example.test/full/path',title:'一份详细文档',siteName:'示例网站',snippet:'这是一段长摘要。'.repeat(500)},presentation=readSourcesPanel([source],'context'),fitted=fitNativeDialogContent(presentation.content,{width:220,maxHeight:500}),nodes=nativePanelNodes(fitted.content),summary=[...nodes.values()].find(node=>node.type==='column'&&node.id.endsWith('-snippet'))!
  assert.equal(summary.children!.length,2)
  assert.ok(summary.children![1]!.text!.endsWith('…'))
  for(const node of summary.children!)assert.ok(node.maxWidth!<180)
  assert.ok([...presentation.actions.keys()].every(id=>nodes.get(id)?.type==='item'))
  assert.ok(nodes.get('read-sources-results')!.height!<150)
})
test('workspace refresh and all failure states share one retry entry while retaining readable files',()=>{
  const entries=[resource(1)]
  const empty=nativePanelNodes(picker([],{snapshot:{ok:true,entries:[],truncated:false,unavailable:2}}).content)
  assert.equal(empty.get('workspace-picker-status')!.text,'部分目录无法读取，请重试')
  for(const state of [{},{error:true},{snapshot:{ok:true,entries,truncated:false,unavailable:2}},{error:true,snapshot:{ok:true,entries,truncated:true,unavailable:2}},{loading:true,error:true}]){
    const presentation=picker(entries,state),nodes=nativePanelNodes(presentation.content),retries=[...nodes.values()].filter(node=>node.id==='workspace-picker-refresh'||node.id.startsWith('workspace-picker-retry'))
    assert.equal(retries.length,1)
    assert.equal(presentation.matches.length,1)
    assert.ok([...presentation.actions.values()].some(action=>action.kind==='open'))
    assert.equal(retries[0]!.disabled,!!state.loading)
    if(state.error||state.snapshot?.unavailable)assert.equal(retries[0]!.accessibleName,'重试读取文件')
    if(state.error&&!state.loading)assert.match(nodes.get('workspace-picker-status')!.text!,/已保留现有文件/)
  }
})
test('native dialog fitting shrinks the live tree to viewport width and height without changing query values or actions',()=>{
  const entries=Array.from({length:30},(_,index)=>resource(index)),initial=picker(entries,{query:'docs',includeValue:true}),fitted=fitNativeDialogContent(initial.content,{width:240,maxHeight:235}),nodes=nativePanelNodes(fitted.content)
  assert.equal(fitted.content.width,240)
  assert.ok(fitted.height<=235)
  assert.ok(nodes.get('workspace-picker-results')!.height!<150)
  assert.equal(nodes.get('workspace-picker-query')!.value,'docs')
  for(const id of initial.actions.keys())assert.ok(nodes.has(id))
  for(const node of nodes.values())if(node.type==='text')assert.ok(node.maxWidth!<=232)
  const tooShort=fitNativeDialogContent(initial.content,{width:240,maxHeight:80})
  assert.equal(tooShort.content.type,'list')
  assert.equal(tooShort.height,80)
  assert.equal(nativePanelFirstFocusable(tooShort.content)?.id,'workspace-picker-query')
  const resized=fitNativeDialogContent(initial.content,{width:460,maxHeight:650})
  assert.equal(nativePanelNodes(resized.content).get('workspace-picker-results')!.height,300)
})
test('global chat search stays compact in long and short viewports and reserves native frame space',()=>{
  const content=chatSearchPanel(Array.from({length:40},(_,index)=>({id:String(index),title:'对话',snippet:'命中的消息',relative:'刚刚'})),'对话',null).content
  const full=fitNativeDialogContent(content,{width:580,maxHeight:800}),short=fitNativeDialogContent(content,{width:300,maxHeight:300})
  assert.equal(nativePanelNodes(full.content).get('chat-search-results')!.height,240)
  assert.equal(nativePanelNodes(short.content).get('chat-search-results')!.height,135)
  assert.ok(short.height<200)
  for(const role of [undefined,'search'] as const){
    const metrics=nativeDialogMetrics(role),frame=fitNativeDialogContent(content,{width:390-16-metrics.width,maxHeight:500-16-metrics.height})
    assert.ok(frame.content.width!+29<=390-16,'reserve the measured native horizontal frame')
    assert.ok(frame.height+29+2*metrics.contentInset<=500-16,'reserve the measured native vertical frame and content inset')
  }
})
