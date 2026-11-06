import {useNativeUi} from './useNativeUi'
import {appLinkError,appLinkUrl,type AppLinkMode} from '@shared/app-links'
import {onBeforeUnmount} from 'vue'

export function useAppLinks(notify:(text:string)=>void=()=>{}) {
  const menus=useNativeUi()
  let disposed=false,menuGeneration=0
  onBeforeUnmount(()=>{disposed=true;menuGeneration++})
  async function openLink(url:string,chatId?:string,mode?:AppLinkMode) {
    try {
      const target=appLinkUrl(url)
      if(window.navora?.app.platform==='web') {
        window.open(target,'_blank','noopener,noreferrer')
        return
      }
      const result=await window.navora?.app.openLink({url:target,chatId,mode})
      if(!result?.ok)throw Error(result?.error||'local_only')
    }catch(error){notify(appLinkError(error))}
  }
  async function showLinkMenu(url:string,event:MouseEvent|KeyboardEvent,chatId?:string) {
    event.preventDefault();event.stopPropagation()
    const generation=++menuGeneration
    const element=event.target instanceof Element?event.target.closest<HTMLElement>('a[href]')|| (event.currentTarget instanceof HTMLElement?event.currentTarget:null):null
    const href=element?.getAttribute('href'),owner=element?.closest<HTMLElement>('[data-chat-id]')?.dataset.chatId
    const current=()=>!disposed&&generation===menuGeneration&&(!element||element.isConnected&&element.getAttribute('href')===href&&element.closest<HTMLElement>('[data-chat-id]')?.dataset.chatId===owner)
    try {
      const target=appLinkUrl(url)
      await menus.ready()
      if(!current())return
      if(!menus.menusSupported.value)throw Error('menu_unavailable')
      const point=event instanceof MouseEvent&&(event.clientX!==0||event.clientY!==0)?{x:event.clientX,y:event.clientY,width:1,height:1}:element?.getBoundingClientRect()||{x:8,y:44,width:1,height:1}
      const result=await menus.popupMenu([
        {id:'visit',label:'访问链接',icon:'arrow-up-right-from-square'},
        {id:'copy',label:'复制链接',icon:'copy'},
        {id:'link-separator',label:'',type:'separator'},
        {id:'external',label:'在外部浏览器中打开链接',icon:'globe'},
      ],point,{contextKey:`link:${chatId||''}:${target}`})
      if(!current())return
      if(!result.supported)throw Error('menu_unavailable')
      if(result.selectedId==='visit')await openLink(target,chatId)
      else if(result.selectedId==='external')await openLink(target,chatId,'external')
      else if(result.selectedId==='copy')await navigator.clipboard.writeText(target)
    }catch{notify('链接菜单暂时不可用，请重试')}
  }
  return {openLink,showLinkMenu}
}
