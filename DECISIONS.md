# Decisions

Short records of the trade-offs made while building FairShare Solar. The numbered ADRs from the brief (§8) are filled in as each milestone lands; smaller build-time decisions are logged at the bottom.

## ADR-001 Integer watt-hours everywhere

**Context.** Every interval must add up exactly: allocated + exported = solar, to the watt-hour. Floating-point sums drift, for the same reason ledgers store money as integer cents.

**Decision.** All stored energy is an `Int` number of watt-hours (`solarWh`, `exportedWh`, `demandWh`, `allocatedWh`), and the allocation engine uses integer maths only. Percentages are calculated only when a response is built. The database backs this up with `CHECK` constraints in migration `checks`: energy columns `>= 0`, and `capacityW` and `lotEntitlement` `> 0`.

**Consequences.** Conservation can be asserted with `===` in tests. Bad data is refused by Postgres even if application validation is bypassed. Sub-Wh precision is lost, which is irrelevant at 5-minute building scale.

## ADR-002 Stack pins: NestJS 11 + Prisma 6 + TypeScript 5.9 on local PostgreSQL 17

**Context.** On 2026-10-19 several npm `latest` tags would break a CommonJS NestJS + Jest project: NestJS 12 is ESM-first and defaults to Vitest, `prisma` installs an 8.0 release candidate, Prisma 7 needs driver adapters and `prisma.config.ts`, and TypeScript 7 is not supported by `ts-jest`.

**Decision.** API: `@nestjs/*@11` (11.2.7), `typescript@~5.9.3`, `prisma` and `@prisma/client` pinned exactly to 6.19.3, Jest 30 + ts-jest 29. Database: local PostgreSQL 17 (Windows service), no Docker.

**Consequences.** Matches the Postgres / Jest / Nest stack in the job ad and stays inside a one-day timebox. Prisma warns that `package.json#prisma` is deprecated; that is expected on 6.x. Upgrade path: NestJS 12 (ESM) and Prisma 7 (driver adapter + `prisma.config.ts`) together, then TypeScript 7 once ts-jest supports it.

## ADR-003 Split mode applies from the next interval

**Context.** A building manager can switch between *Equal* and *By lot entitlement* at any time. Recomputing past intervals would change history people may already have seen or billed against.

**Decision.** Ingest reads the building's current `splitMode` inside the insert transaction and stores it on the reading as `splitModeUsed`. `PATCH /api/buildings/:id` only changes the building, never existing readings.

**Consequences.** Past intervals stay exactly as they were computed, and every reading says which rule produced it. An e2e test patches the mode between two readings and checks that only the second one changes. A mode change that commits while an ingest is in flight applies to whichever reading reads it first. That is acceptable at 5-minute granularity.

## ADR-004 One ingestion path

**Context.** Readings arrive over HTTP from devices, and also from the built-in simulator and the seed's history (M5). Separate paths would drift apart in validation and idempotency.

**Decision.** `ReadingsService.ingest(buildingId, dto)` is the only way a reading is stored. It runs the §5.7 checks (alignment, building, capacity, apartment set), the idempotency rules and the transaction. The simulator and seed will build the same `CreateReadingDto` and call it directly.

**Consequences.** Every rule is tested once, through e2e, and holds for every source. Callers that bypass HTTP also bypass the `ValidationPipe`, so they must build DTOs that are already valid. The simulator does this by construction.

## ADR-006 Idempotent ingest

**Context.** Devices retry on timeouts, so the same interval can arrive more than once, sometimes concurrently. Silently keeping either copy of a *different* payload would hide a real device fault.

**Decision.** `Reading` is unique on `(deviceId, intervalStart)` and stores a sha256 `payloadHash` of a canonical form of the reading: ISO UTC time and demands sorted by apartment id. If the same interval arrives again:
- same hash and same building: **200** with the stored result and `replayed: true`, writing nothing;
- anything else: **409**.

If two inserts race, the loser's `P2002` unique-violation is caught, and the same rule is applied against the row that won.

**Consequences.** Retries are safe and conflicts are loud. The e2e suite covers replay (row counts unchanged), 409, real concurrent requests, and a forced lost race that exercises the `P2002` branch deterministically.

## ADR-007 Water-filling allocation model

**Context.** Each 5-minute interval's solar must be split between apartments. The split has to be fair, explainable in one sentence, and add up exactly to the watt-hour (ADR-001). This is my own simplified model for a demo. It is **not** the algorithm used by any commercial product.

**Decision.** `api/src/allocation/allocate.ts` is a pure function. Solar is shared in proportion to weight (1 each for *Equal*, lot entitlement for *By lot entitlement*), but nobody gets more than their demand in that interval. Energy an apartment can't use is shared again among those still wanting more. Only energy nobody can use is exported. All maths is integer, and exact shares are compared as `remaining × weight` vs `unmet × W`. When nobody is capped, each apartment gets the floor of its exact share. The leftover Wh go one each by **largest fractional remainder**, then weight descending, then id ascending.

**Consequences.** Six invariants are tested (I1–I6), plus 2 × 1,000 seeded random cases: conservation, no over-supply, no waste, within 1 Wh of the proportional share when scarce, order-independence, and integer outputs. The model has no memory: an apartment that was short-changed by rounding in one interval isn't compensated in the next, and batteries and tariffs are out of scope.

**Deviation from the brief's §6.1 algorithm (caught by a test).** The brief's version re-ran proportional rounds on rounding dust and gave leftover Wh by weight descending. Written test-first, the I4 test failed on it. At 10 Wh with weights 2/1/1 it returns 6/2/2, while the exact shares are 5/2.5/2.5. With many apartments, a second proportional round could pile several Wh of dust onto one heavy apartment (1.33 Wh off in the random test). Rounding dust is now placed once, by largest remainder. All seven worked examples in the brief give the same results.

## Build-time decisions

- **M1: web toolchain versions come from `create-vue@3.24.0` as generated.** It scaffolded Vue 3.5, Vite 8, **Vitest 4.1** (the brief expected 5) and **TypeScript 6.0** in `web`. The TypeScript-below-7 rule only matters for the API (ts-jest), and vue-tsc 3.3 supports TS 6, so the scaffold's versions are kept rather than hand-editing them. API stays on TypeScript 5.9.3.
- **M1: a minimal `PrismaService` lands early.** `/api/health` must run `SELECT 1`, so the Prisma module/service and a model-less `schema.prisma` exist from M1; models and migrations follow in M3.
- **M1: `prisma generate` runs from the API's `postinstall`.** npm 11's `allow-scripts` can skip dependency install scripts (including `@prisma/client`'s), so the workspace's own `postinstall` guarantees a generated client after `npm install`.
- **M1: lint scripts check, `fix` scripts write.** The scaffolds' `lint` scripts ran with `--fix`; `npm run lint` now only reports (safe for CI), and `npm run fix -w <api|web>` applies fixes.
- **M2: `simulator/prng.ts` lands with the engine.** The engine's property tests need the seeded `mulberry32`, so the pure PRNG (plus `randInt`) and its spec are added now; the simulator itself follows in M5.
- **M2: the engine refuses inputs that would break exact integer maths.** Besides the brief's `RangeError` checks, it throws when `max(solarWh, demandWh) × total weight` exceeds `Number.MAX_SAFE_INTEGER`. Ingest's bounds are far below this; the guard only protects other callers.
- **README "How I used AI" note:** the I4 invariant test caught a rounding flaw in the specified algorithm before any code depended on it (see ADR-007).
- **M3: e2e runs `prisma migrate deploy`, not `migrate reset`, on `fairshare_test`.** Prisma 6.19 refuses `migrate reset` when run by an AI agent unless the user consents for each run. Every e2e run already truncates all tables (`TRUNCATE … RESTART IDENTITY CASCADE`) and re-seeds in `beforeEach`, so applying pending migrations is enough. `npm run test:e2e:reset -w api` still does a full reset of the test DB by hand. The truncate helper refuses to run unless `DATABASE_URL` points at `fairshare_test`.
- **M3: the seed looks up the building by name with `findFirst`, not `upsert`.** `Building.name` isn't unique in the §5.5 schema, and Prisma's `upsert` needs a unique key. Apartments are upserted by `(buildingId, label)`. Re-seeding keeps the building's current split mode. The demo data and upsert live in `prisma/demo-building.ts`, shared by the seed and the e2e reset. `prisma/` is excluded from the Nest build so `dist/main.js` stays at the root.
- **M3: one HTTP setup for the app and the tests.** `src/app.setup.ts` (global prefix, ValidationPipe, shutdown hooks) is called by `main.ts` and by the e2e `createTestApp()`, so tests exercise the same pipeline as production.
- **M3: `GET /api/buildings/:id` also returns `intervalMinutes`.** The dashboard needs the interval length, and it costs nothing to include.
- **M4: `intervalStart` must carry a timezone (`Z` or `±hh:mm`).** `IsISO8601` accepts `2026-10-20T03:05:00`, which JavaScript parses in the server's local zone (Melbourne would shift it by 10–11 hours). Such values are rejected with 400.
- **M4: alignment is checked twice.** §5.7 orders the alignment check before the building lookup, so it checks the fixed 5-minute device grid first, with the brief's exact message. After the building is found, it also checks the building's own `intervalMinutes`; for the demo building both are 5.
- **M4: a replay must match the building too.** The payload hash doesn't include the building, so the same payload posted to another building's URL is a 409, not a replay of the first building's reading.
- **M4: the P2002 branch is tested by forcing a lost race.** Real concurrent requests are also tested, but either path can win. One test makes the pre-insert lookup miss once (a Jest spy on the private `findExisting`), so the insert hits the unique key and the catch branch must produce the replay or 409.
- **M4: the summary uses Prisma `aggregate` and `groupBy` with a relation filter.** The relation filter in `groupBy` works on Prisma 6.19, so no raw SQL was needed. Totals are summed in Postgres. Only one row per apartment comes back to Node.
- **M4: the payload hash sorts apartment ids by code unit, not `localeCompare`,** so the hash can't change with the server's locale.
