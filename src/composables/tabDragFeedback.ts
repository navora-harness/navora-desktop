let target:HTMLElement|null=null
export function clearTabDrop(){target?.classList.remove('tab-drop-before','tab-drop-after');target=null}
export function leaveTabDrop(event:DragEvent){if(!(event.relatedTarget instanceof Node)||(event.currentTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget)))clearTabDrop()}
export function showTabDrop(event:DragEvent){
  const row=(event.target as Element)?.closest<HTMLElement>('.file-workspace-tab,.browser-host-tab,.file-host-tab')
  clearTabDrop();if(!row)return
  const r=row.getBoundingClientRect();target=row;row.classList.add(event.clientX>r.x+r.width/2?'tab-drop-after':'tab-drop-before')
}
export function tabDropBefore(event:DragEvent,fallback?:string){
  if(!event.clientX)return fallback
  const row=(event.target as Element)?.closest<HTMLElement>('.file-workspace-tab,.browser-host-tab,.file-host-tab');if(!row)return fallback
  const r=row.getBoundingClientRect(),node=event.clientX>r.x+r.width/2?row.nextElementSibling:row
  const button=node?.querySelector<HTMLElement>('[role=tab]')
  return button?.dataset.fileKey||button?.dataset.pageId
}
export function startTabFeedback(event:DragEvent){
  const row=event.currentTarget as HTMLElement,label=row.querySelector('[role=tab]'),ghost=document.createElement('div')
  ghost.className='tab-drag-preview';ghost.setAttribute('aria-hidden','true')
  const icon=label?.querySelector<SVGElement|HTMLImageElement>('svg,img')
  if(icon){const previewIcon=icon.cloneNode(true) as SVGElement|HTMLImageElement;previewIcon.removeAttribute('id');previewIcon.setAttribute('aria-hidden','true');ghost.append(previewIcon)}
  const text=document.createElement('span');text.textContent=label?.textContent?.trim()||'标签页';ghost.append(text);document.body.append(ghost)
  const bounds=ghost.getBoundingClientRect()
  ghost.style.left=`${Math.max(0,Math.min(event.clientX-24,innerWidth-bounds.width))}px`
  ghost.style.top=`${Math.max(0,Math.min(event.clientY-18,innerHeight-bounds.height))}px`
  event.dataTransfer?.setDragImage(ghost,24,18);setTimeout(()=>ghost.remove(),0)
  row.classList.add('tab-is-dragging');document.documentElement.classList.add('tab-dragging')
}
export function endTabFeedback(){clearTabDrop();document.querySelectorAll('.tab-is-dragging').forEach(el=>el.classList.remove('tab-is-dragging'));document.documentElement.classList.remove('tab-dragging')}
