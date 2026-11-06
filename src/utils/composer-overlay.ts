/** Keep editor popovers within their conversation pane, away from native views. */
export function composerOverlayBoundary(editor:HTMLElement):HTMLElement {
  return editor.closest<HTMLElement>('.subchat-detail,.composer')||editor.closest<HTMLElement>('[data-composer-editor]')||editor
}

export function composerOverlayBounds(editor:HTMLElement) {
  const pane=composerOverlayBoundary(editor),rect=pane.getBoundingClientRect()
  // The main conversation wrapper uses display:contents, so measure its
  // composer column horizontally and the main workspace vertically.
  const workspace=editor.closest<HTMLElement>('.subchat-detail,.main')?.getBoundingClientRect()
  const left=Math.max(8,rect.left+8),right=Math.min(innerWidth-8,rect.right-8)
  const top=workspace?Math.max(8,workspace.top+8):8,bottom=workspace?Math.min(innerHeight-8,workspace.bottom-8):innerHeight-8
  return {left,right:Math.max(left,right),top,bottom:Math.max(top,bottom),width:Math.max(0,right-left),height:Math.max(0,bottom-top)}
}
