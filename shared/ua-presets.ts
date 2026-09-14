import { DEFAULT_EDGE_UA } from './types'

export type UaPreset = {
  id: string
  label: string
  ua: string
}

const CHROME152_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
const CHROME152_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
const CHROME152_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'

const EDGE152_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0'
const EDGE152_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0'

export const UA_PRESETS: UaPreset[] = [
  {
    id: 'edge152',
    label: 'Microsoft Edge 152 · Windows',
    ua: DEFAULT_EDGE_UA,
  },
  {
    id: 'edge152_mac',
    label: 'Microsoft Edge 152 · macOS',
    ua: EDGE152_MAC,
  },
  {
    id: 'edge152_linux',
    label: 'Microsoft Edge 152 · Linux',
    ua: EDGE152_LINUX,
  },
  {
    id: 'chrome152',
    label: 'Google Chrome 152 · Windows',
    ua: CHROME152_WIN,
  },
  {
    id: 'chrome152_mac',
    label: 'Google Chrome 152 · macOS',
    ua: CHROME152_MAC,
  },
  {
    id: 'chrome152_linux',
    label: 'Google Chrome 152 · Linux',
    ua: CHROME152_LINUX,
  },
  {
    id: 'custom',
    label: '自定义',
    ua: '',
  },
]

export function getUaPreset(id: string): UaPreset | undefined {
  return UA_PRESETS.find((p) => p.id === id)
}

/** Match a built-in preset by exact UA string (ignores「自定义」). */
export function findUaPresetByUa(ua: string): UaPreset | undefined {
  const t = ua.trim()
  if (!t) return undefined
  return UA_PRESETS.find((p) => p.id !== 'custom' && p.ua === t)
}
