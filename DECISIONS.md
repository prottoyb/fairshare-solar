# Decisions

Short records of the trade-offs made while building FairShare Solar. The numbered ADRs from the brief (§8) are filled in as each milestone lands; smaller build-time decisions are logged at the bottom.

## ADR-002 Stack pins: NestJS 11 + Prisma 6 + TypeScript 5.9 on local PostgreSQL 17

**Context.** On 2026-10-19 several npm `latest` tags would break a CommonJS NestJS + Jest project: NestJS 12 is ESM-first and defaults to Vitest, `prisma` installs an 8.0 release candidate, Prisma 7 needs driver adapters and `prisma.config.ts`, and TypeScript 7 is not supported by `ts-jest`.

**Decision.** API: `@nestjs/*@11` (11.2.7), `typescript@~5.9.3`, `prisma` and `@prisma/client` pinned exactly to 6.19.3, Jest 30 + ts-jest 29. Database: local PostgreSQL 17 (Windows service), no Docker.

**Consequences.** Matches the Postgres / Jest / Nest stack in the job ad and stays inside a one-day timebox. Prisma warns that `package.json#prisma` is deprecated; that is expected on 6.x. Upgrade path: NestJS 12 (ESM) and Prisma 7 (driver adapter + `prisma.config.ts`) together, then TypeScript 7 once ts-jest supports it.

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
