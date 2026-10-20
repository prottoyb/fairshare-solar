import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { seedHistory } from '../prisma/seed-history';
import { DeviceStatusService } from '../src/live/device-status.service';
import {
  LiveEventsService,
  ReadingEvent,
} from '../src/live/live-events.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReadingsService } from '../src/readings/readings.service';
import { createTestApp } from './utils/create-app';
import { Apt, apartmentsOf, readingBody, rowCounts } from './utils/readings';
import { resetDb } from './utils/reset-db';

// These tests never start the simulator timer; only the Cypress smoke test does.
describe('Live events, simulator API and seed history (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let buildingId: string;
  let apts: Apt[];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    buildingId = await resetDb(prisma);
    apts = await apartmentsOf(prisma, buildingId);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('reading events', () => {
    it('publishes once per new reading and never for a replay or a 409', async () => {
      const events: ReadingEvent[] = [];
      const sub = app
        .get(LiveEventsService)
        .readings$.subscribe((e) => events.push(e));
      try {
        const post = (body: unknown) =>
          http()
            .post(`/api/buildings/${buildingId}/readings`)
            .send(body as object);

        const first = await post(readingBody(apts)).expect(201);
        await post(readingBody(apts)).expect(200);
        await post(readingBody(apts, { solarWh: 1 })).expect(409);

        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({
          deviceId: 'sim-device-001',
          reading: first.body as unknown,
        });
      } finally {
        sub.unsubscribe();
      }
    });

    it('marks the device ONLINE when a new reading is stored', async () => {
      await http()
        .post(`/api/buildings/${buildingId}/readings`)
        .send(readingBody(apts))
        .expect(201);
      const status = app
        .get(DeviceStatusService)
        .snapshot()
        .find((s) => s.deviceId === 'sim-device-001');
      expect(status).toMatchObject({ buildingId, status: 'ONLINE' });
      expect(status?.lastReadingAt).toEqual(expect.any(String));
    });
  });

  describe('simulator API (without starting it)', () => {
    it('GET /api/simulator/status reports it stopped', async () => {
      const res = await http().get('/api/simulator/status').expect(200);
      expect(res.body).toMatchObject({
        running: false,
        speedMs: 2000,
        simulatedTime: null,
      });
    });

    it.each([[499], [10_001], [1500.5], ['fast']])(
      'POST /api/simulator/start rejects speedMs=%j with 400',
      async (speedMs) => {
        await http().post('/api/simulator/start').send({ speedMs }).expect(400);
        const status = await http().get('/api/simulator/status').expect(200);
        expect((status.body as { running: boolean }).running).toBe(false);
      },
    );

    it('POST /api/simulator/start rejects unknown fields with 400', async () => {
      await http().post('/api/simulator/start').send({ seed: 1 }).expect(400);
    });

    it('POST /api/simulator/stop is safe when not running', async () => {
      const res = await http().post('/api/simulator/stop').expect(200);
      expect((res.body as { running: boolean }).running).toBe(false);
    });
  });

  describe('seed history (F12)', () => {
    const now = new Date('2026-10-20T09:00:00.000Z');
    // 288 sequential ingests through the real path exceed Jest's 5 s default on CI runners.
    const SEED_TIMEOUT_MS = 30_000;

    it(
      "stores yesterday's 288 intervals through ingest, and replays on re-run",
      async () => {
        const readings = app.get(ReadingsService);

        const first = await seedHistory(prisma, readings, buildingId, 42, now);
        expect(first).toEqual({
          date: '2026-10-19',
          created: 288,
          replayed: 0,
          conflicts: 0,
        });
        const counts = await rowCounts(prisma);
        expect(counts).toEqual({
          readings: 288,
          demands: 288 * 6,
          allocations: 288 * 6,
        });

        const again = await seedHistory(prisma, readings, buildingId, 42, now);
        expect(again).toMatchObject({
          created: 0,
          replayed: 288,
          conflicts: 0,
        });
        expect(await rowCounts(prisma)).toEqual(counts);

        // The summary for that day adds up to the watt-hour.
        const summary = (
          await http()
            .get(`/api/buildings/${buildingId}/summary?date=2026-10-19`)
            .expect(200)
        ).body as {
          building: {
            intervals: number;
            solarWh: number;
            allocatedWh: number;
            exportedWh: number;
          };
        };
        expect(summary.building.intervals).toBe(288);
        expect(summary.building.solarWh).toBeGreaterThan(0);
        expect(summary.building.allocatedWh + summary.building.exportedWh).toBe(
          summary.building.solarWh,
        );
      },
      SEED_TIMEOUT_MS,
    );

    it(
      'counts a conflicting interval instead of failing',
      async () => {
        // Different simulator data already stored for yesterday 00:00.
        await http()
          .post(`/api/buildings/${buildingId}/readings`)
          .send(
            readingBody(apts, {
              intervalStart: '2026-10-19T00:00:00.000Z',
              solarWh: 7,
            }),
          )
          .expect(201);
        const result = await seedHistory(
          prisma,
          app.get(ReadingsService),
          buildingId,
          42,
          now,
        );
        expect(result).toMatchObject({ created: 287, conflicts: 1 });
      },
      SEED_TIMEOUT_MS,
    );
  });
});
