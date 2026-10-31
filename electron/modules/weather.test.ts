import test from 'node:test'
import assert from 'node:assert/strict'
import { readWeather, formatCurrentWeather } from './weather'

const payload = { timezone: 'Asia/Shanghai', current: { time: '2026-10-31T09:00', temperature_2m: 18, weather_code: 3 }, daily: { time: ['2026-10-31'], temperature_2m_max: [20] } }
test('weather uses one structured request for coordinates and preserves source, timestamp and units', async () => {
  const calls: URL[] = []
  const result = await readWeather({ latitude: 30, longitude: 111 }, (async (url, init) => {
    calls.push(new URL(String(url)))
    assert.ok(init?.signal)
    return Response.json(payload)
  }) as typeof fetch)
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.hostname, 'api.open-meteo.com')
  assert.equal(calls[0]?.searchParams.get('latitude'), '30')
  assert.equal(result.sourceUrl, calls[0]?.href)
  assert.deepEqual(result.current, payload.current)
  assert.ok(result.retrievedAt)
})

test('direct answers use returned place and numbers, and never infer a city from coordinates', () => {
  const answer = formatCurrentWeather({ ok: true, ...payload, location: { name: '定位附近' }, currentUnits: { temperature_2m: '°C' }, daily: { ...payload.daily, temperature_2m_min: [12], precipitation_probability_max: [6] } })
  assert.match(answer!, /定位附近/)
  assert.match(answer!, /18°C/)
  assert.match(answer!, /阴/)
  assert.match(answer!, /12°C～20°C/)
  assert.match(answer!, /6%/)
  assert.equal(formatCurrentWeather({ ok: false, error: 'weather_timeout' }), null)
})
test('explicit cities use geocoding and ambiguous locations are not guessed', async () => {
  let calls = 0
  const result = await readWeather({ location: 'Springfield', latitude: NaN, longitude: NaN }, (async () => {
    calls++
    return Response.json({ results: [
      { name: 'Springfield', country: 'US', admin1: 'Illinois', latitude: 39.8, longitude: -89.6 },
      { name: 'Springfield', country: 'US', admin1: 'Missouri', latitude: 37.2, longitude: -93.3 },
    ] })
  }) as typeof fetch)
  assert.equal(result.error, 'ambiguous_location')
  assert.equal(calls, 1)
})
test('a major city is not confused with tiny settlements sharing its name', async () => {
  let calls = 0
  const result = await readWeather({ location: '北京', latitude: NaN, longitude: NaN }, (async () => {
    calls++
    return Response.json(calls === 1 ? { results: [
      { name: '北京', country: '中国', admin1: '北京市', latitude: 39.9, longitude: 116.4, population: 18000000 },
      { name: '北京', country: '中国', admin1: '四川', latitude: 31, longitude: 104 },
    ] } : payload)
  }) as typeof fetch)
  assert.equal(result.ok, true)
  assert.equal(calls, 2)
})
test('invalid data and HTTP failures never become weather observations; cancellation stops immediately', async () => {
  assert.equal((await readWeather({ latitude: 91, longitude: 0 })).error, 'invalid_coordinates')
  assert.equal((await readWeather({ latitude: 30, longitude: 111 }, (async () => Response.json({})) as typeof fetch)).error, 'invalid_weather_response')
  assert.equal((await readWeather({ latitude: 30, longitude: 111 }, (async () => new Response('', { status: 503 })) as typeof fetch)).error, 'weather_http_503')
  const controller = new AbortController()
  const started = Date.now()
  const pending = readWeather({ latitude: 30, longitude: 111, signal: controller.signal }, (async (_url, init) => {
    return await new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  }) as typeof fetch)
  controller.abort()
  await assert.rejects(pending, /aborted/)
  assert.ok(Date.now() - started < 200)
})
