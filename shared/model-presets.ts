/** OpenAI-compatible provider presets for Settings → 模型
 * Model IDs curated from public docs (MiMo / DeepSeek / OpenAI / Qwen / Kimi / GLM, 2026).
 */

export type ModelPreset = {
  id: string
  label: string
  base_url: string
  /** Default model within `models` */
  model: string
  /** Suggested selectable model IDs for this provider */
  models: string[]
  /** Suggested secret path under dataRoot */
  api_key_ref: string
  timeout_ms?: number
  hint?: string
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-5.4',
    models: ['gpt-5.4', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano'],
    api_key_ref: 'secrets/openai',
    hint: '可用名随账号权限变化；也可手填 gpt-5.6 / gpt-6-astra 等',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    api_key_ref: 'secrets/deepseek',
    hint: 'deepseek-chat / deepseek-reasoner 已下线，请用 V4',
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    base_url: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3',
    models: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.7-code-highspeed', 'moonshot-v1-128k'],
    api_key_ref: 'secrets/moonshot',
    hint: '优先 kimi-k3；编程可用 kimi-k2.7-code-highspeed',
  },
  {
    id: 'qwen',
    label: '通义千问 (DashScope)',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-flash'],
    api_key_ref: 'secrets/qwen',
    hint: '国内用 dashscope.aliyuncs.com；国际可用 dashscope-intl…',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.5',
    models: ['glm-4.5', 'glm-4.5-air', 'glm-4-plus', 'glm-4-flash'],
    api_key_ref: 'secrets/zhipu',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    base_url: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    models: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen2.5-72B-Instruct',
      'Qwen/Qwen3-235B-A22B',
    ],
    api_key_ref: 'secrets/siliconflow',
  },
  {
    id: 'groq',
    label: 'Groq',
    base_url: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'],
    api_key_ref: 'secrets/groq',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    base_url: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1',
    models: [
      'openai/gpt-4.1',
      'openai/gpt-5-mini',
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-flash',
      'deepseek/deepseek-chat-v3',
    ],
    api_key_ref: 'secrets/openrouter',
  },
  {
    id: 'mimo',
    label: '小米 MiMo',
    base_url: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5-pro',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
    api_key_ref: 'secrets/mimo',
    hint: '官方当前主力：mimo-v2.5-pro（推理）/ mimo-v2.5（多模态 Agent）',
  },
  {
    id: 'ollama',
    label: 'Ollama (本地)',
    base_url: 'http://127.0.0.1:11434/v1',
    model: 'llama3.2',
    models: ['llama3.2', 'qwen2.5', 'deepseek-r1', 'mistral'],
    api_key_ref: 'secrets/ollama',
    timeout_ms: 300000,
    hint: '本地服务一般可填任意非空 Key；模型名需与 ollama list 一致',
  },
  {
    id: 'custom',
    label: '自定义 (OpenAI 兼容)',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4.1',
    models: ['gpt-4.1'],
    api_key_ref: 'secrets/custom',
    hint: '任意 OpenAI Chat Completions 兼容端点；自行维护模型列表',
  },
]

export function findModelPreset(id: string): ModelPreset | undefined {
  return MODEL_PRESETS.find((p) => p.id === id)
}

/** Best-effort match current config to a preset (by base_url host). */
export function matchModelPreset(baseUrl: string): string {
  const raw = String(baseUrl || '').trim().toLowerCase().replace(/\/+$/, '')
  if (!raw) return 'custom'
  for (const p of MODEL_PRESETS) {
    if (p.id === 'custom') continue
    const u = p.base_url.toLowerCase().replace(/\/+$/, '')
    if (raw === u || raw.startsWith(u) || u.startsWith(raw)) return p.id
  }
  if (raw.includes('xiaomimimo') || raw.includes('mimo')) return 'mimo'
  return 'custom'
}
