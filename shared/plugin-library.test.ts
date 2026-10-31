import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PluginRecord } from './plugins'
import { filterPluginLibrary, pluginLibrarySource, pluginLibraryStatus } from './plugin-library'
const plugin = (extra:Partial<PluginRecord>):PluginRecord => ({id:'demo',dirName:'demo',name:'文本工具',description:'处理文本',enabled:true,bundled:false,path:'D:/plugins/demo',kind:'installed',source:'压缩包安装',tools:['demo_reverse'],hasReadme:true,...extra})
test('library separates creator snapshots, external links and bundled packages', () => {
  assert.equal(pluginLibrarySource(plugin({kind:'linked',path:'D:\\data\\creators\\creator_1234567890abcdef12345678\\releases\\revision-2'})).id,'creator')
  assert.equal(pluginLibrarySource(plugin({kind:'linked',path:'D:/my-creators/demo'})).id,'linked')
  assert.equal(pluginLibrarySource(plugin({kind:'linked',bundled:true})).id,'bundled')
})
test('search matches all tokens across readable names, IDs and tools while preserving input order', () => {
  const records = [plugin({}),plugin({id:'other',name:'另一插件',tools:['other_fetch'],enabled:false})]
  assert.deepEqual(filterPluginLibrary(records,' 文本  REVERSE ','all','all',new Set()).map(item=>item.id),['demo'])
  assert.deepEqual(filterPluginLibrary(records,'','disabled','all',new Set()).map(item=>item.id),['other'])
  assert.deepEqual(records.map(item=>item.id),['demo','other'])
  assert.equal(filterPluginLibrary(records,'missing','all','all',new Set()).length,0)
})
test('load failures and suite conflicts are attention states even if configuration says enabled', () => {
  assert.equal(pluginLibraryStatus(plugin({error:'load_failed'}),new Set()),'attention')
  assert.equal(pluginLibraryStatus(plugin({}),new Set(['demo'])),'attention')
})
