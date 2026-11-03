import type {ChatMessageParam,ChatCompletionTool} from './openai-types'
export function estimateContextText(value:unknown){return Math.ceil(new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)??'').byteLength/3)}
/** Approximate tokenizer shared with preflight; includes reserved output. */
export function estimateContextBudget(messages:ChatMessageParam[],tools:ChatCompletionTool[],output:number,capacity:number){
  let imageCount=0
  const textOnly=messages.map(message=>({...message,content:Array.isArray(message.content)?message.content.map(part=>{if(part.type==='image_url'){imageCount++;return '[image]'}return part.text}):message.content}))
  const textTokens=estimateContextText({messages:textOnly,tools}),imageTokens=imageCount*4096,outputTokens=Math.max(0,output),total=textTokens+imageTokens+outputTokens
  return {textTokens,imageTokens,outputTokens,total,ratio:total/Math.max(1,capacity),exceeds:total>capacity*.9}
}
