import type {FileTab,WorkspaceFileTab} from './file-tabs'
/** Keep readable RTL/emoji text; remove control characters that can impersonate a suffix or status. */
export const workspaceDisplayText=(value:unknown)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim():''
export function workspaceFileIcon(path:string){const extension=path.split('.').at(-1)?.toLowerCase()||'';return /^(png|jpe?g|webp|gif|svg|ico|avif|bmp)$/.test(extension)?'image':/^(js|jsx|ts|tsx|vue|html?|css|scss|json|py|rs|go|java|c|cpp|h|sh|ps1|yaml|yml|toml|xml|sql)$/.test(extension)?'code':'file-lines'}
function host(url?:string){try{const parsed=new URL(url||'');return /^https?:$/.test(parsed.protocol)?parsed.host:''}catch{return ''}}
export function workspaceBrowserTitle(title?:string,url?:string){return workspaceDisplayText(title)||host(url)||'新标签页'}
function stableSuffix(id:string){let hash=2166136261;for(const char of id){hash^=char.codePointAt(0)!;hash=Math.imul(hash,16777619)}return (hash>>>0).toString(36).slice(-4).padStart(4,'0')}
export function workspaceTabPresentation(tab:FileTab,tabs:readonly FileTab[],owner:(id:string)=>string=()=> ''){
  if(tab.kind==='subchats'){const label=workspaceDisplayText(tab.title)||'子对话';return {label,suffix:'',fullTitle:label,description:[label,'子对话',owner(tab.parentChatId)].filter(Boolean).join('，'),icon:'robot'}}
  if(tab.kind==='browser'){
    const fullTitle=workspaceBrowserTitle(tab.fullTitle??tab.path,tab.desiredUrl||tab.url),domain=host(tab.desiredUrl||tab.url)
    const duplicates=tabs.filter(item=>item.kind==='browser'&&workspaceBrowserTitle(item.fullTitle??item.path,item.desiredUrl||item.url)===fullTitle)
    const sameHost=duplicates.filter(item=>host(item.desiredUrl||item.url)===domain)
    const suffix=duplicates.length>1?[domain,sameHost.length>1?stableSuffix(tab.pageId||tab.key):''].filter(Boolean).join(' · '):''
    return {label:fullTitle,suffix,fullTitle,description:[fullTitle,suffix,'网页',owner(tab.chatId),tab.desiredUrl||tab.url].filter(Boolean).join('，'),icon:'globe'}
  }
  const path=workspaceDisplayText(tab.path),parts=path.split('/'),label=parts.at(-1)||path
  const duplicates=tabs.filter((item):item is WorkspaceFileTab=>!item.kind&&item.path.split('/').at(-1)===tab.path.split('/').at(-1))
  let suffix=''
  if(duplicates.length>1){
    const parents=parts.slice(0,-1)
    for(let count=1;count<=Math.max(1,parents.length);count++){
      suffix=parents.slice(-count).join('/')||'根目录'
      if(duplicates.every(item=>item.key===tab.key||item.chatId!==tab.chatId||item.path.split('/').slice(0,-1).slice(-count).join('/')!==parents.slice(-count).join('/')))break
    }
    if(duplicates.some(item=>item.key!==tab.key&&item.chatId!==tab.chatId&&item.path===tab.path))suffix=[owner(tab.chatId)||tab.chatId,suffix].filter(Boolean).join(' / ')
  }
  return {label,suffix,fullTitle:label,description:[label,suffix,'文件',owner(tab.chatId),path].filter(Boolean).join('，'),icon:workspaceFileIcon(path)}
}
/** The app renderer never loads an unrelated origin on behalf of an untrusted favicon. */
export function workspaceFaviconUrl(value:unknown,pageUrl?:string){
  if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\u007f]/.test(value))return
  try{const url=new URL(value),page=new URL(pageUrl||'');if(!/^https?:$/.test(url.protocol)||!/^https?:$/.test(page.protocol)||url.username||url.password||url.origin!==page.origin)return;return url.href}catch{return}
}
export function workspaceAudioLabel(muted?:boolean,audible?:boolean,reason?:'manual'|'agent'){return muted?(reason==='agent'?'Agent 操作期间自动静音':reason==='manual'?'手动静音':'已静音'):audible?'正在播放音频':''}
