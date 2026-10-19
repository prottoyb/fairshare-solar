import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { ReadingResult } from '../readings/reading-result';
import { DeviceStatusEvent } from './device-status';

export type ReadingEvent = { deviceId: string; reading: ReadingResult };

/**
 * In-process event bus (SPEC.md §6.3). ReadingsService publishes committed readings;
 * DeviceStatusService and the gateway subscribe. Keeps those services free of
 * imports on each other, so there are no circular dependencies.
 */
@Injectable()
export class LiveEventsService {
  readonly readings$ = new Subject<ReadingEvent>();
  readonly deviceStatus$ = new Subject<DeviceStatusEvent>();

  publishReading(event: ReadingEvent): void {
    this.readings$.next(event);
  }

  publishDeviceStatus(event: DeviceStatusEvent): void {
    this.deviceStatus$.next(event);
  }
}
