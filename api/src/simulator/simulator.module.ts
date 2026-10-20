import { Module } from '@nestjs/common';
import { ReadingsModule } from '../readings/readings.module';
import { WeatherModule } from '../weather/weather.module';
import { SimulatorController } from './simulator.controller';
import { SimulatorService } from './simulator.service';

@Module({
  imports: [ReadingsModule, WeatherModule],
  controllers: [SimulatorController],
  providers: [SimulatorService],
  exports: [SimulatorService],
})
export class SimulatorModule {}
