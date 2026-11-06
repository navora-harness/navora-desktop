/** Stateful native configuration boundary for ownership and input unit tests. */
export function automationTestApi() {
  const defaults = () => ({
    isolateInput:false, blockRealPointer:false, blockRealKeyboard:false, keepRendering:false,
    virtualCursor:{enabled:false,frameRate:0,hotspot:{x:0,y:0},customImage:false},
  })
  let state = defaults()
  return {
    async setAutomationOptions(options: Electron.AutomationOptions) {
      state = {...state,...options,virtualCursor:{...state.virtualCursor,...options.virtualCursor,
        ...(options.virtualCursor?.image===undefined?{}:{customImage:options.virtualCursor.image!==null})}}
    },
    getAutomationState() {
      return {...structuredClone(state),rendering:{viewAvailable:true,keepAlive:state.keepRendering,
        requestedBackgroundThrottling:true,effectiveBackgroundThrottling:!state.keepRendering},inputActive:false}
    },
    async resetAutomationOptions() { state=defaults() },
    setVirtualCursorFrameRate(frameRate:number) { state.virtualCursor.frameRate=frameRate },
  }
}
