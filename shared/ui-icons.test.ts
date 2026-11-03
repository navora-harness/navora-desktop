import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {parse as parseJavaScript,parseExpression} from '@babel/parser'
import {NodeTypes,parse as parseTemplate} from '@vue/compiler-dom'
import {getUiIcon,resolveUiIcon,uiIconPaths,vuetifyIconAliases} from './ui-icons'

type SyntaxNode={type:string;[key:string]:unknown}
function isNode(value:unknown):value is SyntaxNode{return !!value&&typeof value==='object'&&'type' in value&&typeof value.type==='string'}
function walk(value:unknown,visit:(node:SyntaxNode)=>void){
  if(Array.isArray(value)){for(const item of value)walk(item,visit);return}
  if(!isNode(value))return
  visit(value)
  for(const child of Object.values(value))if(child&&typeof child==='object')walk(child,visit)
}
/** Collect possible icon values, rather than strings used to decide which value wins. */
function iconValues(node:unknown,names:Set<string>){
  if(!isNode(node))return
  switch(node.type){
    case 'StringLiteral':if(typeof node.value==='string'&&/^[a-z0-9-]+$/.test(node.value))names.add(node.value);break
    case 'ConditionalExpression':iconValues(node.consequent,names);iconValues(node.alternate,names);break
    case 'LogicalExpression':if(node.operator!=='&&')iconValues(node.left,names);iconValues(node.right,names);break
    case 'TSAsExpression':case 'TSSatisfiesExpression':case 'TSNonNullExpression':case 'ParenthesizedExpression':iconValues(node.expression,names);break
    case 'SequenceExpression':if(Array.isArray(node.expressions))iconValues(node.expressions.at(-1),names);break
    case 'MemberExpression':case 'OptionalMemberExpression':if(isNode(node.object)&&node.object.type==='ObjectExpression'&&Array.isArray(node.object.properties))for(const property of node.object.properties)if(isNode(property)&&property.type==='ObjectProperty')iconValues(property.value,names);break
  }
}
function objectIcons(node:unknown,names:Set<string>){
  walk(node,item=>{
    if(item.type!=='ObjectProperty'||!isNode(item.key))return
    const key=item.key.type==='Identifier'?item.key.name:item.key.type==='StringLiteral'?item.key.value:undefined
    if(key==='icon')iconValues(item.value,names)
  })
}
function referencedIcons(source:string,vue:boolean):Set<string>{
  const names=new Set<string>()
  if(vue){
    const visit=(node:ReturnType<typeof parseTemplate>['children'][number])=>{
      if(node.type!==NodeTypes.ELEMENT)return
      for(const prop of node.props){
        if(node.tag==='AppIcon'&&prop.type===NodeTypes.ATTRIBUTE&&prop.name==='icon'&&prop.value)names.add(prop.value.content)
        if(prop.type!==NodeTypes.DIRECTIVE||prop.exp?.type!==NodeTypes.SIMPLE_EXPRESSION)continue
        const isIcon=node.tag==='AppIcon'&&prop.name==='bind'&&prop.arg?.type===NodeTypes.SIMPLE_EXPRESSION&&prop.arg.content==='icon'
        try{
          const expression=parseExpression(prop.exp.content,{plugins:['typescript']})
          if(isIcon)iconValues(expression,names)
          objectIcons(expression,names)
        }catch(error){if(isIcon)throw error}
      }
      for(const child of node.children)visit(child)
    }
    for(const node of parseTemplate(source).children)visit(node)
  }
  const scripts=vue?[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]):[source]
  for(const script of scripts)objectIcons(parseJavaScript(script,{sourceType:'module',plugins:['typescript']}),names)
  return names
}

function browserMenuCustomIcons():Set<string>{
  const source=fs.readFileSync('src/components/BrowserTabContextMenu.vue','utf8'),names=new Set<string>()
  let branches=0
  const visit=(children:ReturnType<typeof parseTemplate>['children'])=>{
    const elements=children.filter(node=>node.type===NodeTypes.ELEMENT)
    for(const [index,node] of elements.entries()){
      if(node.tag==='BrowserTabAudioIcon'){
        branches++
        const condition=node.props.find(prop=>prop.type===NodeTypes.DIRECTIVE&&prop.name==='if')
        assert.ok(condition?.type===NodeTypes.DIRECTIVE&&condition.exp?.type===NodeTypes.SIMPLE_EXPRESSION,'Dedicated audio SVG must be conditionally selected')
        walk(parseExpression(condition.exp.content),part=>{
          if(part.type!=='BinaryExpression'||part.operator!=='==='||!isNode(part.left)||part.left.type!=='MemberExpression'||!isNode(part.left.property)||part.left.property.type!=='Identifier'||part.left.property.name!=='icon'||!isNode(part.right)||part.right.type!=='StringLiteral')return
          names.add(String(part.right.value))
        })
        const fallback=elements[index+1]
        assert.equal(fallback?.tag,'AppIcon','Only unmatched menu icons go to the generic catalogue')
        assert.ok(fallback.props.some(prop=>prop.type===NodeTypes.DIRECTIVE&&prop.name==='else'))
      }
      visit(node.children)
    }
  }
  visit(parseTemplate(source).children)
  assert.equal(branches,2,'Root and submenu entries both use the dedicated audio renderer')
  assert.deepEqual([...names].sort(),['tab-audio','tab-muted'])
  const svg=fs.readFileSync('src/components/BrowserTabAudioIcon.vue','utf8')
  assert.match(svg,/<svg\b/)
  assert.match(svg,/v-if="muted"/)
  assert.match(svg,/v-else-if="audible!==false"/,'Only playing or legacy unknown-audibility pages show sound waves; silent slots remain visually empty')
  return names
}

test('icon scanning distinguishes conditional values from status tests and lookup keys',()=>{
  const source=`<template><AppIcon :icon="kind==='running' && spin===false ? 'clock' : statusIcons[kind] || 'circle-check'" /><AppIcon :icon="count > 1 ? 'check' : 'xmark'" /><AppIcon :icon="statusIcons['stopped'] || 'triangle-exclamation'" /><ActionMenu :items="[{icon: mode === 'open' ? 'folder-open' : 'folder'}]" /></template><script setup lang="ts">const item={icon:'missing-real-icon'}; const text=":icon='not-an-icon-reference'"</script>`
  assert.deepEqual([...referencedIcons(source,true)].sort(),['check','circle-check','clock','folder','folder-open','missing-real-icon','triangle-exclamation','xmark'].sort())
  assert.equal(resolveUiIcon('missing-real-icon'),'circle-question','A returned missing icon is still rejected by catalogue coverage')
})

test('all application icon references are covered by the original SVG catalogue',()=>{
  const files=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):/\.(vue|ts)$/.test(entry.name)?[path.join(dir,entry.name)]:[])
  const missing=new Set<string>()
  const customMenuIcons=browserMenuCustomIcons()
  for(const file of [...files('src'),path.join('shared','tool-display.ts')]){
    const source=fs.readFileSync(file,'utf8'),names=referencedIcons(source,file.endsWith('.vue'))
    for(const name of names){
      // These two menu-data tokens route to a dedicated SVG component, never AppIcon.
      // Restrict that contract to its producer; direct AppIcon usage still fails.
      if(file.replaceAll(path.sep,'/')==='src/composables/useBrowserTabActions.ts'&&customMenuIcons.has(name))continue
      if(resolveUiIcon(name)==='circle-question'&&name!=='circle-question')missing.add(name+' in '+file)
    }
    assert.equal(/font-awesome-icon|@fortawesome|@mdi\/font/.test(source),false,'Old icon renderers must not return: '+file)
  }
  assert.deepEqual([...missing],[])
})

test('form controls resolve to distinct check, radio, warning and navigation SVGs',()=>{
  for(const name of Object.values(vuetifyIconAliases))assert.ok(uiIconPaths[name],name)
  assert.notDeepEqual(uiIconPaths[vuetifyIconAliases.checkboxOn],uiIconPaths[vuetifyIconAliases.checkboxOff])
  assert.notDeepEqual(uiIconPaths[vuetifyIconAliases.radioOn],uiIconPaths[vuetifyIconAliases.radioOff])
  for(const size of [16,20]){
    assert.notDeepEqual(getUiIcon(vuetifyIconAliases.checkboxOn,size).paths,getUiIcon(vuetifyIconAliases.checkboxOff,size).paths)
    assert.notDeepEqual(getUiIcon(vuetifyIconAliases.radioOn,size).paths,getUiIcon(vuetifyIconAliases.radioOff,size).paths)
  }
  assert.equal(resolveUiIcon('unknown-extension-icon'),'circle-question')
})
