export type SidebarRailGroup = {id:string;panels:string[]}
export type SidebarRailState = {version:1;groups:SidebarRailGroup[];active:string}
const valid=(id:unknown):id is string=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(id)
export function normalizeRail(raw:unknown,registered:readonly string[]):SidebarRailState {
  const saved=raw&&typeof raw==='object'?raw as Partial<SidebarRailState>:{}
  const seen=new Set<string>(),ids=new Set<string>(),groups:SidebarRailGroup[]=[]
  for(const item of Array.isArray(saved.groups)?saved.groups.slice(0,80):[]) {
    if(!item||!Array.isArray(item.panels))continue
    const panels=item.panels.filter(id=>valid(id)&&!seen.has(id)&&Boolean(seen.add(id))).slice(0,80)
    if(!panels.length)continue
    let id=valid(item.id)?item.id:`rail-${panels[0]}`
    while(ids.has(id))id+='-new'
    ids.add(id);groups.push({id,panels})
  }
  for(const panel of registered)if(valid(panel)&&!seen.has(panel)){let id=`rail-${panel}`;while(ids.has(id))id+='-new';ids.add(id);seen.add(panel);groups.push({id,panels:[panel]})}
  return {version:1,groups,active:typeof saved.active==='string'&&ids.has(saved.active)?saved.active:''}
}
export function mergeRail(state:SidebarRailState,sourceId:string,targetId:string):SidebarRailState {
  const result=normalizeRail(state,[]),source=result.groups.find(group=>group.id===sourceId),target=result.groups.find(group=>group.id===targetId)
  if(!source||!target||source===target)return result
  target.panels.push(...source.panels);result.groups=result.groups.filter(group=>group!==source);result.active=target.id
  return result
}
export function splitRail(state:SidebarRailState,panel:string):SidebarRailState {
  const result=normalizeRail(state,[]),group=result.groups.find(item=>item.panels.includes(panel))
  if(!group||group.panels.length<2)return result
  group.panels=group.panels.filter(id=>id!==panel)
  let id=`rail-${panel}`;while(result.groups.some(item=>item.id===id))id+='-new'
  result.groups.splice(result.groups.indexOf(group)+1,0,{id,panels:[panel]})
  return result
}
