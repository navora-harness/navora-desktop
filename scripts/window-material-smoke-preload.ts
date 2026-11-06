import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('navora', {
  app: {
    platform: process.platform,
    windowMaterial: () => ipcRenderer.invoke('material.state'),
    onWindowMaterial: (callback: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => callback(state)
      ipcRenderer.on('navora:app.window.material.changed', listener)
      return () => ipcRenderer.removeListener('navora:app.window.material.changed', listener)
    },
  },
  config: {
    get: () => ipcRenderer.invoke('material.config'),
    onChanged: (callback: (config: unknown) => void) => {
      const listener = (_event: unknown, config: unknown) => callback(config)
      ipcRenderer.on('navora:config.changed', listener)
      return () => ipcRenderer.removeListener('navora:config.changed', listener)
    },
  },
})
