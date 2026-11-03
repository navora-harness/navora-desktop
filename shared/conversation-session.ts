import type {AgentEvent,ChatMessage,ChatSession} from './types'

/** Replay only events received after a snapshot request began, never merge an old whole transcript. */
export function replayConversationEvents(snapshot:ChatSession,events:readonly AgentEvent[]):ChatSession{
  const chat={...snapshot,messages:snapshot.messages.map(message=>({...message}))}
  for(const event of events){
    if(event.chatId!==chat.id)continue
    if(event.type==='title')chat.title=event.title
    if(event.type==='message'||event.type==='message_update'){
      const index=chat.messages.findIndex(message=>message.id===event.message.id)
      if(index<0)chat.messages.push(event.message);else chat.messages[index]=event.message
    }
  }
  return chat
}
export function upsertConversationMessage(messages:readonly ChatMessage[],message:ChatMessage):ChatMessage[]{
  const index=messages.findIndex(value=>value.id===message.id)
  return index<0?[...messages,message]:messages.map((value,i)=>i===index?message:value)
}

export type ConversationFindViewState={opened:boolean;query:string;caseSensitive:boolean;includeTools:boolean;activeIndex:number}
