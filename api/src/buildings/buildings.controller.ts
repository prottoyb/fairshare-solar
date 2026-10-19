import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  BuildingDetail,
  BuildingsService,
  BuildingSummary,
} from './buildings.service';
import { UpdateBuildingDto } from './dto/update-building.dto';

@Controller('buildings')
export class BuildingsController {
  constructor(private readonly buildings: BuildingsService) {}

  @Get()
  list(): Promise<BuildingSummary[]> {
    return this.buildings.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<BuildingDetail> {
    return this.buildings.get(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBuildingDto,
  ): Promise<BuildingDetail> {
    return this.buildings.setSplitMode(id, dto.splitMode);
  }
}
