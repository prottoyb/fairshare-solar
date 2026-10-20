import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { upsertDemoBuilding } from '../prisma/demo-building';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './utils/create-app';
import { resetDb } from './utils/reset-db';

describe('Buildings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let buildingId: string;
  const unknownId = 'does-not-exist';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    buildingId = await resetDb(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('GET /api/buildings', () => {
    it('lists buildings with id, name, splitMode and capacityW only', async () => {
      const res = await http().get('/api/buildings').expect(200);
      expect(res.body).toEqual([
        {
          id: buildingId,
          name: "Prottoy's Apartment",
          splitMode: 'EQUAL',
          capacityW: 10000,
        },
      ]);
    });
  });

  describe('GET /api/buildings/:id', () => {
    it('returns the building with apartments ordered by label', async () => {
      const res = await http().get(`/api/buildings/${buildingId}`).expect(200);
      expect(res.body).toMatchObject({
        id: buildingId,
        name: "Prottoy's Apartment",
        capacityW: 10000,
        splitMode: 'EQUAL',
        intervalMinutes: 5,
      });
      const apartments = (
        res.body as { apartments: { label: string; lotEntitlement: number }[] }
      ).apartments;
      expect(apartments.map((a) => [a.label, a.lotEntitlement])).toEqual([
        ['Unit 1', 10],
        ['Unit 2', 10],
        ['Unit 3', 15],
        ['Unit 4', 15],
        ['Unit 5', 20],
        ['Unit 6', 30],
      ]);
    });

    it('returns 404 for an unknown id', async () => {
      const res = await http().get(`/api/buildings/${unknownId}`).expect(404);
      expect(res.body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: `Building ${unknownId} not found`,
      });
    });
  });

  describe('PATCH /api/buildings/:id', () => {
    it('changes the split mode and persists it', async () => {
      const res = await http()
        .patch(`/api/buildings/${buildingId}`)
        .send({ splitMode: 'ENTITLEMENT' })
        .expect(200);
      expect(res.body).toMatchObject({
        id: buildingId,
        splitMode: 'ENTITLEMENT',
      });
      expect((res.body as { apartments: unknown[] }).apartments).toHaveLength(
        6,
      );

      const stored = await prisma.building.findUniqueOrThrow({
        where: { id: buildingId },
      });
      expect(stored.splitMode).toBe('ENTITLEMENT');
    });

    it.each([
      ['an unknown split mode', { splitMode: 'BY_SIZE' }],
      ['a missing split mode', {}],
      ['a field other than splitMode', { splitMode: 'EQUAL', name: 'Renamed' }],
    ])('returns 400 for %s', async (_name, body) => {
      const res = await http()
        .patch(`/api/buildings/${buildingId}`)
        .send(body)
        .expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });

      const stored = await prisma.building.findUniqueOrThrow({
        where: { id: buildingId },
      });
      expect(stored).toMatchObject({
        name: "Prottoy's Apartment",
        splitMode: 'EQUAL',
      });
    });

    it('names the allowed values when the split mode is invalid', async () => {
      const res = await http()
        .patch(`/api/buildings/${buildingId}`)
        .send({ splitMode: 'BY_SIZE' })
        .expect(400);
      expect(res.body).toMatchObject({
        message: ['splitMode must be one of: EQUAL, ENTITLEMENT'],
      });
    });

    it('returns 404 for an unknown id', async () => {
      await http()
        .patch(`/api/buildings/${unknownId}`)
        .send({ splitMode: 'ENTITLEMENT' })
        .expect(404);
    });
  });

  describe('seed', () => {
    it('is idempotent and keeps the current split mode', async () => {
      await prisma.building.update({
        where: { id: buildingId },
        data: { splitMode: 'ENTITLEMENT' },
      });

      const again = await upsertDemoBuilding(prisma);

      expect(again.id).toBe(buildingId);
      expect(await prisma.building.count()).toBe(1);
      expect(await prisma.apartment.count()).toBe(6);
      const stored = await prisma.building.findUniqueOrThrow({
        where: { id: buildingId },
      });
      expect(stored.splitMode).toBe('ENTITLEMENT');
    });
  });
});
