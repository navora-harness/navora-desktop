/** Probe the running binary, rather than assuming a custom method from a version number. */
export function browserCapabilities(contents: object) {
  const api = contents as Record<string, unknown>
  const has = (name: string) => typeof api[name] === 'function'
  return {
    runtime: { electron: process.versions.electron || null, chromium: process.versions.chrome || null },
    queryDeep: has('querySelectorDeep'),
    queryAcrossDocuments: has('querySelectorAcrossDocuments'),
    nodeGeometry: has('getNodeBoxModel'),
    trustedClick: has('clickSelector'),
    trustedPointer: has('dispatchMouseEvent'),
    inputSequence: has('dispatchInputSequence'),
    pointerTrajectory: has('dispatchInputSequence'),
    virtualCursor: has('setVirtualCursorEnabled'),
    virtualCursorImage: has('setVirtualCursorImage'),
    virtualCursorFrameRate: has('setVirtualCursorFrameRate'),
    // API presence alone does not certify native physical-input blocking.
    physicalInputProtection: has('setVirtualCursorEnabled') ? 'available-unverified' : 'unavailable',
    agentSnapshot: has('getAgentSnapshot'),
    agentFind: has('findAgentElements'),
    targetedTrustedInput: has('dispatchKeyEvent') && has('dispatchMouseEvent') && has('clickSelector'),
    targetedTouchInput: has('dispatchTouchEvent'),
    fileInput: has('setFileInputFiles'),
    fileInputMethod: 'setFileInputFiles',
    documentResponse: has('loadURLWithResponse'),
    jsDialogHandler: has('setJsDialogHandler'),
    pageIndex: { source: 'isolated-world', openShadow: true, closedShadow: false, frameContents: false },
    agentDom: { source: 'native-blink', frames: has('getAgentSnapshot'), closedShadow: has('getAgentSnapshot'), coverageAndTruncation: has('getAgentSnapshot') },
    debuggerRequired: false,
  }
}
