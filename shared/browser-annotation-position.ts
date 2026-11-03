export type AnnotationBox={x:number;y:number;width:number;height:number}
/** All inputs are host CSS pixels. Shadow padding does not enlarge the target. */
export function annotationEditorPlacement(anchor:AnnotationBox,bounds:AnnotationBox,size:{width:number;height:number}){
  const gap=10,pad=8,width=Math.min(size.width,Math.max(0,bounds.width-pad*2)),height=Math.min(size.height,Math.max(0,bounds.height-pad*2))
  const candidates=[{x:anchor.x+anchor.width+gap,y:anchor.y},{x:anchor.x,y:anchor.y+anchor.height+gap},{x:anchor.x-width-gap,y:anchor.y},{x:anchor.x,y:anchor.y-height-gap}]
  const fits=(p:{x:number;y:number})=>p.x>=bounds.x+pad&&p.y>=bounds.y+pad&&p.x+width<=bounds.x+bounds.width-pad&&p.y+height<=bounds.y+bounds.height-pad
  const candidate=candidates.find(fits)||candidates[0]!
  return {x:Math.max(bounds.x+pad,Math.min(bounds.x+bounds.width-pad-width,candidate.x)),y:Math.max(bounds.y+pad,Math.min(bounds.y+bounds.height-pad-height,candidate.y)),width,maxHeight:Math.max(0,bounds.height-pad*2)}
}
