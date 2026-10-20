import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DEFAULT_SHARES_PCT } from '../prisma/demo-building';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './utils/create-app';
import {
  Apt,
  apartmentsOf,
  readingBody,
  ReadingResponse,
} from './utils/readings';
import { resetDb } from './utils/reset-db';

type BuildingDetail = {
  id: string;
  splitMode: string;
  apartments: {
    id: string;
    label: string;
    lotEntitlement: number;
    customSharePct: number | null;
  }[];
};

describe('Owner-set shares (e2e)', () => {
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
  const put = (body: unknown, id = buildingId) =>
    http()
      .put(`/api/buildings/${id}/shares`)
      .send(body as object);
  const shares = (pcts: number[]) => ({
    shares: apts.map((a, i) => ({ apartmentId: a.id, sharePct: pcts[i] })),
  });
  const currentShares = async () =>
    (
      await prisma.apartment.findMany({
        where: { buildingId },
        orderBy: { label: 'asc' },
        select: { customSharePct: true },
      })
    ).map((a) => a.customSharePct);

  /** A 400 that mentions `fragment` and leaves the stored shares unchanged. */
  async function expect400(body: unknown, fragment: RegExp) {
    const before = await currentShares();
    const res = await put(body).expect(400);
    const { message } = res.body as { message: string | string[] };
    expect(Array.isArray(message) ? message.join(' | ') : message).toMatch(
      fragment,
    );
    expect(await currentShares()).toEqual(before);
  }

  describe('GET /api/buildings/:id', () => {
    it('includes each apartment’s owner share (seeded default)', async () => {
      const res = await http().get(`/api/buildings/${buildingId}`).expect(200);
      const body = res.body as BuildingDetail;
      expect(body.apartments.map((a) => a.customSharePct)).toEqual(
        DEFAULT_SHARES_PCT,
      );
      expect(DEFAULT_SHARES_PCT.reduce((s, x) => s + x, 0)).toBe(100);
    });
  });

  describe('PUT /api/buildings/:id/shares', () => {
    it('stores valid shares and returns the building with its apartments', async () => {
      const pcts = [10, 10, 10, 20, 20, 30];
      const res = await put(shares(pcts)).expect(200);
      const body = res.body as BuildingDetail;
      expect(body.id).toBe(buildingId);
      expect(body.apartments.map((a) => a.customSharePct)).toEqual(pcts);
      expect(await currentShares()).toEqual(pcts);
    });

    it('accepts the entries in any order', async () => {
      const body = shares([5, 5, 10, 10, 30, 40]);
      body.shares.reverse();
      await put(body).expect(200);
      expect(await currentShares()).toEqual([5, 5, 10, 10, 30, 40]);
    });

    it.each([
      [
        'below 100',
        [15, 15, 15, 15, 20, 15],
        /total exactly 100 % \(got 95 %\)/,
      ],
      [
        'above 100',
        [20, 20, 20, 20, 20, 20],
        /total exactly 100 % \(got 120 %\)/,
      ],
    ])('400 when the total is %s', (_name, pcts, fragment) =>
      expect400(shares(pcts), fragment),
    );

    it('400 for a missing apartment, naming it', () => {
      const body = shares([20, 20, 20, 20, 20, 0]);
      body.shares.pop();
      return expect400(body, new RegExp(`missing: ${apts[5].id}`));
    });

    it('400 for an unknown apartment, naming it', () => {
      const body = shares(DEFAULT_SHARES_PCT);
      body.shares[0].apartmentId = 'not-an-apartment';
      return expect400(body, /unknown: not-an-apartment/);
    });

    it('400 for a duplicate apartment, naming it', () => {
      const body = shares(DEFAULT_SHARES_PCT);
      body.shares[5].apartmentId = apts[0].id;
      return expect400(body, new RegExp(`duplicate: ${apts[0].id}`));
    });

    it.each([
      ['a non-integer', 15.5, /sharePct must be an integer/],
      ['zero', 0, /sharePct must not be less than 1/],
      ['over 100', 101, /sharePct must not be greater than 100/],
      ['a string', '15', /sharePct must be an integer/],
    ])('400 for %s share', (_name, value, fragment) => {
      const body = shares(DEFAULT_SHARES_PCT) as {
        shares: { apartmentId: string; sharePct: unknown }[];
      };
      body.shares[2].sharePct = value;
      return expect400(body, fragment);
    });

    it('400 for an empty list or unknown fields', async () => {
      await expect400({ shares: [] }, /shares should not be empty/);
      await expect400(
        { ...shares(DEFAULT_SHARES_PCT), splitMode: 'CUSTOM' },
        /property splitMode should not exist/,
      );
    });

    it('404 for an unknown building', async () => {
      const res = await put(
        shares(DEFAULT_SHARES_PCT),
        'no-such-building',
      ).expect(404);
      expect((res.body as { message: string }).message).toBe(
        'Building no-such-building not found',
      );
    });
  });

  describe('PATCH /api/buildings/:id to CUSTOM', () => {
    it('switches to owner-set shares', async () => {
      const res = await http()
        .patch(`/api/buildings/${buildingId}`)
        .send({ splitMode: 'CUSTOM' })
        .expect(200);
      expect((res.body as BuildingDetail).splitMode).toBe('CUSTOM');
    });

    it('400 if any apartment has no share, naming it', async () => {
      await prisma.apartment.update({
        where: { id: apts[2].id },
        data: { customSharePct: null },
      });
      const res = await http()
        .patch(`/api/buildings/${buildingId}`)
        .send({ splitMode: 'CUSTOM' })
        .expect(400);
      expect((res.body as { message: string }).message).toMatch(
        /missing: Unit 3/,
      );
      const stored = await prisma.building.findUniqueOrThrow({
        where: { id: buildingId },
      });
      expect(stored.splitMode).toBe('EQUAL');
    });
  });

  describe('allocation in CUSTOM mode', () => {
    const scarce = { solarWh: 600, demandWh: [500, 500, 500, 500, 500, 500] };
    const post = (intervalStart: string) =>
      http()
        .post(`/api/buildings/${buildingId}/readings`)
        .send(readingBody(apts, { ...scarce, intervalStart }))
        .expect(201)
        .then((r) => r.body as ReadingResponse);

    it('follows the owner shares exactly when solar is scarce', async () => {
      const pcts = [10, 10, 10, 20, 20, 30];
      await put(shares(pcts)).expect(200);
      await http()
        .patch(`/api/buildings/${buildingId}`)
        .send({ splitMode: 'CUSTOM' })
        .expect(200);

      const reading = await post('2026-10-20T03:00:00Z');
      expect(reading.splitModeUsed).toBe('CUSTOM');
      // 600 Wh in proportion to the shares; nobody's demand is covered.
      expect(reading.allocations.map((a) => a.allocatedWh)).toEqual(
        pcts.map((p) => (scarce.solarWh * p) / 100),
      );
    });

    it('applies a share change from the next interval; earlier readings keep theirs', async () => {
      await http()
        .patch(`/api/buildings/${buildingId}`)
        .send({ splitMode: 'CUSTOM' })
        .expect(200);
      const before = await post('2026-10-20T03:00:00Z'); // seeded defaults
      expect(before.allocations.map((a) => a.allocatedWh)).toEqual(
        DEFAULT_SHARES_PCT.map((p) => (scarce.solarWh * p) / 100),
      );

      await put(shares([5, 5, 10, 10, 30, 40])).expect(200);
      const after = await post('2026-10-20T03:05:00Z');
      expect(after.allocations.map((a) => a.allocatedWh)).toEqual(
        [5, 5, 10, 10, 30, 40].map((p) => (scarce.solarWh * p) / 100),
      );

      const list = (
        await http().get(`/api/buildings/${buildingId}/readings`).expect(200)
      ).body as ReadingResponse[];
      const earlier = list.find((r) => r.readingId === before.readingId)!;
      expect(earlier.allocations).toEqual(before.allocations);
    });
  });

  describe('database CHECK', () => {
    it.each([0, 101])(
      'rejects a share of %s inserted directly',
      async (value) => {
        await expect(
          prisma.$executeRaw`UPDATE "Apartment" SET "customSharePct" = ${value} WHERE "id" = ${apts[0].id}`,
        ).rejects.toThrow(/Apartment_customSharePct_range/);
      },
    );
  });
});
