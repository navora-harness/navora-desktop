export type ConversationFindText={id:string;text:string}
export type ConversationMatch={messageId:string;from:number;to:number}
export function findConversationText(items:ConversationFindText[],query:string,caseSensitive=false,limit=100000){
  const matches:ConversationMatch[]=[]
  if(!query.trim())return {matches,truncated:false}
  const pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),caseSensitive?'gu':'giu')
  for(const item of items){pattern.lastIndex=0;for(const match of item.text.matchAll(pattern)){if(matches.length>=limit)return {matches,truncated:true};matches.push({messageId:item.id,from:match.index!,to:match.index!+match[0].length})}}
  return {matches,truncated:false}
}
