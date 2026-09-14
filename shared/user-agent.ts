/**
 * 从 UA 字符串解析 Client Hints / platform，供魔改 Electron setUserAgent 第二参使用。
 * 逻辑对齐 electron-api `UserAgentObject`（unofficial Electron）。
 */

export type UserAgentBrandVersion = { brand: string; version: string }

export type UserAgentMetadata = {
  brands?: UserAgentBrandVersion[]
  fullVersionList?: UserAgentBrandVersion[]
  fullVersion?: string
  platform?: string
  platformVersion?: string
  architecture?: string
  model?: string
  mobile?: boolean
  bitness?: string
  wow64?: boolean
  formFactors?: string[]
}

/** 魔改 Electron `setUserAgent(ua, options)` 第二参 */
export type UserAgentOverrideOptions = {
  platform?: string
  hideChrome?: boolean
  acceptLanguage?: string
  acceptLanguages?: string
  userAgentMetadata?: UserAgentMetadata | null
}

export class UserAgentObject {
  platform: string
  navigatorPlatform: string
  platformVersion: string
  architecture: string
  uaFullVersion: string
  originalUserAgent: string
  appVersion: string
  model: string
  mobile: string | boolean
  brands: UserAgentBrandVersion[]
  initHeader: Record<string, string>

  constructor(
    userAgent: string,
    uaData: Record<string, unknown>,
    initHeader: Record<string, string>,
  ) {
    this.originalUserAgent = userAgent
    this.platform = String(uaData.platform || '')
    this.navigatorPlatform = String(uaData.navigatorPlatform || '')
    this.platformVersion = String(uaData.platformVersion || '')
    this.architecture = String(uaData.architecture || '')
    this.uaFullVersion = String(uaData.uaFullVersion || '')
    this.appVersion = String(uaData.appVersion || '')
    this.model = String(uaData.model || '')
    this.mobile = (uaData.mobile as string | boolean) ?? 'false'
    this.brands = (uaData.brands as UserAgentBrandVersion[]) || []
    this.initHeader = initHeader || {}
  }

  static parseUserAgent(
    userAgent: string,
    initHeader: Record<string, string> = {},
  ): UserAgentObject {
    const uaData: Record<string, unknown> = {}

    const platformMatch = userAgent.match(/\(([^)]+)\)/)
    if (platformMatch) {
      uaData.navigatorPlatform = platformMatch[1]
      if (/Windows/.test(platformMatch[1])) {
        uaData.navigatorPlatform = 'Win32'
        uaData.platform = 'Windows'
      } else if (/iPhone|iPad/.test(platformMatch[1])) {
        uaData.platform = 'iOS'
      } else if (/Mac OS X/.test(platformMatch[1])) {
        uaData.navigatorPlatform = 'MacIntel'
        uaData.platform = 'MacOS'
      } else if (/Android/.test(platformMatch[1])) {
        uaData.platform = 'Android'
      } else if (/Linux/.test(platformMatch[1])) {
        uaData.platform = 'Linux'
      } else {
        uaData.platform = 'Unknown'
      }
    }

    const platformVersionMatch = userAgent.match(
      /(?:Windows NT|Mac OS X|Android|CPU (?:iPhone )?OS|Linux) ([^; )]+)/,
    )
    if (platformVersionMatch) {
      uaData.platformVersion = platformVersionMatch[1]
    }
    uaData.platformVersion = UserAgentObject.normalizePlatformVersion(
      String(uaData.platform || ''),
      String(uaData.platformVersion || ''),
      initHeader,
    )

    const browserVersionMatch = userAgent.match(
      /(?:Chrome|Chromium|CriOS|Firefox|FxiOS|Edg|EdgA|EdgiOS|OPR)\/[^\s]+/gi,
    )
    if (browserVersionMatch) {
      for (const browserVersionMatchValue of browserVersionMatch) {
        const [uaName, uaFullVersion] = browserVersionMatchValue.split('/')
        const name = uaName || ''
        if (/^Firefox$/i.test(name) || /^FxiOS$/i.test(name)) continue
        if (/^(Chrome|Chromium|CriOS)$/i.test(name)) {
          uaData.uaFullVersion = uaFullVersion
        } else if (!uaData.uaFullVersion && /^(Edg|EdgA|EdgiOS|OPR)$/i.test(name)) {
          uaData.uaFullVersion = uaFullVersion
        }
      }
    }

    const architectureMatch = userAgent.match(/(Win64|x64|ARM|i686|i386|x86_64|x86)/)
    if (architectureMatch) {
      uaData.architecture = architectureMatch[1]
      if (['Win64', 'x64', 'i686', 'i386'].includes(String(uaData.architecture))) {
        uaData.architecture = 'x86'
      }
      if (uaData.platform === 'Linux') {
        uaData.navigatorPlatform = `Linux ${uaData.architecture}`
      }
    } else if (uaData.platform === 'MacOS' && platformMatch?.[1]) {
      uaData.architecture = /Intel Mac OS X/.test(platformMatch[1]) ? 'x86' : 'arm'
    }

    const appVersionMatch = userAgent.match(/(?:MSIE|Trident)\/([^\s;)]+)/)
    uaData.appVersion = appVersionMatch
      ? appVersionMatch[1]
      : userAgent.replace(/^Mozilla\//, '')

    uaData.mobile = /Mobile/.test(userAgent)

    if (uaData.platform === 'iOS' || uaData.platform === 'Android') {
      uaData.navigatorPlatform = ''
      uaData.architecture = ''
    }

    return new UserAgentObject(userAgent, uaData, initHeader)
  }

  toString(): string {
    return this.originalUserAgent
  }

  static normalizePlatformVersion(
    platform: string,
    raw: string,
    initHeader?: Record<string, string>,
  ): string {
    const headerVal =
      initHeader?.['sec-ch-ua-platform-version'] ||
      initHeader?.['Sec-CH-UA-Platform-Version']
    if (headerVal != null && String(headerVal).trim() !== '') {
      return UserAgentObject.padVersion(
        String(headerVal).replace(/^"+|"+$/g, '').trim().replace(/_/g, '.'),
        3,
      )
    }
    if (platform === 'Linux') return ''
    if (!raw) {
      return platform === 'Windows' ? '15.0.0' : ''
    }
    const dotted = raw.replace(/_/g, '.')
    if (platform === 'Windows') {
      const ntToCh: Record<string, string> = {
        '5.1': '0.0.0',
        '6.0': '0.0.0',
        '6.1': '0.1.0',
        '6.2': '0.2.0',
        '6.3': '0.3.0',
        '10.0': '15.0.0',
      }
      const nt = dotted.split('.').slice(0, 2).join('.')
      if (ntToCh[nt]) return ntToCh[nt]
      return UserAgentObject.padVersion(dotted, 3)
    }
    if (platform === 'MacOS') return UserAgentObject.padVersion(dotted, 3)
    return UserAgentObject.padVersion(dotted, 3)
  }

  static detectBrowserFamily(
    userAgent: string,
  ): 'chromium' | 'firefox' | 'safari' | 'other' {
    const ua = userAgent || ''
    if (
      /Chrome\/|Chromium\/|CriOS\/|Edg\/|EdgA\/|EdgiOS\/|OPR\/|Brave\//i.test(ua) &&
      !/Firefox\//i.test(ua)
    ) {
      return 'chromium'
    }
    if (/Firefox\/|FxiOS\//i.test(ua)) return 'firefox'
    if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return 'safari'
    return 'other'
  }

  static parseSecChUaBrands(header: string): UserAgentBrandVersion[] | null {
    if (!header || !String(header).trim()) return null
    const brands: UserAgentBrandVersion[] = []
    const re = /"?([^";]+)"?\s*;\s*v="?([^",\s]+)"?/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(header)) !== null) {
      const brand = m[1].trim()
      const version = m[2].trim()
      if (brand && version) brands.push({ brand, version })
    }
    return brands.length ? brands : null
  }

  static greaseBrandVersion(seed: number): UserAgentBrandVersion {
    const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_']
    const vers = ['8', '99', '24']
    const s = Math.max(0, seed | 0)
    return {
      brand: `Not${chars[s % 11]}A${chars[(s + 1) % 11]}Brand`,
      version: vers[s % 3],
    }
  }

  static shuffleBrandList<T>(items: T[], seed: number): T[] {
    const n = items.length
    const s = Math.max(0, seed | 0)
    let order: number[]
    if (n === 2) {
      order = [s % 2, (s + 1) % 2]
    } else if (n === 3) {
      const orders3 = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ]
      order = orders3[s % 6]
    } else if (n <= 1) {
      return items.slice()
    } else {
      return items.slice()
    }
    const out: T[] = new Array(n)
    for (let i = 0; i < n; i++) out[order[i]] = items[i]
    return out
  }

  static generateSecChUaBrands(
    seed: number,
    productBrand?: string | null,
  ): UserAgentBrandVersion[] {
    const s = Math.max(0, parseInt(String(seed), 10) || 0)
    const major = String(s)
    const items: UserAgentBrandVersion[] = [
      UserAgentObject.greaseBrandVersion(s),
      { brand: 'Chromium', version: major },
    ]
    if (productBrand) items.push({ brand: productBrand, version: major })
    return UserAgentObject.shuffleBrandList(items, s)
  }

  static generateSecChUaFullVersionList(
    seed: number,
    fullVersion: string,
    productBrand?: string | null,
  ): UserAgentBrandVersion[] {
    const s = Math.max(0, parseInt(String(seed), 10) || 0)
    const grease = UserAgentObject.greaseBrandVersion(s)
    const fv =
      fullVersion && fullVersion.includes('.') ? fullVersion : `${s}.0.0.0`
    return UserAgentObject.generateSecChUaBrands(s, productBrand).map((b) => ({
      brand: b.brand,
      version: b.brand === grease.brand ? `${grease.version}.0.0.0` : fv,
    }))
  }

  static detectProductBrand(userAgent: string): string | null {
    const ua = userAgent || ''
    if (/Edg\/|EdgA\/|EdgiOS\//i.test(ua)) return 'Microsoft Edge'
    if (/OPR\//i.test(ua)) return 'Opera'
    if (/Brave\//i.test(ua)) return 'Brave'
    if (/Chrome\/|CriOS\//i.test(ua)) return 'Google Chrome'
    if (/Chromium\//i.test(ua)) return null
    return 'Google Chrome'
  }

  private static padVersion(version: string, parts: number): string {
    const cleaned = version.replace(/[^\d.]+/g, '.')
    const segs = cleaned.split('.').filter((s) => s !== '')
    if (!segs.length) return parts > 0 ? new Array(parts).fill('0').join('.') : ''
    while (segs.length < parts) segs.push('0')
    return segs.slice(0, parts).join('.')
  }

  private static sanitizeBrandList(
    list: { brand?: string; version?: string }[] | null | undefined,
  ): UserAgentBrandVersion[] | null {
    if (!Array.isArray(list) || !list.length) return null
    const out: UserAgentBrandVersion[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const brand = item.brand != null ? String(item.brand).trim() : ''
      const version = item.version != null ? String(item.version).trim() : ''
      if (brand && version) out.push({ brand, version })
    }
    return out.length ? out : null
  }

  /** 魔改 Electron setUserAgent 第二参（CDP 风格） */
  toSetUserAgentOptions(): UserAgentOverrideOptions {
    const acceptLanguage =
      this.initHeader?.['accept-language'] || this.initHeader?.['Accept-Language']
    const family = UserAgentObject.detectBrowserFamily(this.originalUserAgent)
    const base: UserAgentOverrideOptions = {
      platform: this.navigatorPlatform || undefined,
      acceptLanguage: acceptLanguage || undefined,
    }

    if (family !== 'chromium') {
      return { ...base, userAgentMetadata: null }
    }

    const mobile = String(this.mobile) === 'true'
    const chPlatform =
      this.platform === 'MacOS'
        ? 'macOS'
        : this.platform === 'Unknown'
          ? undefined
          : this.platform || undefined
    const bitness =
      /(?:Win64|x64|WOW64|x86_64|Intel Mac|arm64|aarch64|Android)/i.test(
        this.originalUserAgent,
      ) ||
      this.platform === 'MacOS' ||
      this.platform === 'iOS'
        ? '64'
        : '32'
    const wow64 = /WOW64/i.test(this.originalUserAgent)
    const fullVersion = this.uaFullVersion || ''
    const seed = parseInt((fullVersion || '0').split('.')[0], 10) || 0
    const productBrand = UserAgentObject.detectProductBrand(this.originalUserAgent)

    const fromHeader = UserAgentObject.sanitizeBrandList(
      UserAgentObject.parseSecChUaBrands(
        this.initHeader?.['sec-ch-ua'] || this.initHeader?.['Sec-CH-UA'] || '',
      ),
    )
    const brands =
      fromHeader ||
      UserAgentObject.sanitizeBrandList(this.brands) ||
      UserAgentObject.generateSecChUaBrands(seed, productBrand)

    const fullVersionList = fromHeader
      ? brands.map((b) => ({
          brand: b.brand,
          version: fullVersion || b.version,
        }))
      : UserAgentObject.generateSecChUaFullVersionList(
          seed,
          fullVersion || String(seed),
          productBrand,
        )

    let architecture = this.architecture || undefined
    if (architecture === 'x86_64' || architecture === 'x64' || architecture === 'Win64') {
      architecture = 'x86'
    }
    if (/^arm/i.test(architecture || '') || architecture === 'aarch64') {
      architecture = 'arm'
    }

    return {
      ...base,
      userAgentMetadata: {
        brands,
        fullVersion: fullVersion || (seed ? `${seed}.0.0.0` : undefined),
        fullVersionList,
        platform: chPlatform,
        platformVersion: this.platformVersion ?? '',
        architecture,
        model: this.model || '',
        mobile,
        bitness,
        wow64,
        formFactors: mobile ? ['Mobile'] : ['Desktop'],
      },
    }
  }
}

const DEFAULT_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6'

type SetUserAgentTarget = {
  setUserAgent: (userAgent: string, options?: UserAgentOverrideOptions | string) => void
}

/**
 * 解析配置 UA，用魔改 Electron 的 setUserAgent(ua, options) 写入 session / webContents。
 * 官方 Electron 仅支持第二参为 Accept-Language 字符串时会降级。
 * @returns 解析后的 UserAgentObject（供请求头消毒使用）
 */
export function applyUserAgentOverride(
  target: SetUserAgentTarget,
  userAgent: string,
  initHeader: Record<string, string> = {},
): UserAgentObject | null {
  const ua = String(userAgent || '').trim()
  if (!ua || !target?.setUserAgent) return null
  const parsed = UserAgentObject.parseUserAgent(ua, {
    'accept-language': DEFAULT_ACCEPT_LANGUAGE,
    ...initHeader,
  })
  const options = parsed.toSetUserAgentOptions()
  try {
    target.setUserAgent(parsed.toString(), options)
  } catch {
    try {
      target.setUserAgent(parsed.toString(), { userAgentMetadata: null })
    } catch {
      try {
        target.setUserAgent(parsed.toString())
      } catch {
        /* ignore */
      }
    }
  }
  return parsed
}

/**
 * electron-api view.ts onBeforeSendHeaders：强制 UA，剥 Full-Version CH，再按 initHeader 写回。
 */
export function sanitizeRequestHeadersForUa(
  requestHeaders: Record<string, string>,
  ua: string,
  initHeader: Record<string, string> = {},
): Record<string, string> {
  requestHeaders['User-Agent'] = ua
  delete requestHeaders['Sec-Ch-Ua-Full-Version-List']
  delete requestHeaders['Sec-Ch-Ua-Full-Version']
  delete requestHeaders['sec-ch-ua-platform']

  let ch_ua = requestHeaders['sec-ch-ua']

  for (const initHeaderKey in initHeader) {
    delete requestHeaders[initHeaderKey]

    if (initHeaderKey === 'sec-ch-ua') {
      if (ch_ua !== undefined && ch_ua !== null && ch_ua !== '') {
        requestHeaders[initHeaderKey] = initHeader[initHeaderKey]
      }
    } else {
      requestHeaders[initHeaderKey] = initHeader[initHeaderKey]
    }
  }

  return requestHeaders
}
