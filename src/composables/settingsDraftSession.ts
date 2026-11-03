import { ref } from 'vue'
import type { AppConfig } from '@shared/config'

// Memory only. Never serialize credentials to localStorage or configuration files.
export const settingsCredentialDrafts = ref<Record<string, string>>({})
export const settingsDraftSession: {
  base: AppConfig | null; draft: AppConfig | null; selected: string; password: string; allowlist: string; failedInstant: AppConfig | null; instantError: string; section:string; scroll:Record<string,number>
} = { base: null, draft: null, selected: '', password: '', allowlist: '', failedInstant: null, instantError: '', section:'basic',scroll:{} }
