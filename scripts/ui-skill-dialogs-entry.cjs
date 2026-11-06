const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
app.setPath('userData',process.env.NAVORA_SKILL_DIALOG_PROFILE)
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[],errors=[],samples=[],output=path.resolve(process.env.NAVORA_UI_OUTPUT||'release/ui-skill-dialogs')
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1100,height:800,show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});win.webContents.on('paint',()=>{});win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  const js=code=>win.webContents.executeJavaScript(code),settle=async()=>{await wait(300);await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')},capture=async name=>{await settle();fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG())},show=async mode=>{await js(`skillDialogFixture.show(${JSON.stringify(mode)})`);await settle()}
  fs.mkdirSync(output,{recursive:true})
  try{
    await win.loadURL(process.env.NAVORA_SKILL_DIALOG_URL);for(let n=0;n<100;n++){if(await js('!!window.skillDialogFixture&&!!document.querySelector(".preview-details")'))break;await wait(40)}await settle()
    for(const theme of ['mist','graphite'])for(const mode of ['light','dark']){
      await js(`skillDialogFixture.theme(${JSON.stringify(mode)},${JSON.stringify(theme)})`);await show('normal')
      const colors=await js(`(()=>{const card=document.querySelector('.skill-dlg-card'),head=card.querySelector('.skill-dlg-head'),foot=card.querySelector('.skill-dlg-actions'),title=card.querySelector('.skill-dlg-title'),close=card.querySelector('.skill-dlg-close'),resolve=name=>{const probe=document.createElement('div');probe.style.color='var('+name+')';card.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color};return{card:getComputedStyle(card).backgroundColor,head:getComputedStyle(head).backgroundColor,foot:getComputedStyle(foot).backgroundColor,title:getComputedStyle(title).color,close:getComputedStyle(close).color,surface:resolve('--navora-surface'),ink:resolve('--navora-ink'),muted:resolve('--navora-muted')}})()`)
      assert.equal(colors.card,colors.surface);assert.equal(colors.head,colors.surface);assert.equal(colors.foot,colors.surface);assert.equal(colors.title,colors.ink);assert.equal(colors.close,colors.muted);samples.push({theme,mode,...colors});checks.push(`${theme} ${mode}: shell surface/text/close use active theme`)
      assert.equal(await js('document.querySelector(".preview-details").open'),false)
      assert.ok(await js('(()=>{const el=document.querySelector(".preview-desc"),css=getComputedStyle(el);return el.clientHeight<=parseFloat(css.lineHeight)*2+1&&el.scrollHeight>el.clientHeight})()'),'Long summary is clamped to two lines')
      assert.equal(await js('document.querySelector(".meta-grid").checkVisibility()'),false)
      await capture(`${theme}-${mode}-collapsed`)
      await js('document.querySelector(".preview-details summary").click()');await settle()
      assert.equal(await js('document.querySelector(".preview-details").open'),true);assert.ok(await js('document.querySelector(".meta-grid").textContent.includes("D:\\\\资料与文档")'))
      assert.equal(await js('document.querySelector(".preview-full-desc").textContent.trim()===document.querySelector(".preview-desc").textContent.trim()'),true)
      await capture(`${theme}-${mode}-expanded`)
    }
    checks.push('Two-line summary expands to complete description, source, id, mode and size')
    await show('overwrite');assert.equal(await js('document.querySelector(".conflict-box").checkVisibility()'),true);assert.equal(await js('document.querySelector(".preview-details").open'),false);await capture('overwrite-warning')
    await js('[...document.querySelectorAll(".skill-dlg-actions button")].find(el=>el.textContent.trim()==="覆盖安装").click()');assert.deepEqual(await js('skillDialogFixture.confirmed'),{overwrite:true,replaceSuite:false});checks.push('Overwrite warning stays visible and confirms overwrite')
    await show('suite');assert.equal(await js('document.querySelector(".suite-box").checkVisibility()'),true);await js('[...document.querySelectorAll(".skill-dlg-actions button")].find(el=>el.textContent.trim()==="卸载并安装").click()');assert.deepEqual(await js('skillDialogFixture.confirmed'),{overwrite:false,replaceSuite:true});checks.push('Suite replacement warning stays visible and confirms replacement')
    await show('blocked');assert.equal(await js('document.querySelector(".suite-box.is-blocked").checkVisibility()'),true);assert.equal(await js('[...document.querySelectorAll(".skill-dlg-actions button")].find(el=>el.textContent.trim()==="无法导入").disabled'),true);await capture('blocked-suite-warning');checks.push('Bundled suite conflict stays visible and prevents install')
    for(const width of [650,390]){
      win.setContentSize(width,740);await show('normal');await capture('narrow-'+width+'-collapsed');await js('document.querySelector(".preview-details summary").click()');await settle()
      assert.equal(await js('(()=>{const card=document.querySelector(".skill-dlg-card"),body=card.querySelector(".skill-dlg-body"),r=card.getBoundingClientRect(),actions=card.querySelector(".skill-dlg-actions").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&body.scrollWidth<=body.clientWidth+1&&actions.bottom<=innerHeight+1})()'),true)
      assert.equal(await js('document.querySelector(".meta-grid").checkVisibility()'),true);await capture('narrow-'+width+'-expanded')
    }
    checks.push('650/390px dialogs preserve complete metadata and visible actions without horizontal overflow')
    await show('saving');assert.equal(await js('document.querySelector(".skill-dlg-close").disabled'),true);assert.equal(await js('document.querySelector(".progress-panel").checkVisibility()'),true);await capture('narrow-saving');checks.push('Install progress remains visible and close stays disabled')
    await show('shell');await capture('shared-skill-shell');checks.push('Generic skill shell uses the same themed header and footer')
    assert.deepEqual(errors,[]);assert.deepEqual(await js('skillDialogErrors'),[])
    fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,samples,boundary:'Real Vue SkillDialogShell and PluginImportDialog with production styles in isolated hidden Electron; no actual plugin installation or user data.'},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));win.destroy();app.exit(0)
  }catch(error){fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG());fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error),checks,samples,errors},null,2));console.error(error);win.destroy();app.exit(1)}
}).catch(error=>{console.error(error);app.exit(1)})
