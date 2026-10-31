import type { AiProviderConfig } from '../../shared/config'
import { modelCapabilities, reasoningValue } from '../../shared/model-capabilities'
import { fetchOpenAiModelsList } from '../../shared/openai-models'
import { OpenAICompatibleClient } from './llm/openai-compatible'

export async function probeModel(provider: AiProviderConfig, apiKey: string, model: string, kind: 'connection' | 'reply') {
  const started = Date.now()
  try {
    if (kind === 'connection') {
      const res = await fetchOpenAiModelsList({ url: provider.base_url, apiKey, timeoutMs: 12000 })
      return res.ok ? { ok: true, ms: Date.now() - started, text: '连接成功' }
        : { ok: false, ms: Date.now() - started, text: res.status === 401 || res.status === 403 ? '密钥验证失败' : '无法读取模型目录，可尝试测试问答' }
    }
    if (!provider.models.includes(model)) return { ok: false, text: '请先应用模型配置' }
    const capability = modelCapabilities(provider, model)
    const client = new OpenAICompatibleClient({ baseUrl: provider.base_url, apiKey, model, timeoutMs: 30000,
      maxOutputTokens: Math.min(2048, capability.max_output_tokens), outputTokenParam: provider.output_token_param,
      reasoningEffort: reasoningValue(capability), contextWindow: capability.context_window, supportsImages: capability.input_types.includes('image') })
    const answer = await client.chat([{ role: 'user', content: '1 + 1 等于多少？请只回答数字。' }], [])
    const text = answer.content?.trim()
    return text ? { ok: true, ms: Date.now() - started, text: text.slice(0, 160) } : { ok: false, ms: Date.now() - started, text: '模型未返回正文' }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return { ok: false, ms: Date.now() - started, text: /auth_40[13]/.test(message) ? '密钥验证失败' : /timeout/.test(message) ? '模型响应超时' : '请求失败，请检查地址与模型配置' }
  }
}
