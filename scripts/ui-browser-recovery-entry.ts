import {app,BrowserWindow,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {dispatchTrustedPointer} from '../electron/modules/trusted-input'
import {createDefaultConfig} from '../shared/config'

const root=process.env.NAVORA_DATA_ROOT!,output=process.env.NAVORA_UI_OUTPUT!,phase=process.env.NAVORA_RECOVERY_PHASE!,url=process.env.NAVORA_RECOVERY_URL!
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
BrowserWindow.prototype.show=function(){this.setPosition(-30000,-30000);this.showInactive()}
BrowserWindow.prototype.focus=function(){}
app.setPath('userData',root)
if(phase==='prepare'){
  const config=createDefaultConfig();config.app.onboarding_completed=true;config.app.show_main_on_start=true
  fs.writeFileSync(path.join(root,'config.yml'),JSON.stringify(config))
}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check:()=>Promise<unknown>,label:string){for(let i=0;i<160;i++){if(await check())return;await wait(50)}throw Error('Timed out: '+label)}
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false)
  win.webContents.once('did-finish-load',()=>{void(async()=>{
    const js=async(code:string)=>{try{return await win.webContents.executeJavaScript(code)}catch(error){console.error('[browser-recovery] Failed script:',code.slice(0,180));throw error}}
    try{
      await until(()=>js('!!window.navora&&!!document.querySelector(".composer")'),'main application ready')
      if(phase==='prepare'){
        const ids=await js(`(async()=>{const chat=await window.navora.chats.create('进程重启恢复');const page=await window.navora.browser.workspace.ensure(chat.id,'browser:restart-main',${JSON.stringify(url)});await window.navora.browser.setVisible(page,true);return {chatId:chat.id,pageId:page}})()`)
        await until(()=>js('!!document.querySelector(".browser-native-slot")'),'native viewport')
        await until(async()=>webContents.getAllWebContents().some(w=>w.getURL()===url),'fixture page')
        const guest=webContents.getAllWebContents().find(w=>w.getURL()===url)!
        await until(async()=>!guest.isLoading()&&await guest.executeJavaScript('!!document.querySelector("#target")'),'fixture document loaded')
        await js('document.querySelector(".browser-notes-toggle").click()')
        await until(()=>js('!!document.querySelector(".annotation-tools")'),'annotation tools ready')
        await wait(500)
        const notes=[]
        for(let index=0;index<2;index++){
          await js('[...document.querySelectorAll(".annotation-tools button")].find(button=>button.textContent.includes("选取元素")).click()')
          await until(()=>js('!!document.querySelector(".browser-selecting-text")&&![...document.querySelectorAll(".browser-tab-toolbar button")].find(button=>button.textContent.includes("取消选择"))?.disabled'),'selection ready after viewport layout')
          await guest.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
          const point=await guest.executeJavaScript('(()=>{const r=document.querySelector("#target").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()')
          await dispatchTrustedPointer(guest,{action:'move',...point});await dispatchTrustedPointer(guest,{action:'down',...point});await dispatchTrustedPointer(guest,{action:'up',...point})
          let captured:any[]=[]
          await until(async()=>{captured=await js(`window.navora.browser.workspace.annotations(${JSON.stringify(ids.chatId)})`);return captured.length===index+1},'real annotation captured')
          notes.push(captured[index])
          await until(()=>js('!document.querySelector(".browser-selecting-text")'),'capture completed')
        }
        const input={text:'退出应用后应保留的草稿',baseComment:'',baseRevision:1,editorId:'restart-writer',sequence:1,deleted:false}
        await js(`window.navora.browser.workspace.saveQuickLink(${JSON.stringify(ids.chatId)},{title:'重启后保留的入口',url:${JSON.stringify(url)}})`)
        await js(`window.navora.browser.workspace.writeAnnotationDraft(${JSON.stringify(ids.chatId)},${JSON.stringify(notes[0].id)},0,${JSON.stringify(input)})`)
        const conflict=await js(`window.navora.browser.workspace.writeAnnotationDraft(${JSON.stringify(ids.chatId)},${JSON.stringify(notes[0].id)},0,${JSON.stringify({...input,text:'退出应用后应保留的冲突副本',editorId:'other-writer'})}).then(()=>false,error=>String(error).includes('annotation_draft_conflict'))`)
        assert.equal(conflict,true)
        await js(`window.navora.browser.workspace.writeAnnotationDraft(${JSON.stringify(ids.chatId)},${JSON.stringify(notes[1].id)},0,${JSON.stringify({...input,text:'将被损坏文件隔离的草稿'})})`)
        const detachedId=await js(`(async()=>{const page=await window.navora.browser.workspace.ensure(${JSON.stringify(ids.chatId)},'browser:restart-detached',${JSON.stringify(url+'?detached=1')});await window.navora.browser.workspace.detach(page);return page})()`)
        await until(async()=>webContents.getAllWebContents().some(contents=>contents.getURL()===url+'?detached=1'&&!contents.isLoading()),'detached page loaded before quit')
        const info=await js(`window.navora.workspace.info(${JSON.stringify(ids.chatId)})`)
        fs.writeFileSync(path.join(output,'prepared.json'),JSON.stringify({...ids,detachedId,noteId:notes[0].id,corruptNoteId:notes[1].id,corruptFile:path.join(info.absolutePath,'browser-annotations','drafts',notes[1].id+'.json')}))
      }else{
        const saved=JSON.parse(fs.readFileSync(path.join(output,'prepared.json'),'utf8'))
        const rows=await js(`window.navora.browser.tree(${JSON.stringify(saved.chatId)})`),pages=rows.flatMap((session:any)=>session.windows)
        assert.equal(pages.length,2)
        const main=pages.find((page:any)=>page.windowId===saved.pageId),detached=pages.find((page:any)=>page.windowId===saved.detachedId)
        assert.ok(main&&detached,'Both original page identities survived')
        assert.equal(main.presentation,'embedded');assert.equal(detached.presentation,'detached')
        assert.equal(main.url,url)
        await until(async()=>BrowserWindow.getAllWindows().some(host=>host!==win&&host.webContents.getURL().includes('/browser-host/')),'detached host restored')
        const drafts=await js(`window.navora.browser.workspace.annotationDrafts(${JSON.stringify(saved.chatId)})`)
        const start=await js(`window.navora.browser.workspace.startPage(${JSON.stringify(saved.chatId)})`)
        assert.equal(start.links[0]?.title,'重启后保留的入口')
        assert.ok(start.history.some((visit:any)=>visit.url===url),'Visited addresses survive an entire application restart')
        assert.equal(drafts.find((row:any)=>row.annotationId===saved.noteId)?.text,'退出应用后应保留的草稿')
        const recovery=await js(`window.navora.browser.workspace.annotationDraftRecovery(${JSON.stringify(saved.chatId)})`)
        assert.equal(recovery.copies[0]?.text,'退出应用后应保留的冲突副本');assert.equal(recovery.issues.length,1)
        const info=await js(`window.navora.workspace.info(${JSON.stringify(saved.chatId)})`)
        assert.equal(fs.readFileSync(path.join(info.absolutePath,'browser-annotations','drafts',recovery.issues[0].fileName),'utf8'),'{interrupted draft file')
        assert.equal(await js(`(async()=>(await window.navora.browser.workspace.annotations(${JSON.stringify(saved.chatId)})).length)()`),2)
        await js(`window.navora.browser.setVisible(${JSON.stringify(saved.pageId)},true)`)
        await until(()=>js('!!document.querySelector(".browser-notes-toggle")'),'restored main browser toolbar')
        await js('if(!document.querySelector(".browser-annotations"))document.querySelector(".browser-notes-toggle").click()')
        await until(()=>js('!!document.querySelector(".draft-recovery")&&!!document.querySelector(".annotation-storage-warning")'),'copies and isolation warning visible')
        const field=`document.querySelector('[data-annotation-id="${saved.noteId}"]')`
        assert.equal(await js(field+'.value'),'退出应用后应保留的草稿')
        await js('document.querySelector("[aria-label=调整批注面板高度]").dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}));document.querySelector(".draft-recovery summary").click();document.querySelector(".draft-recovery").scrollIntoView({block:"end"})');await wait(200)
        const region=await js('(()=>{const r=document.querySelector(".browser-annotations").getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}})()')
        fs.writeFileSync(path.join(output,'recovered-drafts.png'),(await win.webContents.capturePage(region)).toPNG())
        await js('[...document.querySelectorAll(".draft-copy button")].find(button=>button.textContent.includes("合并到当前草稿")).click()')
        await until(()=>js(field+'.value==="退出应用后应保留的草稿\\n\\n退出应用后应保留的冲突副本"'),'explicit merge into current draft')
        const merged=await js(`window.navora.browser.workspace.annotationDrafts(${JSON.stringify(saved.chatId)})`)
        assert.equal(merged.find((row:any)=>row.annotationId===saved.noteId)?.text,'退出应用后应保留的草稿\n\n退出应用后应保留的冲突副本')
        await until(()=>js('!document.querySelector(".draft-recovery")'),'resolved copy removed after successful save')
        assert.equal(await js(`(async()=>(await window.navora.browser.workspace.annotations(${JSON.stringify(saved.chatId)})).find(note=>note.id===${JSON.stringify(saved.noteId)}).comment)()`),'','Merging does not submit an opinion automatically')
        fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks:['quick-link-whole-app-restore','history-whole-app-restore','new-application-process','graceful-quit-workspace-save','embedded-page-id-and-url','detached-page-and-host-restore','draft-text-disk-restore','conflict-copy-disk-restore','corrupt-file-isolation','original-corrupt-bytes-retained','healthy-annotations-visible','recovery-controls-visible','explicit-copy-merge-persisted','resolved-copy-cleanup','merge-awaits-opinion-save']}))
      }
      // Exercise the application's normal shutdown path, including before-quit.
      await js('void window.navora.app.quit();true').catch(error=>{if(!/destroyed|disposed/i.test(String(error)))throw error})
    }catch(error){console.error('[browser-recovery]',error);app.exit(1)}
  })()})
})
await import('../electron/main')
