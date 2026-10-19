import { SplitMode } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateBuildingDto {
  @IsEnum(SplitMode, {
    message: `splitMode must be one of: ${Object.values(SplitMode).join(', ')}`,
  })
  splitMode!: SplitMode;
}
