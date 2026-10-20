import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ShareDto {
  @IsString()
  @IsNotEmpty()
  apartmentId!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  sharePct!: number;
}

/** Body of `PUT /api/buildings/:id/shares` (ADR-010). */
export class SetSharesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ShareDto)
  shares!: ShareDto[];
}
