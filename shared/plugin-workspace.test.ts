import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {PluginRecord} from './plugins'
import type {StoreCatalogProduct} from './store'
import {currentPluginProducts,pluginWorkspaceEntries} from './plugin-workspace'

const local:PluginRecord={id:'text-local',dirName:'text-local',name:'文本处理',description:'整理文本',enabled:true,bundled:false,path:'D:/plugins/text',kind:'installed',source:'安装',tools:['reverse_text'],hasReadme:true,version:'1.0.0'}
const product:StoreCatalogProduct={kind:'plugin',productId:'text-suite',name:'文本套件',description:'编辑和整理',displayMode:'suite',packages:[{id:'text-local',name:'本地版',description:'不联网',versions:[]},{id:'text-network',name:'联网版',description:'联网处理',versions:[]}],installed:{packageId:'obsolete',version:'0.1.0'}}

test('workspace resolves suite installation from local packages and removes stale store installation flags',()=>{
  assert.deepEqual(currentPluginProducts([product],[local])[0].installed,{packageId:local.id,version:local.version,name:local.name})
  assert.equal(currentPluginProducts([product],[])[0].installed,undefined)
  assert.equal(product.installed?.packageId,'obsolete','Catalog inputs are unchanged')
  assert.equal(currentPluginProducts([{...product,kind:'skill'}],[local]).length,0)
})
test('plugin search combines local tools and catalog variants without duplicating installed packages',()=>{
  assert.deepEqual(pluginWorkspaceEntries([local],[product],'search','').map(row=>row.key),['local:text-local'])
  assert.deepEqual(pluginWorkspaceEntries([local],[product],'installed',' REVERSE 文本 ').map(row=>row.key),['local:text-local'])
  assert.deepEqual(pluginWorkspaceEntries([local],[product],'search','联网版').map(row=>row.key),['store:text-suite'])
  assert.equal(pluginWorkspaceEntries([local],[product],'store','文本 套件')[0].product?.installed?.packageId,local.id)
  assert.equal(pluginWorkspaceEntries([local],[product],'installed','missing').length,0)
})
