import { Module } from '@nestjs/common';
import { SimulatorModule } from '../simulator/simulator.module';
import { DeviceStatusService } from './device-status.service';
import { LiveGateway } from './live.gateway';

@Module({
  imports: [SimulatorModule],
  providers: [DeviceStatusService, LiveGateway],
  exports: [DeviceStatusService],
})
export class LiveModule {}
