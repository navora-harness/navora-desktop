export type ComposerShortcut = {id:string;label:string;shortcut:string}

/** Documentation for the editor's existing Tiptap bindings, not global commands. */
export const composerFormattingShortcuts:readonly ComposerShortcut[]=[
  {id:'bold',label:'加粗',shortcut:'Mod+B'},
  {id:'italic',label:'斜体',shortcut:'Mod+I'},
  {id:'strike',label:'删除线',shortcut:'Mod+Shift+S'},
  {id:'code',label:'行内代码',shortcut:'Mod+E'},
  {id:'bulletList',label:'无序列表',shortcut:'Mod+Shift+8'},
  {id:'orderedList',label:'有序列表',shortcut:'Mod+Shift+7'},
]

export const composerEditingShortcuts:readonly ComposerShortcut[]=[
  {id:'selectionFormat',label:'进入选区格式面板',shortcut:'Alt+F10'},
  {id:'undo',label:'撤销',shortcut:'Mod+Z'},
  {id:'redo',label:'重做',shortcut:'Mod+Shift+Z'},
  {id:'link',label:'添加或编辑链接',shortcut:'Mod+Shift+K'},
  {id:'lineBreak',label:'普通文字中换行',shortcut:'Shift+Enter'},
]
