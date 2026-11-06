import {useNativeUi} from './useNativeUi'
import {onBeforeUnmount} from 'vue'
import type {NativeMenuItem} from '@shared/native-ui'
import type {WorkspaceFileAction} from '@shared/workspace-file-actions'

export type WorkspaceFileTarget={chatId:string;path:string;revision?:string;contextKey?:string}
const errors:Record<string,string>={file_changed_refresh:'文件已更新，请重新打开菜单。',file_source_unavailable:'来源窗口或文件已失效。',local_file_ui_only:'此操作需要在桌面端执行。',file_content_binary:'此文件不是文本，无法复制正文。',file_content_encoding:'无法正确解码文件内容，请使用系统应用打开。',file_content_too_large:'文件超过 8 MB，请打开后复制。',open_with_unsupported:'此平台暂不支持系统应用选择。',open_with_failed:'无法打开系统应用选择，请使用默认应用打开。'}
export function useWorkspaceFileActions(options:{open:(path:string,chatId:string)=>void;notify?:(text:string)=>void;isCurrent?:(target:WorkspaceFileTarget)=>boolean}){
  const native=useNativeUi()
  let disposed=false
  onBeforeUnmount(()=>{disposed=true})
  const assertCurrent=(target:WorkspaceFileTarget)=>{if(disposed||options.isCurrent&&!options.isCurrent(target))throw Error('来源窗口或文件已切换，请重新打开菜单。')}
  async function perform(target:WorkspaceFileTarget,action:WorkspaceFileAction|'preview'){
    assertCurrent(target)
    if(action==='preview'){
      const check=await window.navora?.workspace.fileAction(target.chatId,target.path,'inspect',{revision:target.revision})
      if(!check?.ok)throw Error(errors[check?.error||'']||'文件已失效，请刷新后重试。')
      assertCurrent(target)
      options.open(target.path,target.chatId);return
    }
    const result=await window.navora?.workspace.fileAction(target.chatId,target.path,action,{revision:target.revision})
    if(!result?.ok){if(!result?.canceled)throw Error(errors[result?.error||'']||(/ENOENT|not_found/.test(result?.error||'')?'文件已移走或删除。':'无法完成文件操作。'));return}
    if(action==='copyContent')options.notify?.('已复制完整文件内容')
    else if(action==='copyPath')options.notify?.('已复制完整路径')
    else if(action==='copyRelativePath')options.notify?.('已复制相对路径')
  }
  async function show(target:WorkspaceFileTarget,event:MouseEvent|KeyboardEvent,kind:'context'|'openWith'='context',extra?:{items:NativeMenuItem[];run:(id:string,target:WorkspaceFileTarget)=>void|Promise<void>}){
    event.preventDefault();event.stopPropagation()
    const captured={...target},element=event instanceof KeyboardEvent&&event.target instanceof Element?event.target.closest<HTMLElement>('a,button,[tabindex]'):event.currentTarget instanceof HTMLElement?event.currentTarget:null
    const point=event instanceof MouseEvent&&(event.clientX!==0||event.clientY!==0)?{x:event.clientX,y:event.clientY,width:1,height:1}:element?.getBoundingClientRect()
    try{
      await native.ready()
      assertCurrent(captured)
      if(!native.menusSupported.value)throw Error('文件菜单需要桌面端原生菜单支持。')
      const inspection=await window.navora?.workspace.fileAction(captured.chatId,captured.path,'inspect',{revision:captured.revision})
      if(!inspection?.ok||!inspection.capabilities)throw Error(errors[inspection?.error||'']||'文件已失效，请刷新后重试。')
      assertCurrent(captured)
      captured.revision=inspection.capabilities.revision
      const capability=inspection.capabilities
      const opening:NativeMenuItem[]=[{id:'preview',label:'在 Navora 中预览',icon:'file-lines',enabled:!capability.directory},{id:'system',label:'使用系统默认应用',icon:'arrow-up-right-from-square'},{id:'openWith',label:'选择其他应用…',icon:'window-restore',enabled:capability.openWith,reason:capability.openWith?undefined:'此平台暂不支持系统应用选择'}]
      const items:NativeMenuItem[]=kind==='openWith'?opening:[
        {id:'open',label:capability.directory?'打开文件夹':'打开文件',icon:'folder-open'},
        {id:'open-options',label:'打开方式',icon:'arrow-up-right-from-square',children:opening},
        {id:'saveAs',label:'另存为…',icon:'download',enabled:!capability.directory},
        {id:'separator-copy',label:'',type:'separator'},
        {id:'copyPath',label:'复制完整路径',icon:'copy'},
        {id:'copyRelativePath',label:'复制相对路径',icon:'link'},
        {id:'copyContent',label:'复制文件内容',icon:'file-lines',enabled:capability.copyContent,reason:capability.copyContentReason},
        {id:'separator-reveal',label:'',type:'separator'},
        {id:'reveal',label:'在文件管理器中显示',icon:'folder-open'},
      ]
      if(extra?.items.length)items.push({id:'separator-extra',label:'',type:'separator'},...extra.items)
      const result=await native.popupMenu(items,kind==='openWith'&&element?element:point||{x:0,y:0,width:1,height:1},{placement:'bottom-end',contextKey:JSON.stringify([captured.chatId,captured.path,captured.revision])})
      if(!result.supported)throw Error('文件菜单暂时不可用，请重试。')
      if(result.selectedId)assertCurrent(captured)
      if(result.selectedId&&extra?.items.some(item=>item.id===result.selectedId)){
        const current=await window.navora?.workspace.fileAction(captured.chatId,captured.path,'inspect',{revision:captured.revision})
        if(!current?.ok)throw Error('文件已更新，请重新打开菜单。')
        assertCurrent(captured)
        await extra.run(result.selectedId,captured)
      }else if(result.selectedId)await perform(captured,(result.selectedId==='open'?(capability.directory?'system':'preview'):result.selectedId) as WorkspaceFileAction|'preview')
      if(element?.isConnected&&(result.selectedId||!result.reason||result.reason==='dismissed'))element.focus({preventScroll:true})
    }catch(error){options.notify?.(error instanceof Error?error.message:'文件操作失败。')}
  }
  return {show,perform}
}
