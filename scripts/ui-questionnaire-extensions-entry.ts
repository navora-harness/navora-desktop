import {app,BrowserWindow,ipcMain} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {QuestionnaireStore} from '../electron/modules/questionnaire-store'
import type {QuestionnaireDefinition,QuestionnaireDraftInput,QuestionnaireSubmitInput} from '../shared/questionnaire'
const output=process.env.NAVORA_UI_OUTPUT!,profile=process.env.NAVORA_DATA_ROOT!,url=process.env.NAVORA_QUESTIONNAIRE_URL!
async function run(){
  app.setPath('userData',profile);app.commandLine.appendSwitch('no-sandbox');app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  const store=new QuestionnaireStore(profile),definition:QuestionnaireDefinition={title:'扩展需求问卷',questions:[
    {id:'platform',type:'single',title:'目标平台',required:true,options:[{id:'desktop',label:'桌面应用'},{id:'web',label:'网页应用'}]},
    {id:'url',type:'text',title:'网站地址',required:true,showWhen:{questionId:'platform',equals:'web'}},
    {id:'date',type:'date',title:'期望完成日期',required:true,minDate:'2026-01-01',maxDate:'2026-12-31'},
    {id:'range',type:'dateRange',title:'项目周期',required:true},
    {id:'files',type:'attachment',title:'参考附件',required:true,accept:['.txt','.png'],maxFiles:2},
  ]}
  const initial=store.create(definition,{chatId:'extension-chat',chatTitle:'扩展测试',runId:'original-run',toolCallId:'original-tool'})
  await app.whenReady()
  const win=new BrowserWindow({show:false,width:1040,height:900,webPreferences:{preload:path.join(output,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}}),errors:string[]=[],checks:string[]=[]
  win.setPosition(-8000,-8000);win.showInactive();win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);if(event.level==='warning')console.log('renderer-warning',event.message)})
  store.onChanged(record=>win.webContents.send('questionnaire-extension-changed',record))
  ipcMain.handle('questionnaire-extension',(_event,method:string,...args:unknown[])=>{
    const id=String(args[0]||'')
    switch(method){
      case 'list':return store.list()
      case 'get':return store.get(id)
      case 'saveDraft':return store.saveDraft(id,args[1] as QuestionnaireDraftInput)
      case 'submit':{const result=store.submit(id,args[1] as QuestionnaireSubmitInput);if(result.ok)store.setContinuation(id,{state:'done'});return result}
      case 'attach':return store.attach(id,String(args[1]),args[2] as Array<{name:string;data:string}>)
      case 'openAttachment':return store.attachment(id,String(args[1]))
      case 'revise':return store.revise(id)
      case 'listTemplates':return store.listTemplates()
      case 'saveTemplate':return store.saveTemplate(id,String(args[1]))
      case 'deleteTemplate':return store.deleteTemplate(id)
      case 'useTemplate':return store.useTemplate(id,{chatId:String(args[1]),runId:'template-run',toolCallId:'template-tool'})
      case 'cancel':return store.cancel(id)
      default:throw Error('unsupported_fixture_method')
    }
  })
  const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),js=(code:string)=>win.webContents.executeJavaScript(code)
  async function until(test:()=>Promise<unknown>,label:string){for(let i=0;i<180;i++){if(await test())return;await wait(40)}throw Error('Timed out: '+label)}
  async function click(selector:string){await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait(80)}
  async function input(selector:string,value:string){await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(50)}
  const snapshot=async(name:string)=>fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG())
  try{
    await win.loadURL(url);await until(()=>js('document.querySelectorAll(".questionnaire-question").length===4'),'initial hidden branch')
    await click('.questionnaire-options label:nth-child(2) input');await until(()=>js('!!document.querySelector("[aria-label=网站地址]")'),'branch shown')
    await input('[aria-label=网站地址]','https://example.test');await click('.questionnaire-options label:first-child input');assert.equal(await js('!!document.querySelector("[aria-label=网站地址]")'),false)
    await input('[aria-label=期望完成日期]','2026-11-20');await input('[aria-label="项目周期：开始日期"]','2026-11-10');await input('[aria-label="项目周期：结束日期"]','2026-11-09')
    await click('button[type=submit]');assert.match(await js('document.querySelector(".questionnaire-panel").textContent'),/开始日期不能晚于结束日期/)
    await input('[aria-label="项目周期：结束日期"]','2026-11-20');checks.push('conditional-required-branch-and-calendar-range-validation')
    const source=path.join(profile,'参考.txt');fs.writeFileSync(source,'immutable attachment bytes')
    win.webContents.debugger.attach('1.3');const dom=await win.webContents.debugger.sendCommand('DOM.getDocument'),node=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[type=file]'})
    await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[source]});win.webContents.debugger.detach()
    await until(()=>js('document.querySelector(".questionnaire-attachments ul")?.textContent.includes("参考.txt")'),'saved attachment')
    await until(()=>js('document.querySelector(".questionnaire-save-status").textContent.includes("已保存")'),'durable attachment draft')
    fs.writeFileSync(source,'source replaced');const attachment=store.get(initial.id)!.draft.answers.files.attachments![0]
    assert.equal(fs.readFileSync(attachment.path,'utf8'),'immutable attachment bytes');checks.push('real-file-picker-import-to-durable-owned-copy')
    win.webContents.reload();await until(()=>js('document.querySelector("[aria-label=期望完成日期]")?.value==="2026-11-20"'),'restart restored date');assert.equal(await js('document.querySelectorAll("input[type=date]")[2]?.value'),'2026-11-20')
    assert.equal(store.get(initial.id)!.draft.answers.url.value,'https://example.test')
    await snapshot('extensions-light');await js('window.extensionProbe.theme("dark")');await wait(100);await snapshot('extensions-dark');win.setContentSize(390,720);await wait(120);assert.equal(await js('document.documentElement.scrollWidth>innerWidth+1'),false);await snapshot('extensions-narrow');win.setContentSize(1040,900);checks.push('renderer-reload-restores-hidden-date-range-and-attachment-drafts-with-dark-and-narrow-layout')
    await click('.questionnaire-templates summary');await until(()=>js('document.querySelectorAll(".questionnaire-templates li").length===3'),'built-in templates')
    await input('[aria-label=模板名称]','我的项目模板');await click('.template-save button');await until(()=>js('document.querySelectorAll(".questionnaire-templates li").length===4'),'saved template')
    await click('button[type=submit]');await until(()=>js('!!document.querySelector(".questionnaire-receipt")'),'submission')
    assert.equal(store.get(initial.id)!.submission!.answers.url,undefined);assert.equal(store.get(initial.id)!.draft.answers.url.value,'https://example.test');checks.push('hidden-draft-omitted-from-submission-and-template-saves-only-definition')
    await click('.questionnaire-revise');await until(()=>js('!!document.querySelector("[aria-label=期望完成日期]")'),'revision editor')
    await input('[aria-label=期望完成日期]','2026-11-25');await until(()=>js('document.querySelector(".questionnaire-changes")?.textContent.includes("新答案：2026-11-25")'),'live difference')
    await js('document.querySelector(".questionnaire-changes").scrollIntoView({block:"center"})');await snapshot('extensions-amendment');await click('button[type=submit]');await until(()=>js('!!document.querySelector(".questionnaire-receipt")'),'amendment receipt')
    const revision=store.list().find(r=>r.source?.kind==='amendment')!;assert.equal(revision.submission!.answers.date.value,'2026-11-25');assert.equal(store.get(initial.id)!.submission!.answers.date.value,'2026-11-20');checks.push('amendment-new-record-with-visible-diff-and-immutable-original')
    await js('document.querySelector(".questionnaire-templates").open=true');await until(()=>js('document.querySelectorAll(".questionnaire-templates li").length===4'),'template library in receipt')
    await click('.questionnaire-templates li:last-child button');await until(()=>js('document.querySelector("[aria-label=期望完成日期]")?.value===""'),'template reused as fresh form')
    assert.deepEqual(store.list().find(r=>r.source?.kind==='template')!.draft.answers,{});assert.equal(store.list().find(r=>r.source?.kind==='template')!.files?.length,0);checks.push('saved-template-creates-fresh-questionnaire-without-old-answers-or-files')
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({checks,errors,scope:'Actual Vue components, Electron IPC and disk QuestionnaireStore with isolated files. Continuation marked completed by fixture; Agent continuation verified by runtime tests.'},null,2));console.log(JSON.stringify({checks:checks.length,output}));win.destroy();app.quit()
  }catch(error){console.error(error);await snapshot('failed');fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),checks,errors},null,2));win.destroy();app.exit(1)}
}
void run().catch(error=>{console.error(error);app.exit(1)})
