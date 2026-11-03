import type {BrowserAutomationState} from '../../shared/browser-automation'

type AudioTarget={isAudioMuted():boolean;setAudioMuted(muted:boolean):void}

/** Temporary Agent muting never becomes the saved user preference. */
export class BrowserAgentAudio {
  private activeKey?:string
  private manualMuted:boolean
  private overridden=false
  constructor(private target:AudioTarget){this.manualMuted=target.isAudioMuted()}
  get preference(){return this.activeKey?this.manualMuted:this.target.isAudioMuted()}
  /** Display only; never persist this temporary cause as a user preference. */
  snapshot(){const muted=this.target.isAudioMuted(),manualMuted=this.preference;return {muted,manualMuted,muteReason:muted?(manualMuted?'manual' as const:this.activeKey&&!this.overridden?'agent' as const:'manual' as const):undefined,agentAutoMuted:!!this.activeKey&&!this.overridden&&!manualMuted&&muted,manualOverride:!!this.activeKey&&this.overridden}}
  private apply(muted:boolean){if(this.target.isAudioMuted()!==muted)this.target.setAudioMuted(muted)}
  sync(state:BrowserAutomationState,enabled:boolean){
    const key=enabled&&state.owner==='ai'&&(state.leaseRunId||state.activeOperations>0)?state.leaseRunId||'operation':undefined
    if(!key){
      if(this.activeKey)this.apply(this.manualMuted)
      this.activeKey=undefined;this.overridden=false;this.manualMuted=this.target.isAudioMuted();return
    }
    if(key!==this.activeKey){
      if(!this.activeKey)this.manualMuted=this.target.isAudioMuted()
      this.activeKey=key;this.overridden=false
    }
    if(!this.overridden)this.apply(true)
  }
  setManual(muted:boolean){
    this.manualMuted=muted
    if(this.activeKey)this.overridden=true
    this.apply(muted)
  }
}
