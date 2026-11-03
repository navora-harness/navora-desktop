import {screen,type BrowserWindow} from 'electron'
import {detachedWindowBounds,type WindowPoint} from '../../shared/window-layout'
export function placeDetachedWindow(win:BrowserWindow,point?:WindowPoint){
  if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return
  const cursor={x:Math.round(point.x),y:Math.round(point.y)}
  win.setBounds(detachedWindowBounds(win.getBounds(),screen.getDisplayNearestPoint(cursor).workArea,cursor))
}
