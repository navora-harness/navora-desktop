import {Menu,clipboard,shell,nativeTheme,type BrowserWindow,type MenuItemConstructorOptions} from 'electron'
import {randomUUID} from 'node:crypto'
import {appearancePalette} from '../../shared/appearance'
import {isUrlAllowed} from '../../shared/url-allowlist'
import {nativeMenuPosition} from '../../shared/native-menu-position'
import type {AppConfig} from '../../shared/config'
import type {BrowserRegistry} from './browser-registry'
import type {BrowserPage} from './browser-host'
import type {BrowserTabsService} from './browser-tabs-service'
import type {BrowserAnnotationService} from './browser-annotations'
import {browserPageAddressContext,performBrowserPageAddressAction} from './browser-page-address'
import {browserHttpAddress} from '../../shared/browser-page-address'

type Options={registry:BrowserRegistry;tabs:BrowserTabsService;annotations?:BrowserAnnotationService;getConfig:()=>AppConfig;prepareMenu?:(parent:BrowserWindow,close:()=>void)=>()=>void}
/** Guest input never receives the application's menu IPC. Actions retain their source page. */
export function registerBrowserPageContextMenus(options:Options){
  const {registry,tabs}=options,hosts=registry.hosts,watched=new WeakSet<BrowserPage>()
  function watch(page:BrowserPage){
    if(watched.has(page))return
    watched.add(page)
    const wc=page.webContents
    let generation=0,open:Menu|undefined,popupParent:BrowserWindow|undefined,release:(()=>void)|undefined,openValid:(()=>boolean)|undefined
    function close(){generation++;const menu=open,parent=popupParent;open=undefined;popupParent=undefined;openValid=undefined;release?.();release=undefined;if(menu&&parent&&!parent.isDestroyed())menu.closePopup(parent)}
    page.on('presentation-invalidated',close);page.on('hide',close);page.on('closed',close)
    wc.on('did-start-navigation',close);wc.on('render-process-gone',close);wc.on('zoom-changed',close)
    page.on('automation-changed',()=>{if(open&&(!userAvailable(true)||!openValid?.()))close()})
    const userAvailable=(allowLoading=false)=>{
      const state=page.automation.snapshot()
      return !page.isDestroyed()&&!page.activeOperations&&!state.activeOperations&&(!page.automation.isBusy()||allowLoading&&wc.isLoadingMainFrame())&&!state.nativePending&&state.nativeConfirmed&&!state.inputProtected&&!state.leaseRunId&&!state.error&&state.activity==='idle'
    }
    wc.on('context-menu',async(event,params)=>{
      const host=hosts.getHost(page.hostId||'')
      if(!host||!host.ready||host.suspended||host.active!==page.id||!page.view.getVisible()||page.annotationSelecting)return
      event.preventDefault();close()
      const request=++generation,hostId=host.id,epoch=page.automation.captureDocumentEpoch(),controlEpoch=page.automation.captureEpoch(),frame=params.frame
      const sourceCurrent=()=>{
        const now=hosts.getHost(hostId)
        return !page.isDestroyed()&&page.hostId===hostId&&now===host&&!host.window.isDestroyed()&&host.ready&&!host.suspended&&host.active===page.id&&page.view.getVisible()&&page.automation.captureDocumentEpoch()===epoch&&!!frame&&!frame.detached
      }
      const current=()=>request===generation&&sourceCurrent()&&page.automation.captureEpoch()===controlEpoch
      if(!current())return
      const assertCurrent=()=>{
        if(!current())throw Error('browser_context_changed')
        const record=registry.assertWindowOwned(page.chatId,page.id)
        registry.assertSessionUsable(page.chatId,record.sessionId)
      }
      const safeUrl=(value:string)=>{const url=browserHttpAddress(value);return url&&isUrlAllowed(url,options.getConfig().browser.url_allowlist)?url:undefined}
      const editable=params.isEditable,password=params.formControlType==='input-password',flags=params.editFlags
      const hasPosition=params.menuSourceType!=='keyboard'&&Number.isFinite(params.x)&&Number.isFinite(params.y)
      // Bind coordinate commands to the actual hit node and viewport. No elements
      // are inserted and this isolated world has no application IPC.
      const pointKey=randomUUID(),editKey=randomUUID(),annotationKey=randomUUID(),x=params.x/wc.getZoomFactor(),y=params.y/wc.getZoomFactor(),topFrame=frame===wc.mainFrame
      let pointValid=false
      let editValid=false
      let annotationValid=false
      const editScript=(code:string)=>wc.executeJavaScriptInIsolatedWorld(1009,[{code}])
      // WebFrameMain has no public isolated-world execution. Never store a
      // subframe credential in its page-controlled main world.
      if(topFrame&&(editable||params.selectionText.trim()))try{
        editValid=await editScript(`(()=>{let node=document.activeElement;while(node?.shadowRoot?.activeElement)node=node.shadowRoot.activeElement;if(!node||${editable}&&!(node instanceof HTMLInputElement||node instanceof HTMLTextAreaElement||node.isContentEditable))return false;const s=getSelection(),r=s?.rangeCount?s.getRangeAt(0):null;globalThis.__navoraMenuEdit={key:${JSON.stringify(editKey)},node:new WeakRef(node),type:node.type,disabled:node.disabled,readOnly:node.readOnly,start:typeof node.selectionStart==='number'?node.selectionStart:null,end:typeof node.selectionEnd==='number'?node.selectionEnd:null,range:r?{start:new WeakRef(r.startContainer),end:new WeakRef(r.endContainer),startOffset:r.startOffset,endOffset:r.endOffset}:null};return true})()` )===true
      }catch{/* Native edit actions require a retained focus/selection. */}
      if(!current())return
      if(hasPosition&&topFrame)try{
        pointValid=await wc.executeJavaScriptInIsolatedWorld(1009,[{code:`(()=>{const x=${JSON.stringify(x)},y=${JSON.stringify(y)};let node=document.elementFromPoint(x,y);while(node?.shadowRoot){const child=node.shadowRoot.elementFromPoint(x,y);if(!child||child===node)break;node=child}if(!node||${editable}&&!(node instanceof HTMLInputElement||node instanceof HTMLTextAreaElement||node.isContentEditable)||${params.mediaType==='image'}&&!['img','image'].includes(node.localName))return false;const r=node.getBoundingClientRect();globalThis.__navoraMenuPoint={key:${JSON.stringify(pointKey)},node:new WeakRef(node),x,y,rect:[r.x,r.y,r.width,r.height],viewport:[scrollX,scrollY,innerWidth,innerHeight,visualViewport?.offsetLeft,visualViewport?.offsetTop,visualViewport?.scale]};return true})()`}])===true
      }catch{/* No verified point: regular page actions remain available. */}
      if(!current())return
      // The annotation world retains the exact top-document hit. A subframe hit
      // anchors its iframe container; no credential enters a guest main world.
      if(hasPosition&&options.annotations)try{
        annotationValid=await wc.executeJavaScriptInIsolatedWorld(1008,[{code:`(()=>{const x=${JSON.stringify(x)},y=${JSON.stringify(y)};let node=document.elementFromPoint(x,y);while(node?.shadowRoot){const child=node.shadowRoot.elementFromPoint(x,y);if(!child||child===node)break;node=child}if(!node||${!topFrame}&&!node.matches('iframe,frame'))return false;const r=node.getBoundingClientRect();globalThis.__navoraMenuAnnotation={key:${JSON.stringify(annotationKey)},node:new WeakRef(node),x,y,rect:[r.x,r.y,r.width,r.height],viewport:[scrollX,scrollY,innerWidth,innerHeight,visualViewport?.offsetLeft,visualViewport?.offsetTop,visualViewport?.scale]};return true})()`}])===true
      }catch{/* No retained point: the menu cannot offer a target-bound annotation. */}
      if(!current())return
      async function coordinate(action:()=>unknown){
        if(!pointValid||!current()||!userAvailable())throw Error('browser_context_target_changed')
        const unchanged=await wc.executeJavaScriptInIsolatedWorld(1009,[{code:`(()=>{const p=globalThis.__navoraMenuPoint;if(p?.key!==${JSON.stringify(pointKey)})return false;const node=p.node.deref();let hit=document.elementFromPoint(p.x,p.y);while(hit?.shadowRoot){const child=hit.shadowRoot.elementFromPoint(p.x,p.y);if(!child||child===hit)break;hit=child}if(!node||!node.isConnected||hit!==node)return false;const r=node.getBoundingClientRect();return JSON.stringify([r.x,r.y,r.width,r.height])===JSON.stringify(p.rect)&&JSON.stringify([scrollX,scrollY,innerWidth,innerHeight,visualViewport?.offsetLeft,visualViewport?.offsetTop,visualViewport?.scale])===JSON.stringify(p.viewport)})()`}])
        if(!unchanged)throw Error('browser_context_target_changed')
        assertCurrent();if(!userAvailable())throw Error('browser_manual_control_required')
        return action()
      }
      let accepting=false,chosen=false
      const rows:MenuItemConstructorOptions[]=[],add=(id:string,label:string,action:()=>void|Promise<unknown>,enabled=true,requiresUser=true,allowLoading=false)=>{
        rows.push({id,label,enabled:enabled&&(!requiresUser||userAvailable(allowLoading)),click:()=>{
          // Menu callbacks may arrive after a tab transfer, navigation or Agent claim.
          if(!accepting||chosen||!enabled||!current()||requiresUser&&!userAvailable(allowLoading))return
          chosen=true
          try{assertCurrent();void Promise.resolve(action()).catch(report)}catch(error){report(error)}
        }})
      }
      const report=(error:unknown)=>{if(!page.isDestroyed()&&page.hostId===hostId&&!host.window.isDestroyed())host.window.webContents.send('navora:browser.page-menu',{pageId:page.id,action:'error',message:String(error instanceof Error?error.message:error).slice(0,200)})}
      const separator=()=>{if(rows.length&&rows.at(-1)?.type!=='separator')rows.push({type:'separator'})}
      const edit=async(command:'undo'|'redo'|'cut'|'copy'|'paste'|'pasteAndMatchStyle'|'delete'|'selectAll')=>{
        assertCurrent()
        // WebContents editing routes to its focused frame; never focus a different frame.
        if(wc.focusedFrame!==frame)throw Error('browser_context_frame_changed')
        if(!editValid||await editScript(`(()=>{const p=globalThis.__navoraMenuEdit,node=p?.node.deref();let active=document.activeElement;while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;if(p?.key!==${JSON.stringify(editKey)}||!node||active!==node||node.type!==p.type||node.disabled!==p.disabled||node.readOnly!==p.readOnly)return false;if(p.start!==null)return node.selectionStart===p.start&&node.selectionEnd===p.end;const s=getSelection(),r=s?.rangeCount?s.getRangeAt(0):null;return p.range?!!r&&r.startContainer===p.range.start.deref()&&r.endContainer===p.range.end.deref()&&r.startOffset===p.range.startOffset&&r.endOffset===p.range.endOffset:!r})()`)!==true)throw Error('browser_context_selection_changed')
        assertCurrent();if(wc.focusedFrame!==frame||!userAvailable())throw Error('browser_context_frame_changed')
        wc.focus();wc[command]()
      }
      const addEdit=(id:string,label:string,command:Parameters<typeof edit>[0],enabled:boolean)=>{add(id,label,()=>edit(command),enabled&&editValid);if(!topFrame)rows.at(-1)!.toolTip='此框架暂不支持安全菜单编辑，请直接在网页中操作。'}
      const navigate=(kind:'back'|'forward'|'reload'|'reloadIgnoringCache'|'stop')=>{
        assertCurrent();if(!userAvailable(kind==='stop'))throw Error('browser_manual_control_required')
        if(kind==='stop'){registry.markNavigationStopped(page.id);wc.stop();return}
        const history=wc.navigationHistory
        if(kind==='back'&&!history.canGoBack()||kind==='forward'&&!history.canGoForward())return
        // The same synchronous user navigation boundary as workspace.command;
        // it must not claim an Agent input lease or change the manual owner.
        if(kind==='reload')wc.reload();else if(kind==='reloadIgnoringCache')wc.reloadIgnoringCache();else if(kind==='back')history.goBack();else history.goForward()
      }
      add('back','返回',()=>navigate('back'),wc.navigationHistory.canGoBack())
      add('forward','前进',()=>navigate('forward'),wc.navigationHistory.canGoForward())
      const wasLoading=wc.isLoading()
      add('reload',wasLoading?'停止加载':'重新加载',()=>navigate(wasLoading?'stop':'reload'),true,true,wasLoading)
      add('reloadIgnoringCache','忽略缓存重新加载',()=>navigate('reloadIgnoringCache'),!wasLoading)
      separator()
      if(editable){
        addEdit('undo','撤销','undo',flags.canUndo);addEdit('redo','重做','redo',flags.canRedo);separator()
        addEdit('cut','剪切','cut',!password&&flags.canCut)
        if(!topFrame)add('copy','复制所选文字',()=>clipboard.writeText(params.selectionText),!password&&flags.canCopy&&!!params.selectionText)
        else addEdit('copy','复制','copy',!password&&flags.canCopy)
        addEdit('paste','粘贴','paste',flags.canPaste);addEdit('pastePlain','粘贴为纯文本','pasteAndMatchStyle',flags.canPaste)
        addEdit('delete','删除','delete',flags.canDelete);addEdit('selectAll','全选','selectAll',flags.canSelectAll);separator()
      }else if(params.selectionText.trim()){if(topFrame)addEdit('copy','复制','copy',flags.canCopy);else add('copy','复制所选文字',()=>clipboard.writeText(params.selectionText),!password&&flags.canCopy)}
      const openUrl=(url:string)=>{assertCurrent();return tabs.action(hostId,{chatId:page.chatId,pageId:page.id,action:'new',url,background:true})}
      if(!password&&params.selectionText.trim()){
        const query=params.selectionText.trim().slice(0,8192),search=`https://www.bing.com/search?q=${encodeURIComponent(query)}`
        add('search','搜索所选文字',()=>openUrl(search),!!safeUrl(search))
      }
      const link=safeUrl(params.linkURL),image=safeUrl(params.srcURL)
      if(params.linkURL){add('openLink','在新标签页打开链接',()=>openUrl(link!),!!link);add('copyLink','复制链接地址',()=>clipboard.writeText(params.linkURL),!!link,false);if(link)add('openLinkExternal','在外部浏览器中打开链接',async()=>{try{await shell.openExternal(link)}catch{throw Error('browser_external_open_failed')}},true,false)}
      if(params.mediaType==='image'){
        add('copyImage','复制图片',()=>coordinate(()=>wc.copyImageAt(params.x,params.y)),params.hasImageContents&&pointValid)
        add('copyImageUrl','复制图片地址',()=>clipboard.writeText(params.srcURL),!!image,false)
        add('openImage','在新标签页打开图片',()=>openUrl(image!),!!image)
      }
      separator()
      const address=browserPageAddressContext(registry,page.id)
      const addressAction=(action:'copy'|'external')=>performBrowserPageAddressAction(address!,action,{current:()=>browserPageAddressContext(registry,page.id),allowed:url=>isUrlAllowed(url,options.getConfig().browser.url_allowlist),external:url=>shell.openExternal(url),copy:url=>clipboard.writeText(url)})
      add('copyUrl',address?.kind==='failed'?'复制访问失败的网址':'复制当前网址',()=>addressAction('copy'),!!address,false)
      if(address)add('openExternal',address.kind==='failed'?'在外部浏览器中尝试打开此网址':'在外部浏览器中打开',()=>addressAction('external'),true,false)
      add('find','在此网页中查找',()=>{host.window.webContents.focus();host.window.webContents.send('navora:browser.find-shortcut',{pageId:page.id,action:'open'})})
      add('annotate','批注',async()=>{
        const target=await options.annotations!.beginFromContext(page.chatId,page.id,annotationKey,()=>{if(!sourceCurrent())throw Error('browser_context_changed')})
        host.window.webContents.focus();host.window.webContents.send('navora:browser.page-menu',{pageId:page.id,action:'annotate',target})
      },annotationValid)
      separator()
      const debuggingAvailable=!wc.debugger.isAttached()
      add('inspect','检查元素',()=>coordinate(()=>{if(wc.debugger.isAttached())throw Error('browser_debugger_in_use');wc.openDevTools({mode:'detach',activate:true});wc.inspectElement(params.x,params.y)}),pointValid&&debuggingAvailable)
      add('devtools','打开开发者工具',()=>{if(wc.debugger.isAttached())throw Error('browser_debugger_in_use');wc.openDevTools({mode:'detach',activate:true})},debuggingAvailable)
      try{
        const menu=Menu.buildFromTemplate(rows),palette=appearancePalette(options.getConfig().app.appearance_theme,options.getConfig().app.appearance_mode,nativeTheme.shouldUseDarkColors),zoom=host.window.webContents.getZoomFactor()
        release=options.prepareMenu?.(host.window,close)
        if(!current()){release?.();release=undefined;return}
        open=menu;popupParent=host.window;openValid=current;accepting=true
        const origin=host.surface.getBounds(),bounds=page.view.getBounds()
        const appearance=process.platform==='win32'?{theme:palette.dark?'dark' as const:'light' as const,background:palette.surface,foreground:palette.ink,border:palette.stroke,fontFamily:'Segoe UI',fontSize:13*zoom,width:240*zoom,padding:5*zoom,itemPadding:14*zoom,rowHeight:34*zoom,radius:14*zoom,itemRadius:9*zoom,separatorInset:12*zoom,separatorSpacing:12*zoom}:undefined
        const position=nativeMenuPosition({anchor:{x:origin.x+bounds.x+Math.max(0,params.x),y:origin.y+bounds.y+Math.max(0,params.y),width:0,height:0},content:host.window.getContentBounds(),items:rows.map(item=>({label:item.label,type:item.type,shortcut:typeof item.accelerator==='string'?item.accelerator:undefined})),appearance,gap:0})
        menu.popup({window:host.window,frame:frame!,...position,sourceType:params.menuSourceType,...(appearance?{appearance}:{}),callback:()=>{accepting=false;if(open===menu){open=undefined;release?.();release=undefined}}})
      }catch(error){close();report(error)}
    })
  }
  hosts.onPageCreated=watch
  for(const page of hosts.pages.values())watch(page)
}
