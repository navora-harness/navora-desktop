export type FileManagerSelection={paths:string[];current:string|null;anchor:string|null}
export type FileSelectionModifiers={toggle?:boolean;range?:boolean}
export const emptyFileManagerSelection=():FileManagerSelection=>({paths:[],current:null,anchor:null})

export function reconcileFileManagerSelection(order:string[],state:FileManagerSelection):FileManagerSelection{
  const visible=new Set(order)
  return {paths:[...new Set(state.paths)].filter(path=>visible.has(path)),current:state.current&&visible.has(state.current)?state.current:null,anchor:state.anchor&&visible.has(state.anchor)?state.anchor:null}
}
/** The visible order supplies range semantics; paths never carry across owners or folders. */
export function selectFileManagerItem(order:string[],previous:FileManagerSelection,path:string,modifiers:FileSelectionModifiers={}):FileManagerSelection{
  const state=reconcileFileManagerSelection(order,previous),index=order.indexOf(path)
  if(index<0)return state
  if(modifiers.range){
    const anchor=state.anchor||state.current||path,from=order.indexOf(anchor),range=order.slice(Math.min(from,index),Math.max(from,index)+1)
    return {paths:modifiers.toggle?[...new Set([...state.paths,...range])]:range,current:path,anchor}
  }
  if(modifiers.toggle)return {paths:state.paths.includes(path)?state.paths.filter(value=>value!==path):[...state.paths,path],current:path,anchor:path}
  return {paths:[path],current:path,anchor:path}
}
export function moveFileManagerSelection(order:string[],previous:FileManagerSelection,movement:number|'first'|'last',modifiers:FileSelectionModifiers={}):FileManagerSelection{
  const state=reconcileFileManagerSelection(order,previous)
  if(!order.length)return emptyFileManagerSelection()
  const from=state.current?order.indexOf(state.current):-1
  const index=movement==='first'?0:movement==='last'?order.length-1:from<0?(movement<0?order.length-1:0):Math.max(0,Math.min(order.length-1,from+movement))
  const path=order[index]!
  // Ctrl/⌘ navigation moves only the focus cursor; Space can toggle it explicitly.
  if(modifiers.toggle&&!modifiers.range)return {...state,current:path}
  return selectFileManagerItem(order,state,path,modifiers)
}
