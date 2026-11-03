import {app,type BrowserWindow} from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export function resolveWindowIcon(platform:string):string|undefined{
  const filename=platform==='win32'?'app-icon.ico':'app-icon.png'
  const root=app.getAppPath()
  const candidates=[
    path.join(root,'dist-electron','assets',filename),
    path.join(root,'electron','assets',filename),
    path.join(root,'assets',filename),
  ]
  return candidates.find(candidate=>fs.existsSync(candidate))
}

/** OS controls: Windows overlay, macOS traffic lights, Linux window-manager frame. */
export function mainWindowChrome(platform: string) {
  if (platform === 'darwin') return {
    frame: true, titleBarStyle: 'hiddenInset' as const,
    trafficLightPosition: { x: 16, y: 18 },
  }
  if (platform === 'win32') return {
    frame: true, titleBarStyle: 'hidden' as const,
    titleBarOverlay: { color: '#00000000', symbolColor: '#52677e', height: 40 },
  }
  return { frame: true }
}

/** Tabs share the title row with the same native controls as the main window. */
export function detachedWindowChrome(platform:string){
  return mainWindowChrome(platform)
}
export function wireDetachedWindowChrome(win:BrowserWindow){
  const update=()=>{if(!win.isDestroyed())win.webContents.send('navora:app.window.maximized',win.isMaximized())}
  win.on('maximize',update);win.on('unmaximize',update)
}
