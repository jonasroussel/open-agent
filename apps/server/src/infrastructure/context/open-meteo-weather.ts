import type { WeatherDay, WeatherOutput } from '@open-agent/shared';

import { PlaceNotFound, type WeatherService } from '../../application/ports/context-services.ts';

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** WMO weather codes, as Open-Meteo documents them, in words the model translates. */
const SKY: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'freezing fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'dense drizzle',
  56: 'freezing drizzle',
  57: 'freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light showers',
  81: 'showers',
  82: 'violent showers',
  85: 'snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'thunderstorm with heavy hail',
};

type Place = { name: string; admin1?: string; country?: string; latitude: number; longitude: number };

type Forecast = {
  current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_min: number[];
    temperature_2m_max: number[];
    precipitation_probability_max: (number | null)[];
    precipitation_sum: (number | null)[];
  };
};

/** Open-Meteo: free, no key, forecasts from the national weather services (Météo-France for France). */
export class OpenMeteoWeather implements WeatherService {
  async forecast(place: string, days: number, locale: string, abortSignal: AbortSignal): Promise<WeatherOutput> {
    const signal = AbortSignal.any([abortSignal, AbortSignal.timeout(10_000)]);
    const geocoding = new URL(GEOCODING_URL);
    geocoding.search = new URLSearchParams({ name: place, count: '1', language: locale, format: 'json' }).toString();
    const found = (await (await check(fetch(geocoding, { signal }))).json()) as { results?: Place[] };
    const where = found.results?.[0];
    if (!where) throw new PlaceNotFound(`No place named "${place}" was found.`);

    const forecast = new URL(FORECAST_URL);
    forecast.search = new URLSearchParams({
      latitude: String(where.latitude),
      longitude: String(where.longitude),
      current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max,precipitation_sum',
      timezone: 'auto',
      forecast_days: String(Math.min(7, Math.max(1, Math.round(days)))),
    }).toString();
    const data = (await (await check(fetch(forecast, { signal }))).json()) as Forecast;

    return {
      place: [where.name, where.admin1, where.country].filter(Boolean).join(', '),
      now: {
        sky: skyOf(data.current.weather_code),
        temperatureC: data.current.temperature_2m,
        feelsLikeC: data.current.apparent_temperature,
        windKmh: data.current.wind_speed_10m,
      },
      days: data.daily.time.map((date, index): WeatherDay => ({
        date,
        sky: skyOf(data.daily.weather_code[index]!),
        minC: data.daily.temperature_2m_min[index]!,
        maxC: data.daily.temperature_2m_max[index]!,
        rainChance: data.daily.precipitation_probability_max[index] ?? null,
        rainMm: data.daily.precipitation_sum[index] ?? null,
      })),
    };
  }
}

function skyOf(code: number): string {
  return SKY[code] ?? 'unknown';
}

async function check(pending: Promise<Response>): Promise<Response> {
  const response = await pending;
  if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}.`);
  return response;
}
