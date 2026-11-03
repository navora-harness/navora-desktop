export const SETTINGS_SECTIONS=['basic','appearance','model','browser','workspace','skills','plugins','remote','permissions','fork','subchat','about'] as const
export type SettingsSection=typeof SETTINGS_SECTIONS[number]
export function settingsSection(value:unknown):SettingsSection {
  if(typeof value!=='string'||!SETTINGS_SECTIONS.includes(value as SettingsSection))throw Error('invalid_settings_section')
  return value as SettingsSection
}
export type SettingsOpenRequest={requestId:string;returnId:string;section:SettingsSection;sourceWindowId:number}
export type SettingsOpenResult={ok:boolean;requestId?:string;error?:string}
export type SettingsExitState={phase:'idle'|'waiting'|'decision';reason?:'busy'|'saving'|'failed';message?:string}
export type SettingsExitDecision='retry'|'leave'|'stay'

/** Coordinates an explicit leave intent without cancelling an already submitted transaction. */
export function createSettingsExitGuard(options:{busy:()=>boolean;flush:()=>Promise<void>;retry:()=>Promise<void>;error:()=>string;confirmDiscard:()=>boolean;discardCredentials:()=>void;state:(state:SettingsExitState)=>void;waitMs?:number;pollMs?:number}) {
  let request:Promise<boolean>|undefined,decision:((value:SettingsExitDecision)=>void)|undefined,disposed=false
  const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,options.pollMs??40))
  async function waitFor(operation:Promise<unknown>,reason:'busy'|'saving'){
    let settled=false,failed=false;operation.then(()=>{settled=true},()=>{settled=true;failed=true})
    while(!settled&&!disposed){
      const until=Date.now()+(options.waitMs??8000)
      options.state({phase:'waiting',reason,message:reason==='busy'?'正在完成已提交的修改，完成后返回…':'正在保存设置，完成后返回…'})
      while(!settled&&!disposed&&Date.now()<until)await pause()
      if(settled||disposed)break
      options.state({phase:'decision',reason,message:'保存仍在进行。可以继续等待，或保留普通草稿后返回；已提交的操作会继续完成。'})
      const choice=await Promise.race([new Promise<SettingsExitDecision>(resolve=>{decision=resolve}),operation.then(()=>'done' as const,()=>'failed' as const)])
      decision=undefined
      if(choice==='done'||choice==='failed')return disposed?'stay':choice
      if(choice!=='retry')return choice
    }
    return disposed?'stay':failed?'failed':'done'
  }
  async function run(){
    let failedOperation=false
    try{
      if(options.busy()){
        const busy=(async()=>{while(options.busy()&&!disposed)await pause()})()
        const choice=await waitFor(busy,'busy');if(choice==='stay')return false;if(choice==='leave')return finish()
      }
      while(!disposed){
        if(options.error()||failedOperation){
          options.state({phase:'decision',reason:'failed',message:'自动保存未完成。可重试，或保留普通草稿后返回；尚未确认的设置不会视为已保存。'})
          const choice=await new Promise<SettingsExitDecision>(resolve=>{decision=resolve});decision=undefined
          if(choice==='stay')return false;if(choice==='leave')return finish()
          const result=await waitFor(options.retry(),'saving');if(result==='stay')return false;if(result==='leave')return finish();failedOperation=result==='failed'
        }else{
          const result=await waitFor(options.flush(),'saving');if(result==='stay')return false;if(result==='leave')return finish();failedOperation=result==='failed'
        }
        if(!options.error()&&!failedOperation)return finish()
      }
      return false
    }finally{options.state({phase:'idle'})}
  }
  function finish(){if(disposed||!options.confirmDiscard())return false;options.discardCredentials();return true}
  return {
    request(){if(!request)request=run().finally(()=>{request=undefined});return request},
    decide(value:SettingsExitDecision){decision?.(value)},
    dispose(){disposed=true;decision?.('stay')},
  }
}
