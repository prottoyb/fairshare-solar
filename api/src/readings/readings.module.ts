import { Module } from '@nestjs/common';
import { BuildingsModule } from '../buildings/buildings.module';
import { ReadingsController } from './readings.controller';
import { ReadingsService } from './readings.service';
import { SummaryService } from './summary.service';

@Module({
  imports: [BuildingsModule],
  controllers: [ReadingsController],
  providers: [ReadingsService, SummaryService],
  exports: [ReadingsService],
})
export class ReadingsModule {}
