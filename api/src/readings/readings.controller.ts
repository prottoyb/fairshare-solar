import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
// Namespace import: a type in a decorated signature can't be a named import
// under isolatedModules + emitDecoratorMetadata.
import * as express from 'express';
import { CreateReadingDto } from './dto/create-reading.dto';
import { ListReadingsQuery } from './dto/list-readings.query';
import { SummaryQuery } from './dto/summary.query';
import { ReadingResult } from './reading-result';
import { ReadingsService } from './readings.service';
import { DailySummary, SummaryService } from './summary.service';

@Controller('buildings/:buildingId')
export class ReadingsController {
  constructor(
    private readonly readings: ReadingsService,
    private readonly summaries: SummaryService,
  ) {}

  /** 201 for a new reading, 200 for a replay of one already stored. */
  @Post('readings')
  async ingest(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateReadingDto,
    @Res({ passthrough: true }) res: express.Response,
  ): Promise<ReadingResult> {
    const result = await this.readings.ingest(buildingId, dto);
    res.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }

  @Get('readings')
  list(
    @Param('buildingId') buildingId: string,
    @Query() query: ListReadingsQuery,
  ): Promise<ReadingResult[]> {
    return this.readings.list(buildingId, query.limit);
  }

  @Get('summary')
  summary(
    @Param('buildingId') buildingId: string,
    @Query() query: SummaryQuery,
  ): Promise<DailySummary> {
    return this.summaries.daily(buildingId, query.date);
  }
}
