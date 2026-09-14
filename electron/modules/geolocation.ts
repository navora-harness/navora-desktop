/** Resolve device / approximate location for Agent tools. */

import { BrowserWindow, session as electronSession } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const execFileAsync = promisify(execFile)

export type GeolocationResult = {
  ok: true
  source: 'device' | 'ip'
  latitude: number
  longitude: number
  accuracyMeters?: number
  city?: string
  region?: string
  country?: string
  timezone?: string
  /** Short Chinese summary for the model */
  summary: string
}

export type GeolocationFail = {
  ok: false
  error: string
  hint?: string
  deviceError?: string
  ipError?: string
}

function summarize(parts: {
  source: 'device' | 'ip'
  latitude: number
  longitude: number
  accuracyMeters?: number
  city?: string
  region?: string
  country?: string
}): string {
  const place = [parts.city, parts.region, parts.country].filter(Boolean).join(' · ')
  const coords = `${parts.latitude.toFixed(5)}, ${parts.longitude.toFixed(5)}`
  const acc =
    typeof parts.accuracyMeters === 'number' && Number.isFinite(parts.accuracyMeters)
      ? `（约 ±${Math.round(parts.accuracyMeters)}m）`
      : ''
  if (place) {
    return parts.source === 'device'
      ? `设备定位：${place}，坐标 ${coords}${acc}`
      : `大致位置（IP）：${place}，坐标 ${coords}`
  }
  return parts.source === 'device'
    ? `设备定位坐标 ${coords}${acc}`
    : `大致坐标（IP）${coords}`
}

type IpProvider = {
  name: string
  url: string
  parse: (data: Record<string, unknown>) => {
    latitude: number
    longitude: number
    city?: string
    region?: string
    country?: string
    timezone?: string
  } | null
}

const IP_PROVIDERS: IpProvider[] = [
  {
    name: 'ipwho.is',
    url: 'https://ipwho.is/',
    parse: (data) => {
      if (data.success === false) return null
      const latitude = Number(data.latitude)
      const longitude = Number(data.longitude)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
      return {
        latitude,
        longitude,
        city: String(data.city || '').trim() || undefined,
        region: String(data.region || '').trim() || undefined,
        country: String(data.country || '').trim() || undefined,
        timezone:
          typeof data.timezone === 'object' && data.timezone
            ? String((data.timezone as Record<string, unknown>).id || '').trim() || undefined
            : String(data.timezone || '').trim() || undefined,
      }
    },
  },
  {
    name: 'ip-api',
    url: 'http://ip-api.com/json/?fields=status,message,country,regionName,city,lat,lon,timezone&lang=zh-CN',
    parse: (data) => {
      if (String(data.status) !== 'success') return null
      const latitude = Number(data.lat)
      const longitude = Number(data.lon)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
      return {
        latitude,
        longitude,
        city: String(data.city || '').trim() || undefined,
        region: String(data.regionName || '').trim() || undefined,
        country: String(data.country || '').trim() || undefined,
        timezone: String(data.timezone || '').trim() || undefined,
      }
    },
  },
  {
    name: 'ipinfo',
    url: 'https://ipinfo.io/json',
    parse: (data) => {
      if (typeof data.loc !== 'string') return null
      const [a, b] = data.loc.split(',').map((s) => Number(String(s).trim()))
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null
      return {
        latitude: a,
        longitude: b,
        city: String(data.city || '').trim() || undefined,
        region: String(data.region || '').trim() || undefined,
        country: String(data.country || '').trim() || undefined,
        timezone: String(data.timezone || '').trim() || undefined,
      }
    },
  },
  {
    name: 'ipapi.co',
    url: 'https://ipapi.co/json/',
    parse: (data) => {
      const latitude = Number(data.latitude ?? data.lat)
      const longitude = Number(data.longitude ?? data.lon)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
      if (data.error) return null
      return {
        latitude,
        longitude,
        city: String(data.city || '').trim() || undefined,
        region: String(data.region || '').trim() || undefined,
        country: String(data.country_name || data.country || '').trim() || undefined,
        timezone: String(data.timezone || '').trim() || undefined,
      }
    },
  },
]

async function reverseGeocode(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<{ city?: string; region?: string; country?: string }> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=zh-CN`
    const res = await fetch(url, {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Navora/geolocation',
      },
    })
    if (!res.ok) return {}
    const data = (await res.json()) as {
      address?: Record<string, string>
      display_name?: string
    }
    const a = data.address || {}
    const city =
      a.city || a.town || a.village || a.municipality || a.county || a.suburb || undefined
    const region = a.state || a.province || a.region || undefined
    const country = a.country || undefined
    return {
      city: city ? String(city) : undefined,
      region: region ? String(region) : undefined,
      country: country ? String(country) : undefined,
    }
  } catch {
    return {}
  }
}

async function enrichPlace(
  result: GeolocationResult,
  signal?: AbortSignal,
): Promise<GeolocationResult> {
  if (result.city && result.region) return result
  const place = await reverseGeocode(result.latitude, result.longitude, signal)
  const city = result.city || place.city
  const region = result.region || place.region
  const country = result.country || place.country
  return {
    ...result,
    city,
    region,
    country,
    summary: summarize({
      source: result.source,
      latitude: result.latitude,
      longitude: result.longitude,
      accuracyMeters: result.accuracyMeters,
      city,
      region,
      country,
    }),
  }
}

async function fetchIpGeolocation(signal?: AbortSignal): Promise<GeolocationResult | GeolocationFail> {
  let lastError = 'ip_lookup_failed'
  for (const provider of IP_PROVIDERS) {
    try {
      const res = await fetch(provider.url, {
        signal,
        headers: { Accept: 'application/json', 'User-Agent': 'Navora/geolocation' },
      })
      if (!res.ok) {
        lastError = `${provider.name}_http_${res.status}`
        continue
      }
      const data = (await res.json()) as Record<string, unknown>
      const parsed = provider.parse(data)
      if (!parsed) {
        lastError = `${provider.name}_parse_failed`
        continue
      }
      return {
        ok: true,
        source: 'ip',
        ...parsed,
        summary: summarize({
          source: 'ip',
          ...parsed,
        }),
      }
    } catch (e) {
      lastError = `${provider.name}: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return {
    ok: false,
    error: lastError,
    hint: 'IP 定位失败。可请用户提供城市，或检查网络后重试。',
  }
}

/**
 * Windows Location Services (same stack Edge uses) — does NOT need Google API key.
 * Chrome works because it ships Google keys; Electron Chromium usually does not.
 */
async function fetchWindowsNativeGeolocation(
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GeolocationResult | GeolocationFail> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'not_windows' }
  }
  if (signal?.aborted) return { ok: false, error: 'aborted' }

  const ms = Math.min(30000, Math.max(4000, Math.floor(timeoutMs) || 12000))
  const scriptPath = path.join(tmpdir(), `navora-geo-${randomUUID()}.ps1`)
  const script = `
$ErrorActionPreference = 'Stop'
function Write-GeoJson($obj) {
  Write-Output ($obj | ConvertTo-Json -Compress)
}
try {
  Add-Type -AssemblyName System.Device | Out-Null
  $w = New-Object System.Device.Location.GeoCoordinateWatcher
  $w.Start()
  $deadline = (Get-Date).AddMilliseconds(${ms})
  while ($w.Status -ne 'Ready' -and $w.Permission -ne 'Denied' -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 150
  }
  if ($w.Permission -eq 'Denied') {
    Write-GeoJson @{ ok = $false; error = 'windows_location_denied' }
    exit 0
  }
  if ($w.Status -ne 'Ready' -or $w.Position.Location.IsUnknown) {
    Write-GeoJson @{ ok = $false; error = 'windows_location_unavailable'; status = ([string]$w.Status) }
    exit 0
  }
  $lat = $w.Position.Location.Latitude
  $lon = $w.Position.Location.Longitude
  $acc = $w.Position.Location.HorizontalAccuracy
  if ([double]::IsNaN($lat) -or [double]::IsNaN($lon)) {
    Write-GeoJson @{ ok = $false; error = 'windows_coords_nan' }
    exit 0
  }
  Write-GeoJson @{ ok = $true; latitude = $lat; longitude = $lon; accuracy = $acc }
  $w.Stop() | Out-Null
} catch {
  Write-GeoJson @{ ok = $false; error = $_.Exception.Message }
}
`
  try {
    await fs.promises.writeFile(scriptPath, script, 'utf8')
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        timeout: ms + 8000,
        windowsHide: true,
        maxBuffer: 1024 * 64,
      },
    )
    if (signal?.aborted) return { ok: false, error: 'aborted' }
    const line = String(stdout || '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop()
    if (!line) return { ok: false, error: 'windows_location_empty' }
    const parsed = JSON.parse(line) as {
      ok?: boolean
      error?: string
      latitude?: number
      longitude?: number
      accuracy?: number
      status?: string
    }
    if (!parsed.ok) {
      return {
        ok: false,
        error: parsed.error || 'windows_location_failed',
        hint:
          parsed.error === 'windows_location_denied'
            ? '请在 Windows 设置 → 隐私和安全性 → 位置 中开启位置服务，并允许桌面应用访问位置。'
            : 'Windows 位置服务暂不可用。',
      }
    }
    const latitude = Number(parsed.latitude)
    const longitude = Number(parsed.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { ok: false, error: 'invalid_coords' }
    }
    const accuracyMeters =
      typeof parsed.accuracy === 'number' && Number.isFinite(parsed.accuracy)
        ? parsed.accuracy
        : undefined
    return {
      ok: true,
      source: 'device',
      latitude,
      longitude,
      accuracyMeters,
      summary: summarize({
        source: 'device',
        latitude,
        longitude,
        accuracyMeters,
      }),
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      hint: '调用 Windows 位置服务失败。',
    }
  } finally {
    try {
      await fs.promises.unlink(scriptPath)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Chromium navigator.geolocation — usually needs GOOGLE_API_KEY in Electron
 * (Chrome works without one because Google ships keys). Kept as secondary path.
 */
async function fetchChromiumGeolocation(
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GeolocationResult | GeolocationFail> {
  if (signal?.aborted) return { ok: false, error: 'aborted' }

  const partition = `navora-geo-${randomUUID().replace(/-/g, '').slice(0, 10)}`
  const ses = electronSession.fromPartition(partition)
  let grant = false
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'geolocation' && grant)
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'geolocation' && grant)
  })
  grant = true

  const win = new BrowserWindow({
    show: false,
    width: 120,
    height: 120,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  try {
    await win.loadURL('about:blank')
    const ms = Math.min(30000, Math.max(3000, Math.floor(timeoutMs) || 12000))

    const result = await Promise.race([
      win.webContents.executeJavaScript(
        `(() => new Promise((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error('geolocation_unsupported'));
            return;
          }
          const t = setTimeout(() => reject(new Error('geolocation_timeout')), ${ms});
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              clearTimeout(t);
              resolve({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              });
            },
            (err) => {
              clearTimeout(t);
              const msg = err && err.message ? String(err.message) : 'geolocation_denied';
              const code = err && typeof err.code === 'number' ? err.code : -1;
              reject(new Error(msg + ' (code=' + code + ')'));
            },
            { enableHighAccuracy: true, timeout: ${ms}, maximumAge: 60000 }
          );
        }))()`,
        true,
      ) as Promise<{ latitude: number; longitude: number; accuracy?: number }>,
      new Promise<never>((_, reject) => {
        if (!signal) return
        if (signal.aborted) reject(new Error('aborted'))
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
    ])

    const latitude = Number(result.latitude)
    const longitude = Number(result.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { ok: false, error: 'invalid_coords' }
    }
    const accuracyMeters =
      typeof result.accuracy === 'number' && Number.isFinite(result.accuracy)
        ? result.accuracy
        : undefined
    return {
      ok: true,
      source: 'device',
      latitude,
      longitude,
      accuracyMeters,
      summary: summarize({
        source: 'device',
        latitude,
        longitude,
        accuracyMeters,
      }),
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      hint: 'Chromium 网络定位不可用（Electron 通常无 Google 定位密钥；Chrome 自带故可用）。',
    }
  } finally {
    try {
      if (!win.isDestroyed()) win.destroy()
    } catch {
      /* ignore */
    }
    try {
      await ses.clearData()
    } catch {
      /* ignore */
    }
  }
}

async function fetchDeviceGeolocation(
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GeolocationResult | GeolocationFail> {
  const errors: string[] = []

  const winNative = await fetchWindowsNativeGeolocation(timeoutMs, signal)
  if (winNative.ok) return enrichPlace(winNative, signal)
  if (winNative.error !== 'not_windows') {
    errors.push(`windows:${winNative.error}`)
  }

  // Shorter Chromium attempt — usually fails without GOOGLE_API_KEY.
  const chromiumTimeout = Math.min(8000, Math.max(3000, Math.floor(timeoutMs / 2) || 6000))
  const chromium = await fetchChromiumGeolocation(chromiumTimeout, signal)
  if (chromium.ok) return enrichPlace(chromium, signal)
  errors.push(`chromium:${chromium.error}`)

  return {
    ok: false,
    error: errors.join(' | ') || 'device_unavailable',
    hint:
      '设备定位失败。请确认 Windows「位置服务」已开启并允许桌面应用访问。将尝试 IP 大致位置。',
  }
}

export async function resolveGeolocation(opts: {
  prefer?: 'device' | 'ip' | 'auto'
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<GeolocationResult | GeolocationFail> {
  const prefer = opts.prefer || 'auto'
  const timeoutMs = opts.timeoutMs ?? 15000

  if (prefer === 'ip') {
    return fetchIpGeolocation(opts.signal)
  }

  let deviceError: string | undefined
  if (prefer === 'device' || prefer === 'auto') {
    const device = await fetchDeviceGeolocation(timeoutMs, opts.signal)
    if (device.ok) return device
    deviceError = device.error
    if (prefer === 'device') return device
  }

  const ip = await fetchIpGeolocation(opts.signal)
  if (ip.ok) return ip
  return {
    ok: false,
    error: 'geolocation_failed',
    deviceError,
    ipError: ip.error,
    hint:
      '设备定位与 IP 定位均失败。请用户直接提供城市/区域，或检查 Windows 位置权限与网络后重试。',
  }
}
