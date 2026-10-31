import type {BrowserTreeSession} from './types'

/** Navigation/loading changes do not count as a new resource after manual dismissal. */
export function browserResourceIds(tree:BrowserTreeSession[]):string[]{
  return tree.flatMap(session=>session.windows.map(window=>`browser:${window.windowId}`)).sort()
}

export class ResourceAutoOpen {
  private seen=new Map<string,Set<string>>()
  update(chatId:string,resources:string[]):boolean{
    const previous=this.seen.get(chatId)
    this.seen.set(chatId,new Set(resources))
    return resources.some(id=>!previous?.has(id))
  }
}
