import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { BuildingsModule } from './buildings/buildings.module';
import { LiveEventsModule } from './live/live-events.module';
import { LiveModule } from './live/live.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReadingsModule } from './readings/readings.module';
import { SimulatorModule } from './simulator/simulator.module';
import { WeatherModule } from './weather/weather.module';

// Fail fast at startup rather than on the first query.
function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.DATABASE_URL !== 'string' || config.DATABASE_URL === '') {
    throw new Error(
      'DATABASE_URL is not set. Copy api/.env.example to api/.env and fill it in.',
    );
  }
  return config;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    LiveEventsModule,
    BuildingsModule,
    ReadingsModule,
    WeatherModule,
    SimulatorModule,
    LiveModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
