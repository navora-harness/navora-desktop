import {app} from 'electron'
import path from 'node:path'
import type {BrowserDownloadEntry} from '../../shared/types'
import {downloadFileExtension} from '../../shared/download-file-icons'

const cache=new Map<string,Promise<string|undefined>>()
/** Only main-process download records supply paths; the renderer sends an entry ID. */
export function systemDownloadIcon(entry:BrowserDownloadEntry,workspacePath?:string):Promise<string|undefined> {
  const extension=downloadFileExtension(entry.filename)
  const completed=entry.state==='completed',saved=entry.savePath||workspacePath
  const embedded=completed&&saved&&['exe','dll','ico'].includes(extension)
  const target=completed&&saved?saved:path.join(app.getPath('temp'),`navora-file-type.${extension||'unknown'}`)
  const key=embedded?`${target}:${entry.updatedAt}`:`${completed&&saved?'saved':'type'}:${extension}`
  if(!cache.has(key)){
    if(cache.size>=128)cache.delete(cache.keys().next().value!)
    const pending=app.getFileIcon(target,{size:'normal'}).then(icon=>icon.isEmpty()?undefined:icon.resize({width:32,height:32}).toDataURL()).catch(()=>undefined)
    cache.set(key,pending)
  }
  return cache.get(key)!
}
