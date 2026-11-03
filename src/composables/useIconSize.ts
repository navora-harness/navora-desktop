const callbacks=new Map<Element,(size:number)=>void>()
let observer:ResizeObserver|undefined

/** All icons share one observer; CSS continues to own their layout dimensions. */
export function observeIconSize(element:SVGSVGElement,update:(size:number)=>void){
  const initial=element.clientWidth
  if(initial>0)update(initial)
  if(typeof ResizeObserver==='undefined')return ()=>{}
  observer??=new ResizeObserver(entries=>{
    for(const entry of entries){
      const size=entry.contentRect.width
      if(size>0)callbacks.get(entry.target)?.(size)
    }
  })
  callbacks.set(element,update)
  observer.observe(element)
  return ()=>{
    callbacks.delete(element)
    observer?.unobserve(element)
    if(!callbacks.size){observer?.disconnect();observer=undefined}
  }
}
