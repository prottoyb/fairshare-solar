import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './utils/create-app';

type WeatherDay = {
  date: string;
  location: {
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  source: 'open-meteo' | 'fallback';
  sunrise: string | null;
  sunset: string | null;
  daylightHours: number | null;
  sunshineHours: number | null;
  hourly: {
    start: string;
    end: string;
    irradianceWm2: number;
    cloudCoverPct: number;
  }[];
};

const location = {
  name: 'Fawkner VIC 3060',
  latitude: -37.707,
  longitude: 144.968,
  timezone: 'Australia/Melbourne',
};

// The weather provider is always a fake here (utils/create-app): no network.
describe('Weather (e2e)', () => {
  describe('with the saved Open-Meteo response', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    const get = (query: string) =>
      request(app.getHttpServer()).get(`/api/weather${query}`);

    it('returns sunrise, sunset, daylight, sunshine and 24 hourly means for a local date', async () => {
      const body = (await get('?date=2026-10-20').expect(200))
        .body as WeatherDay;
      expect(body).toMatchObject({
        date: '2026-10-20',
        location,
        source: 'open-meteo',
        sunrise: '2026-10-19T19:28:40.000Z', // 06:28:40 AEDT
        sunset: '2026-10-20T08:41:50.000Z', // 19:41:50 AEDT
        daylightHours: 13.2,
        sunshineHours: 10.8,
      });
      expect(body.hourly).toHaveLength(24);
      // The first hour is 00:00–01:00 local; values are means over [start, end).
      expect(body.hourly[0]).toMatchObject({
        start: '2026-10-19T13:00:00.000Z',
        end: '2026-10-19T14:00:00.000Z',
      });
      // 12:00–13:00 local: 877 W/m², 52 % cloud.
      expect(body.hourly[12]).toEqual({
        start: '2026-10-20T01:00:00.000Z',
        end: '2026-10-20T02:00:00.000Z',
        irradianceWm2: 877,
        cloudCoverPct: 52,
      });
    });

    it('falls back for a date outside the forecast', async () => {
      const body = (await get('?date=2026-12-01').expect(200))
        .body as WeatherDay;
      expect(body).toEqual({
        date: '2026-12-01',
        location,
        source: 'fallback',
        sunrise: null,
        sunset: null,
        daylightHours: null,
        sunshineHours: null,
        hourly: [],
      });
    });

    it.each([
      ['missing', ''],
      ['not a date', '?date=today'],
      ['impossible day', '?date=2026-02-30'],
      ['with a time', '?date=2026-10-20T00:00:00Z'],
    ])('400 when the date is %s', async (_name, query) => {
      await get(query).expect(400);
    });
  });

  describe('when Open-Meteo is down', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createTestApp({
        fetchForecast: () => Promise.reject(new Error('ECONNREFUSED')),
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers with the fallback source instead of an error', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/weather?date=2026-10-20')
        .expect(200);
      expect((res.body as WeatherDay).source).toBe('fallback');
    });
  });
});
