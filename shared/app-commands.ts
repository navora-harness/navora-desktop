export type AppMenuId='file'|'edit'|'view'|'help'
export type AppMenuMode='main'|'detached'|'file'|'compact'
export type AppCommandId=
  |'conversation.new'|'browser.new'|'browser.reopen'|'conversation.openFile'|'conversation.openFolder'|'conversation.export'|'content.close'|'app.settings'|'app.quit'
  |'edit.undo'|'edit.redo'|'edit.cut'|'edit.copy'|'edit.paste'|'edit.pastePlain'|'edit.delete'|'edit.selectAll'|'editor.link'|'editor.unlink'|'editor.attach'|'conversation.search'|'conversation.find'
  |'view.sidebar'|'view.sidebarPinned'|'view.workspace'|'view.workspaceExpand'|'view.summary'|'editor.focus'
  |'help.docs'|'help.shortcuts'|'help.guide'|'help.about'
  |'browser.reload'|'browser.reloadIgnoringCache'|'browser.mute'|'workspace.attach'|'file.reveal'|'file.openExternal'
export type AppCommandState={enabled?:boolean;visible?:boolean;label?:string;checked?:boolean;reason?:string}
export type AppCommandStateMap=Partial<Record<AppCommandId,AppCommandState|boolean>>
export type AppCommandContext={contextKey?:string;target:unknown;menu:AppMenuId;source:'menu'|'shortcut';nativePageId?:string}
export type AppCommandHandlers=Partial<Record<AppCommandId,(context:AppCommandContext)=>void|Promise<void>>>
export type AppCommandDefinition={id:AppCommandId;menu:AppMenuId;group:number;label:string;shortcut?:string;scope:'application'|'conversation'|'editor'|'content'|'workspace';modes?:AppMenuMode[];danger?:boolean}
export const appMenus:{id:AppMenuId;label:string;accessKey:string}[]=[{id:'file',label:'文件',accessKey:'f'},{id:'edit',label:'编辑',accessKey:'e'},{id:'view',label:'视图',accessKey:'v'},{id:'help',label:'帮助',accessKey:'h'}]
export const appCommands:AppCommandDefinition[]=[
  {id:'conversation.new',menu:'file',group:0,label:'新对话',shortcut:'Mod+N',scope:'conversation',modes:['main','compact']},
  {id:'browser.new',menu:'file',group:0,label:'新建浏览器标签页',shortcut:'Mod+T',scope:'content',modes:['main','detached','compact']},
  {id:'browser.reopen',menu:'file',group:0,label:'重新打开关闭的浏览器标签页',shortcut:'Mod+Shift+T',scope:'content',modes:['main','detached','compact']},
  {id:'conversation.openFile',menu:'file',group:1,label:'打开对话文件…',shortcut:'Mod+O',scope:'conversation',modes:['main','compact']},
  {id:'conversation.openFolder',menu:'file',group:1,label:'打开当前对话文件夹',scope:'conversation',modes:['main','compact']},
  {id:'conversation.export',menu:'file',group:1,label:'导出当前对话…',scope:'conversation',modes:['main','compact']},
  {id:'file.reveal',menu:'file',group:1,label:'在系统中显示文件',scope:'content',modes:['file']},
  {id:'file.openExternal',menu:'file',group:1,label:'使用默认应用打开',scope:'content',modes:['file']},
  {id:'workspace.attach',menu:'file',group:2,label:'移回工作区',scope:'workspace',modes:['detached','file']},
  {id:'content.close',menu:'file',group:2,label:'关闭当前内容标签页',shortcut:'Mod+W',scope:'content'},
  {id:'app.settings',menu:'file',group:3,label:'设置…',scope:'application',modes:['main','compact']},
  {id:'app.quit',menu:'file',group:4,label:'退出 Navora',shortcut:'Mod+Q',scope:'application',danger:true},
  {id:'edit.undo',menu:'edit',group:0,label:'撤销',shortcut:'Mod+Z',scope:'editor'},
  {id:'edit.redo',menu:'edit',group:0,label:'重做',shortcut:'Mod+Shift+Z',scope:'editor'},
  {id:'edit.cut',menu:'edit',group:1,label:'剪切',shortcut:'Mod+X',scope:'editor'},
  {id:'edit.copy',menu:'edit',group:1,label:'复制',shortcut:'Mod+C',scope:'editor'},
  {id:'edit.paste',menu:'edit',group:1,label:'粘贴',shortcut:'Mod+V',scope:'editor'},
  {id:'edit.pastePlain',menu:'edit',group:1,label:'粘贴为纯文本',shortcut:'Mod+Shift+V',scope:'editor'},
  {id:'edit.delete',menu:'edit',group:1,label:'删除',scope:'editor'},
  {id:'edit.selectAll',menu:'edit',group:1,label:'全选',shortcut:'Mod+A',scope:'editor'},
  {id:'editor.link',menu:'edit',group:2,label:'添加链接…',shortcut:'Mod+Shift+K',scope:'editor',modes:['main','compact']},
  {id:'editor.unlink',menu:'edit',group:2,label:'移除链接',scope:'editor',modes:['main','compact']},
  {id:'editor.attach',menu:'edit',group:2,label:'附加…',scope:'editor',modes:['main','compact']},
  {id:'conversation.find',menu:'edit',group:3,label:'在当前聊天中查找…',shortcut:'Mod+F',scope:'conversation',modes:['main','compact']},
  {id:'conversation.search',menu:'edit',group:3,label:'搜索对话',shortcut:'Mod+K',scope:'conversation',modes:['main','compact']},
  {id:'view.sidebar',menu:'view',group:0,label:'显示侧栏',scope:'workspace',modes:['main','compact']},
  {id:'view.sidebarPinned',menu:'view',group:0,label:'固定侧栏',scope:'workspace',modes:['main','compact']},
  {id:'view.workspace',menu:'view',group:0,label:'显示工作区',scope:'workspace',modes:['main','compact']},
  {id:'view.workspaceExpand',menu:'view',group:0,label:'展开工作区',scope:'workspace',modes:['main','compact']},
  {id:'view.summary',menu:'view',group:0,label:'显示对话摘要',scope:'conversation',modes:['main','compact']},
  {id:'editor.focus',menu:'view',group:1,label:'定位到消息编辑器',scope:'editor',modes:['main','compact']},
  {id:'browser.reload',menu:'view',group:0,label:'重新加载页面',shortcut:'Mod+R',scope:'content',modes:['detached']},
  {id:'browser.reloadIgnoringCache',menu:'view',group:0,label:'忽略缓存重新加载',shortcut:'Mod+Shift+R',scope:'content',modes:['detached']},
  {id:'browser.mute',menu:'view',group:1,label:'静音当前页面',shortcut:'Mod+M',scope:'content',modes:['detached']},
  {id:'help.docs',menu:'help',group:0,label:'使用文档',scope:'application'},
  {id:'help.shortcuts',menu:'help',group:0,label:'键盘快捷键',shortcut:'Mod+/',scope:'application'},
  {id:'help.guide',menu:'help',group:0,label:'使用引导',scope:'application'},
  {id:'help.about',menu:'help',group:1,label:'关于 Navora',scope:'application'},
]
export function commandShortcutLabel(shortcut:string|undefined,platform:string):string{
  if(!shortcut)return ''
  return platform==='darwin'?shortcut.replace(/Mod\+/g,'⌘').replace(/Shift\+/g,'⇧').replace(/Alt\+/g,'⌥'):shortcut.replace(/Mod/g,'Ctrl').replace(/\+/g,' ')
}
export function applicationShortcut(input:{key:string;control?:boolean;meta?:boolean;shift?:boolean;alt?:boolean;isComposing?:boolean;repeat?:boolean}):AppCommandId|undefined{
  if(input.isComposing||input.repeat||input.alt||!input.control&&!input.meta)return
  const key=input.key.toLowerCase()
  if(input.shift)return ({z:'edit.redo',v:'edit.pastePlain',k:'editor.link',t:'browser.reopen',r:'browser.reloadIgnoringCache'} as const)[key as 'z'|'v'|'k'|'t'|'r']
  return ({n:'conversation.new',t:'browser.new',o:'conversation.openFile',w:'content.close',q:'app.quit',z:'edit.undo',y:'edit.redo',x:'edit.cut',c:'edit.copy',v:'edit.paste',a:'edit.selectAll',k:'conversation.search',l:undefined,r:'browser.reload',m:'browser.mute'} as const)[key as 'n'|'t'|'o'|'w'|'q'|'z'|'y'|'x'|'c'|'v'|'a'|'k'|'l'|'r'|'m']
}
