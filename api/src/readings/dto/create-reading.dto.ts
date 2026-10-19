import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const MAX_DEMAND_WH = 10_000;

export class DemandDto {
  @IsString()
  @IsNotEmpty()
  apartmentId!: string;

  @IsInt()
  @Min(0)
  @Max(MAX_DEMAND_WH)
  demandWh!: number;
}

export class CreateReadingDto {
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @IsISO8601({ strict: true })
  // Without an offset, JS parses the time in the server's local zone.
  @Matches(/T.*(Z|[+-]\d{2}:\d{2})$/, {
    message: 'intervalStart must include a timezone (e.g. "Z")',
  })
  intervalStart!: string;

  @IsInt()
  @Min(0)
  solarWh!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DemandDto)
  demands!: DemandDto[];
}
