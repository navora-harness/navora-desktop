export type PopupRect={left:number;top:number;right:number;bottom:number}
export type PopupPoint={x:number;y:number}

/** Keep a DOM popup in renderer-owned space; a native View always paints above it. */
export function browserPopupPosition(size:{width:number;height:number},preferred:PopupPoint,viewport:{width:number;height:number},views:PopupRect[],pad=8):PopupPoint|null{
  const width=Math.ceil(size.width),height=Math.ceil(size.height),maxX=viewport.width-pad-width,maxY=viewport.height-pad-height
  if(width<=0||height<=0||maxX<pad||maxY<pad)return null
  const boundX=(x:number)=>Math.max(pad,Math.min(x,maxX)),boundY=(y:number)=>Math.max(pad,Math.min(y,maxY))
  const blocks=views.filter(view=>view.right>view.left&&view.bottom>view.top&&view.right>0&&view.bottom>0&&view.left<viewport.width&&view.top<viewport.height)
  const xs=[boundX(preferred.x),pad,maxX,...blocks.flatMap(view=>[boundX(view.left-width-pad),boundX(view.right+pad)])]
  const ys=[boundY(preferred.y),pad,maxY,...blocks.flatMap(view=>[boundY(view.top-height-pad),boundY(view.bottom+pad)])]
  let best:PopupPoint|null=null,distance=Infinity
  for(const x of new Set(xs))for(const y of new Set(ys)){
    if(blocks.some(view=>x<view.right&&x+width>view.left&&y<view.bottom&&y+height>view.top))continue
    const next=(x-preferred.x)**2+(y-preferred.y)**2
    if(next<distance){distance=next;best={x,y}}
  }
  return best
}
