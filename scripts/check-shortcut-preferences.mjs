import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-shortcut-state-')),entry=path.join(temporary,'check.mjs')
try{
  await build({stdin:{resolveDir:root,loader:'ts',contents:`
    import assert from 'node:assert/strict';
    import {createRenderer,h,nextTick} from 'vue';
    import {useAppShortcuts} from './src/composables/useAppShortcuts';
    import {createDefaultConfig} from './shared/config';
    import {applySettingsCommit} from './shared/settings-commit';
    import {configurableAppShortcutIds} from './shared/app-shortcuts';
    let current=createDefaultConfig(),rejectRead=true,rejectWrite=false;
    current.app.shortcuts['conversation.new']=false;
    const listeners=new Set();
    globalThis.window={navora:{config:{
      get:async()=>{if(rejectRead)throw Error('fixture read failed');return structuredClone(current)},
      onChanged:listener=>{listeners.add(listener);return ()=>listeners.delete(listener)},
      commit:async request=>{if(rejectWrite)throw Error('fixture write failed');current=applySettingsCommit(current,request);for(const listener of listeners)listener(structuredClone(current));return structuredClone(current)},
    }}};
    const renderer=createRenderer({
      createElement:tag=>({tag,children:[]}),createText:text=>({text}),createComment:text=>({text}),
      setText:(node,text)=>node.text=text,setComment:(node,text)=>node.text=text,setElementText:(node,text)=>node.text=text,
      patchProp:()=>{},parentNode:node=>node.parent,nextSibling:()=>null,
      insert:(node,parent)=>{node.parent=parent;parent.children.push(node)},remove:node=>{if(node.parent)node.parent.children=node.parent.children.filter(child=>child!==node)},
    });
    let preferences;
    const app=renderer.createApp({setup(){preferences=useAppShortcuts();return ()=>h('div')}});
    app.mount({children:[]});await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(preferences.available.value,false);assert.equal(preferences.reading.value,false);assert.match(preferences.error.value,/读取/);
    rejectRead=false;await preferences.reload();assert.equal(preferences.available.value,true);assert.equal(preferences.enabled('conversation.new'),false);assert.equal(preferences.error.value,'');
    await preferences.setEnabled('conversation.new',true);assert.equal(preferences.enabled('conversation.new'),true);
    rejectWrite=true;await preferences.setEnabled('conversation.new',false);assert.equal(preferences.enabled('conversation.new'),true);assert.equal(current.app.shortcuts['conversation.new'],true);assert.match(preferences.error.value,/未保存/);rejectWrite=false;
    current.app.language='en-US';current.browser.default_width=1599;current.app.shortcuts['app.quit']=false;for(const listener of listeners)listener(structuredClone(current));await nextTick();
    await preferences.reset();assert.ok(configurableAppShortcutIds.every(id=>current.app.shortcuts[id]===true));assert.equal(current.app.language,'en-US');assert.equal(current.browser.default_width,1599);
    app.unmount();assert.equal(listeners.size,0);
    console.log(JSON.stringify({ok:true,checks:['initial-read-failure-disables-preference-availability','retry-read-restores-saved-disabled-state','successful-save-updates-only-selected-command','failed-save-keeps-committed-state','reset-only-shortcuts-preserves-unrelated-settings','unmount-releases-config-subscription']}));
  `},outfile:entry,bundle:true,platform:'node',format:'esm',target:'node20',alias:{'@shared':path.join(root,'shared')}})
  const result=spawnSync(process.execPath,[entry],{cwd:root,stdio:'inherit',windowsHide:true})
  process.exitCode=result.status??1
}finally{
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporary))
  if(!relative.startsWith('navora-shortcut-state-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe shortcut state cleanup path')
  fs.rmSync(temporary,{recursive:true,force:true})
}
