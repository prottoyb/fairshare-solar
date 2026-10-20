import { Controller, Get, Query } from '@nestjs/common';
import { WeatherQuery } from './dto/weather.query';
import { toWeatherDayView, WeatherDayView } from './weather-view';
import { WeatherService } from './weather.service';

@Controller('weather')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  /** Weather for the site on a Melbourne local date (open-meteo or fallback). */
  @Get()
  async day(@Query() query: WeatherQuery): Promise<WeatherDayView> {
    return toWeatherDayView(query.date, await this.weather.forDate(query.date));
  }
}
