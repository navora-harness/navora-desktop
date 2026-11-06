import {app,BrowserWindow} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import {WORKSPACE_TABS_STORAGE} from '../shared/workspace-tabs-persistence'
const root=process.env.NAVORA_DATA_ROOT!,output=process.env.NAVORA_UI_OUTPUT!,chatId='chat_outline'
if(process.env.NAVORA_UI_REDUCED_MOTION==='1')app.commandLine.appendSwitch('force-prefers-reduced-motion','1')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false
fs.writeFileSync(path.join(root,'config.yml'),JSON.stringify(config));app.setPath('userData',root)
fs.mkdirSync(path.join(root,'chats'),{recursive:true});fs.mkdirSync(path.join(root,'workspace',chatId),{recursive:true})
for(let index=0;index<3;index++)fs.writeFileSync(path.join(root,'workspace',chatId,`note-${index}.md`),'# 测试文件')
fs.writeFileSync(path.join(root,'workspace',chatId,'image.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=','base64'))
const messages=Array.from({length:100},(_,index)=>[
  {id:'u'+index,role:'user',content:'长对话滚动与目录测试 '+index,createdAt:index*3},
  {id:'t'+index,role:'tool',content:'{"ok":true}',createdAt:index*3+1,meta:{toolName:index%2?'file_list':'fixture_plugin',status:'done'}},
  {id:'a'+index,role:'assistant',content:'这是一条用于检查排版、滚动和侧栏响应的本地测试回复。',createdAt:index*3+2},
]).flat()
messages.push(...([
  {id:'ui-style-user-error',role:'user',content:'工具失败样式（本地测试夹具）',createdAt:400},
  {id:'ui-style-progress-old',role:'assistant',content:'连接超时了，我再试一次。',createdAt:401,meta:{partial:false,reasoning:'第一轮观察'}},
  {id:'ui-style-tool-error',role:'tool',content:'{"ok":false,"error":"load_failed"}',createdAt:401,meta:{toolName:'browser_open',status:'error'}},
  {id:'ui-style-progress-new',role:'assistant',content:'窗口已存在，正在读取页面内容。',createdAt:402,meta:{phase:'progress',partial:false,reasoning:'第二轮观察'}},
  {id:'ui-style-tool-recovered',role:'tool',content:'{"ok":true,"path":"note-0.md"}',createdAt:403,meta:{toolName:'file_write',status:'done'}},
  {id:'ui-style-answer-error',role:'assistant',content:'这里仅检查失败工具的折叠样式。',createdAt:404,meta:{phase:'final',reasoning:'第一轮观察\n第二轮观察\n完成回答'}},
  ...Array.from({length:4},(_,index)=>({id:'ui-style-tail-log'+index,role:'log',content:'收尾日志 '+index,createdAt:404,meta:{kind:'agent_status'}})),
  {id:'ui-style-close-log',role:'log',content:'你关闭了一个浏览器窗口',createdAt:404,meta:{kind:'user_op'}},
  {id:'ui-style-user-plugin',role:'user',content:'插件样式（本地测试夹具）',createdAt:403},
  {id:'ui-style-plugin',role:'tool',content:'{"ok":true}',createdAt:404,meta:{toolName:'fixture_plugin',status:'done',fromPlugin:true,pluginId:'fixture'}},
  {id:'ui-style-answer-plugin',role:'assistant',content:'插件摘要。',createdAt:405},
  {id:'ui-style-user-log',role:'user',content:'日志样式（本地测试夹具）',createdAt:406},
  {id:'ui-style-log',role:'log',content:'本地日志样式记录',createdAt:407,meta:{kind:'agent_status'}},
  {id:'ui-style-answer-log',role:'assistant',content:'日志摘要。\n\n[打开文档](note-0.md)\n\n![图片](image.png)',createdAt:408,meta:{sources:[{url:'https://example.com/fixture',title:'本地来源测试'}]}},
]) as typeof messages)
fs.writeFileSync(path.join(root,'chats',chatId+'.json'),JSON.stringify({id:chatId,title:'长对话目录定位',createdAt:1,updatedAt:2,messages}))
fs.writeFileSync(path.join(root,'chats','chat_outline_secondary.json'),JSON.stringify({id:'chat_outline_secondary',title:'动画切换检查',createdAt:0,updatedAt:1,messages:[{id:'secondary-user',role:'user',content:'用于切换聊天后的动画验收。',createdAt:0}]}))
const visibilityMessages=Array.from({length:4},(_,index)=>[
  {id:'visibility-user-'+index,role:'user',content:'可视比例测试第 '+(index+1)+' 轮',createdAt:index*2},
  {id:'visibility-answer-'+index,role:'assistant',content:Array.from({length:8+index*2},(_,paragraph)=>'第 '+(paragraph+1)+' 段用于验证整轮内容与视口重叠时，右侧横线按各轮实际可见比例显示深浅。').join('\n\n'),createdAt:index*2+1},
]).flat()
fs.writeFileSync(path.join(root,'chats','chat_outline_visibility.json'),JSON.stringify({id:'chat_outline_visibility',title:'轮次可视比例检查',createdAt:-1,updatedAt:-1,messages:visibilityMessages}))
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.focus=function(){}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
let started=false
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;win.webContents.setBackgroundThrottling(false);if(win.webContents.isOffscreen()){win.webContents.setFrameRate(60);win.webContents.on('paint',()=>{})}
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code),results:any[]=[]
    const until=async(check:string)=>{for(let n=0;n<100;n++){if(await js(check))return;await wait(50)}throw Error('Timed out: '+check)}
    const tickPoint=async(messageId:string)=>js(`(()=>{const tick=document.querySelector('.outline-tick[data-message-id='+CSS.escape(${JSON.stringify(messageId)})+']');if(!tick)throw Error('Missing outline tick '+${JSON.stringify(messageId)});const bounds=tick.getBoundingClientRect();return {x:Math.round(bounds.left+bounds.width/2),y:Math.round(bounds.top+bounds.height/2)}})()`)
    const clickTick=async(messageId:string)=>{
      const point=await tickPoint(messageId)
      win.webContents.sendInputEvent({type:'mouseMove',...point})
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
    }
    const leaveOutline=()=>win.webContents.sendInputEvent({type:'mouseMove',x:500,y:450})
    const jump=async(index:number,label:string)=>{
      if(process.env.NAVORA_OUTLINE_MATERIALIZE==='1')await js(`[...document.querySelectorAll('.messages>.msg')].forEach(row=>row.style.contentVisibility='visible')`)
      await js(`(()=>{const box=document.querySelector('.messages'),row=box.querySelector('[data-msg-id="u${index}"]');window.outlineTrace=[];let frame=0;const record=()=>{window.outlineTrace.push({frame:frame++,time:performance.now(),top:row.getBoundingClientRect().top-box.getBoundingClientRect().top,scroll:box.scrollTop,height:box.scrollHeight,rowHeight:row.getBoundingClientRect().height,intrinsic:getComputedStyle(row).containIntrinsicBlockSize,outer:[...function*(node){while(node.parentElement){node=node.parentElement;yield node.scrollTop}}(box)]});if(frame<45)requestAnimationFrame(record)};record();${process.env.NAVORA_OUTLINE_NATIVE_SCROLL==='1'?"row.scrollIntoView({block:'start',behavior:'instant',container:'nearest'})":''}})()`)
      if(process.env.NAVORA_OUTLINE_NATIVE_SCROLL!=='1')await clickTick('u'+index)
      leaveOutline()
      await wait(350)
      const at350=await js(`(()=>{const box=document.querySelector('.messages'),row=box.querySelector('[data-msg-id="u${index}"]');return {top:row.getBoundingClientRect().top-box.getBoundingClientRect().top,scroll:box.scrollTop,height:box.scrollHeight}})()`)
      await wait(500)
      const trace=await js('window.outlineTrace'),outerUnmoved=trace.every((frame:any)=>frame.outer.every((top:number)=>top===0));results.push({label,index,at350,trace,outerUnmoved});return Math.abs(at350.top)<5&&outerUnmoved
    }
    try{
      if(process.env.NAVORA_OUTLINE_FALLBACK==='1'){
        win.webContents.debugger.attach('1.3')
        await win.webContents.debugger.sendCommand('Page.enable')
        await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{window.outlineFallbackInstalled=true;const native=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){return native.call(this,this.isConnected?options:{block:'start',behavior:'instant'})}})()`})
        const reloaded=new Promise<void>(resolve=>win.webContents.once('did-finish-load',()=>resolve()))
        win.webContents.reload();await reloaded
      }
      await until('document.querySelectorAll(".outline-tick").length===103');win.setContentSize(1440,900);await wait(400)
      const tickIds=await js('[...document.querySelectorAll(".outline-tick")].map(tick=>tick.dataset.messageId)')
      assert.deepEqual(tickIds,messages.filter(message=>message.role==='user').map(message=>message.id),'Each user message owns exactly one tick, including conversations above 80 turns')
      assert.equal(await js('document.querySelectorAll(".outline-position").length'),0,'Turn ticks do not include a separate active-position bar')
      results.push({label:'one-tick-per-user-message-without-extra-position-bar',count:tickIds.length,ok:true})
      const nativeContainer=await js(`(()=>{let recognized=false;document.createElement('span').scrollIntoView({get container(){recognized=true;return 'nearest'}});return recognized})()`)
      assert.equal(nativeContainer,process.env.NAVORA_OUTLINE_FALLBACK!=='1','Current Chromium supports the container option; fallback fixture suppresses dictionary access before app startup: '+JSON.stringify(await js('({injected:window.outlineFallbackInstalled,wrapper:Element.prototype.scrollIntoView.toString()})')))
      const initialFollow=await js(`(()=>{const box=document.querySelector('.messages'),last=box.lastElementChild;return {tail:box.scrollHeight-box.clientHeight-box.scrollTop,scroll:box.scrollTop,height:box.scrollHeight,client:box.clientHeight,last:{class:last.className,id:last.dataset.msgId,top:last.getBoundingClientRect().top-box.getBoundingClientRect().top,height:last.getBoundingClientRect().height},jumpButton:!!document.querySelector('.jump-bottom')}})()`)
      fs.writeFileSync(path.join(output,'initial-position.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG())
      results.push({label:'initial-follow-paints-the-actual-last-reply',initialFollow,ok:initialFollow.tail<2&&initialFollow.last.top+initialFollow.last.height<=initialFollow.client+1})
      await js(`[...document.querySelectorAll('.chat-item-main')].find(button=>button.textContent.includes('动画切换检查')).click()`)
      await until('!!document.querySelector("[data-msg-id=secondary-user]")')
      await until('document.querySelectorAll(".outline-tick").length===1')
      leaveOutline();await wait(180)
      const nonScrollable=await js(`(()=>{const box=document.querySelector('.messages'),tick=document.querySelector('.outline-tick');return {maximum:box.scrollHeight-box.clientHeight,id:tick.dataset.messageId,visibility:Number(tick.dataset.visibility),width:tick.getBoundingClientRect().width,extraBars:document.querySelectorAll('.outline-position').length}})()`)
      assert.ok(nonScrollable.maximum<24&&nonScrollable.id==='secondary-user'&&Math.abs(nonScrollable.visibility-1)<.025&&Math.abs(nonScrollable.width-9)<.1&&nonScrollable.extraBars===0,'A non-scrolling conversation retains its one user tick, fully visible and at default width: '+JSON.stringify(nonScrollable))
      results.push({label:'non-scrolling-conversation-retains-each-user-tick',nonScrollable,ok:true})
      await js(`[...document.querySelectorAll('.chat-item-main')].find(button=>button.textContent.includes('长对话目录定位')).click()`)
      await until('document.querySelectorAll(".outline-tick").length===103')
      if(process.env.NAVORA_UI_REDUCED_MOTION!=='1')await until(`document.querySelector('.messages').getAnimations().some(animation=>animation.playState==='running'&&animation.effect.getKeyframes().some(frame=>String(frame.transform).includes('translateY')))`)
      await clickTick('u70');leaveOutline();await wait(350)
      const duringTransition=await js(`(()=>{const box=document.querySelector('.messages'),row=box.querySelector('[data-msg-id="u70"]');return {top:row.getBoundingClientRect().top-box.getBoundingClientRect().top}})()`)
      results.push({label:'reading-during-chat-transition-is-not-overridden-on-finish',duringTransition,ok:Math.abs(duringTransition.top)<5})
      await jump(70,'initial-from-bottom');await jump(10,'reverse-jump');await jump(85,'forward-jump')
      if(process.env.NAVORA_OUTLINE_FOCUSED!=='1'){
      await js(`(()=>{const tabs=[0,1,2].map(index=>({key:JSON.stringify([${JSON.stringify(chatId)},'note-'+index+'.md']),chatId:${JSON.stringify(chatId)},path:'note-'+index+'.md'}));localStorage.setItem(${JSON.stringify(WORKSPACE_TABS_STORAGE)},JSON.stringify({version:2,workspaces:[[${JSON.stringify(chatId)},{tabs,active:tabs[0].key,open:true}]]}))})()`)
      win.webContents.reload();await until('!!document.querySelector(".file-workspace")');await wait(400)
      await js('document.querySelector("[aria-label=隐藏工作区]").click()');await until('!document.querySelector(".file-workspace")')
      await js('document.querySelector(".chat-batch-trigger").click()');await wait(100);await js('document.querySelector(".chat-item-main").click()');await wait(100);await js('document.querySelector(".chat-batch-trigger").click()');await wait(100)
      await jump(70,'after-reload-workspace-hide-batch')
      await js('document.querySelector("[data-chat-resource=workspace]").click()');await until('!!document.querySelector(".file-workspace")')
      await js('document.querySelector(".workspace-expand").click()');await until('document.querySelector(".main").classList.contains("workspace-single")')
      await js(`(()=>{const tab=document.querySelector('.file-workspace [role=tab]:not([data-conversation-tab])'),node=tab.closest('.workspace-tab-item'),rect=node.getBoundingClientRect();node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.x+12,clientY:rect.y+12}))})()`)
      await until('!!document.querySelector(".sidebar-ctx-panel")')
      await js(`[...document.querySelectorAll('.sidebar-ctx-panel [role=menuitem]')].find(button=>button.textContent.includes('打开对话文件')).click()`)
      await until('!!document.querySelector(".file-workspace-picker .workspace-picker-locate")')
      await js(`(()=>{window.artifactCalls=[];window.artifactTrace=[];window.artifactScroll=[];const box=document.querySelector('.messages');box.addEventListener('scroll',()=>{window.artifactScroll.push({time:performance.now(),scroll:box.scrollTop,tail:box.scrollHeight-box.clientHeight-box.scrollTop})});const native=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){const before={top:this.getBoundingClientRect().top-box.getBoundingClientRect().top,scroll:box.scrollTop,height:box.scrollHeight};const result=native.call(this,options);window.artifactCalls.push({time:performance.now(),id:this.dataset?.msgId,options,stack:Error().stack,before,after:{top:this.getBoundingClientRect().top-box.getBoundingClientRect().top,scroll:box.scrollTop,height:box.scrollHeight}});return result};let frame=0;const record=()=>{const row=box.querySelector('[data-msg-id="ui-style-answer-error"]');window.artifactTrace.push({frame:frame++,time:performance.now(),top:row.getBoundingClientRect().top-box.getBoundingClientRect().top,scroll:box.scrollTop,height:box.scrollHeight,rowHeight:row.getBoundingClientRect().height,visible:box.checkVisibility()});if(frame<90)requestAnimationFrame(record)};record()})()`)
      await js(`document.querySelector('.file-workspace-picker [data-resource-path="note-0.md"]').closest('.workspace-picker-row').querySelector('.workspace-picker-locate').click()`)
      await wait(450)
      const artifact=await js(`(()=>{const box=document.querySelector('.messages'),row=box.querySelector('[data-msg-id="ui-style-answer-error"]');return {top:row.getBoundingClientRect().top-box.getBoundingClientRect().top,tail:box.scrollHeight-box.clientHeight-box.scrollTop,height:box.clientHeight,rowHeight:row.getBoundingClientRect().height,visible:box.checkVisibility(),chain:[...function*(node){while(node){yield {tag:node.tagName,class:node.className,scroll:node.scrollTop,overflow:getComputedStyle(node).overflowY};node=node.parentElement}}(row)]}})()`)
      results.push({label:'artifact-navigation-overrides-parked-reading-position',artifact,ok:artifact.visible&&(Math.abs(artifact.top)<5||(artifact.tail<2&&artifact.top>=0&&artifact.top+artifact.rowHeight<=artifact.height))})
      await wait(1100)
      results.at(-1).trace=await js('window.artifactTrace');results.at(-1).nativeCalls=await js('window.artifactCalls');results.at(-1).scrollEvents=await js('window.artifactScroll')
      await js(`(()=>{const box=document.querySelector('.messages');window.artifactEndBaseline=window.artifactCalls.filter(call=>call.options?.block==='end').length;box.dispatchEvent(new Event('scroll'));box.style.height='620px'})()`)
      win.webContents.send('navora:agent.event',{type:'done',chatId,followups:[]})
      await wait(250)
      await js(`document.querySelector('.messages').style.height=''`)
      await wait(250)
      const retainedArtifact=await js(`(()=>{const box=document.querySelector('.messages'),row=box.querySelector('[data-msg-id="ui-style-answer-error"]');return {top:row.getBoundingClientRect().top-box.getBoundingClientRect().top,rowHeight:row.getBoundingClientRect().height,height:box.clientHeight,endCalls:window.artifactCalls.filter(call=>call.options?.block==='end').length-window.artifactEndBaseline}})()`)
      results.push({label:'near-tail-navigation-survives-late-scroll-resize-and-agent-done',retainedArtifact,ok:retainedArtifact.top>=-1&&retainedArtifact.top+retainedArtifact.rowHeight<=retainedArtifact.height&&retainedArtifact.endCalls===0})
      await clickTick('u10');leaveOutline();await wait(20)
      const point=await js(`(()=>{const r=document.querySelector('.messages').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`)
      win.webContents.sendInputEvent({type:'mouseWheel',...point,deltaX:0,deltaY:240,canScroll:true})
      await wait(300)
      const userPosition=await js(`(()=>{const box=document.querySelector('.messages'),row=box.querySelector('[data-msg-id="u10"]');return {top:row.getBoundingClientRect().top-box.getBoundingClientRect().top,scroll:box.scrollTop}})()`)
      await wait(350)
      const retainedPosition=await js(`(()=>{const box=document.querySelector('.messages'),row=box.querySelector('[data-msg-id="u10"]');return {top:row.getBoundingClientRect().top-box.getBoundingClientRect().top,scroll:box.scrollTop,styles:[...box.querySelectorAll('.msg')].filter(row=>row.style.contentVisibility).length,anchor:box.style.overflowAnchor}})()`)
      results.push({label:'native-wheel-cancels-position-correction',userPosition,retainedPosition,ok:Math.abs(userPosition.top)>50&&Math.abs(userPosition.top-retainedPosition.top)<5&&retainedPosition.styles===0&&retainedPosition.anchor===''})
      await clickTick('u70')
      await js(`(()=>{const button=document.querySelector('.jump-bottom');if(!button)throw Error('Jump-to-bottom action is available');button.click()})()`)
      leaveOutline()
      await wait(350)
      const bottom=await js(`(()=>{const box=document.querySelector('.messages');return {tail:box.scrollHeight-box.clientHeight-box.scrollTop,styles:[...box.querySelectorAll('.msg')].filter(row=>row.style.contentVisibility).length,anchor:box.style.overflowAnchor}})()`)
      results.push({label:'explicit-bottom-cancels-pending-message-jump',bottom,ok:bottom.tail<2&&bottom.styles===0&&bottom.anchor===''})
      await clickTick('u10');leaveOutline();await wait(350)
      await js(`(()=>{const box=document.querySelector('.messages');window.followInputTrace=[];for(const type of ['keydown','scroll','scrollend'])box.addEventListener(type,event=>window.followInputTrace.push({type,key:event.key,time:performance.now(),scroll:box.scrollTop,tail:box.scrollHeight-box.clientHeight-box.scrollTop}))})()`)
      await js(`(()=>{const box=document.querySelector('.messages');box.tabIndex=-1;box.focus({preventScroll:true})})()`)
      for(let attempt=0;attempt<10;attempt++){
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'End',modifiers:['control']})
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'End',modifiers:['control']});await wait(250)
        if(await js(`(()=>{const box=document.querySelector('.messages');return box.scrollHeight-box.clientHeight-box.scrollTop<2})()`))break
      }
      const beforeUpdate=await js(`(()=>{const box=document.querySelector('.messages');window.followEndBaseline=window.artifactCalls.filter(call=>call.options?.block==='end').length;return {tail:box.scrollHeight-box.clientHeight-box.scrollTop}})()`)
      win.webContents.send('navora:agent.event',{type:'message_update',chatId,message:{id:'ui-style-answer-log',role:'assistant',createdAt:408,content:Array.from({length:20},(_,index)=>'真实滚动恢复跟随后新增的回复 '+index).join('\n\n')}})
      await wait(450)
      const resumedFollow=await js(`(()=>{const box=document.querySelector('.messages');return {tail:box.scrollHeight-box.clientHeight-box.scrollTop,endCalls:window.artifactCalls.filter(call=>call.options?.block==='end').length-window.followEndBaseline}})()`)
      results.push({label:'native-scroll-to-bottom-resumes-following-new-reply',beforeUpdate,resumedFollow,inputTrace:await js('window.followInputTrace'),ok:beforeUpdate.tail<2&&resumedFollow.tail<2&&resumedFollow.endCalls>0})
      fs.writeFileSync(path.join(output,'outline-position.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG())
      }
      await js(`[...document.querySelectorAll('.chat-item-main')].find(button=>button.textContent.includes('轮次可视比例检查')).click()`)
      await until('document.querySelectorAll(".outline-tick").length===4')
      await js(`[...document.querySelectorAll('.messages>.msg')].forEach(row=>row.style.contentVisibility='visible')`)
      leaveOutline();await wait(400)
      const shortTickIds=await js('[...document.querySelectorAll(".outline-tick")].map(tick=>tick.dataset.messageId)')
      assert.deepEqual(shortTickIds,visibilityMessages.filter(message=>message.role==='user').map(message=>message.id),'Short conversations have their real turn count without filler ticks')
      const defaultWidths=await js('[...document.querySelectorAll(".outline-tick")].map(tick=>tick.getBoundingClientRect().width)')
      assert.ok(defaultWidths.every((width:number)=>Math.abs(width-9)<.1),'All default ticks are 9 px, including currently visible turns: '+JSON.stringify(defaultWidths))
      assert.equal(await js('document.querySelectorAll(".outline-position").length'),0,'Visibility feedback is carried only by the per-turn ticks')
      const visibilityTarget=await js(`(()=>{const box=document.querySelector('.messages'),bounds=box.getBoundingClientRect(),rows=[...box.querySelectorAll('.msg.user')],starts=rows.map(row=>row.getBoundingClientRect().top-bounds.top+box.scrollTop),maximum=box.scrollHeight-box.clientHeight;for(let top=0;top<=maximum;top+=Math.max(1,box.clientHeight*.13)){const visible=starts.map((start,index)=>Math.max(0,Math.min(starts[index+1]??box.scrollHeight,top+box.clientHeight)-Math.max(start,top))/Math.max(1,(starts[index+1]??box.scrollHeight)-start)).filter(ratio=>ratio>.01);if(visible.length>1&&Math.max(...visible)-Math.min(...visible)>.15){box.scrollTo({top,behavior:'instant'});return {top,visible}}}throw Error('Fixture must show multiple turns with different visible proportions')})()`)
      await wait(250)
      const visibility=await js(`(()=>{const box=document.querySelector('.messages'),bounds=box.getBoundingClientRect(),ticks=[...document.querySelectorAll('.outline-tick')],starts=ticks.map(tick=>box.querySelector('[data-msg-id='+CSS.escape(tick.dataset.messageId)+']').getBoundingClientRect().top-bounds.top+box.scrollTop);return ticks.map((tick,index)=>{const start=starts[index],end=starts[index+1]??box.scrollHeight,expected=Math.max(0,Math.min(end,box.scrollTop+box.clientHeight)-Math.max(start,box.scrollTop))/Math.max(1,end-start);return {id:tick.dataset.messageId,expected,reported:Number(tick.dataset.visibility),opacity:Number(getComputedStyle(tick).opacity),width:tick.getBoundingClientRect().width}})})()`)
      assert.ok(visibility.every((tick:any)=>Math.abs(tick.expected-tick.reported)<.025),'Each tick reports its whole turn overlap with the viewport: '+JSON.stringify(visibility))
      assert.ok(visibility.every((tick:any)=>Math.abs(tick.opacity-(.26+.74*tick.expected))<.025),'Tick depth follows visible proportion: '+JSON.stringify(visibility))
      const visibleTurns=visibility.filter((tick:any)=>tick.expected>.01)
      assert.ok(visibleTurns.length>1&&Math.max(...visibleTurns.map((tick:any)=>tick.opacity))-Math.min(...visibleTurns.map((tick:any)=>tick.opacity))>.1,'Several visible turns can have different color depths')
      assert.ok(visibility.every((tick:any)=>Math.abs(tick.width-9)<.1),'Scroll visibility changes color without changing default tick widths')
      results.push({label:'short-conversation-count-and-independent-visible-turn-depth',count:shortTickIds.length,defaultWidths,visibilityTarget,visibility,ok:true})
      fs.writeFileSync(path.join(output,'outline-visible-proportions.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG())
      const hoverPoint=await tickPoint('visibility-user-1'),trackWidth=await js('document.querySelector(".outline-track").getBoundingClientRect().width')
      win.webContents.sendInputEvent({type:'mouseMove',...hoverPoint});await wait(250)
      const hover=await js(`(()=>{const ticks=[...document.querySelectorAll('.outline-tick')];return {widths:ticks.map(tick=>tick.getBoundingClientRect().width),trackWidth:document.querySelector('.outline-track').getBoundingClientRect().width,preview:document.querySelector('.outline-preview-question')?.textContent,keyboardEntries:[...document.querySelectorAll('.conversation-outline [tabindex]')].filter(node=>node.tabIndex===0).length}})()`)
      assert.ok(hover.widths[1]>28&&hover.widths[1]>hover.widths[3],'Hover retains the local tick length expansion')
      assert.equal(hover.trackWidth,trackWidth,'Hover keeps the navigation hit region fixed')
      assert.match(hover.preview,/第 2 轮/,'Hover previews the nearest user turn')
      assert.equal(hover.keyboardEntries,1,'The track retains one keyboard entry point')
      leaveOutline();await wait(250)
      assert.equal(await js('!!document.querySelector(".outline-preview")'),false,'Moving away dismisses the preview')
      assert.ok((await js('[...document.querySelectorAll(".outline-tick")].map(tick=>tick.getBoundingClientRect().width)')).every((width:number)=>Math.abs(width-9)<.1),'Leaving hover restores every tick to the same width')
      results.push({label:'hover-only-expansion-and-turn-preview',hover,ok:true})
      await js(`(()=>{const track=document.querySelector('.outline-track'),r=track.getBoundingClientRect(),options={pointerId:99,pointerType:'mouse',isPrimary:true,clientX:r.right-10,clientY:r.top+r.height/3};track.dispatchEvent(new PointerEvent('pointermove',options));track.dispatchEvent(new PointerEvent('pointerleave',options))})()`)
      await wait(250)
      const sameFrameLeave=await js(`(()=>({preview:!!document.querySelector('.outline-preview'),widths:[...document.querySelectorAll('.outline-tick')].map(tick=>tick.getBoundingClientRect().width)}))()`)
      assert.ok(!sameFrameLeave.preview&&sameFrameLeave.widths.every((width:number)=>Math.abs(width-9)<.1),'Moving away before the queued animation frame leaves no preview or stretched ticks: '+JSON.stringify(sameFrameLeave))
      results.push({label:'same-frame-hover-leave-cancels-pending-preview-and-width',sameFrameLeave,ok:true})
      await clickTick('visibility-user-2');leaveOutline();await wait(350)
      const clickedTurn=await js(`(()=>{const box=document.querySelector('.messages'),row=box.querySelector('[data-msg-id="visibility-user-2"]');return {top:row.getBoundingClientRect().top-box.getBoundingClientRect().top}})()`)
      assert.ok(Math.abs(clickedTurn.top)<5,'Click selects the exact tick turn in a short conversation: '+JSON.stringify(clickedTurn))
      const dragPoints=await js(`(()=>{const r=document.querySelector('.outline-track').getBoundingClientRect();return {x:Math.round(r.right-10),from:Math.round(r.top+r.height*.15),to:Math.round(r.top+r.height*.75)}})()`)
      win.webContents.sendInputEvent({type:'mouseMove',x:dragPoints.x,y:dragPoints.from})
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:dragPoints.x,y:dragPoints.from})
      win.webContents.sendInputEvent({type:'mouseMove',x:dragPoints.x,y:dragPoints.to,modifiers:['leftbuttondown']})
      await wait(40)
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:dragPoints.x,y:dragPoints.to})
      leaveOutline();await wait(250)
      const dragged=await js(`(()=>{const box=document.querySelector('.messages'),r=document.querySelector('.outline-track').getBoundingClientRect();return {actual:box.scrollTop/(box.scrollHeight-box.clientHeight),expected:(${dragPoints.to}-r.top)/r.height,dragging:document.querySelector('.conversation-outline').classList.contains('is-dragging')}})()`)
      assert.ok(Math.abs(dragged.actual-dragged.expected)<.025&&!dragged.dragging,'Dragging still seeks by scroll percentage: '+JSON.stringify(dragged))
      results.push({label:'exact-short-turn-click-and-proportional-drag',clickedTurn,dragged,ok:true})
      await js(`(()=>{window.outlineOutsidePointerTrace=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture'])window.addEventListener(type,event=>{const track=document.querySelector('.outline-track');window.outlineOutsidePointerTrace.push({type:event.type,target:String(event.target.className||event.target.nodeName),buttons:event.buttons,button:event.button,pointerId:event.pointerId,x:event.clientX,y:event.clientY,captured:track?.hasPointerCapture(event.pointerId)})},true)})()`)
      const outsideDrag=await js(`(()=>{const r=document.querySelector('.outline-track').getBoundingClientRect();return {insideX:Math.round(r.right-10),outsideX:Math.round(r.left-60),from:Math.round(r.top+r.height*.2),to:Math.round(r.top+r.height*.7)}})()`)
      win.webContents.sendInputEvent({type:'mouseMove',x:outsideDrag.insideX,y:outsideDrag.from})
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:outsideDrag.insideX,y:outsideDrag.from})
      win.webContents.sendInputEvent({type:'mouseMove',x:outsideDrag.outsideX,y:outsideDrag.to,modifiers:['leftbuttondown']})
      await wait(80)
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:outsideDrag.outsideX,y:outsideDrag.to})
      await wait(250)
      const outsideRelease=await js(`(()=>({hovering:document.querySelector('.outline-track').matches(':hover'),dragging:document.querySelector('.conversation-outline').classList.contains('is-dragging'),preview:!!document.querySelector('.outline-preview'),widths:[...document.querySelectorAll('.outline-tick')].map(tick=>tick.getBoundingClientRect().width),pointerTrace:window.outlineOutsidePointerTrace}))()`)
      assert.ok(outsideRelease.pointerTrace.some((event:any)=>event.type==='pointermove'&&event.x===outsideDrag.outsideX&&event.buttons===1),'The outside drag fixture keeps the left button held during movement: '+JSON.stringify(outsideRelease.pointerTrace))
      assert.ok(!outsideRelease.hovering&&!outsideRelease.dragging&&!outsideRelease.preview&&outsideRelease.widths.every((width:number)=>Math.abs(width-9)<.1),'Releasing a captured drag outside the track restores the default appearance without another pointer move: '+JSON.stringify(outsideRelease))
      results.push({label:'release-drag-outside-track-restores-default-appearance',outsideRelease,ok:true})
      await clickTick('visibility-user-0');leaveOutline();await wait(350)
      const firstEndpoint=await js(`(()=>{const box=document.querySelector('.messages'),row=box.querySelector('[data-msg-id="visibility-user-0"]');return {top:row.getBoundingClientRect().top-box.getBoundingClientRect().top,scroll:box.scrollTop,label:document.querySelector('.outline-track').getAttribute('aria-valuetext')}})()`)
      assert.ok(firstEndpoint.top>=-2&&firstEndpoint.top<44&&firstEndpoint.label.includes('第 1 / 4 轮'),'The first tick is clickable at its visual center: '+JSON.stringify(firstEndpoint))
      await clickTick('visibility-user-3');leaveOutline();await wait(350)
      const lastEndpoint=await js(`(()=>{const box=document.querySelector('.messages'),row=box.querySelector('[data-msg-id="visibility-user-3"]');return {top:row.getBoundingClientRect().top-box.getBoundingClientRect().top,tail:box.scrollHeight-box.clientHeight-box.scrollTop,height:box.clientHeight,scroll:box.scrollTop,label:document.querySelector('.outline-track').getAttribute('aria-valuetext')}})()`)
      assert.ok(lastEndpoint.scroll>firstEndpoint.scroll&&lastEndpoint.top>=-2&&lastEndpoint.top<lastEndpoint.height&&(Math.abs(lastEndpoint.top)<5||lastEndpoint.tail<2)&&lastEndpoint.label.includes('第 4 / 4 轮'),'The last tick is clickable at its visual center, including the bottom edge: '+JSON.stringify(lastEndpoint))
      results.push({label:'first-and-last-tick-visual-centers-are-clickable',firstEndpoint,lastEndpoint,ok:true})
      const ok=results.every(result=>result.at350?Math.abs(result.at350.top)<5&&result.outerUnmoved:result.ok)
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok,nativeContainer,initialFollow,focused:process.env.NAVORA_OUTLINE_FOCUSED==='1',fallbackFixture:process.env.NAVORA_OUTLINE_FALLBACK==='1',results},null,2));console.log(JSON.stringify({ok,nativeContainer,initialFollow,results:results.map(({label,at350,ok,artifact,userPosition,retainedPosition,bottom,outerUnmoved,retainedArtifact,beforeUpdate,resumedFollow})=>({label,...at350,ok,artifact,userPosition,retainedPosition,bottom,outerUnmoved,retainedArtifact,beforeUpdate,resumedFollow}))}));assert.equal(ok,true);app.exit(0)
    }catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error),results},null,2));console.error(error);app.exit(1)}
  })())
})
await import('../electron/main')
