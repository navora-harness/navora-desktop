import { Tray, Menu, nativeImage, app, type BrowserWindow, type NativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type TrayController = {
  destroy: () => void
  showMain: () => void
  hideToTray: () => void
}

function loadTrayImage(): NativeImage {
  const candidates = [
    path.join(__dirname, 'assets', 'tray-icon.png'),
    path.join(__dirname, 'assets', 'app-icon.png'),
    path.join(__dirname, '..', 'electron', 'assets', 'tray-icon.png'),
    path.join(__dirname, '..', 'electron', 'assets', 'app-icon.png'),
    path.join(app.getAppPath(), 'electron', 'assets', 'app-icon.png'),
    path.join(app.getAppPath(), 'dist-electron', 'assets', 'app-icon.png'),
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    let img = nativeImage.createFromPath(file)
    if (img.isEmpty()) continue
    // Windows tray looks sharper at ~16–32px
    const { width } = img.getSize()
    if (width > 32) {
      img = img.resize({ width: 32, height: 32, quality: 'best' })
    }
    return img
  }
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAPElEQVRYR+3WMQ0AIAwDwQz9e0YhJgEJbNLd3Z2q/wABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgMAfYC8AAf4RAaYAAAAASUVORK5CYII=',
  )
}

export function createAppTray(opts: {
  getMainWindow: () => BrowserWindow | null
  createWindow: () => Promise<void>
  onQuit: () => void
}): TrayController {
  const tray = new Tray(loadTrayImage())
  tray.setToolTip('Navora')

  const showMain = () => {
    void (async () => {
      let win = opts.getMainWindow()
      if (!win || win.isDestroyed()) {
        await opts.createWindow()
        win = opts.getMainWindow()
      }
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })()
  }

  const hideToTray = () => {
    const win = opts.getMainWindow()
    if (win && !win.isDestroyed()) win.hide()
  }

  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMain() },
    { label: '隐藏主窗口', click: () => hideToTray() },
    { type: 'separator' },
    { label: '退出', click: () => opts.onQuit() },
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => showMain())
  tray.on('click', () => {
    if (process.platform === 'darwin') return
    const win = opts.getMainWindow()
    if (win && !win.isDestroyed() && win.isVisible()) hideToTray()
    else showMain()
  })

  return {
    destroy: () => tray.destroy(),
    showMain,
    hideToTray,
  }
}
