import type {BrowserPage} from './browser-host'

/** Check and commit synchronously: menu zoom never takes over or aborts submitted input. */
export function setBrowserPageZoom(page:Pick<BrowserPage,'webContents'|'automation'|'annotationSelecting'|'activeOperations'>,value:unknown,layout:()=>void):void{
  const zoom=Number(value)
  if(!Number.isFinite(zoom)||zoom<0.25||zoom>3)throw Error('invalid_zoom')
  if(page.webContents.getZoomFactor()===zoom)return
  const state=page.automation.snapshot()
  if(page.annotationSelecting||page.activeOperations||page.automation.isBusy()||state.activity==='acting'||state.activity==='handoff'||state.error)throw Error('browser_busy_wait_for_current_action')
  page.webContents.setZoomFactor(zoom)
  page.automation.geometryChanged()
  layout()
}
