import type {BrowserTreeSession,ChatMessage} from './types'
import {parseSourcesFromMarkdown,type AnswerSource} from './answer-sources'
import {progressMessageIds} from './message-presentation'

export function conversationSources(messages:ChatMessage[]):AnswerSource[]{
  const sources=new Map<string,AnswerSource>()
  const progress=progressMessageIds(messages)
  for(const message of [...messages].reverse()){
    if(message.role!=='assistant'||progress.has(message.id))continue
    const items=Array.isArray(message.meta?.sources)?message.meta.sources:parseSourcesFromMarkdown(message.content)
    for(const item of items){
      if(!item||typeof item!=='object'||typeof item.url!=='string')continue
      try{
        const url=new URL(item.url)
        if(!['http:','https:'].includes(url.protocol)||url.username||url.password)continue
        url.hash=''
        if(!sources.has(url.href))sources.set(url.href,{url:url.href,title:typeof item.title==='string'?item.title:url.hostname})
      }catch{/* Ignore invalid legacy citations. */}
    }
  }
  return [...sources.values()]
}

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
