import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { loadOpenMeteoFixture } from '../../src/weather/__fixtures__/load-fixture';
import {
  WEATHER_CLOCK,
  WEATHER_PROVIDER,
  type WeatherProvider,
} from '../../src/weather/weather.provider';

/** Serves the saved Fawkner response (18–26 October 2026). Never the network. */
export const fixtureWeather: WeatherProvider = {
  fetchForecast: () => Promise.resolve(loadOpenMeteoFixture()),
};

/** The weather clock e2e tests run at: 12:00 in Fawkner on 20 October 2026. */
export const WEATHER_NOW = Date.parse('2026-10-20T01:00:00.000Z');

/**
 * The real app with the weather provider replaced by a fake, so no e2e test
 * (locally or in CI) ever calls Open-Meteo.
 */
export async function createTestApp(
  weather: WeatherProvider = fixtureWeather,
): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(WEATHER_PROVIDER)
    .useValue(weather)
    .overrideProvider(WEATHER_CLOCK)
    .useValue(() => WEATHER_NOW)
    .compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}
