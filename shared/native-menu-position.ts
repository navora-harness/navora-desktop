import type {NativeAnchor,NativeMenuAppearance,NativePlacement} from './native-ui'

type LayoutItem={label?:string;type?:string;icon?:unknown;shortcut?:string;children?:readonly LayoutItem[];controls?:readonly {type:string;label?:string;group?:number}[]}
type MenuSize={width:number;height:number}

// Menu.popup has no public preferred-size query. Use the supplied native metrics
// and a conservative text estimate; the native menu keeps its final screen fit,
// scrolling, and submenu direction. All values here are content-relative DIP.
function textWidth(text:string,fontSize:number){
  let units=0
  for(const char of text.replace(/&&/g,'\u0000').replace(/&/g,'').replace(/\u0000/g,'&')){
    if(/\p{Mark}/u.test(char))continue
    units+=char.codePointAt(0)!>=0x2e80?1:/[ilI.,'`!:;|\s]/.test(char)?.35:/[MW@#%]/.test(char)?.95:.65
  }
  return Math.ceil(units*fontSize)
}
// Accelerators are rendered as platform key labels, not their API identifiers.
// Measuring "CommandOrControl" made right-aligned menus drift far left.
function shortcutLabel(shortcut:string){
  const labels:Record<string,string>={CommandOrControl:'Ctrl',CmdOrCtrl:'Ctrl',Control:'Ctrl',Command:'Cmd',Option:'Alt',Super:'Win',Meta:'Win'}
  return shortcut.split('+').map(key=>labels[key]??key).join('+')
}
export function nativeMenuSize(items:readonly LayoutItem[],appearance:NativeMenuAppearance={},submenu=false):MenuSize{
  const font=appearance.fontSize??14,padding=appearance.padding??4,itemPadding=appearance.itemPadding??12
  const rowHeight=Math.max(appearance.rowHeight??30,Math.ceil(font*1.4)),separator=appearance.separatorSpacing??14
  // The Views native adapter applies minimum width to the content; its outer
  // rounded border then adds padding on each side.
  let width=(submenu?appearance.submenuWidth??180:appearance.width??240)+padding*2,height=padding*2
  for(const item of items){
    if(item.type==='separator'){height+=separator;continue}
    height+=rowHeight
    let rowWidth=textWidth(item.label??'',font)+itemPadding+padding*2+32
    if(item.shortcut)rowWidth+=textWidth(shortcutLabel(item.shortcut),font)+24
    if(item.children)rowWidth+=20
    if(item.controls){
      let controlsWidth=0
      for(let i=0;i<item.controls.length;i++){
        const control=item.controls[i]!
        controlsWidth+=control.type==='label'?44:24
        if(i&&!control.group&&item.controls[i-1]!.group)controlsWidth+=4
      }
      rowWidth=textWidth(item.label??'',font)+controlsWidth+itemPadding*2+padding*2+16
    }
    width=Math.max(width,rowWidth)
  }
  return {width:Math.ceil(width),height:Math.ceil(height)}
}

/** Translate the preferred anchor into the owner content area; never flip sides. */
export function nativeMenuPosition(input:{anchor:NativeAnchor;content:{width:number;height:number};items:readonly LayoutItem[];placement?:NativePlacement;appearance?:NativeMenuAppearance;gap?:number}){
  const {anchor,content,items,placement='auto',appearance}=input,size=nativeMenuSize(items,appearance)
  const margin=Math.min(8,Math.max(0,Math.min(content.width,content.height)/4)),gap=input.gap??4
  let x=placement.endsWith('end')?anchor.x+anchor.width-size.width:anchor.x
  let y=placement.startsWith('top')?anchor.y-size.height-gap:anchor.y+anchor.height+gap
  // Reserving the first submenu's natural right-hand lane avoids crossing the
  // owner window edge in ordinary menus. If both levels cannot fit, retain the
  // root menu and let the system handle native submenu flipping/scrolling.
  const children=items.filter(item=>item.children?.length).map(item=>nativeMenuSize(item.children!,appearance,true))
  const submenuWidth=Math.max(0,...children.map(child=>child.width))
  const availableWidth=content.width-margin*2
  const reserve=submenuWidth&&size.width+submenuWidth+gap<=availableWidth?submenuWidth+gap:0
  x=Math.max(margin,Math.min(x,content.width-margin-size.width-reserve))
  y=Math.max(margin,Math.min(y,content.height-margin-size.height))
  return {x:Math.round(x),y:Math.round(y)}
}
