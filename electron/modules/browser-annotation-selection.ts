/** Guest-only CSS cursor assets. Deliberately independent of AI virtual cursors. */
export const annotationCursor='url("data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M4 2v19l5-5 4 9 4-2-4-9h7z" fill="#2563a9" stroke="white" stroke-width="2" stroke-linejoin="round"/><path d="M20 5h9v7h-5l-3 3v-3h-1z" fill="white" stroke="#2563a9" stroke-width="1.5"/></svg>')+'") 4 2, crosshair'
export const annotationDragCursor='url("data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M2 10h16M10 2v16" stroke="white" stroke-width="4"/><path d="M2 10h16M10 2v16" stroke="#2563a9" stroke-width="2"/><path d="M16 16h12v11H16z" fill="white" stroke="#2563a9" stroke-width="1.5" stroke-dasharray="3 2"/></svg>')+'") 10 10, crosshair'

/** Closed shadow DOM isolates drawing only. Comment text never enters this guest world. */
export function annotationSelectionSource(mode:'auto'|'element'|'region',sessionId:string){return String.raw`(() => {
  globalThis.__navoraAnnotations?.stop();
  const state={id:(globalThis.__navoraDocumentId ||= crypto.randomUUID()),sessionId:SESSION,phase:'armed',selection:null,element:null,cancelled:false,heldSpace:false,capture:false};
  globalThis.__navoraAnnotations=state;
  const host=document.createElement('div'),box=document.createElement('div'),root=host.attachShadow({mode:'closed'});
  host.dataset.navoraAnnotationLayer='';host.tabIndex=-1;host.style.cssText='position:fixed;inset:0;z-index:2147483647;touch-action:none;outline:none';host.style.cursor=CURSOR;
  box.style.cssText='position:fixed;box-sizing:border-box;border:2px solid #397dd0;background:#397dd019;pointer-events:none;display:none';root.append(box);document.documentElement.append(host);
  let start=null,mode=MODE;
  const block=e=>{e.preventDefault();e.stopImmediatePropagation()};
  const editable=()=>{const el=document.activeElement;return el instanceof Element&&(el.matches('input,textarea,select')||el.isContentEditable)};
  const rect=(x,y,width,height)=>({x,y,width,height});
  const draw=r=>{box.style.display='';Object.assign(box.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'})};
  const target=e=>{host.style.display='none';let el=document.elementFromPoint(e.clientX,e.clientY);host.style.display='';while(el?.shadowRoot){const inner=el.shadowRoot.elementFromPoint(e.clientX,e.clientY);if(!inner||inner===el)break;el=inner}return el};
  const region=(a,b)=>rect(Math.max(0,Math.min(a.x,b.x)),Math.max(0,Math.min(a.y,b.y)),Math.min(innerWidth,Math.max(a.x,b.x))-Math.max(0,Math.min(a.x,b.x)),Math.min(innerHeight,Math.max(a.y,b.y))-Math.max(0,Math.min(a.y,b.y)));
  function setMode(value){state.heldSpace=false;start=null;state.phase=value;host.style.display=value==='passthrough'?'none':'';host.style.cursor=CURSOR;if(value==='armed'){state.selection=null;state.element=null;box.style.display='none';host.focus({preventScroll:true})}}
  state.mode=setMode;
  state.hideForCapture=value=>{state.capture=value;host.style.visibility=value?'hidden':'';if(state.phase!=='stale')state.phase=value?'saving':state.selection?'target-ready':'armed'};
  function move(e){if(state.phase==='passthrough'||state.capture)return;if(start){if(mode==='region'||Math.hypot(e.clientX-start.x,e.clientY-start.y)>=6){state.phase='dragging';host.style.cursor=DRAG_CURSOR;draw(region(start,{x:e.clientX,y:e.clientY}))}}else if(state.phase==='armed'){const el=target(e);if(el instanceof Element&&!el.matches('html,body'))draw(el.getBoundingClientRect());else box.style.display='none'}}
  function down(e){if(state.phase==='passthrough')return;block(e);if(!e.isPrimary||e.button!==0||state.capture)return;start={x:e.clientX,y:e.clientY,pointer:e.pointerId};try{host.setPointerCapture(e.pointerId)}catch{}}
  function up(e){if(state.phase==='passthrough')return;block(e);if(!start||state.capture)return;const a=start;start=null;const el=target(e),r=region(a,{x:e.clientX,y:e.clientY});let kind=(mode==='region'||Math.hypot(e.clientX-a.x,e.clientY-a.y)>=6)&&r.width>=2&&r.height>=2?'region':'element',chosen=r;
    if(kind==='element'){const measured=el instanceof Element?el.getBoundingClientRect():null;if(!measured||el.matches('html,body')||measured.width<1||measured.height<1){kind='point';chosen=rect(Math.max(0,e.clientX-4),Math.max(0,e.clientY-4),8,8)}else chosen=rect(measured.x,measured.y,measured.width,measured.height)}
    const path=[];let node=kind==='element'?el:null;while(node&&node!==document.documentElement&&path.length<10){if(node.id){path.unshift('#'+CSS.escape(node.id));break}const parent=node.parentElement;if(!parent)break;path.unshift(node.localName+':nth-child('+(Array.from(parent.children).indexOf(node)+1)+')');node=parent}
    state.element=kind==='element'?el:null;state.selection={formatVersion:2,targetId:'target_'+crypto.randomUUID(),documentId:state.id,url:location.href,title:document.title,kind,rect:chosen,selector:kind==='element'?path.join(' > '):undefined,text:kind==='element'&&!el.matches('input,textarea')?(el.textContent||'').trim().slice(0,500):'',point:kind==='point'?{x:e.clientX+scrollX,y:e.clientY+scrollY}:undefined,frameScope:kind==='element'&&el.matches('iframe,frame')?'embedded-container':'top',viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY,dpr:devicePixelRatio},visualViewport:visualViewport?{offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop,scale:visualViewport.scale,width:visualViewport.width,height:visualViewport.height}:undefined};
    state.phase='target-ready';host.style.cursor=CURSOR;draw(chosen);try{host.releasePointerCapture(e.pointerId)}catch{}
  }
  function cancelPointer(e){if(!start)return;block(e);start=null;state.phase='armed';box.style.display='none';host.style.cursor=CURSOR}
  function keydown(e){if(e.isComposing||e.keyCode===229||e.repeat)return;if(e.key==='Escape'&&state.phase!=='saving'){block(e);if(state.phase==='passthrough'||state.selection||start)setMode('armed');else {state.cancelled=true;stop()}return}if(e.code==='Space'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey&&state.phase==='armed'&&!start&&!editable()){block(e);state.heldSpace=true;state.phase='passthrough';host.style.display='none'}}
  function keyup(e){if(e.code!=='Space'||!state.heldSpace||e.isComposing)return;block(e);state.heldSpace=false;if(!editable())setMode('armed')}
  function blur(){state.heldSpace=false;if(state.phase==='passthrough'&&!editable())setMode('armed');if(start){start=null;state.phase='armed';box.style.display='none'}}
  const click=e=>{if(state.phase!=='passthrough')block(e)};
  function stop(){state.heldSpace=false;host.remove();for(const [name,fn] of handlers)document.removeEventListener(name,fn,true);window.removeEventListener('blur',blur)}
  const handlers=[['pointermove',move],['pointerdown',down],['pointerup',up],['pointercancel',cancelPointer],['lostpointercapture',cancelPointer],['click',click],['contextmenu',click],['keydown',keydown],['keyup',keyup]];
  state.stop=stop;for(const [name,fn] of handlers)document.addEventListener(name,fn,true);window.addEventListener('blur',blur);host.focus({preventScroll:true});return true;
})()`.replace('SESSION',JSON.stringify(sessionId)).replace('MODE',JSON.stringify(mode)).replaceAll('DRAG_CURSOR',JSON.stringify(annotationDragCursor)).replaceAll('CURSOR',JSON.stringify(annotationCursor))}
