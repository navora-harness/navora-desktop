import type {WorkspaceResourceSnapshot} from '../../shared/workspace-resources'

/** Bounded concurrency and short-lived metadata keep resource panes cheap. */
export class WorkspaceResourceIndex {
  private cache=new Map<string,{at:number;value:Promise<boolean>}>()
  private snapshots=new Map<string,{at:number;value:Promise<WorkspaceResourceSnapshot>}>()
  private readers=0
  private waiting:Array<()=>void>=[]
  constructor(private containsFiles:(id:string)=>Promise<boolean>,private readResources?:(id:string)=>Promise<WorkspaceResourceSnapshot>){}
  invalidate(id?:string){if(id){this.cache.delete(id);this.snapshots.delete(id)}else{this.cache.clear();this.snapshots.clear()}}
  async resources(id:string,refresh=false):Promise<WorkspaceResourceSnapshot>{
    if(refresh)this.invalidate(id)
    let item=this.snapshots.get(id)
    if(!item||Date.now()-item.at>5000){
      if(!this.readResources)throw Error('resource_index_unavailable')
      item={at:Date.now(),value:this.readSnapshot(id)}
      this.snapshots.delete(id);this.snapshots.set(id,item)
      while(this.snapshots.size>40)this.snapshots.delete(this.snapshots.keys().next().value!)
    }
    try{return await item.value}catch(error){if(this.snapshots.get(id)===item)this.snapshots.delete(id);throw error}
  }
  private async readSnapshot(id:string){
    await new Promise<void>(resolve=>{if(this.readers<4){this.readers++;resolve()}else this.waiting.push(resolve)})
    try{return await this.readResources!(id)}finally{const next=this.waiting.shift();if(next)next();else this.readers--}
  }
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
