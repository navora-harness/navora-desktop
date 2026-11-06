/** .7's public target transport uses nonnegative signed 32-bit IDs. */
export const NATIVE_TARGET_KEYS = ['webContentsId','processId','routingId','documentId','backendNodeId'] as const
export const nativeAgentTargetSchema = {
  type:'object', additionalProperties:false, required:[...NATIVE_TARGET_KEYS],
  properties:Object.fromEntries(NATIVE_TARGET_KEYS.map(key=>[key,{type:'integer',minimum:0,maximum:2147483647}])),
  description:'Complete native target from a fresh browser_get(agent_snapshot/agent_find). Prefer its ref for ordinary input; never invent or partially reconstruct routing IDs.',
}
export function nativeTargetIssues(value:unknown):string[] {
  if(!value||typeof value!=='object'||Array.isArray(value))return ['target must be an object']
  const source=value as Record<string,unknown>,issues:string[]=[]
  for(const key of NATIVE_TARGET_KEYS){const number=source[key],max=2147483647;if(typeof number!=='number'||!Number.isSafeInteger(number)||number<0||number>max)issues.push(`${key}: required integer 0..${max}`)}
  for(const key of Object.keys(source))if(!(NATIVE_TARGET_KEYS as readonly string[]).includes(key))issues.push(`unexpected field: ${key}`)
  return issues
}
