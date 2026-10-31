/** Bounded concurrency and short-lived metadata keep the global file pane cheap. */
export class WorkspaceResourceIndex {
  private cache=new Map<string,{at:number;value:Promise<boolean>}>()
  constructor(private containsFiles:(id:string)=>Promise<boolean>){}
  invalidate(id?:string){if(id)this.cache.delete(id);else this.cache.clear()}
  async owners(ids:string[],refresh=false){
    if(refresh)this.invalidate()
    const found=new Set<string>();let unavailable=0,next=0
    await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{
      while(next<ids.length){
        const id=ids[next++]!
        let item=this.cache.get(id)
        if(!item||Date.now()-item.at>5000){item={at:Date.now(),value:Promise.resolve().then(()=>this.containsFiles(id))};this.cache.set(id,item)}
        try{if(await item.value)found.add(id)}catch{unavailable++;if(this.cache.get(id)===item)this.cache.delete(id)}
      }
    }))
    return {chatIds:ids.filter(id=>found.has(id)),unavailable}
  }
}
