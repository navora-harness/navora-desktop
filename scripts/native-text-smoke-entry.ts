import {app,BrowserWindow} from 'electron'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import {executeAgentTool,type ToolExecContext} from '../electron/modules/browser-tools'
import {getBrowserAutomationController} from '../electron/modules/browser-automation-controller'
import {createDefaultConfig} from '../shared/config'
import {AgentProgressPolicy} from '../shared/agent-progress-policy'

const root=process.env.NAVORA_NATIVE_TEXT_SMOKE_ROOT!
app.setPath('userData',path.join(root,'profile'))
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const fixture=`<!doctype html><meta charset="utf-8"><title>Native text fixture</title>
<style>input,textarea,[contenteditable]{display:block;width:300px;margin:8px;height:30px}iframe{width:420px;height:100px}</style>
<form id="form"><input id="text" aria-label="Text fixture" value="keep"><button>Submit fixture</button></form>
<textarea id="multi" aria-label="Multiline fixture">keep</textarea><input id="readonly" readonly value="untouched"><input id="disabled" disabled value="untouched">
<button id="not-editor">Not an editor</button><div id="rich" contenteditable="true" aria-label="Rich fixture">keep</div><div id="shadow"></div><iframe src="/frame"></iframe>
<section id="lifecycle"><input id="editor" aria-label="Lifecycle editor" value="old"></section>
<script>window.fixture={submits:0,trusted:[],inputs:0};document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.fixture.submits++});document.addEventListener('input',e=>{window.fixture.inputs++;window.fixture.trusted.push(e.isTrusted);if(window.fixture.cancelOnInput&&e.inputType==='insertText'){window.fixture.cancelOnInput=false;fetch('/cancel')}});const shadow=document.querySelector('#shadow').attachShadow({mode:'open'});shadow.innerHTML='<input id="shadow-text" aria-label="Shadow fixture" value="keep">';</script>`

void app.whenReady().then(async()=>{
  let win:BrowserWindow|undefined,server:http.Server|undefined
  const checks:string[]=[]
  let cancellation:AbortController|undefined
  try{
    assert.equal(process.env.NAVORA_NATIVE_TEXT_RELEASE,'45.0.0-cloudbypass.11')
    server=http.createServer((request,response)=>{if(request.url==='/cancel'){cancellation?.abort();response.end('ok');return}response.setHeader('Content-Type','text/html; charset=utf-8');response.end(request.url==='/frame'?'<input id="frame-text" aria-label="Frame fixture" value="keep">':fixture)})
    await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve))
    win=new BrowserWindow({show:false,width:1000,height:760,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}})
    Object.assign(win,{activeOperations:0,manager:{flushLayout(){}}})
    const wc=win.webContents,record={windowId:'text-window',win}
    const config=createDefaultConfig()
    config.browser.wait.load=false;config.browser.wait.network_idle=false;config.browser.wait.delay_ms=0;config.browser.action_timeout_ms=15000
    const context=(signal=new AbortController().signal)=>({chatId:'native-text-fixture',browserRunId:'native-text-run',signal,getConfig:()=>config,registry:{assertWindowOwned(chatId:string,windowId:string){assert.equal(chatId,'native-text-fixture');assert.equal(windowId,'text-window');return record},getTree(){return[]},getWindowRecord(){return record}},gate:{async check(){return{ok:true}}}} as unknown as ToolExecContext)
    const call=(name:string,args:Record<string,unknown>,signal?:AbortSignal)=>executeAgentTool(name,{windowId:'text-window',waitUntil:'none',...args},context(signal)) as Promise<Record<string,any>>
    const ref=async(selector:string)=>{
      const snapshot=await call('browser_get',{what:'agent_find',agentQuery:{selector},maxNodes:100,maxFrames:8})
      assert.equal(snapshot.ok,true)
      assert.ok(snapshot.value.elements.length,`Fresh native target for ${selector}`)
      return snapshot.value.elements[0].ref as string
    }
    const nativeType=async(selector:string,text:unknown,extra:Record<string,unknown>={},signal?:AbortSignal)=>call('browser_type',{ref:await ref(selector),text,...extra},signal)
    const value=()=>wc.executeJavaScript('document.querySelector("#text").value') as Promise<string>
    await win.loadURL(`http://127.0.0.1:${(server.address() as {port:number}).port}/`)
    assert.equal(await wc.executeJavaScript('document.readyState'),'complete')
    const nativeDispatch=wc.dispatchKeyEvent.bind(wc),nativeSequence=wc.dispatchInputSequence.bind(wc),events:Electron.KeyEvent[]=[]
    wc.dispatchKeyEvent=((event:Electron.KeyEvent&{target?:Electron.AgentTarget})=>{events.push(event);return nativeDispatch(event)}) as typeof wc.dispatchKeyEvent
    wc.dispatchInputSequence=((steps,options)=>{events.push(...steps.filter(step=>step.kind==='key'));return nativeSequence(steps,options)}) as typeof wc.dispatchInputSequence
    for(const text of ['a','abc','abcd','中文输入连贯测试','long ASCII replacement text','😀中文🚀','e\u0301x','👩‍💻']){
      const started=performance.now()
      const typed=await nativeType('#text',text)
      console.log('[native-text-smoke] replacement',JSON.stringify({codeUnits:text.length,elapsedMs:Math.round(performance.now()-started),ok:typed.ok}))
      assert.equal(typed.ok,true,JSON.stringify(typed))
      assert.equal(typed.method,'target_dispatchInputSequence');assert.equal(await value(),text)
      assert.equal(typed.input.effect,'confirmed');assert.equal(typed.input.confirmedCodeUnits,text.length)
    }
    assert.ok(events.filter(event=>event.type==='char').every(event=>event.text!.length<=3))
    assert.ok((await wc.executeJavaScript('window.fixture.trusted')).every((trusted:boolean)=>trusted))
    checks.push('native-ref-Unicode-and-ASCII-boundaries','trusted-page-input','bounded-char-events','replacement-verification')
    await wc.executeJavaScript('document.querySelector("#text").setSelectionRange(0,0)')
    assert.equal((await nativeType('#text','追加',{append:true})).ok,true)
    assert.equal(await value(),'👩‍💻追加');checks.push('append-ignores-prior-caret')
    assert.equal((await nativeType('#text','')).ok,true);assert.equal(await value(),'');checks.push('empty-replacement')
    for(const [selector,text,error]of [['#readonly','new','text_target_readonly'],['#disabled','new','text_target_disabled'],['#text','\ud800','text_invalid_unicode'],['#text',7,'text_must_be_string'],['#text','one\ntwo','text_target_single_line']]){
      const before=events.length,result=await nativeType(selector as string,text)
      assert.equal(result.error,error,JSON.stringify(result));assert.equal(events.length,before)
    }
    const buttonSnapshot=await call('browser_get',{what:'agent_find',agentQuery:{selector:'#not-editor'}})
    const rejected=await call('browser_type',{target:buttonSnapshot.value.elements[0].target,text:'bad'})
    assert.equal(rejected.ok,false);assert.equal(rejected.input.clearAttempted,false)
    assert.equal(await wc.executeJavaScript('document.querySelector("#readonly").value'),'untouched')
    checks.push('preflight-rejection-does-not-clear')
    const multiline=await nativeType('#multi','第一行\n第二行')
    assert.equal(multiline.ok,true,JSON.stringify(multiline));assert.equal(await wc.executeJavaScript('document.querySelector("#multi").value'),'第一行\n第二行')
    const rich=await nativeType('#rich','富文本😀')
    assert.equal(rich.ok,true,JSON.stringify(rich));assert.equal(await wc.executeJavaScript('document.querySelector("#rich").textContent'),'富文本😀')
    const shadow=await nativeType('#shadow-text','影子输入')
    assert.equal(shadow.ok,true,JSON.stringify(shadow));assert.equal(await wc.executeJavaScript('document.querySelector("#shadow").shadowRoot.querySelector("input").value'),'影子输入')
    const framed=await nativeType('#frame-text','框架输入')
    assert.equal(framed.ok,true,JSON.stringify(framed));assert.equal(await wc.executeJavaScript('document.querySelector("iframe").contentDocument.querySelector("input").value'),'框架输入')
    checks.push('textarea-newlines','contenteditable','shadow-native-target','frame-native-target')
    const submitted=await nativeType('#text','确认提交',{submit:true})
    assert.equal(submitted.ok,true,JSON.stringify(submitted));assert.equal(submitted.submitted,true)
    assert.equal(await wc.executeJavaScript('window.fixture.submits'),1);checks.push('verified-input-before-Enter-submit')
    for(const mode of ['hide','remove','deferred']){
      await wc.executeJavaScript(`(()=>{const section=document.querySelector('#lifecycle');section.innerHTML='<input id="editor" aria-label="Lifecycle editor" value="old">';window.fixture.lifecycleSubmits=0;const input=section.querySelector('input');input.addEventListener('keydown',event=>{if(event.key!=='Enter')return;event.preventDefault();window.fixture.lifecycleSubmits++;const label=document.createElement('label');label.textContent=input.value;${mode==='hide'?'input.style.display="none"':'input.remove()'};${mode==='deferred'?'setTimeout(()=>section.append(label),100)':'section.append(label)' }})})()`)
      const entered=await nativeType('#editor',`synthetic ${mode} result`,{submit:true})
      assert.equal(entered.ok,false,JSON.stringify(entered));assert.equal(entered.input.effect,'confirmed')
      assert.equal(entered.input.submitDispatched,true);assert.equal(entered.input.submission.status,'partial')
      assert.equal(entered.input.submission.cleanup,'confirmed');assert.equal(entered.input.pageResult.status,mode==='deferred'?'unknown':'observed',JSON.stringify(entered))
      if(mode==='deferred'){
        const policy=new AgentProgressPolicy('输入并核对页面结果')
        policy.recordTool('browser_type',{windowId:'text-window'},entered)
        assert.equal(policy.guardTool('browser_click',{windowId:'text-window',ref:'new'})?.error,'browser_observation_required')
        await new Promise(resolve=>setTimeout(resolve,140))
        const observed=await call('browser_get',{what:'agent_snapshot',maxNodes:5000,maxFrames:1000})
        assert.equal(observed.submissionObservation?.status,'observed',JSON.stringify(observed.submissionObservation))
        policy.recordTool('browser_get',{windowId:'text-window',what:'agent_snapshot'},observed)
        assert.equal(policy.guardTool('browser_click',{windowId:'text-window',ref:'new'}),null)
      }
      assert.equal(await wc.executeJavaScript('window.fixture.lifecycleSubmits'),1,'Enter was not replayed')
      console.log('[native-text-smoke] lifecycle',JSON.stringify({mode,error:entered.error,input:entered.input,sequences:entered.sequences}))
      checks.push(`Enter-${mode}-independent-receipts-one-submit`)
    }
    wc.dispatchInputSequence=((steps,options)=>nativeSequence(steps.map(step=>step.kind==='key'&&step.type==='char'?{...step,target:{...step.target!,backendNodeId:99999999}}:step),options)) as typeof wc.dispatchInputSequence
    const failed=await nativeType('#text','失败不提交',{submit:true})
    assert.equal(failed.ok,false);assert.equal(failed.input.clearDispatched,true);assert.equal(failed.input.submitAttempted,false)
    assert.equal(failed.sequences[0].dispatchedCount,6)
    assert.equal(await wc.executeJavaScript('window.fixture.submits'),1);checks.push('failed-char-no-replay-no-submit')
    const cancelling=cancellation=new AbortController()
    await wc.executeJavaScript('window.fixture.cancelOnInput=true')
    wc.dispatchInputSequence=((steps,options)=>nativeSequence(steps.map((step,index)=>({...step,atMs:index*30})),options)) as typeof wc.dispatchInputSequence
    const cancelled=await nativeType('#text','取消后不得继续输入',{submit:true},cancelling.signal)
    assert.equal(cancelled.ok,false);assert.equal(cancelled.input.submitAttempted,false)
    assert.ok(cancelled.input.dispatchedCodeUnits>0&&cancelled.input.dispatchedCodeUnits<cancelled.input.requestedCodeUnits)
    assert.equal(await wc.executeJavaScript('window.fixture.submits'),1);checks.push('cancellation-partial-receipt-no-submit')
    wc.dispatchKeyEvent=nativeDispatch;wc.dispatchInputSequence=nativeSequence
    const controller=getBrowserAutomationController(wc)
    await controller.finishRun('native-text-run')
    assert.equal(controller.snapshot().inputProtected,false)
    assert.equal(controller.snapshot().nativeConfirmed,true)
    assert.equal(wc.debugger.isAttached(),false);assert.equal(win.isVisible(),false)
    checks.push('input-protection-released-after-native-ack','hidden-isolated-profile','no-debugger')
    console.log('[native-text-smoke] PASS',JSON.stringify({release:process.env.NAVORA_NATIVE_TEXT_RELEASE,electron:process.versions.electron,checks,limitations:'Local isolated fixtures and native delivery; physical IME, arbitrary rich editors, and OS focus across devices are not certified.'}))
  }finally{win?.destroy();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()))}
}).then(()=>app.exit(0),error=>{console.error('[native-text-smoke] FAIL',error);app.exit(1)})
