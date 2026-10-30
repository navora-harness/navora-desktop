import { DEFAULT_EDGE_UA } from './types'
import { FALLBACK_CHROME_UA_VERSION } from './user-agent'

export type UaPreset = {
  id: string
  label: string
  ua: string
}

const V = FALLBACK_CHROME_UA_VERSION
const CHROME_WIN = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${V} Safari/537.36`
const CHROME_MAC = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${V} Safari/537.36`
const CHROME_LINUX = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${V} Safari/537.36`
const EDGE_MAC = `${CHROME_MAC} Edg/${V}`
const EDGE_LINUX = `${CHROME_LINUX} Edg/${V}`

export const UA_PRESETS: UaPreset[] = [
  {
    id: 'edge152',
    label: 'Microsoft Edge · Windows',
    ua: DEFAULT_EDGE_UA,
  },
  {
    id: 'edge152_mac',
    label: 'Microsoft Edge · macOS',
    ua: EDGE_MAC,
  },
  {
    id: 'edge152_linux',
    label: 'Microsoft Edge · Linux',
    ua: EDGE_LINUX,
  },
  {
    id: 'chrome152',
    label: 'Google Chrome · Windows',
    ua: CHROME_WIN,
  },
  {
    id: 'chrome152_mac',
    label: 'Google Chrome · macOS',
    ua: CHROME_MAC,
  },
  {
    id: 'chrome152_linux',
    label: 'Google Chrome · Linux',
    ua: CHROME_LINUX,
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
