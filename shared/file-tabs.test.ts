import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyFileTabs,openFileTab,openBrowserTab,showFileWorkspace,closeFileTab,restoreFileTabs,persistedFileTabs,makeFileTab,workspaceLinkPath,removeFileOwner,type FileTabs,type FileTab} from './file-tabs'
import {makeQuestionnaireTab,openQuestionnaireTab} from './file-tabs'

test('questionnaires reuse one stable tab while preserving surrounding files and owner metadata',()=>{
  const files=openFileTab(openFileTab(emptyFileTabs(),'first','before.md'),'first','after.md')
  const first=openQuestionnaireTab(files,{chatId:'first',questionnaireId:'question-1',questionnaireRevision:1})
  const replaced=openQuestionnaireTab(first,{chatId:'second',questionnaireId:'question-2',questionnaireRevision:2})
  assert.equal(replaced.tabs.length,3)
  assert.equal(replaced.active,'questionnaire')
  assert.deepEqual(replaced.tabs.slice(0,2),files.tabs)
  assert.deepEqual(replaced.tabs[2],makeQuestionnaireTab({chatId:'second',questionnaireId:'question-2',questionnaireRevision:2}))
  assert.deepEqual(restoreFileTabs(replaced),replaced)
  assert.throws(()=>makeQuestionnaireTab({chatId:'../bad',questionnaireId:'q'}))
  assert.throws(()=>makeQuestionnaireTab({chatId:'owner',questionnaireId:'q',questionnaireRevision:-1}))
})

test('singleton replacement works at the tab limit and restore strips unsupported questionnaire capabilities',()=>{
  let state=openQuestionnaireTab(emptyFileTabs(),{chatId:'owner',questionnaireId:'first'})
  for(let i=0;i<31;i++)state=openFileTab(state,'owner',`${i}.txt`)
  const replaced=openQuestionnaireTab(state,{chatId:'owner',questionnaireId:'second'})
  assert.equal(replaced.tabs.length,32)
  const restored=restoreFileTabs({open:true,active:'questionnaire',tabs:[{...replaced.tabs[0],pinned:true,pageId:'foreign-native-page',url:'https://example.test'},{...replaced.tabs[0],questionnaireId:'duplicate'}]})
  assert.equal(restored.tabs.length,1)
  assert.equal(restored.tabs[0]?.pinned,undefined)
  assert.equal(restored.tabs[0]?.pageId,undefined)
  assert.equal(restored.tabs[0]?.url,undefined)
})
test('file tabs reuse paths, distinguish resource owners and close to a neighbouring tab',()=>{
  let state=openFileTab(emptyFileTabs(),'a','folder/report.md')
  state=openFileTab(state,'a','./folder\\report.md');assert.equal(state.tabs.length,1)
  state=openFileTab(state,'b','folder/report.md');assert.equal(state.tabs.length,2)
  const otherKey=state.active
  state=openFileTab(state,'a','image.png');assert.equal(state.tabs.length,3)
  state=closeFileTab(state,otherKey);assert.equal(state.tabs.length,2);assert.equal(state.active,state.tabs[1]!.key)
  state=closeFileTab(state,state.active);assert.equal(state.active,state.tabs[0]!.key)
  state=closeFileTab(state,state.active);assert.deepEqual(state,emptyFileTabs())
})
test('restoration stores metadata only and rejects unsafe paths',()=>{
  const valid=makeFileTab('owner','report.md')
  const state=restoreFileTabs({open:true,active:'missing',tabs:[valid,valid,{chatId:'owner',path:'../outside'},{chatId:'owner',path:'C:\\secret'}]})
  assert.deepEqual(state,{tabs:[valid],active:valid.key,open:true})
  assert.throws(()=>makeFileTab('owner','../private'))
})

test('browser tabs coexist with files during the run and unsafe restart targets are omitted',()=>{
  let state=openBrowserTab(openFileTab(emptyFileTabs(),'owner','report.md'),'owner')
  const browser=state.tabs[1]!
  assert.equal(browser.kind,'browser')
  browser.url='javascript:alert(1)'
  const restored=restoreFileTabs(state)
  assert.deepEqual(restored,{tabs:[state.tabs[0]!],active:state.tabs[0]!.key,open:true})
  assert.equal(state.tabs.length,2)
  state=closeFileTab(state,browser.key)
  assert.equal(state.active,state.tabs[0]!.key)
  assert.equal(state.tabs[0]!.path,'report.md')
  assert.equal(removeFileOwner(restored,'owner').tabs.length,0)
})

test('new browser tabs open beside the selected normal tab without reordering surrounding files',()=>{
  const files=openFileTab(openFileTab(emptyFileTabs(),'owner','first.md'),'owner','second.md')
  const first=files.tabs[0]!,second=files.tabs[1]!
  const opened=openBrowserTab({...files,active:first.key},'owner')
  assert.deepEqual(opened.tabs.map(tab=>tab.key),[first.key,opened.active,second.key])
  assert.equal(opened.tabs[1]!.kind,'browser')
  assert.deepEqual(opened.tabs.filter(tab=>tab.kind!=='browser'),files.tabs)
})

test('restart filtering preserves file positions and selects the retained right neighbour',()=>{
  const first=makeFileTab('owner','first.md'),middle=makeFileTab('owner','middle.md'),last=makeFileTab('owner','last.md')
  const visited:FileTab={key:'browser:visited',chatId:'owner',path:'新标签页',kind:'browser',url:'https://example.test/visited'}
  const blank:FileTab={key:'browser:blank',chatId:'owner',path:'新标签页',kind:'browser',url:'about:blank'}
  const pending:FileTab={key:'browser:pending',chatId:'owner',path:'正在加载',kind:'browser',url:'about:blank',desiredUrl:'https://example.test/pending',persistent:true,pageId:'old-page',loading:true}
  const temporary:FileTab={key:'browser:temporary',chatId:'owner',path:'临时网页',kind:'browser',url:'https://example.test/temporary',persistent:false}
  const state:FileTabs={tabs:[first,visited,blank,middle,temporary,pending,last],active:blank.key,open:true}
  const before=structuredClone(state)
  const restored=restoreFileTabs(state)
  assert.deepEqual(restored.tabs.map(tab=>tab.key),[first.key,visited.key,middle.key,pending.key,last.key])
  assert.equal(restored.active,middle.key)
  assert.deepEqual(restored.tabs.filter(tab=>tab.kind!=='browser'),[first,middle,last])
  assert.equal(restored.tabs[1]!.url,visited.url)
  assert.equal(restored.tabs[3]!.url,pending.desiredUrl)
  assert.equal(restored.tabs[3]!.desiredUrl,pending.desiredUrl)
  assert.equal(restored.tabs[3]!.pageId,undefined)
  assert.equal(restored.tabs[3]!.loading,undefined)
  assert.deepEqual(persistedFileTabs(state),restored)
  assert.deepEqual(state,before)
})

test('submitted loading and failed navigations survive restart through their desired URL',()=>{
  for(const loading of [true,false]){
    const tab:FileTab={key:'browser:submitted',chatId:'owner',path:loading?'正在加载':'加载失败',kind:'browser',url:'about:blank',desiredUrl:'https://example.test/target',loading}
    const restored=restoreFileTabs({tabs:[tab],active:tab.key,open:true})
    assert.equal(restored.tabs.length,1)
    assert.equal(restored.tabs[0]!.url,tab.desiredUrl)
    assert.equal(restored.active,tab.key)
    assert.equal(restored.open,true)
  }
})

test('blank-only restart snapshots close the workspace without deleting live tabs or creating a replacement',()=>{
  const live=openBrowserTab(emptyFileTabs(),'owner')
  assert.deepEqual(restoreFileTabs(live),emptyFileTabs())
  assert.deepEqual(persistedFileTabs(live),emptyFileTabs())
  assert.equal(live.tabs.length,1)
  assert.equal(live.open,true)
  const file=makeFileTab('owner','retained.md')
  const mixed=restoreFileTabs({tabs:[file,...live.tabs],active:live.active,open:true})
  assert.deepEqual(mixed,{tabs:[file],active:file.key,open:true})
})
test('workspace Markdown links decode local names and never accept traversal or protocols',()=>{
  assert.equal(workspaceLinkPath('./folder/report%20one.md#section'),'folder/report one.md')
  for(const href of ['https://example.com/a.md','//example.com/a','file:///private','%2e%2e/private','C:/private','#section','/absolute'])assert.equal(workspaceLinkPath(href),null)
})


test('document links resolve relative to their file and never escape the workspace',()=>{
  assert.equal(workspaceLinkPath('./note.txt','folder/guide.md'),'folder/note.txt')
  assert.equal(workspaceLinkPath('../preview.md','folder/guide.md'),'preview.md')
  assert.equal(workspaceLinkPath('assets/../note%20one.txt','folder/guide.md'),'folder/note one.txt')
  for(const link of ['../../outside','%2f%2fserver/private','%5c%5cserver/private','%00file'])assert.equal(workspaceLinkPath(link,'folder/guide.md'),null)
  assert.equal(makeFileTab('owner','folder//./note.txt').key,makeFileTab('owner','folder/note.txt').key)
})
test('full tab lists reuse canonical paths and owner deletion removes only affected resources',()=>{
  let state=emptyFileTabs()
  for(let i=0;i<32;i++)state=openFileTab(state,i<2?'foreign':'owner',`folder/${i}.txt`)
  assert.equal(openFileTab(state,'owner','./folder//31.txt').tabs.length,32)
  assert.throws(()=>openFileTab(state,'owner','another.txt'),/上限/)
  const next=removeFileOwner(state,'foreign')
  assert.equal(next.tabs.length,30);assert.equal(next.active,state.active)
  assert.equal(removeFileOwner(next,'owner').open,false)
})

test('opening an empty workspace creates one owned default tab and reopening reuses it',()=>{
  const first=showFileWorkspace(emptyFileTabs(),'owner')
  assert.equal(first.tabs.length,1);assert.equal(first.tabs[0]!.kind,'browser');assert.equal(first.tabs[0]!.chatId,'owner');assert.equal(first.open,true)
  const reopened=showFileWorkspace({...first,open:false},'owner')
  assert.deepEqual(reopened,first)
  const afterClose=showFileWorkspace(closeFileTab(first,first.active),'owner')
  assert.equal(afterClose.tabs.length,1);assert.notEqual(afterClose.active,first.active)
  assert.equal(showFileWorkspace(emptyFileTabs(),'other').tabs[0]!.chatId,'other')
})

test('showing an existing file workspace preserves its selection and never inserts a browser tab',()=>{
  const files=openFileTab(openFileTab(emptyFileTabs(),'owner','one.txt'),'owner','two.txt')
  assert.deepEqual(showFileWorkspace({...files,open:false},'owner'),files)
  const repaired=showFileWorkspace({...files,active:'missing'},'owner')
  assert.equal(repaired.tabs.length,2);assert.equal(repaired.active,files.tabs[0]!.key)
})
