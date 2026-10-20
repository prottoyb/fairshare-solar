import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ReadingsService } from '../readings/readings.service';
import { solarWhFromIrradiance } from './profiles';
import { IntervalWeather, WeatherService } from '../weather/weather.service';
import { GeneratedReading } from './reading-generator';
import { SimulatorService } from './simulator.service';

describe('SimulatorService (fake timers)', () => {
  const NOW = Date.parse('2026-10-20T08:17:00.000Z');
  const building = {
    id: 'b1',
    capacityW: 30000,
    apartments: [
      { id: 'a1', lotEntitlement: 10 },
      { id: 'a2', lotEntitlement: 30 },
    ],
  };
  let latestReading: { intervalStart: Date } | null;
  let ingested: GeneratedReading[];
  let ingest: jest.Mock;
  let intervalWeather: jest.Mock<Promise<IntervalWeather>, [Date, number]>;
  let service: SimulatorService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    latestReading = null;
    ingested = [];
    ingest = jest.fn((_buildingId: string, dto: GeneratedReading) => {
      ingested.push(dto);
      return Promise.resolve({ replayed: false });
    });
    const prisma = {
      building: {
        findFirst: jest.fn(() => Promise.resolve(building)),
      },
      reading: { findFirst: jest.fn(() => Promise.resolve(latestReading)) },
    };
    const config = { get: () => '42' };
    intervalWeather = jest.fn<Promise<IntervalWeather>, [Date, number]>(
      // no weather: clear-sky fallback, no heating/cooling
      () => Promise.resolve({ irradianceWm2: null, temperatureC: null }),
    );
    service = new SimulatorService(
      prisma as unknown as PrismaService,
      { ingest } as unknown as ReadingsService,
      { intervalWeather } as unknown as WeatherService,
      config as unknown as ConfigService,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  const times = () => ingested.map((r) => r.intervalStart);

  it('reports stopped with the default speed before starting', async () => {
    expect(await service.status()).toEqual({
      running: false,
      speedMs: 2000,
      buildingId: 'b1',
      simulatedTime: null,
    });
  });

  it('takes solar from the weather for each interval', async () => {
    intervalWeather.mockResolvedValue({
      irradianceWm2: 1000,
      temperatureC: 20,
    });
    await service.start(1000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(intervalWeather).toHaveBeenCalledWith(
      new Date('2026-10-19T13:00:00.000Z'),
      5,
    );
    expect(ingested[0].solarWh).toBe(solarWhFromIrradiance(30000, 1000, 5));
  });

  it('starts at today 00:00 Melbourne time when the device has no readings', async () => {
    // NOW is 19:17 AEDT on 20 October; local midnight was 13:00 UTC on the 19th.
    const status = await service.start();
    expect(status).toMatchObject({
      running: true,
      speedMs: 2000,
      simulatedTime: '2026-10-19T13:00:00.000Z',
    });
    await jest.advanceTimersByTimeAsync(6000);
    expect(times()).toEqual([
      '2026-10-19T13:00:00.000Z',
      '2026-10-19T13:05:00.000Z',
      '2026-10-19T13:10:00.000Z',
    ]);
    expect(ingest).toHaveBeenCalledWith('b1', expect.any(Object));
  });

  it('resumes at the interval after the latest stored reading', async () => {
    latestReading = { intervalStart: new Date('2026-10-21T13:55:00.000Z') };
    await service.start(1000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(times()).toEqual(['2026-10-21T14:00:00.000Z']);
  });

  it('does nothing when started again at the same speed', async () => {
    await service.start(2000);
    await jest.advanceTimersByTimeAsync(1000);
    await service.start(2000); // must not reset the timer
    await jest.advanceTimersByTimeAsync(1000);
    expect(ingested).toHaveLength(1);
  });

  it('restarts the timer at a new speed and keeps the clock', async () => {
    await service.start(2000);
    await jest.advanceTimersByTimeAsync(2000);
    const status = await service.start(500);
    expect(status).toMatchObject({ running: true, speedMs: 500 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(times()).toEqual([
      '2026-10-19T13:00:00.000Z',
      '2026-10-19T13:05:00.000Z',
      '2026-10-19T13:10:00.000Z',
    ]);
  });

  it('stops sending after stop()', async () => {
    await service.start(1000);
    await jest.advanceTimersByTimeAsync(2000);
    const status = await service.stop();
    expect(status.running).toBe(false);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(ingested).toHaveLength(2);
  });

  it('skips a tick while the previous ingest is still running', async () => {
    let finish: () => void = () => {};
    ingest.mockImplementationOnce((_id: string, dto: GeneratedReading) => {
      ingested.push(dto);
      return new Promise((resolve) => {
        finish = () => resolve({ replayed: false });
      });
    });
    await service.start(500);
    await jest.advanceTimersByTimeAsync(2000); // 4 ticks, first one still busy
    expect(ingested).toHaveLength(1);
    finish();
    await jest.advanceTimersByTimeAsync(500);
    expect(times()).toEqual([
      '2026-10-19T13:00:00.000Z',
      '2026-10-19T13:05:00.000Z',
    ]);
  });

  it('logs and carries on when an interval fails', async () => {
    ingest.mockRejectedValueOnce(new Error('boom'));
    const warn = jest
      .spyOn(
        (service as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => {});
    await service.start(1000);
    await jest.advanceTimersByTimeAsync(3000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledTimes(3);
    expect(await service.status()).toMatchObject({
      running: true,
      simulatedTime: '2026-10-19T13:15:00.000Z',
    });
  });

  it('clears its timer in onModuleDestroy', async () => {
    await service.start(1000);
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5000);
    expect(ingested).toHaveLength(0);
  });

  it('refuses to start without a building', async () => {
    const prisma = {
      building: { findFirst: jest.fn(() => Promise.resolve(null)) },
      reading: { findFirst: jest.fn() },
    };
    const empty = new SimulatorService(
      prisma as unknown as PrismaService,
      { ingest } as unknown as ReadingsService,
      { intervalWeather } as unknown as WeatherService,
      { get: () => undefined } as unknown as ConfigService,
    );
    await expect(empty.start()).rejects.toBeInstanceOf(NotFoundException);
    expect(empty.running).toBe(false);
  });
});
