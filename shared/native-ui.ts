/** App-owned UI only. Page, plugin and remote renderers do not receive this bridge. */
export const NATIVE_UI_OPEN='navora:native-ui-open'
export type NativeAnchor={x:number;y:number;width:number;height:number}
export type NativePlacement='auto'|'top-start'|'top-end'|'bottom-start'|'bottom-end'
export type NativeMenuItem={id:string;label:string;type?:'normal'|'checkbox'|'radio'|'separator';enabled?:boolean;checked?:boolean;icon?:string;reason?:string;shortcut?:string;children?:NativeMenuItem[]}
export type NativePanelContent={
  id:string;type:'row'|'column'|'list'|'text'|'icon'|'button'|'toggle'|'input'|'option'|'separator'|'progress'
  children?:NativePanelContent[];icon?:string;disabled?:boolean;visible?:boolean;width?:number;height?:number;flex?:number;tooltip?:string
  gap?:number;padding?:number;text?:string;muted?:boolean;fontSize?:number;checked?:boolean;value?:string|number
  placeholder?:string;maxLength?:number;items?:Array<{id:string;label:string;value?:string;disabled?:boolean}>
}
export type NativePanelAction={id:string;type:'click'|'change'|'submit';value?:string|boolean}
export type NativeUiTheme={mode?:'light'|'dark'|'system';background?:string;text?:string;muted?:string;accent?:string;border?:string;fontFamily?:string;fontSize?:number}
export type NativeUiCapabilities={menus:boolean;panels:boolean;pageInfo:boolean;distributionVersion:string}
export type NativeMenuResult={supported:boolean;selectedId?:string;checked?:boolean;reason?:'dismissed'|'superseded'|'closed'}
export type NativePanelEvent={id:string;session:string;kind:'action'|'dismissed'|'closed';action?:NativePanelAction;reason?:string}
export type NativeUiIcons=Record<string,string>
export type NativePanelShow={id:string;content:NativePanelContent;anchor:NativeAnchor;placement?:NativePlacement;focusMode?:'none'|'menu'|'input';theme?:NativeUiTheme;icons?:NativeUiIcons;sourcePageId?:string;contextKey?:string}
export type NativePanelHandle={supported:boolean;id:string;session:string}
export type NativeUiApi={
  capabilities:()=>Promise<NativeUiCapabilities>
  popupMenu:(input:{requestId:string;items:NativeMenuItem[];anchor:NativeAnchor;placement?:NativePlacement;icons?:NativeUiIcons;contextKey?:string})=>Promise<NativeMenuResult>
  closeMenu:(requestId:string)=>Promise<void>
  showPanel:(input:NativePanelShow)=>Promise<NativePanelHandle>
  updatePanel:(id:string,session:string,patch:{content?:NativePanelContent;anchor?:NativeAnchor;theme?:NativeUiTheme;icons?:NativeUiIcons})=>Promise<boolean>
  hidePanel:(id:string,session:string)=>Promise<void>
  destroyPanel:(id:string,session:string)=>Promise<void>
  showPageInfo:(pageId:string,anchor:NativeAnchor,siteUrl?:string)=>Promise<boolean>
  onPanelEvent:(callback:(event:NativePanelEvent)=>void)=>()=>void
}
