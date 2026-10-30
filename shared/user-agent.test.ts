import assert from 'node:assert/strict'
import {
  UserAgentObject,
  adaptUserAgentToEngine,
  buildSetUserAgentArgs,
  FALLBACK_CHROME_FULL_VERSION,
  FALLBACK_CHROME_UA_VERSION,
  toReducedChromeVersion,
} from './user-agent.ts'

const WIN_ENGINE = {
  chromeVersion: FALLBACK_CHROME_UA_VERSION,
  chromeFullVersion: FALLBACK_CHROME_FULL_VERSION,
  platform: 'win32',
}

const CHROME152_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
const CHROME152_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
const EDGE152_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0'
const FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'
const ELECTRON =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Navora/0.3.22 Chrome/152.0.7977.130 Electron/44.0.0-cloudbypass.6 Safari/537.36'

assert.equal(toReducedChromeVersion('152.0.7977.130'), '152.0.0.0')
assert.equal(toReducedChromeVersion('152'), '152.0.0.0')

{
  const a = adaptUserAgentToEngine(CHROME152_WIN, WIN_ENGINE)
  assert.equal(a.family, 'chromium')
  assert.equal(a.electron, false)
  assert.equal(a.versionAligned, true)
  assert.equal(a.platformAligned, true)
  assert.match(a.ua, /Chrome\/152\.0\.0\.0/)
  assert.doesNotMatch(a.ua, /Chrome\/152\.0\.7977/)
}

{
  const a = adaptUserAgentToEngine(CHROME152_MAC, WIN_ENGINE)
  assert.equal(a.platformAligned, true)
  assert.match(a.ua, /Windows NT 10\.0; Win64; x64/)
  assert.match(a.ua, /Chrome\/152\.0\.0\.0/)
  assert.doesNotMatch(a.ua, /Macintosh/)
}

{
  // Even if config UA carries a full build, string is reduced to .0.0.0
  const a = adaptUserAgentToEngine(
    CHROME152_WIN.replace('152.0.0.0', '152.0.7977.130'),
    WIN_ENGINE,
  )
  assert.match(a.ua, /Chrome\/152\.0\.0\.0/)
}

{
  const built = buildSetUserAgentArgs(EDGE152_WIN, {}, WIN_ENGINE)
  assert.ok(built)
  assert.match(built.userAgent, /Edg\/152\.0\.0\.0/)
  assert.doesNotMatch(built.userAgent, /Edg\/152\.0\.7977/)
  assert.equal(
    built.options.userAgentMetadata?.fullVersion,
    FALLBACK_CHROME_FULL_VERSION,
  )
  const brands = built.options.userAgentMetadata?.brands || []
  assert.deepEqual(
    brands.map((b) => b.brand).sort(),
    ['Chromium', 'Microsoft Edge', 'Not?A_Brand'].sort(),
  )
  assert.ok(brands.every((b) => /not.+brand/i.test(b.brand) || b.version === '152'))
  const fvl = built.options.userAgentMetadata?.fullVersionList || []
  assert.ok(
    fvl.every(
      (b) =>
        /not.+brand/i.test(b.brand) || b.version === FALLBACK_CHROME_FULL_VERSION,
    ),
  )
  assert.equal(built.options.userAgentMetadata?.platform, 'Windows')
  assert.equal(built.options.platform, 'Win32')
}

{
  const built = buildSetUserAgentArgs(CHROME152_WIN, {}, WIN_ENGINE)
  assert.ok(built)
  assert.match(built.userAgent, /Chrome\/152\.0\.0\.0/)
  assert.equal(
    built.options.userAgentMetadata?.fullVersion,
    FALLBACK_CHROME_FULL_VERSION,
  )
  const brands = built.options.userAgentMetadata?.brands || []
  assert.ok(brands.some((b) => b.brand === 'Google Chrome' && b.version === '152'))
  assert.deepEqual(
    UserAgentObject.generateSecChUaBrands(152, 'Google Chrome'),
    brands,
  )
}

{
  const a = adaptUserAgentToEngine(ELECTRON, WIN_ENGINE)
  assert.equal(a.electron, true)
  assert.equal(a.ua, ELECTRON)
}

{
  const built = buildSetUserAgentArgs(FIREFOX, {}, WIN_ENGINE)
  assert.ok(built)
  assert.equal(built.adaptation.family, 'chromium')
  assert.match(built.userAgent, /Chrome\/152\.0\.0\.0/)
  assert.doesNotMatch(built.userAgent, /Firefox/)
  assert.equal(
    built.options.userAgentMetadata?.fullVersion,
    FALLBACK_CHROME_FULL_VERSION,
  )
  const brands = built.options.userAgentMetadata?.brands || []
  assert.ok(brands.some((b) => b.brand === 'Google Chrome' && b.version === '152'))
  assert.ok(built.adaptation.warnings.length > 0)
}

console.log('user-agent adaptation tests ok')
