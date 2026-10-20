import { Module } from '@nestjs/common';
import { WeatherController } from './weather.controller';
import {
  OpenMeteoProvider,
  WEATHER_CLOCK,
  WEATHER_PROVIDER,
  type WeatherClock,
} from './weather.provider';
import { WeatherService } from './weather.service';

@Module({
  controllers: [WeatherController],
  providers: [
    WeatherService,
    { provide: WEATHER_PROVIDER, useClass: OpenMeteoProvider },
    { provide: WEATHER_CLOCK, useValue: (() => Date.now()) as WeatherClock },
  ],
  exports: [WeatherService],
})
export class WeatherModule {}
