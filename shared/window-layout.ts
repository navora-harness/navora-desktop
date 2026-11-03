export type WindowPoint={x:number;y:number}
type Rect=WindowPoint&{width:number;height:number}
/** Keep a torn-out window, including its controls, inside the chosen display. */
export function detachedWindowBounds(size:{width:number;height:number},work:Rect,point:WindowPoint):Rect{
  // Windows converts DIP bounds to physical pixels; leave room for rounding.
  work={x:work.x+2,y:work.y+2,width:Math.max(1,work.width-4),height:Math.max(1,work.height-4)}
  const width=Math.min(size.width,work.width),height=Math.min(size.height,work.height)
  return {width,height,x:Math.round(Math.max(work.x,Math.min(point.x-100,work.x+work.width-width))),y:Math.round(Math.max(work.y,Math.min(point.y-20,work.y+work.height-height)))}
}
