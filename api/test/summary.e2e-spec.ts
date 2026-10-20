import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './utils/create-app';
import { Apt, apartmentsOf, readingBody } from './utils/readings';
import { resetDb } from './utils/reset-db';

type Summary = {
  date: string;
  building: {
    intervals: number;
    solarWh: number;
    allocatedWh: number;
    exportedWh: number;
    demandWh: number;
    solarUsedPct: number;
  };
  apartments: {
    apartmentId: string;
    label: string;
    lotEntitlement: number;
    demandWh: number;
    allocatedWh: number;
    selfSufficiencyPct: number;
    shareOfSolarPct: number;
  }[];
};

describe('Summary (e2e)', () => {
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
  const ingest = (overrides: Parameters<typeof readingBody>[1]) =>
    http()
      .post(`/api/buildings/${buildingId}/readings`)
      .send(readingBody(apts, overrides))
      .expect(201);
  const summary = (date: string, id = buildingId) =>
    http().get(`/api/buildings/${id}/summary?date=${date}`);

  it('matches hand-calculated totals for two known readings', async () => {
    // EQUAL split, 6 apartments.
    // A: solar 600, demands 50/100/100/100/100/200 (650).
    //    Shares 100 each → Unit 1 capped at 50; 550 left over 5 → 110 each →
    //    Units 2–5 capped at 100; Unit 6 gets the last 150. Export 0.
    await ingest({
      intervalStart: '2026-10-20T03:00:00Z',
      solarWh: 600,
      demandWh: [50, 100, 100, 100, 100, 200],
    });
    // B: solar 800, demands 100 each (600) → 100 each, export 200.
    await ingest({ intervalStart: '2026-10-20T03:05:00Z', solarWh: 800 });
    // Just outside the Melbourne local day (AEDT, UTC+11) on both sides: ignored.
    await ingest({ intervalStart: '2026-10-19T12:55:00Z', solarWh: 800 }); // 23:55 on the 19th
    await ingest({ intervalStart: '2026-10-20T13:00:00Z', solarWh: 800 }); // 00:00 on the 21st

    const res = await summary('2026-10-20').expect(200);
    const body = res.body as Summary;

    expect(body.date).toBe('2026-10-20');
    expect(body.building).toEqual({
      intervals: 2,
      solarWh: 1400,
      allocatedWh: 1200,
      exportedWh: 200,
      demandWh: 1250,
      solarUsedPct: 85.7, // 1200 / 1400
    });
    const row = (label: string) =>
      body.apartments.find((a) => a.label === label);
    expect(body.apartments.map((a) => a.label)).toEqual(
      apts.map((a) => a.label),
    );
    expect(row('Unit 1')).toEqual({
      apartmentId: apts[0].id,
      label: 'Unit 1',
      lotEntitlement: 10,
      demandWh: 150,
      allocatedWh: 150,
      selfSufficiencyPct: 100,
      shareOfSolarPct: 12.5, // 150 / 1200
    });
    for (const label of ['Unit 2', 'Unit 3', 'Unit 4', 'Unit 5']) {
      expect(row(label)).toMatchObject({
        demandWh: 200,
        allocatedWh: 200,
        selfSufficiencyPct: 100,
        shareOfSolarPct: 16.7, // 200 / 1200 = 16.67
      });
    }
    expect(row('Unit 6')).toMatchObject({
      lotEntitlement: 30,
      demandWh: 300,
      allocatedWh: 250,
      selfSufficiencyPct: 83.3, // 250 / 300
      shareOfSolarPct: 20.8, // 250 / 1200
    });
  });

  it('uses the Melbourne local day, so a UTC-midnight reading counts on the local day', async () => {
    // 00:00 local on the 20th is 13:00 UTC on the 19th; 23:55 local is 12:55 UTC.
    await ingest({ intervalStart: '2026-10-19T13:00:00Z', solarWh: 100 });
    await ingest({ intervalStart: '2026-10-20T12:55:00Z', solarWh: 100 });
    const body = (await summary('2026-10-20').expect(200)).body as Summary;
    expect(body.building.intervals).toBe(2);
    expect((await summary('2026-10-19').expect(200)).body).toMatchObject({
      building: { intervals: 0 },
    });
  });

  it('returns zeros for every apartment on a day with no readings', async () => {
    const res = await summary('2026-10-20').expect(200);
    const body = res.body as Summary;
    expect(body.building).toEqual({
      intervals: 0,
      solarWh: 0,
      allocatedWh: 0,
      exportedWh: 0,
      demandWh: 0,
      solarUsedPct: 0,
    });
    expect(body.apartments).toHaveLength(6);
    for (const a of body.apartments) {
      expect(a).toMatchObject({
        demandWh: 0,
        allocatedWh: 0,
        selfSufficiencyPct: 0,
        shareOfSolarPct: 0,
      });
    }
  });

  it('gives 0 % (not NaN) for zero denominators', async () => {
    // Night: no solar but demand. Allocated 0, solar 0.
    await ingest({ intervalStart: '2026-10-20T00:00:00Z', solarWh: 0 });
    const body = (await summary('2026-10-20').expect(200)).body as Summary;
    expect(body.building).toMatchObject({
      solarWh: 0,
      demandWh: 600,
      solarUsedPct: 0,
    });
    expect(body.apartments[0]).toMatchObject({
      selfSufficiencyPct: 0,
      shareOfSolarPct: 0,
    });
  });

  it('ignores readings from other buildings', async () => {
    const other = await prisma.building.create({
      data: {
        name: 'Other',
        capacityW: 30000,
        apartments: { create: { label: 'Unit 1', lotEntitlement: 1 } },
      },
      include: { apartments: true },
    });
    await http()
      .post(`/api/buildings/${other.id}/readings`)
      .send({
        deviceId: 'other-device',
        intervalStart: '2026-10-20T03:00:00Z',
        solarWh: 500,
        demands: [{ apartmentId: other.apartments[0].id, demandWh: 100 }],
      })
      .expect(201);
    const body = (await summary('2026-10-20').expect(200)).body as Summary;
    expect(body.building.intervals).toBe(0);
  });

  it.each([
    ['missing', ''],
    ['not a date', 'date=today'],
    ['impossible day', 'date=2026-02-30'],
    ['with a time', 'date=2026-10-20T00:00:00Z'],
  ])('400 when the date is %s', async (_name, query) => {
    await http()
      .get(`/api/buildings/${buildingId}/summary?${query}`)
      .expect(400);
  });

  it('404 for an unknown building', async () => {
    await summary('2026-10-20', 'no-such-building').expect(404);
  });
});
