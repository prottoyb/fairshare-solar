# Decisions

Short records of the trade-offs made while building FairShare Solar. The numbered ADRs from the brief (§8) are filled in as each milestone lands; smaller build-time decisions are logged at the bottom.

## ADR-002 Stack pins: NestJS 11 + Prisma 6 + TypeScript 5.9 on local PostgreSQL 17

**Context.** On 2026-10-19 several npm `latest` tags would break a CommonJS NestJS + Jest project: NestJS 12 is ESM-first and defaults to Vitest, `prisma` installs an 8.0 release candidate, Prisma 7 needs driver adapters and `prisma.config.ts`, and TypeScript 7 is not supported by `ts-jest`.

**Decision.** API: `@nestjs/*@11` (11.2.7), `typescript@~5.9.3`, `prisma` and `@prisma/client` pinned exactly to 6.19.3, Jest 30 + ts-jest 29. Database: local PostgreSQL 17 (Windows service), no Docker.

**Consequences.** Matches the Postgres / Jest / Nest stack in the job ad and stays inside a one-day timebox. Prisma warns that `package.json#prisma` is deprecated; that is expected on 6.x. Upgrade path: NestJS 12 (ESM) and Prisma 7 (driver adapter + `prisma.config.ts`) together, then TypeScript 7 once ts-jest supports it.

## Build-time decisions

- **M1: web toolchain versions come from `create-vue@3.24.0` as generated.** It scaffolded Vue 3.5, Vite 8, **Vitest 4.1** (the brief expected 5) and **TypeScript 6.0** in `web`. The TypeScript-below-7 rule only matters for the API (ts-jest), and vue-tsc 3.3 supports TS 6, so the scaffold's versions are kept rather than hand-editing them. API stays on TypeScript 5.9.3.
- **M1: a minimal `PrismaService` lands early.** `/api/health` must run `SELECT 1`, so the Prisma module/service and a model-less `schema.prisma` exist from M1; models and migrations follow in M3.
- **M1: `prisma generate` runs from the API's `postinstall`.** npm 11's `allow-scripts` can skip dependency install scripts (including `@prisma/client`'s), so the workspace's own `postinstall` guarantees a generated client after `npm install`.
- **M1: lint scripts check, `fix` scripts write.** The scaffolds' `lint` scripts ran with `--fix`; `npm run lint` now only reports (safe for CI), and `npm run fix -w <api|web>` applies fixes.
