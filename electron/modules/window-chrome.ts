/** OS controls: Windows overlay, macOS traffic lights, Linux window-manager frame. */
export function mainWindowChrome(platform: string) {
  if (platform === 'darwin') return {
    frame: true, titleBarStyle: 'hiddenInset' as const,
    trafficLightPosition: { x: 16, y: 18 },
  }
  if (platform === 'win32') return {
    frame: true, titleBarStyle: 'hidden' as const,
    titleBarOverlay: { color: '#ffffff', symbolColor: '#30343b', height: 40 },
  }
  return { frame: true }
}
