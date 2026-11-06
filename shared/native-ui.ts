/** App-owned UI only. Page, plugin and remote renderers do not receive this bridge. */
export const NATIVE_UI_OPEN='navora:native-ui-open'
export type NativeAnchor={x:number;y:number;width:number;height:number}
export type NativePlacement='auto'|'top-start'|'top-end'|'bottom-start'|'bottom-end'
export type NativeScrollbarPlacement='gutter'|'overlay'
export type NativeMenuControl={id:string;type:'button'|'label';label?:string;icon?:string;accessibleName?:string;enabled?:boolean;closeOnClick?:boolean;group?:number}
export type NativeMenuItem={id:string;label:string;type?:'normal'|'checkbox'|'radio'|'separator';enabled?:boolean;checked?:boolean;icon?:string;reason?:string;shortcut?:string;children?:NativeMenuItem[];controls?:NativeMenuControl[]}
export type NativeMenuAppearance={theme?:'light'|'dark'|'system';background?:string;foreground?:string;hover?:string;border?:string;fontFamily?:string;fontSize?:number;width?:number;submenuWidth?:number;radius?:number;itemRadius?:number;padding?:number;itemPadding?:number;rowHeight?:number;separatorSpacing?:number;separatorInset?:number}
export type NativePanelStateStyle={background?:string;color?:string;borderColor?:string}
export type NativePanelVisualState='selected'|'active'|'hover'|'pressed'|'focused'|'invalid'|'busy'|'disabled'
export type NativePanelStyle={background?:string;color?:string;linkColor?:string;textDecoration?:'none'|'line-through'|'underline';borderColor?:string;borderWidth?:number;radius?:number;paddingTop?:number;paddingRight?:number;paddingBottom?:number;paddingLeft?:number;fontFamily?:string;fontSize?:number;fontWeight?:'normal'|'medium'|'bold';align?:'start'|'center'|'end'|'stretch';verticalAlign?:'top'|'middle'|'bottom';lineHeight?:number;borderless?:boolean}&Partial<Record<NativePanelVisualState,NativePanelStateStyle>>&Partial<Record<`${NativePanelVisualState}${'Background'|'Color'|'BorderColor'}`,string>>
export type NativePanelContent={
  id:string;type:'row'|'column'|'list'|'item'|'iconButton'|'text'|'icon'|'button'|'toggle'|'input'|'textarea'|'option'|'separator'|'progress'
  children?:NativePanelContent[];icon?:string;disabled?:boolean;visible?:boolean;hoverOnly?:boolean;width?:number;height?:number;maxWidth?:number;flex?:number;tooltip?:string
  gap?:number;padding?:number;text?:string;muted?:boolean;fontSize?:number;checked?:boolean;value?:string|number
  placeholder?:string;maxLength?:number;items?:Array<{id:string;label:string;value?:string;disabled?:boolean}>
  accessibleName?:string;selected?:boolean;singleLine?:boolean;highlights?:Array<{start:number;end:number}>;linkRange?:{start:number;end:number}
  variant?:'default'|'plain'|'outlined';style?:NativePanelStyle;submitOnEnter?:boolean;scrollbarPlacement?:NativeScrollbarPlacement
  styleName?:string|string[];minWidth?:number;minHeight?:number;maxHeight?:number;contextMenu?:boolean;accessibleDescription?:string;role?:'listbox'|'option'|'menu'|'menuitem'|'group'|'status';expanded?:boolean;busy?:boolean
  justify?:'start'|'center'|'end';wrap?:boolean;virtual?:{itemHeight:number;overscan?:number};selectable?:boolean;maxLines?:number;links?:Array<{id:string;start:number;end:number}>
  readOnly?:boolean;password?:boolean;invalid?:boolean;autoGrow?:boolean;navigationTarget?:string;iconSize?:number
}
export type NativePanelAction={id:string;type:'click'|'change'|'submit'|'contextMenu';value?:string|boolean;anchor?:NativeAnchor;revision?:number;sourceType?:'mouse'|'keyboard';linkId?:string}
export type NativeUiTheme={mode?:'light'|'dark'|'system';background?:string;materialTint?:string;text?:string;muted?:string;accent?:string;border?:string;fontFamily?:string;fontSize?:number;tokens?:Record<string,string>;styles?:Record<string,NativePanelStyle>}
export type NativeUiCapabilities={menus:boolean;panels:boolean;pageInfo:boolean;distributionVersion:string;menuControls?:boolean;menuAppearance?:boolean;panelItems?:boolean;panelTextarea?:boolean;panelScrollbars?:boolean;panelApiVersion?:number;panelFeatures?:string[];panelMaterial?:boolean}
export type NativeMenuResult={supported:boolean;selectedId?:string;checked?:boolean;reason?:'dismissed'|'superseded'|'closed'}
export type NativeMenuControlEvent={requestId:string;itemId:string;controlId:string;sequence:number}
export type NativePanelEvent={id:string;session:string;kind:'action'|'dismissed'|'closed'|'input-overflow';action?:NativePanelAction;reason?:string;controlId?:string;length?:number}
export type NativeUiIcons=Record<string,string|{dataUrl:string;logicalSize:16|20}>
/** Coordination roles are app state, not a native parent/child popup API. */
export type NativePanelRole='transient'|'editor'|'passive'|'search'
export type NativePanelOptions={contentInset?:number;radius?:number;scrollbarPlacement?:NativeScrollbarPlacement;shadow?:boolean}
export type NativePanelShow=NativePanelOptions&{id:string;content:NativePanelContent;anchor:NativeAnchor;placement?:NativePlacement;focusMode?:'none'|'menu'|'input';theme?:NativeUiTheme;icons?:NativeUiIcons;sourcePageId?:string;contextKey?:string;role?:NativePanelRole;dismissOnEscape?:boolean;dismissOnOutsideClick?:boolean}
export type NativePanelPatch=NativePanelOptions&{content?:NativePanelContent;anchor?:NativeAnchor;theme?:NativeUiTheme;icons?:NativeUiIcons;expectedRevision?:number;revision?:number}
export type NativePanelCommand={type:'focus'|'active'|'scroll';id:string}|{type:'scroll-list';id:string;offset:number}|{type:'bounds';id?:string}|{type:'announce';text:string;assertive?:boolean}
export type NativePanelNodePatch={op:'set';id:string;properties:Partial<Omit<NativePanelContent,'id'|'type'|'children'>>}|{op:'insert';id:string;index:number;node:NativePanelContent}|{op:'remove';id:string}|{op:'replace';id:string;node:NativePanelContent}
export type NativeMenuShow={requestId:string;items:NativeMenuItem[];anchor:NativeAnchor;placement?:NativePlacement;icons?:NativeUiIcons;contextKey?:string;sourcePageId?:string;appearance?:NativeMenuAppearance;parentPanelId?:string;parentPanelTargetId?:string;sourceType?:'mouse'|'keyboard'}
export type NativeMenuPatch={items:NativeMenuItem[];icons?:NativeUiIcons}
export type NativePanelHandle={supported:boolean;id:string;session:string;revision?:number}
export type NativeUiApi={
  capabilities:()=>Promise<NativeUiCapabilities>
  popupMenu:(input:NativeMenuShow)=>Promise<NativeMenuResult>
  updateMenu:(requestId:string,patch:NativeMenuPatch)=>Promise<boolean>
  closeMenu:(requestId:string)=>Promise<void>
  showPanel:(input:NativePanelShow)=>Promise<NativePanelHandle>
  updatePanel:(id:string,session:string,patch:NativePanelPatch)=>Promise<boolean>
  commandPanel:(id:string,session:string,command:NativePanelCommand)=>Promise<boolean|NativeAnchor|null>
  patchPanel:(id:string,session:string,operations:NativePanelNodePatch[],options?:{expectedRevision?:number;revision?:number})=>Promise<boolean>
  hidePanel:(id:string,session:string)=>Promise<void>
  destroyPanel:(id:string,session:string)=>Promise<void>
  showPageInfo:(pageId:string,anchor:NativeAnchor,siteUrl?:string)=>Promise<boolean>
  onMenuOpened:(callback:(event:{requestId:string})=>void)=>()=>void
  onMenuControl:(callback:(event:NativeMenuControlEvent)=>void)=>()=>void
  onPanelEvent:(callback:(event:NativePanelEvent)=>void)=>()=>void
}
