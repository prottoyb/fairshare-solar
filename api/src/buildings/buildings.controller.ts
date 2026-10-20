import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import {
  BuildingDetail,
  BuildingsService,
  BuildingSummary,
} from './buildings.service';
import { SetSharesDto } from './dto/set-shares.dto';
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

  /** Owner-set shares (ADR-010). No auth in this demo; see README. */
  @Put(':id/shares')
  setShares(
    @Param('id') id: string,
    @Body() dto: SetSharesDto,
  ): Promise<BuildingDetail> {
    return this.buildings.setShares(id, dto.shares);
  }
}
