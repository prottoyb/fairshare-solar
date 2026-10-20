import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReadingsService } from '../src/readings/readings.service';
import { createTestApp } from './utils/create-app';
import {
  Apt,
  apartmentsOf,
  maxSolarWhFor,
  readingBody,
  ReadingResponse,
  rowCounts,
} from './utils/readings';
import { resetDb } from './utils/reset-db';

describe('Readings (e2e)', () => {
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
  const post = (body: unknown, id = buildingId) =>
    http()
      .post(`/api/buildings/${id}/readings`)
      .send(body as object);

  /** Asserts a 400 and that its message mentions `fragment`. */
  async function expect400(body: unknown, fragment: string | RegExp) {
    const res = await post(body).expect(400);
    const { message } = res.body as { message: string | string[] };
    const text = Array.isArray(message) ? message.join(' | ') : message;
    expect(text).toMatch(fragment);
    expect(await rowCounts(prisma)).toEqual({
      readings: 0,
      demands: 0,
      allocations: 0,
    });
  }

  describe('POST /api/buildings/:id/readings', () => {
    it('201 stores the reading, demands and allocations, and adds up', async () => {
      const res = await post(readingBody(apts)).expect(201);
      const body = res.body as ReadingResponse;

      expect(body).toMatchObject({
        buildingId,
        intervalStart: '2026-10-20T03:05:00.000Z',
        solarWh: 800,
        exportedWh: 200,
        splitModeUsed: 'EQUAL',
        replayed: false,
      });
      expect(body.allocations).toEqual(
        apts.map((a) => ({
          apartmentId: a.id,
          label: a.label,
          lotEntitlement: a.lotEntitlement,
          demandWh: 100,
          allocatedWh: 100,
        })),
      );
      const allocated = body.allocations.reduce((s, a) => s + a.allocatedWh, 0);
      expect(allocated + body.exportedWh).toBe(body.solarWh);

      expect(await rowCounts(prisma)).toEqual({
        readings: 1,
        demands: 6,
        allocations: 6,
      });
      const stored = await prisma.reading.findUniqueOrThrow({
        where: { id: body.readingId },
      });
      expect(stored).toMatchObject({
        buildingId,
        deviceId: 'sim-device-001',
        solarWh: 800,
        exportedWh: 200,
        splitModeUsed: 'EQUAL',
      });
      expect(stored.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('accepts a future interval and any UTC offset', async () => {
      const res = await post(
        readingBody(apts, { intervalStart: '2099-01-01T10:05:00+10:00' }),
      ).expect(201);
      expect((res.body as ReadingResponse).intervalStart).toBe(
        '2099-01-01T00:05:00.000Z',
      );
    });

    describe('idempotency', () => {
      it('200 replays an identical reading without writing anything', async () => {
        const first = (await post(readingBody(apts)).expect(201))
          .body as ReadingResponse;
        const before = await rowCounts(prisma);

        // Same reading, demands reordered and the instant spelt differently.
        const again = readingBody(apts, {
          intervalStart: '2026-10-20T13:05:00+10:00',
        });
        again.demands.reverse();
        const res = await post(again).expect(200);

        expect(res.body).toEqual({ ...first, replayed: true });
        expect(await rowCounts(prisma)).toEqual(before);
      });

      it('409 when the same interval arrives with different numbers', async () => {
        await post(readingBody(apts)).expect(201);
        const res = await post(readingBody(apts, { solarWh: 799 })).expect(409);
        expect(res.body).toEqual({
          statusCode: 409,
          error: 'Conflict',
          message: 'A different reading for this interval already exists',
        });
        expect((await rowCounts(prisma)).readings).toBe(1);
      });

      it('handles two identical readings racing (P2002 path): one 201, one 200', async () => {
        const body = readingBody(apts);
        const results = await Promise.all([post(body), post(body), post(body)]);
        const statuses = results.map((r) => r.status).sort();
        expect(statuses).toEqual([200, 200, 201]);
        const ids = new Set(
          results.map((r) => (r.body as ReadingResponse).readingId),
        );
        expect(ids.size).toBe(1);
        expect(await rowCounts(prisma)).toEqual({
          readings: 1,
          demands: 6,
          allocations: 6,
        });
      });

      it('handles two different readings racing: one 201, one 409', async () => {
        const results = await Promise.all([
          post(readingBody(apts, { solarWh: 500 })),
          post(readingBody(apts, { solarWh: 600 })),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
        expect((await rowCounts(prisma)).readings).toBe(1);
      });

      describe('after losing the race (insert hits P2002)', () => {
        // Make the pre-insert lookup miss once, as if the other request committed
        // between our lookup and our insert. The unique key then throws P2002.
        // findExisting is private; spying on it is the narrowest way in.
        function missNextLookup() {
          const service: unknown = app.get(ReadingsService);
          return jest
            .spyOn(
              service as { findExisting: () => Promise<null> },
              'findExisting',
            )
            .mockResolvedValueOnce(null);
        }

        afterEach(() => jest.restoreAllMocks());

        it('replays an identical reading with 200', async () => {
          const first = (await post(readingBody(apts)).expect(201))
            .body as ReadingResponse;
          const spy = missNextLookup();
          const res = await post(readingBody(apts)).expect(200);
          expect(spy).toHaveBeenCalledTimes(2); // missed lookup + post-P2002 read
          expect(res.body).toEqual({ ...first, replayed: true });
          expect((await rowCounts(prisma)).readings).toBe(1);
        });

        it('returns 409 for a different reading', async () => {
          await post(readingBody(apts)).expect(201);
          const spy = missNextLookup();
          await post(readingBody(apts, { solarWh: 1 })).expect(409);
          expect(spy).toHaveBeenCalledTimes(2);
          expect((await rowCounts(prisma)).readings).toBe(1);
        });
      });
    });

    describe('validation (400)', () => {
      it.each([
        ['…:03:00Z', '2026-10-20T03:03:00.000Z'],
        ['…:05:01Z', '2026-10-20T03:05:01.000Z'],
        ['…:05:00.001Z', '2026-10-20T03:05:00.001Z'],
      ])('rejects a misaligned intervalStart (%s)', async (_name, iso) => {
        const res = await post(
          readingBody(apts, { intervalStart: iso }),
        ).expect(400);
        expect((res.body as { message: string }).message).toBe(
          'intervalStart must align to a 5-minute boundary',
        );
      });

      it('rejects an intervalStart without a timezone', () =>
        expect400(
          readingBody(apts, { intervalStart: '2026-10-20T03:05:00' }),
          /intervalStart must include a timezone/,
        ));

      it('rejects an intervalStart that is not a date', () =>
        expect400(
          readingBody(apts, { intervalStart: 'yesterday' }),
          /intervalStart must be a valid ISO 8601/,
        ));

      it('rejects a missing apartment and names it', () => {
        const body = readingBody(apts);
        body.demands.pop();
        return expect400(body, new RegExp(`missing.*${apts[5].id}`));
      });

      it('rejects an unknown apartment and names it', () => {
        const body = readingBody(apts);
        body.demands[0].apartmentId = 'not-an-apartment';
        return expect400(body, /unknown.*not-an-apartment/);
      });

      it('rejects a duplicate apartment and names it', () => {
        const body = readingBody(apts);
        body.demands[5].apartmentId = apts[0].id;
        return expect400(body, new RegExp(`duplicate.*${apts[0].id}`));
      });

      it('rejects an apartment from another building', async () => {
        const other = await prisma.building.create({
          data: {
            name: 'Other',
            capacityW: 10000,
            apartments: { create: { label: 'Unit X', lotEntitlement: 1 } },
          },
          include: { apartments: true },
        });
        const body = readingBody(apts);
        body.demands[0].apartmentId = other.apartments[0].id;
        await expect400(body, new RegExp(`unknown.*${other.apartments[0].id}`));
      });

      it.each([
        ['float solarWh', { solarWh: 10.5 }, /solarWh must be an integer/],
        [
          'negative solarWh',
          { solarWh: -1 },
          /solarWh must not be less than 0/,
        ],
        ['string solarWh', { solarWh: '100' }, /solarWh must be an integer/],
        ['missing deviceId', { deviceId: undefined }, /deviceId/],
        ['empty deviceId', { deviceId: '' }, /deviceId should not be empty/],
      ])('rejects %s', (_name, override, fragment) =>
        expect400({ ...readingBody(apts), ...override }, fragment),
      );

      it.each([
        ['float demandWh', 10.5, /demandWh must be an integer/],
        ['negative demandWh', -1, /demandWh must not be less than 0/],
        [
          'demandWh over 10000',
          10001,
          /demandWh must not be greater than 10000/,
        ],
      ])('rejects %s', (_name, demandWh, fragment) => {
        const body = readingBody(apts);
        (body.demands[2] as { demandWh: unknown }).demandWh = demandWh;
        return expect400(body, fragment);
      });

      it('accepts solar exactly at capacity for one interval', async () => {
        // capacityW × 5 min, from the seeded building (833 Wh at 10 kW).
        const max = await maxSolarWhFor(prisma, buildingId);
        await post(readingBody(apts, { solarWh: max })).expect(201);
      });

      it('rejects solar over the building capacity for one interval', async () => {
        const max = await maxSolarWhFor(prisma, buildingId);
        await expect400(
          readingBody(apts, { solarWh: max + 1 }),
          new RegExp(`${max + 1}.*${max}`),
        );
      });

      it('rejects empty demands', () =>
        expect400(
          { ...readingBody(apts), demands: [] },
          /demands should not be empty/,
        ));

      it('rejects unknown top-level fields', () =>
        expect400(
          { ...readingBody(apts), exportedWh: 0 },
          /property exportedWh should not exist/,
        ));

      it('rejects unknown nested fields', () => {
        const body = readingBody(apts);
        (body.demands[0] as Record<string, unknown>).allocatedWh = 5;
        return expect400(body, /property allocatedWh should not exist/);
      });

      it('checks alignment before the building exists (§5.7 order)', async () => {
        const res = await post(
          readingBody(apts, { intervalStart: '2026-10-20T03:03:00Z' }),
          'no-such-building',
        ).expect(400);
        expect((res.body as { message: string }).message).toMatch(/align/);
      });

      it('checks capacity before the apartment set (§5.7 order)', async () => {
        const max = await maxSolarWhFor(prisma, buildingId);
        const body = readingBody(apts, { solarWh: max + 1 });
        body.demands.pop();
        const res = await post(body).expect(400);
        expect((res.body as { message: string }).message).toMatch(
          new RegExp(`maximum of ${max} Wh`),
        );
      });
    });

    it('404 for an unknown building', async () => {
      const res = await post(readingBody(apts), 'no-such-building').expect(404);
      expect(res.body).toMatchObject({
        message: 'Building no-such-building not found',
      });
    });
  });

  describe('split mode snapshot (ADR-003)', () => {
    it('PATCH changes only later readings', async () => {
      const scarce = { solarWh: 600, demandWh: [500, 500, 500, 500, 500, 500] };
      const before = (
        await post(
          readingBody(apts, {
            ...scarce,
            intervalStart: '2026-10-20T03:00:00Z',
          }),
        ).expect(201)
      ).body as ReadingResponse;

      await http()
        .patch(`/api/buildings/${buildingId}`)
        .send({ splitMode: 'ENTITLEMENT' })
        .expect(200);

      const after = (
        await post(
          readingBody(apts, {
            ...scarce,
            intervalStart: '2026-10-20T03:05:00Z',
          }),
        ).expect(201)
      ).body as ReadingResponse;

      expect(before.splitModeUsed).toBe('EQUAL');
      expect(before.allocations.map((a) => a.allocatedWh)).toEqual([
        100, 100, 100, 100, 100, 100,
      ]);
      expect(after.splitModeUsed).toBe('ENTITLEMENT');
      // Entitlements 10/10/15/15/20/30 of 100.
      expect(after.allocations.map((a) => a.allocatedWh)).toEqual([
        60, 60, 90, 90, 120, 180,
      ]);

      // The earlier reading is unchanged in storage and in the list.
      const list = (
        await http().get(`/api/buildings/${buildingId}/readings`).expect(200)
      ).body as ReadingResponse[];
      expect(list.map((r) => r.splitModeUsed)).toEqual([
        'ENTITLEMENT',
        'EQUAL',
      ]);
      expect(list[1]).toEqual({ ...before, replayed: false });
    });
  });

  describe('GET /api/buildings/:id/readings', () => {
    async function ingestAt(times: string[]) {
      for (const t of times) {
        await post(readingBody(apts, { intervalStart: t })).expect(201);
      }
    }

    it('lists newest first with allocations, default limit 50', async () => {
      await ingestAt([
        '2026-10-20T03:00:00Z',
        '2026-10-20T03:10:00Z',
        '2026-10-20T03:05:00Z',
      ]);
      const res = await http()
        .get(`/api/buildings/${buildingId}/readings`)
        .expect(200);
      const list = res.body as ReadingResponse[];
      expect(list.map((r) => r.intervalStart)).toEqual([
        '2026-10-20T03:10:00.000Z',
        '2026-10-20T03:05:00.000Z',
        '2026-10-20T03:00:00.000Z',
      ]);
      expect(list[0].allocations.map((a) => a.label)).toEqual(
        apts.map((a) => a.label),
      );
      expect(list.every((r) => r.replayed === false)).toBe(true);
    });

    it('honours limit', async () => {
      await ingestAt(['2026-10-20T03:00:00Z', '2026-10-20T03:05:00Z']);
      const res = await http()
        .get(`/api/buildings/${buildingId}/readings?limit=1`)
        .expect(200);
      expect(
        (res.body as ReadingResponse[]).map((r) => r.intervalStart),
      ).toEqual(['2026-10-20T03:05:00.000Z']);
    });

    it('returns an empty list when there are no readings', async () => {
      await http()
        .get(`/api/buildings/${buildingId}/readings`)
        .expect(200)
        .expect([]);
    });

    it.each(['0', '289', '1.5', 'abc'])('400 for limit=%s', async (limit) => {
      await http()
        .get(`/api/buildings/${buildingId}/readings?limit=${limit}`)
        .expect(400);
    });

    it('404 for an unknown building', async () => {
      await http().get('/api/buildings/no-such-building/readings').expect(404);
    });
  });

  describe('database CHECK constraints', () => {
    it('reject a negative value inserted directly', async () => {
      await expect(
        prisma.$executeRaw`INSERT INTO "Reading" ("id", "buildingId", "deviceId", "intervalStart", "solarWh", "exportedWh", "splitModeUsed", "payloadHash")
          VALUES ('raw-1', ${buildingId}, 'raw-device', now(), -1, 0, 'EQUAL', ${'0'.repeat(64)})`,
      ).rejects.toThrow(/Reading_solarWh_nonnegative/);
    });

    it('reject a zero lot entitlement inserted directly', async () => {
      await expect(
        prisma.$executeRaw`INSERT INTO "Apartment" ("id", "buildingId", "label", "lotEntitlement")
          VALUES ('raw-apt', ${buildingId}, 'Unit Z', 0)`,
      ).rejects.toThrow(/Apartment_lotEntitlement_positive/);
    });
  });
});
