import type {AppQuitRequest,AppQuitState,AppQuitResult} from '../../shared/app-quit'

/** Run leases can remain during cancellation cleanup; only live Agents count. */
export function readAppQuitState(runtime?:{runningChatIds:()=>string[];isRunning:(chatId:string)=>boolean}):AppQuitState{
  return {runningAgents:runtime?[...new Set(runtime.runningChatIds())].filter(id=>runtime.isRunning(id)).length:0}
}

type QuitWindow={isDestroyed:()=>boolean;isMinimized:()=>boolean;restore:()=>void;show:()=>void;focus:()=>void;webContents:{id:number;isDestroyed:()=>boolean;send:(channel:string,payload:AppQuitRequest)=>void}}
/** A tray click requests the same renderer confirmation; only confirm commits shutdown. */
export function createAppQuitIntent(options:{getMain:()=>QuitWindow|null;createMain:()=>Promise<void>;state?:()=>AppQuitState;commit:()=>void|Promise<void>}){
  let readyId:number|undefined,pending=false,creating:Promise<void>|undefined,committed=false,confirmation:Promise<AppQuitResult>|undefined,pendingError:string|undefined
  const live=(win:QuitWindow|null):win is QuitWindow=>!!win&&!win.isDestroyed()&&!win.webContents.isDestroyed()
  function dispatch(){const main=options.getMain();if(committed||!pending||!live(main)||main.webContents.id!==readyId)return;pending=false;main.webContents.send('navora:app.quit-requested',{source:'tray',...(pendingError?{error:pendingError}:{})});pendingError=undefined}
  return {
    state:():AppQuitState=>options.state?.()||{runningAgents:0},
    async request(error?:string){
      if(committed)return
      if(error)pendingError=error
      pending=true
      if(!live(options.getMain())){creating??=options.createMain().finally(()=>{creating=undefined});await creating}
      const main=options.getMain();if(!live(main))throw Error('main_window_unavailable')
      if(main.isMinimized())main.restore();main.show();main.focus();dispatch()
    },
    ready(win:QuitWindow){if(win!==options.getMain()||!live(win))throw Error('main_window_required');readyId=win.webContents.id;dispatch()},
    loading(win:QuitWindow){if(win===options.getMain())readyId=undefined},
    confirm(expectedRunningAgents?:number):AppQuitResult|Promise<AppQuitResult>{
      if(confirmation)return confirmation
      if(committed)return {ok:true}
      if(expectedRunningAgents!==undefined){
        if(!Number.isSafeInteger(expectedRunningAgents)||expectedRunningAgents<0)throw Error('invalid_quit_state')
        const state=options.state?.()||{runningAgents:0}
        if(state.runningAgents>expectedRunningAgents)return {ok:false,reason:'running_agents_changed',...state}
      }
      committed=true;pending=false
      try{
        const result=options.commit()
        if(result&&typeof result.then==='function'){
          confirmation=Promise.resolve(result).then(()=>{confirmation=undefined;return {ok:true}}).catch(error=>{committed=false;confirmation=undefined;throw error})
          return confirmation
        }
        return {ok:true}
      }catch(error){committed=false;throw error}
    },
  }
}

/** Every normal quit path shares one resource barrier before native shutdown. */
export function createAppQuitDrain(options:{stop:()=>void;drain:()=>Promise<void>;commit:()=>void;failed?:()=>void}){
  let ready=false,pending:Promise<void>|undefined
  return {
    ready:()=>ready,
    request():Promise<void>{
      if(ready)return Promise.resolve().then(options.commit)
      if(pending)return pending
      // Assign the shared promise before stop can synchronously close a window
      // and re-enter Electron's before-quit event.
      pending=Promise.resolve().then(()=>{options.stop();return options.drain()}).then(()=>{ready=true;options.commit()}).catch(error=>{pending=undefined;options.failed?.();throw error})
      return pending
    },
  }
}
