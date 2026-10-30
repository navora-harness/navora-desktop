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
    // Electron stock UA contains Chrome/ but must NOT claim Google Chrome in Client Hints.
    if (/Electron\//i.test(ua)) return null
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
    const acceptLanguageRaw =
      this.initHeader?.['accept-language'] || this.initHeader?.['Accept-Language']
    // setUserAgent → GenerateAcceptLanguageHeader: pass language list without q=.
    const acceptLanguage = acceptLanguageRaw
      ? toAcceptLanguageList(String(acceptLanguageRaw))
      : undefined
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
    const headerMatchesSeed =
      !!fromHeader &&
      fromHeader.every(
        (b) => /not.+brand/i.test(b.brand) || b.version.split('.')[0] === String(seed),
      )
    const brands =
      (headerMatchesSeed ? fromHeader : null) ||
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

/**
 * Language preference list for `setUserAgent({ acceptLanguage })`.
 * Chromium's `GenerateAcceptLanguageHeader` adds `;q=` itself — do NOT pass wire q-values here.
 */
export const DEFAULT_ACCEPT_LANGUAGE_LIST = 'zh-CN,zh,en,en-GB,en-US'

/** Strip `;q=…` (and other params) → comma-separated language tags. */
export function toAcceptLanguageList(raw: string): string {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim().split(';')[0].trim())
    .filter(Boolean)
    .join(',')
}

/**
 * Mirror `net::HttpUtil::GenerateAcceptLanguageHeader`: first tag implicit q=1.0,
 * then q=0.9, 0.8, … down to 0.1.
 */
export function generateAcceptLanguageHeader(rawLanguageList: string): string {
  const langs = toAcceptLanguageList(rawLanguageList)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!langs.length) return ''
  let q10 = 10
  const out: string[] = []
  for (const language of langs) {
    if (q10 === 10) out.push(language)
    else out.push(`${language};q=0.${q10}`)
    if (q10 > 1) q10 -= 1
  }
  return out.join(',')
}

/** Wire Accept-Language (with q) matching Chromium / real Edge for the default list. */
export const DEFAULT_ACCEPT_LANGUAGE = generateAcceptLanguageHeader(
  DEFAULT_ACCEPT_LANGUAGE_LIST,
)

/**
 * UA 字符串里的 Chrome/Edg 版本：主版本 + `.0.0.0`（与真实浏览器导航 UA 一致）。
 */
export const FALLBACK_CHROME_UA_VERSION = '152.0.0.0'

/**
 * Client Hints 高熵 `fullVersion` / `fullVersionList` 用的完整构建号。
 * 运行时优先 `process.versions.chrome`。
 */
export const FALLBACK_CHROME_FULL_VERSION = '152.0.7977.130'

/** @deprecated 使用 FALLBACK_CHROME_UA_VERSION；保留别名以免旧引用断裂 */
export const FALLBACK_CHROME_VERSION = FALLBACK_CHROME_UA_VERSION

export type EngineHint = {
  /** Reduced form for User-Agent string tokens, e.g. `152.0.0.0`. */
  chromeVersion: string
  /** Full build for Sec-CH-UA-Full-Version*, e.g. `152.0.7977.130`. */
  chromeFullVersion: string
  platform: string
}

/** `152.0.7977.130` → `152.0.0.0` */
export function toReducedChromeVersion(version: string): string {
  const major = String(version || '').split('.')[0] || '0'
  return /^\d+$/.test(major) ? `${major}.0.0.0` : '0.0.0.0'
}

export function getRuntimeEngineHint(): EngineHint {
  const full =
    typeof process !== 'undefined' && process.versions?.chrome
      ? String(process.versions.chrome)
      : FALLBACK_CHROME_FULL_VERSION
  const platform =
    typeof process !== 'undefined' && process.platform
      ? String(process.platform)
      : 'win32'
  return {
    chromeVersion: toReducedChromeVersion(full),
    chromeFullVersion: full,
    platform,
  }
}

export type UserAgentAdaptation = {
  original: string
  ua: string
  family: 'chromium' | 'firefox' | 'safari' | 'other'
  electron: boolean
  versionAligned: boolean
  platformAligned: boolean
  warnings: string[]
}

export function chromiumFamilyUserAgent(
  engine: EngineHint,
  product: 'chrome' | 'edge' = 'chrome',
): string {
  const { token } = enginePlatformToken(engine.platform)
  const v = engine.chromeVersion
  const base = `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`
  return product === 'edge' ? `${base} Edg/${v}` : base
}

function enginePlatformToken(platform: string): {
  token: string
  os: 'Windows' | 'MacOS' | 'Linux'
} {
  if (platform === 'darwin') {
    return { token: 'Macintosh; Intel Mac OS X 10_15_7', os: 'MacOS' }
  }
  if (platform === 'linux') {
    return { token: 'X11; Linux x86_64', os: 'Linux' }
  }
  return { token: 'Windows NT 10.0; Win64; x64', os: 'Windows' }
}

function claimedOs(
  ua: string,
): 'Windows' | 'MacOS' | 'Linux' | 'iOS' | 'Android' | 'Unknown' {
  const inner = ua.match(/\(([^)]+)\)/)?.[1] || ''
  if (/Windows/.test(inner)) return 'Windows'
  if (/iPhone|iPad/.test(inner)) return 'iOS'
  if (/Mac OS X|Macintosh/.test(inner)) return 'MacOS'
  if (/Android/.test(inner)) return 'Android'
  if (/Linux/.test(inner)) return 'Linux'
  return 'Unknown'
}

/**
 * 把配置里的 UA 收束到本机真实引擎：UA 字符串用缩简版本（主版本.0.0.0），
 * 桌面 OS 跟 process.platform 对齐。完整构建号留给 Client Hints fullVersion。
 * Firefox/Safari 无法靠 setUserAgent options 对齐。
 */
export function adaptUserAgentToEngine(
  userAgent: string,
  engine: EngineHint = getRuntimeEngineHint(),
): UserAgentAdaptation {
  const original = String(userAgent || '').trim()
  const warnings: string[] = []
  const family = UserAgentObject.detectBrowserFamily(original)
  const electron = /Electron\//i.test(original)
  const uaVersion = toReducedChromeVersion(
    engine.chromeVersion || engine.chromeFullVersion || FALLBACK_CHROME_UA_VERSION,
  )
  if (!original) {
    return {
      original,
      ua: original,
      family,
      electron,
      versionAligned: false,
      platformAligned: false,
      warnings,
    }
  }
  if (electron) {
    return {
      original,
      ua: original,
      family,
      electron: true,
      versionAligned: true,
      platformAligned: true,
      warnings,
    }
  }
  if (family !== 'chromium') {
    warnings.push(
      `non-Chromium UA (${family}) remapped to Chrome ${uaVersion}`,
    )
    return {
      original,
      ua: chromiumFamilyUserAgent({ ...engine, chromeVersion: uaVersion }, 'chrome'),
      family: 'chromium',
      electron: false,
      versionAligned: true,
      platformAligned: true,
      warnings,
    }
  }

  let ua = original.replace(
    /(Chrome|Chromium|CriOS|Edg|EdgA|EdgiOS|OPR|Brave)\/(\d+(?:\.\d+)*)/gi,
    (_m, name: string) => `${name}/${uaVersion}`,
  )
  const engineMajor = uaVersion.split('.')[0] || ''
  const versionAligned = engineMajor
    ? new RegExp(
        `(?:Chrome|Chromium|CriOS|Edg|EdgA|EdgiOS|OPR)/${engineMajor}(?:\\.|\\s|$)`,
        'i',
      ).test(ua)
    : false

  const { token, os } = enginePlatformToken(engine.platform)
  const claimed = claimedOs(ua)
  let platformAligned = claimed === os
  if (claimed === 'iOS' || claimed === 'Android') {
    warnings.push(
      `mobile UA platform ${claimed} left unchanged (engine is desktop ${engine.platform})`,
    )
    platformAligned = false
  } else if (claimed !== os) {
    if (/\([^)]*\)/.test(ua)) ua = ua.replace(/\([^)]*\)/, `(${token})`)
    platformAligned = claimedOs(ua) === os
  }

  return {
    original,
    ua,
    family,
    electron: false,
    versionAligned,
    platformAligned,
    warnings,
  }
}

function applyFullVersionToOptions(
  options: UserAgentOverrideOptions,
  fullVersion: string,
  productBrand: string | null,
): UserAgentOverrideOptions {
  const meta = options.userAgentMetadata
  if (!meta || !fullVersion) return options
  const seed = parseInt(fullVersion.split('.')[0] || '0', 10) || 0
  const brands = meta.brands
  const fullVersionList =
    brands && brands.length
      ? UserAgentObject.generateSecChUaFullVersionList(
          seed,
          fullVersion,
          productBrand,
        )
      : meta.fullVersionList
  return {
    ...options,
    userAgentMetadata: {
      ...meta,
      fullVersion,
      ...(fullVersionList ? { fullVersionList } : {}),
    },
  }
}

export function buildSetUserAgentArgs(
  userAgent: string,
  initHeader: Record<string, string> = {},
  engine: EngineHint = getRuntimeEngineHint(),
): {
  userAgent: string
  options: UserAgentOverrideOptions
  adaptation: UserAgentAdaptation
} | null {
  const raw = String(userAgent || '').trim()
  if (!raw) return null
  const adaptation = adaptUserAgentToEngine(raw, engine)
  const parsed = UserAgentObject.parseUserAgent(adaptation.ua, {
    'accept-language': DEFAULT_ACCEPT_LANGUAGE_LIST,
    ...initHeader,
  })
  const productBrand = UserAgentObject.detectProductBrand(adaptation.ua)
  const options = applyFullVersionToOptions(
    parsed.toSetUserAgentOptions(),
    engine.chromeFullVersion || FALLBACK_CHROME_FULL_VERSION,
    productBrand,
  )
  return {
    userAgent: parsed.toString(),
    options,
    adaptation,
  }
}

type SetUserAgentTarget = {
  setUserAgent: (userAgent: string, options?: UserAgentOverrideOptions | string) => void
}

/**
 * 解析配置 UA，按本机 Chromium 版本 / OS 适配后再调用魔改 setUserAgent(ua, options)。
 * @returns 解析后的 UserAgentObject（UA 可能已被改成引擎版本）
 */
export function applyUserAgentOverride(
  target: SetUserAgentTarget,
  userAgent: string,
  initHeader: Record<string, string> = {},
): UserAgentObject | null {
  const built = buildSetUserAgentArgs(userAgent, initHeader)
  if (!built || !target?.setUserAgent) return null
  const parsed = UserAgentObject.parseUserAgent(built.userAgent, {
    'accept-language': DEFAULT_ACCEPT_LANGUAGE_LIST,
    ...initHeader,
  })
  try {
    target.setUserAgent(built.userAgent, built.options)
  } catch {
    try {
      target.setUserAgent(built.userAgent, { userAgentMetadata: null })
    } catch {
      try {
        target.setUserAgent(built.userAgent)
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
