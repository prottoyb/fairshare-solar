import { PrismaService } from '../prisma/prisma.service';
import { SimulatorService } from '../simulator/simulator.service';
import { computeStatus, DeviceStatusEvent } from './device-status';
import { DeviceStatusService } from './device-status.service';
import { LiveEventsService } from './live-events.service';

describe('computeStatus', () => {
  const threshold = 6000;

  it('is OFFLINE before any reading', () => {
    expect(computeStatus(null, 1_000_000, threshold)).toBe('OFFLINE');
  });

  it('is ONLINE while the last reading is younger than the threshold', () => {
    expect(computeStatus(1000, 1000, threshold)).toBe('ONLINE');
    expect(computeStatus(1000, 6999, threshold)).toBe('ONLINE');
  });

  it('is STALE once the last reading is threshold old or more', () => {
    expect(computeStatus(1000, 7000, threshold)).toBe('STALE');
    expect(computeStatus(1000, 60_000, threshold)).toBe('STALE');
  });
});

describe('DeviceStatusService (fake timers)', () => {
  const T0 = Date.parse('2026-10-20T00:00:00.000Z');
  let live: LiveEventsService;
  let simulator: { speedMs: number };
  let service: DeviceStatusService;
  let events: DeviceStatusEvent[];

  beforeEach(async () => {
    jest.useFakeTimers({ now: T0 });
    live = new LiveEventsService();
    simulator = { speedMs: 2000 };
    const prisma = {
      building: { findFirst: jest.fn().mockResolvedValue({ id: 'b1' }) },
    };
    service = new DeviceStatusService(
      live,
      simulator as unknown as SimulatorService,
      prisma as unknown as PrismaService,
    );
    events = [];
    live.deviceStatus$.subscribe((e) => events.push(e));
    await service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  /** Publishes a stored reading the way ReadingsService does. */
  function reading() {
    live.publishReading({
      deviceId: 'sim-device-001',
      reading: { buildingId: 'b1' } as never,
    });
  }

  it('starts OFFLINE without emitting', () => {
    expect(service.snapshot()).toEqual([
      {
        buildingId: 'b1',
        deviceId: 'sim-device-001',
        status: 'OFFLINE',
        lastReadingAt: null,
      },
    ]);
    jest.advanceTimersByTime(10_000);
    expect(events).toEqual([]);
  });

  it('goes OFFLINE → ONLINE → STALE → ONLINE, emitting once per change', () => {
    reading();
    expect(events.map((e) => e.status)).toEqual(['ONLINE']);
    expect(events[0].lastReadingAt).toBe('2026-10-20T00:00:00.000Z');

    // Readings every 2 s keep it ONLINE without new events.
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(2000);
      reading();
    }
    expect(events.map((e) => e.status)).toEqual(['ONLINE']);

    // Silence: threshold is 3 × 2000 ms. Still ONLINE just before it…
    jest.advanceTimersByTime(5000);
    expect(events.map((e) => e.status)).toEqual(['ONLINE']);
    // …STALE by the next 1-second check after it.
    jest.advanceTimersByTime(1000);
    expect(events.map((e) => e.status)).toEqual(['ONLINE', 'STALE']);
    expect(events[1].lastReadingAt).toBe('2026-10-20T00:00:10.000Z');

    // Staying stale emits nothing more.
    jest.advanceTimersByTime(60_000);
    expect(events).toHaveLength(2);

    // A new reading brings it back at once.
    reading();
    expect(events.map((e) => e.status)).toEqual(['ONLINE', 'STALE', 'ONLINE']);
  });

  it('uses the simulator speed for the threshold', () => {
    simulator.speedMs = 500;
    reading();
    jest.advanceTimersByTime(1000);
    expect(events.map((e) => e.status)).toEqual(['ONLINE']);
    jest.advanceTimersByTime(1000); // 2 s ≥ 3 × 500 ms
    expect(events.map((e) => e.status)).toEqual(['ONLINE', 'STALE']);
  });

  it('tracks a device it was not told about up front', () => {
    live.publishReading({
      deviceId: 'other-device',
      reading: { buildingId: 'b2' } as never,
    });
    expect(events).toEqual([
      expect.objectContaining({
        buildingId: 'b2',
        deviceId: 'other-device',
        status: 'ONLINE',
      }),
    ]);
  });

  it('stops checking after onModuleDestroy', () => {
    reading();
    service.onModuleDestroy();
    jest.advanceTimersByTime(60_000);
    expect(events.map((e) => e.status)).toEqual(['ONLINE']);
  });
});
