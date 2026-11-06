import {app,BrowserWindow} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import {QuestionnaireStore} from '../electron/modules/questionnaire-store'
const root=process.env.NAVORA_DATA_ROOT!,output=process.env.NAVORA_UI_OUTPUT!,phase=process.env.NAVORA_QUESTIONNAIRE_PHASE!
app.setPath('userData',root);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')
const seedFile=path.join(root,'questionnaire-fixture.json')
if(phase==='seed'){
  const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false
  for(const provider of config.ai.providers)provider.base_url='http://127.0.0.1:9'
  fs.writeFileSync(path.join(root,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(root,'chats'),{recursive:true})
  const store=new QuestionnaireStore(root),now=Date.now(),ids:Record<string,string>={}
  for(const [index,name]of ['甲','乙'].entries()){
    const chatId=`questionnaire_chat_${index}`,title=`问卷集成${name}`
    const form=store.create({title:`${name}的需求确认`,questions:[{id:'name',type:'text',title:'项目名称',required:true},{id:'enabled',type:'toggle',title:'开启通知'}]},{chatId,runId:`fixture_run_${index}`,toolCallId:`fixture_call_${index}`,chatTitle:title})
    ids[chatId]=form.id
    fs.writeFileSync(path.join(root,'chats',chatId+'.json'),JSON.stringify({id:chatId,title,createdAt:now-index,updatedAt:now-index,messages:[{id:`user_${index}`,role:'user',content:'请集中确认需求。',createdAt:now-index},{id:`tool_${index}`,role:'tool',content:'正在等待填写问卷',createdAt:now-index,meta:{toolName:'agent_ask_form',toolCallId:`fixture_call_${index}`,questionnaireId:form.id,status:'running',args:{title:form.title}}}]}))
  }
  fs.writeFileSync(seedFile,JSON.stringify(ids))
}
const ids=JSON.parse(fs.readFileSync(seedFile,'utf8')) as Record<string,string>
const originalShowInactive=BrowserWindow.prototype.showInactive
BrowserWindow.prototype.show=function(){this.setPosition(-8000,-8000);originalShowInactive.call(this)}
BrowserWindow.prototype.focus=function(){}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false)
  const errors:string[]=[],checks:string[]=[]
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string)=>win.webContents.executeJavaScript(code)
    async function until(check:()=>Promise<unknown>,label:string){for(let n=0;n<160;n++){if(await check())return;await wait(50)}throw Error('Questionnaire application did not settle: '+label)}
    async function click(selector:string){await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait(70)}
    async function chooseChat(name:string){await js(`(()=>{const title=[...document.querySelectorAll('.chat-item-title-text')].find(el=>el.textContent.trim()===${JSON.stringify('问卷集成'+name)});if(!title)throw Error('chat missing');title.closest('.chat-item-main').click()})()`);await until(()=>js(`document.querySelector('.shell').dataset.chatId===${JSON.stringify('questionnaire_chat_'+(name==='甲'?0:1))}`),'chat '+name)}
    async function openCurrent(){
      const owner=await js('document.querySelector(".shell").dataset.chatId'),title=owner==='questionnaire_chat_0'?'甲的需求确认':'乙的需求确认'
      const ready=`document.querySelectorAll('.questionnaire-panel').length===1&&document.querySelector('.questionnaire-panel h1')?.textContent===${JSON.stringify(title)}&&!!document.querySelector('.questionnaire-panel input[aria-label=项目名称]')`
      await until(()=>js(`!!document.querySelector('.questionnaire-pending-dock button')||(${ready})`),'pending questionnaire entry')
      if(!await js(ready))await click('.questionnaire-pending-dock button')
      await until(()=>js(ready),'questionnaire panel for '+owner)
    }
    async function type(value:string){await js(`(()=>{const input=document.querySelector('.questionnaire-panel input[aria-label=项目名称]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
    try{
      await until(()=>js('document.querySelectorAll(".chat-item-title-text").length===2'),'seeded main chats')
      await chooseChat('甲');await openCurrent()
      if(phase==='seed'){
        await type('甲的持久草稿');await until(()=>js('document.querySelector(".questionnaire-save-status").textContent.includes("已保存")'),'draft saved')
        await click('[data-file-key=questionnaire] ~ .workspace-tab-close');await until(()=>js('!document.querySelector("[data-file-key=questionnaire]")'),'questionnaire tab closed');await openCurrent();assert.equal(await js('document.querySelector(".questionnaire-panel input[aria-label=项目名称]").value'),'甲的持久草稿');checks.push('main-chat-open-close-reopen-preserves-draft')
        await chooseChat('乙');await openCurrent();assert.equal(await js('document.querySelector(".questionnaire-panel input[aria-label=项目名称]").value'),'');await type('乙的独立草稿');await wait(550)
        await js(`window.dispatchEvent(new CustomEvent('navora:questionnaire.open',{detail:{id:${JSON.stringify(ids.questionnaire_chat_0)},chatId:'questionnaire_chat_0'}}))`)
        await until(()=>js('document.querySelector(".questionnaire-panel input[aria-label=项目名称]")?.value==="甲的持久草稿"'),'cross-chat card opens correct questionnaire')
        await wait(250)
        const opened=await js('JSON.parse(localStorage.getItem("navora.workspace-tabs.v2")).workspaces.flatMap(row=>row[1].tabs).filter(tab=>tab.kind==="questionnaire")')
        assert.equal(opened.length,1);assert.equal(opened[0].questionnaireId,ids.questionnaire_chat_0);checks.push('one-questionnaire-tab-across-chat-workspace-maps')
        assert.equal(await js('document.querySelector("[data-file-key=questionnaire]").closest(".workspace-tab-item").getAttribute("draggable")'),'false');checks.push('questionnaire-tab-cannot-detach')
        const stored=new QuestionnaireStore(root)
        assert.equal(stored.get(ids.questionnaire_chat_0)!.draft.answers.name!.value,'甲的持久草稿');assert.equal(stored.get(ids.questionnaire_chat_1)!.draft.answers.name!.value,'乙的独立草稿');checks.push('main-ipc-persists-independent-typed-drafts-on-disk')
        const directory=path.join(root,'questionnaires'),backup=path.join(root,'questionnaires-write-failure')
        fs.renameSync(directory,backup);fs.writeFileSync(directory,'write-failure-fixture')
        try{
          await type('发送前的新填写');await wait(430)
          await js('document.querySelector(".composer-input-row [contenteditable=true]").focus()');win.webContents.insertText('先解释这些问题')
          await until(()=>js('document.querySelector(".composer-submit-button")?.disabled===false'),'composer ready to return to chat')
          await click('.composer-submit-button');await until(()=>js('document.body.textContent.includes("请先保存问卷草稿或处理版本冲突，再切回聊天")'),'failed questionnaire save blocks chat submit')
          assert.equal(await js(`window.navora.questionnaires.get(${JSON.stringify(ids.questionnaire_chat_0)}).then(record=>record.status)`),'pending')
          assert.equal(await js('document.querySelector(".questionnaire-panel input[aria-label=项目名称]").value'),'发送前的新填写');checks.push('chat-send-cannot-end-questionnaire-before-draft-is-durable')
        }finally{fs.rmSync(directory);fs.renameSync(backup,directory)}
        await click('.questionnaire-save-status button');await until(()=>js('document.querySelector(".questionnaire-save-status").textContent.includes("已保存")'),'write failure repaired')
      }else{
        assert.equal(await js('document.querySelector(".questionnaire-panel input[aria-label=项目名称]").value'),'发送前的新填写');await chooseChat('乙');await openCurrent();assert.equal(await js('document.querySelector(".questionnaire-panel input[aria-label=项目名称]").value'),'乙的独立草稿');checks.push('new-app-process-restores-both-questionnaire-drafts')
        await click('.questionnaire-footer-actions .ui-button:not(.primary)');await until(()=>js('document.querySelector(".composer-input-row")?.checkVisibility()'),'return to chat');assert.equal(new QuestionnaireStore(root).get(ids.questionnaire_chat_1)!.status,'pending');checks.push('return-to-chat-does-not-cancel-before-user-sends')
      }
      assert.deepEqual(errors,[])
      fs.writeFileSync(path.join(output,phase+'.png'),(await win.webContents.capturePage()).toPNG());fs.writeFileSync(path.join(output,phase+'.json'),JSON.stringify({checks,errors,scope:'Actual main application, IPC and on-disk storage; isolated profile, no model requests.'},null,2));console.log(JSON.stringify({phase,checks:checks.length,output}));app.exit(0)
    }catch(error){fs.writeFileSync(path.join(output,phase+'-failed.png'),(await win.webContents.capturePage()).toPNG());fs.writeFileSync(path.join(output,phase+'-failed.json'),JSON.stringify({error:String(error),errors,checks},null,2));console.error(error);app.exit(1)}
  })())
})
await import('../electron/main')
