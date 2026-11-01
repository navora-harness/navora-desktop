import type {BrowserDownloadEntry,BrowserDownloadState} from './types'
export function downloadNeedsLog(previous:BrowserDownloadState|undefined,next:BrowserDownloadEntry):boolean {
  return !next.id.startsWith('ignored_')&&next.state!==previous&&['started','completed','failed','cancelled'].includes(next.state)
}
/** A file on disk can still be a partial Chromium download. Report only observed states. */
export function pendingBrowserDownloadReply(entries:readonly BrowserDownloadEntry[]):string|null {
  const pending=entries.filter(entry=>['intercepted','started','paused'].includes(entry.state))
  if(!pending.length)return null
  const lines=pending.map(entry=>{
    const name=entry.filename.replace(/[\r\n]/g,' ').replace(/[\\`*_{}\[\]()<>!#|~]/g,'\\$&'),bytes=entry.receivedBytes
    const state=entry.state==='intercepted'?'等待下载确认':entry.state==='paused'?'已暂停':'正在下载'
    const progress=typeof bytes==='number'&&bytes>0?`，已接收 ${(bytes/1048576).toFixed(1)} MB`:''
    return `- ${name}：${state}${progress}。`
  })
  return `下载尚未完成，文件仍在处理中。\n\n${lines.join('\n')}\n\n可以在下载列表查看实时进度；完成后文件会显示在此回复下方。`
}
