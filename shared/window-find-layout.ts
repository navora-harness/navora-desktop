export const WINDOW_FIND_WIDTH=360
export const WINDOW_FIND_CONTROLS_GAP=25
// The shadowless local capsule extends 1 DIP beyond anchor + content width.
// Keep this separate from the global search card, which retains its own shadow.
export const WINDOW_FIND_FRAME_EXTRA=1

export function currentFindGeometry(input:{windowWidth:number;controlsLeft:number;top:number;preferredWidth?:number}){
  const windowWidth=Math.max(0,input.windowWidth),left=8
  const right=Math.max(left,Math.min(windowWidth,input.controlsLeft)-WINDOW_FIND_CONTROLS_GAP)
  const width=Math.max(1,Math.min(input.preferredWidth??WINDOW_FIND_WIDTH,right-left-WINDOW_FIND_FRAME_EXTRA))
  return {width,anchor:{x:Math.max(left,right-width-WINDOW_FIND_FRAME_EXTRA),y:input.top,width:1,height:1}}
}
