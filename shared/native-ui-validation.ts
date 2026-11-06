import type {NativeAnchor,NativeMenuItem,NativeMenuControl,NativePanelAction,NativePanelContent,NativePanelOptions,NativePanelStyle,NativePanelRole,NativeUiTheme,NativeMenuAppearance,NativePanelNodePatch} from './native-ui'
function object(value:unknown):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_native_ui_object')}
export function nativeUiKeys(value:unknown,allowed:readonly string[]){object(value);if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error('invalid_native_ui_field')}
export function nativeUiDefined<T>(value:T):T{
  if(Array.isArray(value))return value.map(nativeUiDefined) as T
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,child])=>child!==undefined).map(([key,child])=>[key,nativeUiDefined(child)])) as T
  return value
}
function number(value:unknown,min=0,max=100000){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error('invalid_native_ui_number')}
function string(value:unknown,max=65536,nonempty=false):asserts value is string{if(typeof value!=='string'||value.length>max||nonempty&&!value)throw Error('invalid_native_ui_string')}
function bool(value:unknown){if(typeof value!=='boolean')throw Error('invalid_native_ui_boolean')}
function color(value:unknown){if(typeof value!=='string'||!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value))throw Error('invalid_native_ui_color')}
function member(value:unknown,allowed:readonly unknown[]){if(!allowed.includes(value))throw Error('invalid_native_ui_enum')}
const scrollbar=(value:unknown)=>member(value,['gutter','overlay'])
const styleDimensions=['radius','borderWidth','paddingTop','paddingRight','paddingBottom','paddingLeft'] as const
const nodeDimensions=['width','height','maxWidth','gap','padding','fontSize'] as const
const panelNodeDimensions=[...nodeDimensions,'minWidth','minHeight','maxHeight','iconSize'] as const
const panelStyleDimensions=[...styleDimensions,'fontSize','lineHeight'] as const
const states=['selected','active','hover','pressed','focused','invalid','busy','disabled'] as const
function panelColor(value:unknown){if(typeof value==='string'&&/^\$[a-zA-Z0-9_.-]+$/.test(value))return;color(value)}
const menuFields=['id','label','type','enabled','checked','icon','reason','shortcut','children','controls']
export function nativeAnchor(anchor:NativeAnchor,zoom:number,origin:{x:number;y:number}={x:0,y:0}){
  if(!anchor||![anchor.x,anchor.y,anchor.width,anchor.height,zoom,origin.x,origin.y].every(Number.isFinite)||anchor.width<0||anchor.height<0||zoom<=0||zoom>8)throw Error('invalid_native_anchor')
  return {x:Math.round(origin.x+anchor.x*zoom),y:Math.round(origin.y+anchor.y*zoom),width:Math.max(1,Math.round(anchor.width*zoom)),height:Math.max(1,Math.round(anchor.height*zoom))}
}
export function nativeMenuItems(items:NativeMenuItem[]){
  const ids=new Set<string>();let count=0
  function walk(rows:NativeMenuItem[],depth=0):NativeMenuItem[]{if(!Array.isArray(rows)||depth>12)throw Error('invalid_native_menu');return rows.map(item=>{
    nativeUiKeys(item,menuFields)
    if(++count>500||typeof item.id!=='string'||!item.id||item.id.length>256||ids.has(item.id)||typeof item.label!=='string'||item.label.length>4096||!['normal','checkbox','radio','separator'].includes(item.type||'normal'))throw Error('invalid_native_menu')
    ids.add(item.id)
    for(const key of ['enabled','checked'] as const)if(item[key]!==undefined&&typeof item[key]!=='boolean')throw Error('invalid_native_menu')
    for(const key of ['icon','reason','shortcut'] as const)if(item[key]!==undefined&&(typeof item[key]!=='string'||item[key]!.length>4096))throw Error('invalid_native_menu')
    if(item.controls!==undefined){
      if(item.type&&item.type!=='normal'||item.children!==undefined||!Array.isArray(item.controls)||item.controls.length<1||item.controls.length>8)throw Error('invalid_native_menu_controls')
      const controlIds=new Set<string>()
      for(const control of item.controls){
        nativeUiKeys(control,['id','type','label','icon','accessibleName','enabled','closeOnClick','group']);string(control.id,256,true)
        if(controlIds.has(control.id))throw Error('invalid_native_menu_controls');controlIds.add(control.id);member(control.type,['button','label'])
        for(const key of ['label','icon','accessibleName'] as const)if(control[key]!==undefined)string(control[key],key==='label'?1024:4096)
        for(const key of ['enabled','closeOnClick'] as const)if(control[key]!==undefined)bool(control[key])
        if(control.group!==undefined){number(control.group,0,8);if(!Number.isInteger(control.group))throw Error('invalid_native_menu_controls')}
        if(control.type==='button'&&!control.label&&!control.icon||control.type==='button'&&control.icon&&!control.label&&!control.accessibleName||control.type==='label'&&control.icon!==undefined)throw Error('invalid_native_menu_controls')
      }
    }
    return {...item,...(item.children?{children:walk(item.children,depth+1)}:{}),...(item.controls?{controls:item.controls.map(control=>({...control}))}:{})}
  })}
  return walk(items)
}
/** Native refresh only permits changes to presentation/state, not command membership. */
export function nativeMenuRefreshCompatible(previous:NativeMenuItem[],next:NativeMenuItem[]):boolean{
  return previous.length===next.length&&previous.every((item,index)=>{
    const row=next[index]!
    return item.id===row.id&&(item.type||'normal')===(row.type||'normal')&&!!item.children===!!row.children&&
      (!item.children||nativeMenuRefreshCompatible(item.children,row.children!))&&!!item.controls===!!row.controls&&
      (!item.controls||item.controls.length===row.controls!.length&&item.controls.every((control,i)=>control.id===row.controls![i]!.id&&control.type===row.controls![i]!.type&&(control.group||0)===(row.controls![i]!.group||0)))
  })
}
export function nativeMenuControlAllowed(items:NativeMenuItem[],detail:{itemId:string;controlId:string}):NativeMenuControl|undefined{
  for(const item of items){if(item.enabled===false)continue;if(item.id===detail.itemId){const control=item.controls?.find(c=>c.id===detail.controlId&&c.type==='button'&&c.enabled!==false);return control}if(item.children){const control=nativeMenuControlAllowed(item.children,detail);if(control)return control}}
}
function panelStyle(style:NativePanelStyle){
  const stateColors=states.flatMap(state=>[`${state}Background`,`${state}Color`,`${state}BorderColor`] as const)
  nativeUiKeys(style,['background','color','linkColor','borderColor',...stateColors,...states,...panelStyleDimensions,'fontFamily','fontWeight','align','verticalAlign','textDecoration','borderless'])
  for(const field of ['background','color','linkColor','borderColor',...stateColors] as const)if(style[field]!==undefined)panelColor(style[field])
  for(const state of states)if(style[state]!==undefined){const value=style[state]!;nativeUiKeys(value,['background','color','borderColor']);for(const color of Object.values(value))panelColor(color)}
  for(const field of styleDimensions)if(style[field]!==undefined)number(style[field],0,1000)
  if(style.fontFamily!==undefined)string(style.fontFamily,256)
  if(style.fontSize!==undefined)number(style.fontSize,6,96)
  if(style.lineHeight!==undefined)number(style.lineHeight,0,256)
  if(style.fontWeight!==undefined)member(style.fontWeight,['normal','medium','bold'])
  if(style.align!==undefined)member(style.align,['start','center','end','stretch'])
  if(style.verticalAlign!==undefined)member(style.verticalAlign,['top','middle','bottom'])
  if(style.textDecoration!==undefined)member(style.textDecoration,['none','line-through','underline'])
  if(style.borderless!==undefined)bool(style.borderless)
}
const common=['id','type','disabled','visible','width','height','minWidth','minHeight','maxWidth','maxHeight','flex','tooltip','style','styleName','contextMenu','accessibleName','accessibleDescription','role','expanded','busy']
const fields:Record<NativePanelContent['type'],readonly string[]>={row:['children','gap','padding','wrap','justify'],column:['children','gap','padding','justify'],list:['children','gap','padding','scrollbarPlacement','virtual'],item:['children','gap','padding','selected','justify'],iconButton:['icon','hoverOnly','iconSize'],text:['text','muted','fontSize','singleLine','highlights','linkRange','links','selectable','maxLines'],icon:['icon'],button:['text','variant','icon'],toggle:['text','checked'],input:['value','placeholder','maxLength','readOnly','password','invalid','navigationTarget'],textarea:['value','placeholder','maxLength','submitOnEnter','scrollbarPlacement','readOnly','invalid','autoGrow'],option:['items','value'],separator:[],progress:['value']}
export function nativePanelNodes(content:NativePanelContent){
  const nodes=new Map<string,NativePanelContent>();let count=0,mounted=0
  function walk(node:NativePanelContent,depth=0,disabled=false,visible=true,virtualRow=false){
    if(!node||++count>100000||!virtualRow&&++mounted>2000||depth>32||!Object.hasOwn(fields,node.type))throw Error('invalid_native_panel')
    nativeUiKeys(node,[...common,...fields[node.type]]);string(node.id,256,true);if(nodes.has(node.id)||node.id.startsWith('__native_panel_virtual__:'))throw Error('invalid_native_panel')
    if(virtualRow&&!['item','row','column','text','icon','button','iconButton','separator'].includes(node.type))throw Error('invalid_native_panel_virtual')
    for(const key of ['disabled','visible','muted','selected','singleLine','submitOnEnter','checked','hoverOnly','contextMenu','expanded','busy','wrap','selectable','readOnly','password','invalid','autoGrow'] as const)if(node[key]!==undefined)bool(node[key])
    for(const key of ['width','height','minWidth','minHeight','maxWidth','maxHeight','gap','padding'] as const)if(node[key]!==undefined)number(node[key])
    if(node.iconSize!==undefined)number(node.iconSize,1,256)
    if(node.maxLines!==undefined){number(node.maxLines,0,1000);if(!Number.isInteger(node.maxLines))throw Error('invalid_native_panel')}
    if(node.role!==undefined)member(node.role,['listbox','option','menu','menuitem','group','status'])
    if(node.justify!==undefined)member(node.justify,['start','center','end'])
    if(node.styleName!==undefined){const names=typeof node.styleName==='string'?[node.styleName]:node.styleName;if(!Array.isArray(names)||names.length>256)throw Error('invalid_native_panel_style');for(const name of names)string(name,256,true)}
    if(node.flex!==undefined)number(node.flex,0,1000)
    if(node.fontSize!==undefined)number(node.fontSize,6,96)
    if(node.style!==undefined)panelStyle(node.style)
    if(node.scrollbarPlacement!==undefined)scrollbar(node.scrollbarPlacement)
    for(const key of ['tooltip','accessibleName','accessibleDescription','icon','placeholder','navigationTarget'] as const)if(node[key]!==undefined)string(node[key],key==='navigationTarget'?256:65536)
    if(node.type==='icon'||node.type==='iconButton')string(node.icon,4096,true)
    if(node.type==='iconButton')string(node.accessibleName,65536,true)
    if(['text','button','toggle'].includes(node.type))string(node.text)
    if(node.type==='toggle')bool(node.checked)
    if(node.variant!==undefined)member(node.variant,['default','plain','outlined'])
    if(node.type==='input'||node.type==='textarea'){
      if(node.value!==undefined)string(node.value)
      if(node.maxLength!==undefined){number(node.maxLength,0,65536);if(!Number.isInteger(node.maxLength))throw Error('invalid_native_panel')}
    }
    if(node.type==='progress'&&node.value!==-1)number(node.value,0,1)
    if(node.type==='option'){
      if(!Array.isArray(node.items)||node.items.length>2000)throw Error('invalid_native_panel')
      const ids=new Set<string>(),values=new Set<string>()
      for(const item of node.items){nativeUiKeys(item,['id','label','value','disabled']);string(item.id,256,true);string(item.label);if(item.value!==undefined)string(item.value);if(item.disabled!==undefined)bool(item.disabled);const value=item.value??item.id;if(ids.has(item.id)||values.has(value))throw Error('invalid_native_panel');ids.add(item.id);values.add(value)}
      if(node.value!==undefined){string(node.value);if(!values.has(node.value))throw Error('invalid_native_panel')}
    }
    const range=(value:{start:number;end:number},link=false)=>{nativeUiKeys(value,['start','end']);number(value.start,0,node.text!.length);number(value.end,value.start+(link?1:0),node.text!.length);if(!Number.isInteger(value.start)||!Number.isInteger(value.end))throw Error('invalid_native_panel_range')}
    if(node.highlights!==undefined){if(!Array.isArray(node.highlights)||node.highlights.length>256)throw Error('invalid_native_panel_range');for(const value of node.highlights)range(value)}
    if(node.linkRange!==undefined){if(node.singleLine||node.highlights!==undefined)throw Error('invalid_native_panel_range');range(node.linkRange,true)}
    if(node.links!==undefined){if(node.linkRange||node.singleLine||node.highlights||node.selectable||!Array.isArray(node.links)||node.links.length>256)throw Error('invalid_native_panel_range');let end=0;const ids=new Set<string>();for(const link of node.links){nativeUiKeys(link,['id','start','end']);string(link.id,256,true);if(ids.has(link.id)||link.start<end)throw Error('invalid_native_panel_range');ids.add(link.id);range({start:link.start,end:link.end},true);end=link.end}}
    if(node.selectable&&node.linkRange)throw Error('invalid_native_panel_range')
    if(node.virtual!==undefined){nativeUiKeys(node.virtual,['itemHeight','overscan']);number(node.virtual.itemHeight,1,1000);number(node.virtual.overscan??3,0,32);if(!Number.isInteger(node.virtual.itemHeight)||!Number.isInteger(node.virtual.overscan??3)||node.padding||node.gap||!Array.isArray(node.children)||node.children.length>50000||node.children.some(child=>child.type!=='item'))throw Error('invalid_native_panel_virtual')}
    const effective={...node,disabled:disabled||!!node.disabled||!!node.busy,visible:visible&&node.visible!==false};nodes.set(node.id,effective)
    if(['row','column','list','item'].includes(node.type)){if(!Array.isArray(node.children))throw Error('invalid_native_panel');for(const child of node.children)walk(child,depth+1,effective.disabled,effective.visible,virtualRow||!!node.virtual)}
  }
  walk(content);return nodes
}
export function nativePanelActionAllowed(nodes:ReadonlyMap<string,NativePanelContent>,action:NativePanelAction){
  const node=nodes.get(action.id);if(!node||node.disabled||node.visible===false)return false
  if(action.type==='contextMenu')return (node.contextMenu===true||node.type==='item'&&node.contextMenu!==false)&&action.value===undefined
  if(action.type==='click')return action.value===undefined&&(node.type==='button'||node.type==='iconButton'||node.type==='item'||node.type==='text'&&(!!node.linkRange&&!action.linkId||!!node.links?.some(link=>link.id===action.linkId)))
  if(action.type==='submit')return (node.type==='input'||node.type==='textarea'&&node.submitOnEnter!==false)&&typeof action.value==='string'&&action.value.length<=65536
  if(action.type!=='change')return false
  if(node.type==='toggle')return typeof action.value==='boolean'
  if(node.type==='input'||node.type==='textarea')return !node.readOnly&&typeof action.value==='string'&&action.value.length<=65536
  return node.type==='option'&&typeof action.value==='string'&&!!node.items?.some(item=>!item.disabled&&(item.value??item.id)===action.value)
}
/** Application coordination only; none of these roles is an Electron option. */
export function nativePanelInteraction(input:{role?:NativePanelRole;focusMode?:'none'|'menu'|'input';dismissOnEscape?:boolean;dismissOnOutsideClick?:boolean}){
  const role=input.role??'transient',focusMode=input.focusMode??(role==='search'?'input':'menu')
  if(!['transient','editor','passive','search'].includes(role)||!['none','menu','input'].includes(focusMode))throw Error('invalid_native_panel_focus')
  for(const value of [input.dismissOnEscape,input.dismissOnOutsideClick])if(value!==undefined&&typeof value!=='boolean')throw Error('invalid_native_panel_dismiss')
  if(role==='passive'&&focusMode!=='none')throw Error('invalid_native_panel_focus')
  if(role==='search'&&(focusMode!=='input'||input.dismissOnEscape===false||input.dismissOnOutsideClick===true))throw Error('invalid_native_panel_search')
  return {role,focusMode,dismissOnEscape:input.dismissOnEscape??true,dismissOnOutsideClick:input.dismissOnOutsideClick??(role!=='search')}
}
export function nativePanelShouldDismiss(current:NativePanelRole,incoming?:NativePanelRole){
  if(current==='search')return incoming==='search'
  return incoming!=='passive'||current==='passive'
}
/** Fresh input sessions must put their editor before close/refresh actions. */
export function nativePanelFirstFocusable(content:NativePanelContent){
  return [...nativePanelNodes(content).values()].find(node=>!node.disabled&&node.visible!==false&&(['input','textarea','button','iconButton','item','toggle','option'].includes(node.type)||node.type==='text'&&!!node.linkRange))
}
/** Only measurements scale. UTF-16 ranges, IDs, flex weights, enums and values do not. */
export function nativePanelScale(tree:NativePanelContent,zoom:number):NativePanelContent{
  number(zoom,0.01,8)
  const result={...tree,...(tree.style?{style:{...tree.style}}:{})}
  for(const field of panelNodeDimensions)if(typeof result[field]==='number')result[field]=result[field]!*zoom
  for(const field of panelStyleDimensions)if(typeof result.style?.[field]==='number')result.style[field]=result.style[field]!*zoom
  if(tree.virtual)result.virtual={...tree.virtual,itemHeight:Math.max(1,Math.round(tree.virtual.itemHeight*zoom))}
  if(tree.children)result.children=tree.children.map(child=>nativePanelScale(child,zoom))
  return result
}
/** Cosmetic refreshes must not replay a stale value over native IME state. */
export function nativePanelPresentationTree(tree:NativePanelContent):NativePanelContent{
  const result={...tree}
  if(tree.type==='input'||tree.type==='textarea')delete result.value
  if(tree.children)result.children=tree.children.map(nativePanelPresentationTree)
  return result
}
export function nativePanelOptions(input:NativePanelOptions,zoom=1):NativePanelOptions{
  const result:NativePanelOptions={}
  if(input.contentInset!==undefined){number(input.contentInset,0,64);result.contentInset=Math.round(input.contentInset*zoom);number(result.contentInset,0,64)}
  if(input.radius!==undefined){number(input.radius,0,1000);result.radius=input.radius*zoom;number(result.radius,0,1000)}
  if(input.scrollbarPlacement!==undefined){scrollbar(input.scrollbarPlacement);result.scrollbarPlacement=input.scrollbarPlacement}
  if(input.shadow!==undefined){bool(input.shadow);result.shadow=input.shadow}
  return result
}
export function nativeUiTheme(theme:NativeUiTheme,zoom=1):NativeUiTheme{
  nativeUiKeys(theme,['mode','background','materialTint','text','muted','accent','border','fontFamily','fontSize','tokens','styles'])
  if(theme.mode!==undefined)member(theme.mode,['light','dark','system'])
  for(const field of ['background','materialTint','text','muted','accent','border'] as const)if(theme[field]!==undefined)color(theme[field])
  if(theme.fontFamily!==undefined)string(theme.fontFamily,256)
  if(theme.fontSize!==undefined){number(theme.fontSize,6,96);number(theme.fontSize*zoom,6,96)}
  if(theme.tokens!==undefined){object(theme.tokens);if(Object.keys(theme.tokens).length>256)throw Error('invalid_native_panel_tokens');for(const [name,value] of Object.entries(theme.tokens)){string(name,256,true);panelColor(value)}
    for(const name of Object.keys(theme.tokens)){const seen=new Set<string>();let current:string|undefined=name;while(current&&Object.hasOwn(theme.tokens,current)){if(seen.has(current))throw Error('invalid_native_panel_tokens');seen.add(current);const value:string=theme.tokens[current]!;current=value.startsWith('$')?value.slice(1):undefined}}
  }
  if(theme.styles!==undefined){object(theme.styles);if(Object.keys(theme.styles).length>256)throw Error('invalid_native_panel_styles');for(const [name,value] of Object.entries(theme.styles)){string(name,256,true);panelStyle(value)}}
  return nativeUiDefined({...theme,...(theme.fontSize!==undefined?{fontSize:theme.fontSize*zoom}:{}),...(theme.styles?{styles:Object.fromEntries(Object.entries(theme.styles).map(([name,style])=>[name,nativePanelScale({id:'style',type:'text',text:'',style},zoom).style!]))}:{})})
}

/** Validate a complete candidate before replacing any native controls. */
export function nativePanelTreePatch(tree:NativePanelContent,operations:NativePanelNodePatch[]):NativePanelContent{
  if(!Array.isArray(operations)||operations.length>2000)throw Error('invalid_native_panel_patch')
  let root=structuredClone(tree)
  const locate=(id:string,node=root,parent?:NativePanelContent):{node:NativePanelContent;parent?:NativePanelContent}|undefined=>node.id===id?{node,parent}:node.children?.map(child=>locate(id,child,node)).find(Boolean)
  for(const operation of operations){
    nativeUiKeys(operation,['op','id',...(operation.op==='set'?['properties']:operation.op==='insert'?['index','node']:operation.op==='replace'?['node']:[])])
    string(operation.id,256,true);member(operation.op,['set','insert','remove','replace'])
    const found=locate(operation.id);if(!found)throw Error('invalid_native_panel_patch_target')
    if(operation.op==='set'){nativeUiKeys(operation.properties,[...common,...fields[found.node.type]].filter(key=>!['id','type','children'].includes(key)));Object.assign(found.node,structuredClone(operation.properties))}
    else if(operation.op==='insert'){if(!found.node.children)throw Error('invalid_native_panel_patch_target');number(operation.index,0,found.node.children.length);if(!Number.isInteger(operation.index))throw Error('invalid_native_panel_patch');found.node.children.splice(operation.index,0,structuredClone(operation.node))}
    else if(operation.op==='remove'){if(!found.parent)throw Error('invalid_native_panel_patch_root');found.parent.children!.splice(found.parent.children!.indexOf(found.node),1)}
    else if(found.parent)found.parent.children![found.parent.children!.indexOf(found.node)]=structuredClone(operation.node)
    else root=structuredClone(operation.node)
  }
  nativePanelNodes(root);return root
}
export function nativeMenuAppearance(input:NativeMenuAppearance,zoom=1):NativeMenuAppearance{
  const limits:Record<string,[number,number]>={fontSize:[6,48],width:[120,1600],submenuWidth:[80,1600],radius:[0,64],itemRadius:[0,50],padding:[1,32],itemPadding:[0,64],rowHeight:[20,100],separatorSpacing:[1,64],separatorInset:[0,100]}
  nativeUiKeys(input,['theme','background','foreground','hover','border','fontFamily',...Object.keys(limits)])
  if(input.theme!==undefined)member(input.theme,['light','dark','system'])
  for(const field of ['background','foreground','hover','border'] as const)if(input[field]!==undefined)color(input[field])
  if(input.fontFamily!==undefined)string(input.fontFamily,256)
  const result={...input}
  for(const [field,[min,max]] of Object.entries(limits)){const value=input[field as keyof NativeMenuAppearance];if(value!==undefined){number(value,min,max);(result as Record<string,unknown>)[field]=Math.max(min,Math.min(max,Math.round((value as number)*zoom)))}}
  return result
}
