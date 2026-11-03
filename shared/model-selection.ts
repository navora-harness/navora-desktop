import type {AiProviderConfig,AppConfig} from './config'
import {resolveModelName,resolveProvider,normalizeProvider} from './model-providers'
import {modelCapabilities} from './model-capabilities'
export type ModelSelectionIdentity={providerId:string;model:string;reasoningLevel:string|null;executionMode:'auto'|'chat'|'agent';configFingerprint:string}
/** Only public configuration is fingerprinted. Secret values never cross this boundary. */
export function modelConfigurationFingerprint(provider:AiProviderConfig,model:string){
  provider=normalizeProvider({...provider,models:[...(provider.models||[])]})
  const value=JSON.stringify([provider.id,provider.type,provider.base_url,provider.api_key_ref,provider.protocol,provider.output_token_param,provider.timeout_ms,model,modelCapabilities(provider,model)])
  let a=2166136261,b=0x9e3779b9
  for(let index=0;index<value.length;index++){a=Math.imul(a^value.charCodeAt(index),16777619);b=Math.imul(b^value.charCodeAt(index),2246822519)}
  return (a>>>0).toString(16)+(b>>>0).toString(16)
}
export function confirmedModelSelection(config:{ai:Pick<AppConfig['ai'],'providers'|'default_provider'>},chat:{providerId?:string;model?:string;reasoningLevel?:string|null;executionMode?:'auto'|'chat'|'agent'}):ModelSelectionIdentity{
  const provider=resolveProvider(config.ai.providers,config.ai.default_provider,chat.providerId)
  if(!provider)throw Error('provider_not_configured')
  const model=resolveModelName(provider,chat.model),caps=modelCapabilities(provider,model),level=chat.reasoningLevel
  return {providerId:provider.id,model,reasoningLevel:caps.reasoning.enabled?(caps.reasoning.levels.some(item=>item.id===level)?level!:caps.reasoning.default)||null:null,executionMode:chat.executionMode||'auto',configFingerprint:modelConfigurationFingerprint(provider,model)}
}
export function validateModelSelection(config:{ai:Pick<AppConfig['ai'],'providers'|'default_provider'>},identity:ModelSelectionIdentity){
  if(!identity||typeof identity.providerId!=='string'||typeof identity.model!=='string'||!['auto','chat','agent'].includes(identity.executionMode))throw Error('invalid_model_selection')
  const provider=config.ai.providers.find(item=>item.id===identity.providerId)
  if(!provider||!provider.models.includes(identity.model)||modelConfigurationFingerprint(provider,identity.model)!==identity.configFingerprint)throw Error('model_configuration_changed:模型配置已变化，请检查后重新提交。')
  const reasoning=modelCapabilities(provider,identity.model).reasoning
  if(identity.reasoningLevel!==null&&(typeof identity.reasoningLevel!=='string'||!reasoning.enabled||!reasoning.levels.some(item=>item.id===identity.reasoningLevel)))throw Error('invalid_model_selection')
  return provider
}
export function assertConfirmedModelSelection(expected:ModelSelectionIdentity,actual:ModelSelectionIdentity){if((['providerId','model','reasoningLevel','executionMode','configFingerprint'] as const).some(key=>expected[key]!==actual[key]))throw Error('model_selection_conflict:会话模型已在其他位置变化，请确认后重新发送。')}
/** An insertion continues the existing provider call; another identity must queue. */
export function canInsertModelSelection(current:ModelSelectionIdentity|undefined,incoming:ModelSelectionIdentity|undefined):boolean{
  if(!incoming)return true // compatibility with legacy corrections lacking an identity
  if(!current)return false
  try{assertConfirmedModelSelection(current,incoming);return true}catch{return false}
}
