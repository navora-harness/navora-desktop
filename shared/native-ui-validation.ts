import type {NativeAnchor,NativeMenuItem,NativePanelAction,NativePanelContent} from './native-ui'
export function nativeAnchor(anchor:NativeAnchor,zoom:number,origin:{x:number;y:number}={x:0,y:0}){
  if(!anchor||![anchor.x,anchor.y,anchor.width,anchor.height,zoom,origin.x,origin.y].every(Number.isFinite)||anchor.width<0||anchor.height<0||zoom<=0||zoom>8)throw Error('invalid_native_anchor')
  return {x:Math.round(origin.x+anchor.x*zoom),y:Math.round(origin.y+anchor.y*zoom),width:Math.max(1,Math.round(anchor.width*zoom)),height:Math.max(1,Math.round(anchor.height*zoom))}
}
export function nativeMenuItems(items:NativeMenuItem[]){
  const ids=new Set<string>();let count=0
  function walk(rows:NativeMenuItem[],depth=0):NativeMenuItem[]{if(!Array.isArray(rows)||depth>12)throw Error('invalid_native_menu');return rows.map(item=>{
    if(++count>500||!item||typeof item.id!=='string'||!item.id||item.id.length>256||ids.has(item.id)||typeof item.label!=='string'||item.label.length>4096||!['normal','checkbox','radio','separator'].includes(item.type||'normal'))throw Error('invalid_native_menu')
    ids.add(item.id)
    for(const key of ['enabled','checked'] as const)if(item[key]!==undefined&&typeof item[key]!=='boolean')throw Error('invalid_native_menu')
    for(const key of ['icon','reason','shortcut'] as const)if(item[key]!==undefined&&(typeof item[key]!=='string'||item[key]!.length>4096))throw Error('invalid_native_menu')
    return {...item,...(item.children?{children:walk(item.children,depth+1)}:{})}
  })}
  return walk(items)
}
export function nativePanelNodes(content:NativePanelContent){
  const nodes=new Map<string,NativePanelContent>();let count=0
  function walk(node:NativePanelContent,depth=0,disabled=false,visible=true){
    if(!node||++count>2000||depth>32||typeof node.id!=='string'||!node.id||node.id.length>256||nodes.has(node.id)||!['row','column','list','text','icon','button','toggle','input','option','separator','progress'].includes(node.type))throw Error('invalid_native_panel')
    const effective={...node,disabled:disabled||!!node.disabled,visible:visible&&node.visible!==false};nodes.set(node.id,effective)
    if(node.children){if(!['row','column','list'].includes(node.type)||!Array.isArray(node.children))throw Error('invalid_native_panel');for(const child of node.children)walk(child,depth+1,effective.disabled,effective.visible)}
  }
  walk(content);return nodes
}
export function nativePanelActionAllowed(nodes:ReadonlyMap<string,NativePanelContent>,action:NativePanelAction){
  const node=nodes.get(action.id);if(!node||node.disabled||node.visible===false)return false
  if(action.type==='click')return node.type==='button'
  if(action.type==='submit')return node.type==='input'&&typeof action.value==='string'
  if(action.type!=='change')return false
  if(node.type==='toggle')return typeof action.value==='boolean'
  if(node.type==='input')return typeof action.value==='string'
  return node.type==='option'&&typeof action.value==='string'&&!!node.items?.some(item=>!item.disabled&&(item.value??item.id)===action.value)
}
