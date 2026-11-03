import {browserTabAfterRemoval} from './browser-workspace'

/** Orders renderer reads against explicit tab choices; presentation events are only invalidations. */
export class BrowserHostSelection {
  private revision=0
  private intent=0
  private pending:{id:string;intent:number}|undefined
  beginRefresh(){return ++this.revision}
  acceptsRefresh(revision:number){return revision===this.revision}
  beginSelection(id:string){
    this.revision++
    this.pending={id,intent:++this.intent}
    return this.pending.intent
  }
  isCurrentSelection(intent:number){return this.pending?.intent===intent}
  settleSelection(intent:number){
    if(!this.isCurrentSelection(intent))return false
    this.pending=undefined
    return true
  }
  activeId(confirmed:string|undefined,current:string,previous:string[],live:string[]){
    if(this.pending&&live.includes(this.pending.id))return this.pending.id
    return confirmed&&live.includes(confirmed)?confirmed:browserTabAfterRemoval(previous,current,live)
  }
  invalidate(){this.revision++;this.pending=undefined}
}
