import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { SIM_DEVICE_ID } from '../simulator/simulator.constants';
import { SimulatorService } from '../simulator/simulator.service';
import {
  computeStatus,
  DeviceStatus,
  DeviceStatusEvent,
  STALE_AFTER_INTERVALS,
} from './device-status';
import { LiveEventsService } from './live-events.service';

type TrackedDevice = {
  buildingId: string;
  deviceId: string;
  lastReadingAt: number | null; // wall clock, ms
  status: DeviceStatus;
};

/**
 * Tracks each device's last reading (wall clock) and publishes `device-status`
 * only when a status changes (brief §6.3). Rechecked every second and on every
 * new reading. The stale threshold follows the simulator's current speed.
 */
@Injectable()
export class DeviceStatusService implements OnModuleInit, OnModuleDestroy {
  private readonly devices = new Map<string, TrackedDevice>();
  private timer: NodeJS.Timeout | null = null;
  private subscription: Subscription | null = null;

  constructor(
    private readonly live: LiveEventsService,
    private readonly simulator: SimulatorService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscription = this.live.readings$.subscribe((e) =>
      this.recordReading(e.deviceId, e.reading.buildingId),
    );
    // So the dashboard can show the simulator's device as OFFLINE before any reading.
    const building = await this.prisma.building.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (building && !this.devices.has(SIM_DEVICE_ID)) {
      this.devices.set(SIM_DEVICE_ID, {
        buildingId: building.id,
        deviceId: SIM_DEVICE_ID,
        lastReadingAt: null,
        status: 'OFFLINE',
      });
    }
    this.timer = setInterval(() => this.refresh(), 1000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  get thresholdMs(): number {
    return STALE_AFTER_INTERVALS * this.simulator.speedMs;
  }

  /** Called for every newly stored reading (never for replays). */
  recordReading(deviceId: string, buildingId: string, now = Date.now()): void {
    const device = this.devices.get(deviceId) ?? {
      buildingId,
      deviceId,
      lastReadingAt: null,
      status: 'OFFLINE' as DeviceStatus,
    };
    device.buildingId = buildingId;
    device.lastReadingAt = now;
    this.devices.set(deviceId, device);
    this.refresh(now);
  }

  /** Recomputes every device and publishes the ones whose status changed. */
  refresh(now = Date.now()): void {
    for (const device of this.devices.values()) {
      const status = computeStatus(device.lastReadingAt, now, this.thresholdMs);
      if (status !== device.status) {
        device.status = status;
        this.live.publishDeviceStatus(toEvent(device));
      }
    }
  }

  /** Current status of every known device, for a newly connected client. */
  snapshot(): DeviceStatusEvent[] {
    return [...this.devices.values()].map(toEvent);
  }
}

function toEvent(device: TrackedDevice): DeviceStatusEvent {
  return {
    buildingId: device.buildingId,
    deviceId: device.deviceId,
    status: device.status,
    lastReadingAt:
      device.lastReadingAt === null
        ? null
        : new Date(device.lastReadingAt).toISOString(),
  };
}
