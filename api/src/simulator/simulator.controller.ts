import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { StartSimulatorDto } from './dto/start-simulator.dto';
import { SimulatorService, SimulatorStatus } from './simulator.service';

@Controller('simulator')
export class SimulatorController {
  constructor(private readonly simulator: SimulatorService) {}

  @Post('start')
  @HttpCode(200)
  start(@Body() dto: StartSimulatorDto): Promise<SimulatorStatus> {
    return this.simulator.start(dto?.speedMs);
  }

  @Post('stop')
  @HttpCode(200)
  stop(): Promise<SimulatorStatus> {
    return this.simulator.stop();
  }

  @Get('status')
  status(): Promise<SimulatorStatus> {
    return this.simulator.status();
  }
}
