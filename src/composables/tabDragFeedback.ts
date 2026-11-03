const rowSelector='.workspace-tab-item'
let target:HTMLElement|null=null,after=false,marker:HTMLElement|undefined,source:HTMLElement|undefined,sourceRows:HTMLElement[]=[],previewRows:HTMLElement[]=[],lastPoint:{x:number;y:number}|undefined
const key=(row:Element)=>{const tab=row.querySelector<HTMLElement>('[role=tab]');return tab?.dataset.fileKey||tab?.dataset.pageId}
const isConversation=(row:Element)=>!!row.querySelector('[data-conversation-tab]')
function rowsIn(row:Element){return [...row.parentElement?.children||[]].filter((node):node is HTMLElement=>node instanceof HTMLElement&&node.matches(rowSelector)&&!isConversation(node))}
function naturalRect(row:HTMLElement){const rect=row.getBoundingClientRect(),x=Number(row.dataset.tabPreviewX)||0;return {left:rect.left-x,right:rect.right-x,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height}}
function resetPreview(){for(const row of previewRows){row.style.removeProperty('translate');row.classList.remove('tab-neighbor-preview');delete row.dataset.tabPreviewX}previewRows=[]}
export function clearTabDrop(){target?.classList.remove('tab-drop-before','tab-drop-after');target=null;marker?.remove();marker=undefined;resetPreview();lastPoint=undefined}
export function leaveTabDrop(event:DragEvent){if(!(event.relatedTarget instanceof Node)||(event.currentTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget)))clearTabDrop()}
function resolve(event:DragEvent){
 const row=(event.target as Element)?.closest<HTMLElement>(rowSelector);if(!row||isConversation(row))return
 const r=naturalRect(row),rtl=getComputedStyle(row.parentElement!).direction==='rtl',mid=r.left+r.width/2,position=event.clientX-mid
 // Four CSS pixels of hysteresis prevent two adjacent slots oscillating at a shared midpoint.
 const next=target===row&&Math.abs(position)<4?after:rtl?position<0:position>0
 return {row,after:next,rtl,r}
}
function renderAt(event:DragEvent){
 const candidate=resolve(event);if(!candidate){clearTabDrop();return}
 const {row,rtl,r}=candidate,rows=rowsIn(row),group=sourceRows.filter(item=>rows.includes(item)),pinned=group[0]?.classList.contains('is-pinned')
 let index=rows.indexOf(row)+(candidate.after?1:0)
 if(group.length){const boundary=rows.filter(item=>item.classList.contains('is-pinned')).length;index=pinned?Math.min(index,boundary):Math.max(index,boundary)}
 const preceding=rows[index],last=rows.at(-1),placement=preceding?naturalRect(preceding):last?naturalRect(last):r
 const lineX=preceding?(rtl?placement.right:placement.left):(rtl?placement.left:placement.right)
 target?.classList.remove('tab-drop-before','tab-drop-after');target=row;after=candidate.after;row.classList.add(after?'tab-drop-after':'tab-drop-before')
 marker??=Object.assign(document.createElement('div'),{className:'tab-drop-indicator'});marker.setAttribute('aria-hidden','true');if(!marker.isConnected)document.body.append(marker)
 marker.style.cssText='left:'+Math.max(0,lineX-1)+'px;top:'+r.top+'px;height:'+r.height+'px'
 const beforeRow=rows.slice(index).find(item=>!group.includes(item));marker.dataset.before=beforeRow?key(beforeRow)||'':''
 resetPreview()
 if(group.length&&source?.parentElement===row.parentElement){
  const remaining=rows.filter(item=>!group.includes(item)),before=rows.slice(index).find(item=>!group.includes(item)),insert=before?remaining.indexOf(before):remaining.length,next=[...remaining.slice(0,insert),...group,...remaining.slice(insert)]
  const first=rows[0]&&naturalRect(rows[0]);let position=first?(rtl?first.right:first.left):0;const gap=parseFloat(getComputedStyle(row.parentElement!).columnGap)||4
  for(const item of next){const natural=naturalRect(item),dx=rtl?position-natural.right:position-natural.left;position+= (rtl?-1:1)*(natural.width+gap);if(group.includes(item)||Math.abs(dx)<.5)continue;item.dataset.tabPreviewX=String(dx);item.style.translate=dx+'px 0';item.classList.add('tab-neighbor-preview');previewRows.push(item)}
 }
}
export function showTabDrop(event:DragEvent){lastPoint={x:event.clientX,y:event.clientY};renderAt(event)}
export function refreshTabDrop(){if(!lastPoint)return;const element=document.elementFromPoint(lastPoint.x,lastPoint.y);if(element)renderAt({target:element,clientX:lastPoint.x,clientY:lastPoint.y} as unknown as DragEvent)}
export function tabDropBefore(event:DragEvent,fallback?:string){
 if(event.clientX===0&&event.clientY===0)return fallback
 if(!resolve(event))return fallback
 renderAt(event);return marker?.dataset.before||undefined
}
export function startTabFeedback(event:DragEvent){
 endTabFeedback();source=event.currentTarget as HTMLElement
 const rows=rowsIn(source),selected=source.classList.contains('is-multi-selected')?rows.filter(row=>row.classList.contains('is-multi-selected')&&row.classList.contains('is-pinned')===source!.classList.contains('is-pinned')):[source]
 sourceRows=selected.length?selected:[source]
 for(const row of sourceRows){row.style.setProperty('--tab-drag-slot-width',row.getBoundingClientRect().width+'px');row.classList.add('tab-is-dragging')}
 const label=source.querySelector('[role=tab]'),ghost=document.createElement('div');ghost.className='tab-drag-preview';ghost.setAttribute('aria-hidden','true')
 const icon=label?.querySelector<SVGElement|HTMLImageElement>('svg,img');if(icon){const copy=icon.cloneNode(true) as Element;copy.removeAttribute('id');copy.setAttribute('aria-hidden','true');ghost.append(copy)}
 const text=document.createElement('span');text.textContent=label?.textContent?.trim()||'标签页';ghost.append(text);document.body.append(ghost)
 ghost.style.width=source.getBoundingClientRect().width+'px';const bounds=ghost.getBoundingClientRect();ghost.style.left=Math.max(0,Math.min(event.clientX-24,innerWidth-bounds.width))+'px';ghost.style.top=Math.max(0,Math.min(event.clientY-18,innerHeight-bounds.height))+'px';event.dataTransfer?.setDragImage(ghost,24,18);setTimeout(()=>ghost.remove(),0)
 document.documentElement.classList.add('tab-dragging');window.addEventListener('blur',endTabFeedback);window.addEventListener('keydown',cancelVisual,true)
}
function cancelVisual(event:KeyboardEvent){if(event.key==='Escape')endTabFeedback()}
export function endTabFeedback(){clearTabDrop();for(const row of sourceRows){row.classList.remove('tab-is-dragging');row.style.removeProperty('--tab-drag-slot-width')}sourceRows=[];source=undefined;document.documentElement.classList.remove('tab-dragging');window.removeEventListener('blur',endTabFeedback);window.removeEventListener('keydown',cancelVisual,true)}
