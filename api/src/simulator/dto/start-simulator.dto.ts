import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_SPEED_MS, MIN_SPEED_MS } from '../simulator.constants';

export class StartSimulatorDto {
  @IsOptional()
  @IsInt()
  @Min(MIN_SPEED_MS)
  @Max(MAX_SPEED_MS)
  speedMs?: number;
}
