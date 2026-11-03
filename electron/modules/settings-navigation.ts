import {randomUUID} from 'node:crypto'
import {settingsSection,type SettingsOpenRequest,type SettingsOpenResult} from '../../shared/settings-navigation'
type WindowPort={id:number;isDestroyed:()=>boolean;isMinimized:()=>boolean;restore:()=>void;show:()=>void;focus:()=>void;isFocused:()=>boolean;webContents:{id:number;isDestroyed:()=>boolean;send:(channel:string,payload:SettingsOpenRequest)=>void}}
type Pending={payload:SettingsOpenRequest;source:WindowPort;resolve:(value:SettingsOpenResult)=>void;promise:Promise<SettingsOpenResult>;timer:ReturnType<typeof setTimeout>;sentTo?:number}
/** Hash/history navigation keeps the mounted App listener; subframes do not own it. */
export const resetsSettingsDocument=(isInPlace:boolean,isMainFrame:boolean)=>isMainFrame&&!isInPlace
/** Sender authentication stays with the IPC adapter; this service never accepts renderer window IDs. */
export function createSettingsNavigation(options:{getMain:()=>WindowPort|null;createMain:()=>Promise<void>;timeoutMs?:number}){
  let readyId:number|undefined,creating:Promise<void>|undefined,activeReturn:{id:string;source:WindowPort}|undefined
  const pending=new Map<string,Pending>()
  const live=(win:WindowPort|null|undefined):win is WindowPort=>!!win&&!win.isDestroyed()&&!win.webContents.isDestroyed()
  function foreground(win:WindowPort){if(win.isMinimized())win.restore();win.show();win.focus()}
  function finish(id:string,result:SettingsOpenResult){const item=pending.get(id);if(!item)return;clearTimeout(item.timer);pending.delete(id);if(!result.ok&&activeReturn?.id===id)activeReturn=undefined;item.resolve(result)}
  function dispatch(){const main=options.getMain();if(!live(main)||main.webContents.id!==readyId)return;for(const item of pending.values())if(item.sentTo!==readyId){item.sentTo=readyId;main.webContents.send('navora:app.settings.open',item.payload)}}
  async function open(source:WindowPort,section:unknown):Promise<SettingsOpenResult>{
    const destination=settingsSection(section)
    if(!live(source))return {ok:false,error:'来源窗口已关闭，请从当前窗口重试。'}
    const duplicate=[...pending.values()].find(item=>item.source===source&&item.payload.section===destination)
    if(duplicate)return duplicate.promise
    const id=randomUUID(),returnId=activeReturn?.id||id
    const payload:SettingsOpenRequest={requestId:id,returnId,section:destination,sourceWindowId:source.id}
    let resolve!:Pending['resolve'];const promise=new Promise<SettingsOpenResult>(done=>resolve=done)
    const timer=setTimeout(()=>finish(id,{ok:false,error:'设置窗口没有及时响应，请再次选择此入口重试。'}),options.timeoutMs??15000)
    pending.set(id,{payload,source,resolve,promise,timer})
    if(!activeReturn)activeReturn={id,source}
    try{
      if(!live(options.getMain())){
        creating??=options.createMain().finally(()=>{creating=undefined})
        await creating
      }
      const main=options.getMain();if(!live(main))throw Error('主窗口暂不可用，请重试。')
      foreground(main);dispatch()
    }catch(error){finish(id,{ok:false,error:error instanceof Error?error.message:'无法打开设置，请重试。'})}
    return promise
  }
  return {
    open,
    ready(main:WindowPort){if(main!==options.getMain()||!live(main))throw Error('main_window_required');readyId=main.webContents.id;dispatch()},
    loading(main:WindowPort){if(main===options.getMain()){readyId=undefined;for(const item of pending.values())item.sentTo=undefined}},
    handled(main:WindowPort,id:string,accepted:boolean){if(main!==options.getMain()||main.webContents.id!==readyId)throw Error('main_window_required');finish(id,{ok:accepted,requestId:id,...(!accepted?{error:'设置未打开；请完成当前对话框或保留修改后重试。'}:{})})},
    returnToSource(main:WindowPort,id:string,restore=true){if(main!==options.getMain())throw Error('main_window_required');if(activeReturn?.id!==id)return;const ticket=activeReturn;activeReturn=undefined;if(restore&&main.isFocused()&&ticket.source!==main&&live(ticket.source))foreground(ticket.source)},
    dispose(){for(const id of pending.keys())finish(id,{ok:false,error:'应用窗口已关闭。'});activeReturn=undefined;readyId=undefined},
  }
}
