import type {NativeMenuItem} from '@shared/native-ui'

/** Read the ordinary slot menus without replacing their Vue action handlers. */
export function nativeMenuSource(root:HTMLElement):{items:NativeMenuItem[];buttons:Map<string,HTMLButtonElement>;signature:string}{
  const items:NativeMenuItem[]=[],buttons=new Map<string,HTMLButtonElement>()
  let index=0
  function separator(){if(items.length&&items.at(-1)?.type!=='separator')items.push({id:`separator-${index++}`,label:'',type:'separator'})}
  function visit(node:Element){
    if(node.matches('[role="separator"],.sidebar-more-divider,.with-sep,[class$="-separator"]'))separator()
    if(node instanceof HTMLButtonElement){
      const id=`action-${index++}`,copy=node.cloneNode(true) as HTMLElement
      copy.querySelectorAll('svg,[aria-hidden="true"],kbd,[class*="shortcut"]').forEach(element=>element.remove())
      const label=(copy.textContent||node.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim()
      if(!label)return
      const role=node.getAttribute('role'),type=role==='menuitemcheckbox'?'checkbox':role==='menuitemradio'?'radio':'normal'
      const shortcut=node.querySelector('kbd,[class*="shortcut"]')?.textContent?.trim()
      items.push({id,label,type,enabled:!node.disabled,...(type!=='normal'?{checked:node.getAttribute('aria-checked')==='true'}:{}),...(node.querySelector('[data-icon]')?.getAttribute('data-icon')?{icon:node.querySelector('[data-icon]')!.getAttribute('data-icon')!}:{}),...(node.title?{reason:node.title}:{}),...(shortcut?{shortcut}:{})})
      buttons.set(id,node)
      return
    }
    if(node.matches('.sidebar-ctx-label')&&node.textContent?.trim()){
      items.push({id:`heading-${index++}`,label:node.textContent.trim(),enabled:false})
      return
    }
    for(const child of node.children)visit(child)
  }
  for(const child of root.children)visit(child)
  if(items.at(-1)?.type==='separator')items.pop()
  return {items,buttons,signature:JSON.stringify(items)}
}

export function nativeMenuAnchor(event:MouseEvent|KeyboardEvent,trigger?:HTMLElement|null){
  const bounds=trigger?.getBoundingClientRect(),keyboard=!('clientX' in event)||(event.clientX===0&&event.clientY===0)
  return keyboard&&bounds?{x:bounds.left,y:bounds.bottom,width:0,height:0}:{x:'clientX' in event?event.clientX:0,y:'clientY' in event?event.clientY:0,width:0,height:0}
}
