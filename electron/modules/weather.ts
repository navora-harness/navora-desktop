/** Structured weather reads: no browser navigation or page-load waits. */
type Coordinates = { latitude: number; longitude: number }
type Place = Coordinates & { name?: string; admin1?: string; country?: string; population?: number }
type WeatherOptions = Coordinates & { location?: string; placeName?: string; days?: number; signal?: AbortSignal }
type WeatherPayload = {
  results?: Place[]
  timezone?: string
  current?: Record<string, unknown>
  current_units?: Record<string, string>
  daily?: { time?: string[]; [key: string]: unknown }
  daily_units?: Record<string, string>
}

function validCoordinates(p: Coordinates) {
  return Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 &&
    Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180
}

export async function readWeather(
  options: WeatherOptions,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  // One deadline covers geocoding, response headers AND body. Never retry a slow page.
  const signal = AbortSignal.any([AbortSignal.timeout(6500), ...(options.signal ? [options.signal] : [])])
  async function json(url: URL) {
    const response = await fetcher(url, { signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`weather_http_${response.status}`)
    return await response.json() as WeatherPayload
  }
  try {
    let place: Place = options
    if (options.location?.trim()) {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
      url.search = new URLSearchParams({ name: options.location.trim(), count: '5', language: 'zh' }).toString()
      const data = await json(url)
      const matches: Place[] = (Array.isArray(data.results) ? data.results : []).filter(validCoordinates)
      if (!matches.length) return { ok: false, error: 'location_not_found', hint: '请提供城市和省份/国家。' }
      // Distinct cities with the same name must be clarified rather than silently guessed.
      const first = matches[0]!
      const dominantCity = (first.population || 0) >= 500000 && matches.slice(1).every(p => (first.population || 0) >= 10 * (p.population || 0))
      if (!dominantCity && matches.some(p => p.name === first.name && (p.country !== first.country || p.admin1 !== first.admin1))) {
        return { ok: false, error: 'ambiguous_location', candidates: matches, hint: '请用户指定省份或国家。' }
      }
      place = first
    }
    if (!validCoordinates(place)) return { ok: false, error: 'invalid_coordinates' }
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.search = new URLSearchParams({
      latitude: String(place.latitude), longitude: String(place.longitude), timezone: 'auto', forecast_days: String(Math.min(7, Math.max(1, Math.floor(options.days || 1)))),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    }).toString()
    const data = await json(url)
    if (!data.current?.time || !Number.isFinite(data.current.temperature_2m) ||
        !Array.isArray(data.daily?.time) || !data.daily.time.length) throw new Error('invalid_weather_response')
    return {
      ok: true, source: 'Open-Meteo', sourceUrl: url.href, retrievedAt: new Date().toISOString(),
      location: { latitude: place.latitude, longitude: place.longitude, name: place.name || options.placeName || options.location || '定位附近', region: place.admin1, country: place.country }, timezone: data.timezone,
      current: data.current, currentUnits: data.current_units, daily: data.daily, dailyUnits: data.daily_units,
      note: '数值为天气模型估算/预报，非气象站实测。weather_code 使用 WMO 编码。回复注明地点、日期和来源；IP 定位仅代表大致位置。地点只使用返回的名称；只有坐标时称定位附近，不得自行猜测城市。只回答用户所问日期。',
    }
  } catch (error) {
    if (options.signal?.aborted) throw new Error('aborted')
    return { ok: false, error: signal.aborted ? 'weather_timeout' : (error instanceof Error ? error.message : 'weather_failed'),
      hint: '天气源暂不可用。简短说明失败，可换来源一次；不要反复等待同一页面，不得编造天气。' }
  }
}

/** A factual current-weather answer needs no model inference after retrieval. */
export function formatCurrentWeather(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const value = result as Record<string, any>
  if (value.ok !== true || !value.current || !Number.isFinite(value.current.temperature_2m)) return null
  const conditions: Record<number, string> = {
    0: '晴', 1: '大部晴朗', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
    51: '小毛毛雨', 53: '毛毛雨', 55: '较强毛毛雨', 56: '冻毛毛雨', 57: '较强冻毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '较强冻雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '小阵雨', 81: '阵雨', 82: '强阵雨',
    85: '小阵雪', 86: '强阵雪', 95: '雷暴', 96: '雷暴伴小冰雹', 99: '雷暴伴较强冰雹',
  }
  const current = value.current
  const daily = value.daily || {}
  const units = value.currentUnits || {}
  const dailyUnits = value.dailyUnits || {}
  const name = String(value.location?.name || '定位附近').replace(/[\r\n*<>\[\]]/g, '')
  const number = (n: unknown, unit: unknown) => typeof n === 'number' && Number.isFinite(n) ? `${n}${String(unit || '')}` : ''
  const date = String(daily.time?.[0] || current.time).slice(0, 10)
  const lines = [`**${name} · ${date}**`, '', `${conditions[Number(current.weather_code)] || '天气数据'}，当前 **${number(current.temperature_2m, units.temperature_2m || '°C')}**${number(current.apparent_temperature, units.apparent_temperature || '°C') ? `，体感 ${number(current.apparent_temperature, units.apparent_temperature || '°C')}` : ''}。`]
  const low = number(daily.temperature_2m_min?.[0], dailyUnits.temperature_2m_min || '°C')
  const high = number(daily.temperature_2m_max?.[0], dailyUnits.temperature_2m_max || '°C')
  const rain = number(daily.precipitation_probability_max?.[0], dailyUnits.precipitation_probability_max || '%')
  if (low && high) lines.push(`今日 ${low}～${high}${rain ? `，最高降雨概率 ${rain}` : ''}。`)
  lines.push('', `数据时间 ${String(current.time).replace('T', ' ')}（${String(value.timezone || '当地时间')}）。来源：Open-Meteo 天气模型估算。${value.locationSource === 'ip' ? '位置来自 IP，仅供参考。' : name === '定位附近' ? '未解析到城市名称，使用设备坐标附近的预报。' : ''}`)
  return lines.join('\n')
}
