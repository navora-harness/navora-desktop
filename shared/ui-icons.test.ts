import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {resolveUiIcon,uiIconPaths,vuetifyIconAliases} from './ui-icons'

test('all application icon references are covered by the original SVG catalogue',()=>{
  const files=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):/\.(vue|ts)$/.test(entry.name)?[path.join(dir,entry.name)]:[])
  const missing=new Set<string>()
  for(const file of [...files('src'),path.join('shared','tool-display.ts')]){
    const source=fs.readFileSync(file,'utf8'),names=new Set<string>()
    for(const tag of source.matchAll(/<AppIcon\b([^>]+)/g)){
      const literal=tag[1].match(/(?<!:)\bicon="([a-z0-9-]+)"/)
      if(literal)names.add(literal[1])
      const dynamic=tag[1].match(/:icon="([^"]+)"/)
      if(dynamic)for(const match of dynamic[1].matchAll(/'([a-z0-9-]+)'/g))names.add(match[1])
    }
    for(const match of source.matchAll(/\bicon\s*:\s*'([a-z0-9-]+)'/g))names.add(match[1])
    for(const name of names)if(resolveUiIcon(name)==='circle-question'&&name!=='circle-question')missing.add(name+' in '+file)
    assert.equal(/font-awesome-icon|@fortawesome|@mdi\/font/.test(source),false,'Old icon renderers must not return: '+file)
  }
  assert.deepEqual([...missing],[])
})

test('form controls resolve to distinct check, radio, warning and navigation SVGs',()=>{
  for(const name of Object.values(vuetifyIconAliases))assert.ok(uiIconPaths[name],name)
  assert.notDeepEqual(uiIconPaths[vuetifyIconAliases.checkboxOn],uiIconPaths[vuetifyIconAliases.checkboxOff])
  assert.notDeepEqual(uiIconPaths[vuetifyIconAliases.radioOn],uiIconPaths[vuetifyIconAliases.radioOff])
  assert.equal(resolveUiIcon('unknown-extension-icon'),'circle-question')
})
