# Decisions

Short records of the trade-offs made while building FairShare Solar: the seven architecture decisions (ADR-001 to ADR-007, Context / Decision / Consequences), then a milestone-by-milestone log of smaller build-time decisions.

## ADR-001 Integer watt-hours everywhere

**Context.** Every interval must add up exactly: allocated + exported = solar, to the watt-hour. Floating-point sums drift, for the same reason ledgers store money as integer cents.

**Decision.** All stored energy is an `Int` number of watt-hours (`solarWh`, `exportedWh`, `demandWh`, `allocatedWh`), and the allocation engine uses integer maths only. Percentages are calculated only when a response is built. The database backs this up with `CHECK` constraints in migration `checks`: energy columns `>= 0`, and `capacityW` and `lotEntitlement` `> 0`.

**Consequences.** Conservation can be asserted with `===` in tests. Bad data is refused by Postgres even if application validation is bypassed. Sub-Wh precision is lost, which is irrelevant at 5-minute building scale.

## ADR-002 Stack pins: NestJS 11 + Prisma 6 + TypeScript 5.9 on local PostgreSQL 17

**Context.** On 2026-10-19 several npm `latest` tags would break a CommonJS NestJS + Jest project: NestJS 12 is ESM-first and defaults to Vitest, `prisma` installs an 8.0 release candidate, Prisma 7 needs driver adapters and `prisma.config.ts`, and TypeScript 7 is not supported by `ts-jest`.

**Decision.** API: `@nestjs/*@11` (11.2.7), `typescript@~5.9.3`, `prisma` and `@prisma/client` pinned exactly to 6.19.3, Jest 30 + ts-jest 29. Database: local PostgreSQL 17 (Windows service), no Docker.

**Consequences.** A mainstream Postgres / Jest / CommonJS NestJS stack that stays inside a one-day timebox. Prisma warns that `package.json#prisma` is deprecated; that is expected on 6.x. Upgrade path: NestJS 12 (ESM) and Prisma 7 (driver adapter + `prisma.config.ts`) together, then TypeScript 7 once ts-jest supports it.

## ADR-003 Split mode applies from the next interval

**Context.** A building manager can switch between *Equal* and *By lot entitlement* at any time. Recomputing past intervals would change history people may already have seen or billed against.

**Decision.** Ingest reads the building's current `splitMode` inside the insert transaction and stores it on the reading as `splitModeUsed`. `PATCH /api/buildings/:id` only changes the building, never existing readings.

**Consequences.** Past intervals stay exactly as they were computed, and every reading says which rule produced it. An e2e test patches the mode between two readings and checks that only the second one changes. A mode change that commits while an ingest is in flight applies to whichever reading reads it first. That is acceptable at 5-minute granularity.

## ADR-004 One ingestion path

**Context.** Readings arrive over HTTP from devices, and also from the built-in simulator and the seed's history (M5). Separate paths would drift apart in validation and idempotency.

**Decision.** `ReadingsService.ingest(buildingId, dto)` is the only way a reading is stored. It runs the §5.7 checks (alignment, building, capacity, apartment set), the idempotency rules and the transaction. The simulator and the seed's history both get their readings from one seeded `ReadingGenerator` (built on the pure profile functions) and call `ingest()` directly. Committed readings are published on an in-process `LiveEventsService` bus, which the device-status service and the Socket.IO gateway subscribe to.

**Consequences.** Every rule is tested once, through e2e, and holds for every source. Callers that bypass HTTP also bypass the `ValidationPipe`, so they must build DTOs that are already valid. The generator does this by construction, and a unit test checks it for a whole day. A simulated or seeded reading goes through the same idempotency and the same `reading` event as one from a device.

## ADR-005 Duplicated DTO types in the web app

**Context.** The Vue app needs the API's response shapes: building, reading, summary, simulator status and the WebSocket events. A shared types package would need its own build, TypeScript project references and workspace wiring across a CommonJS NestJS app (TS 5.9) and an ESM Vite app (TS 6).

**Decision.** `web/src/types.ts` duplicates the shapes by hand, with a comment pointing here. The API stays the source of truth: its e2e tests assert the exact response bodies.

**Consequences.** No extra build step for a one-day demo. The cost is drift: an API change also needs a change in `types.ts`, and nothing enforces it at compile time. With more than one client, I'd generate the types from an OpenAPI document instead (see README "What I'd do next").

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

**Deviation from the SPEC.md §6.1 algorithm (caught by a test).** The spec's version re-ran proportional rounds on rounding dust and gave leftover Wh by weight descending. Written test-first, the I4 test failed on it. At 10 Wh with weights 2/1/1 it returns 6/2/2, while the exact shares are 5/2.5/2.5. With many apartments, a second proportional round could pile several Wh of dust onto one heavy apartment (1.33 Wh off in the random test). Rounding dust is now placed once, by largest remainder. All seven worked examples in the spec give the same results.

## Build-time decisions

- **M1: web toolchain versions come from `create-vue@3.24.0` as generated.** It scaffolded Vue 3.5, Vite 8, **Vitest 4.1** (the spec expected 5) and **TypeScript 6.0** in `web`. The TypeScript-below-7 rule only matters for the API (ts-jest), and vue-tsc 3.3 supports TS 6, so the scaffold's versions are kept rather than hand-editing them. API stays on TypeScript 5.9.3.
- **M1: a minimal `PrismaService` lands early.** `/api/health` must run `SELECT 1`, so the Prisma module/service and a model-less `schema.prisma` exist from M1; models and migrations follow in M3.
- **M1: `prisma generate` runs from the API's `postinstall`.** npm 11's `allow-scripts` can skip dependency install scripts (including `@prisma/client`'s), so the workspace's own `postinstall` guarantees a generated client after `npm install`.
- **M1: lint scripts check, `fix` scripts write.** The scaffolds' `lint` scripts ran with `--fix`; `npm run lint` now only reports (safe for CI), and `npm run fix -w <api|web>` applies fixes.
- **M2: `simulator/prng.ts` lands with the engine.** The engine's property tests need the seeded `mulberry32`, so the pure PRNG (plus `randInt`) and its spec are added now; the simulator itself follows in M5.
- **M2: the engine refuses inputs that would break exact integer maths.** Besides the spec's `RangeError` checks, it throws when `max(solarWh, demandWh) × total weight` exceeds `Number.MAX_SAFE_INTEGER`. Ingest's bounds are far below this; the guard only protects other callers.
- **README "How I used AI" note:** the I4 invariant test caught a rounding flaw in the specified algorithm before any code depended on it (see ADR-007).
- **M3: e2e runs `prisma migrate deploy`, not `migrate reset`, on `fairshare_test`.** Prisma 6.19 refuses `migrate reset` when run by an AI agent unless the user consents for each run. Every e2e run already truncates all tables (`TRUNCATE … RESTART IDENTITY CASCADE`) and re-seeds in `beforeEach`, so applying pending migrations is enough. `npm run test:e2e:reset -w api` still does a full reset of the test DB by hand. The truncate helper refuses to run unless `DATABASE_URL` points at `fairshare_test`.
- **M3: the seed looks up the building by name with `findFirst`, not `upsert`.** `Building.name` isn't unique in the §5.5 schema, and Prisma's `upsert` needs a unique key. Apartments are upserted by `(buildingId, label)`. Re-seeding keeps the building's current split mode. The demo data and upsert live in `prisma/demo-building.ts`, shared by the seed and the e2e reset. `prisma/` is excluded from the Nest build so `dist/main.js` stays at the root.
- **M3: one HTTP setup for the app and the tests.** `src/app.setup.ts` (global prefix, ValidationPipe, shutdown hooks) is called by `main.ts` and by the e2e `createTestApp()`, so tests exercise the same pipeline as production.
- **M3: `GET /api/buildings/:id` also returns `intervalMinutes`.** The dashboard needs the interval length, and it costs nothing to include.
- **M4: `intervalStart` must carry a timezone (`Z` or `±hh:mm`).** `IsISO8601` accepts `2026-10-20T03:05:00`, which JavaScript parses in the server's local zone (Melbourne would shift it by 10–11 hours). Such values are rejected with 400.
- **M4: alignment is checked twice.** §5.7 orders the alignment check before the building lookup, so it checks the fixed 5-minute device grid first, with the spec's exact message. After the building is found, it also checks the building's own `intervalMinutes`; for the demo building both are 5.
- **M4: a replay must match the building too.** The payload hash doesn't include the building, so the same payload posted to another building's URL is a 409, not a replay of the first building's reading.
- **M4: the P2002 branch is tested by forcing a lost race.** Real concurrent requests are also tested, but either path can win. One test makes the pre-insert lookup miss once (a Jest spy on the private `findExisting`), so the insert hits the unique key and the catch branch must produce the replay or 409.
- **M4: the summary uses Prisma `aggregate` and `groupBy` with a relation filter.** The relation filter in `groupBy` works on Prisma 6.19, so no raw SQL was needed. Totals are summed in Postgres. Only one row per apartment comes back to Node.
- **M4: the payload hash sorts apartment ids by code unit, not `localeCompare`,** so the hash can't change with the server's locale.
- **M5: one seeded `ReadingGenerator` for the simulator and the seed.** It holds the PRNG, the cloud random walk and each apartment's base load, and calls the pure profile functions. Same seed and apartments in, same readings out; a unit test checks a whole day is valid ingest input.
- **M5: `simulatedTime` in `/api/simulator/status` is the start of the next interval to be sent** (UTC), or `null` before the first start. The dashboard can use its date for the summary.
- **M5: a failed simulator tick still advances the clock.** Otherwise a single 409 (for example, an interval already stored with other data) would repeat forever. The failure is logged as a warning.
- **M5: device status is tracked per device id.** The simulator's device is registered as OFFLINE at startup (for the first building) so a new dashboard sees it before any reading. Other devices appear on their first reading. The stale threshold is always 3 × the simulator's current speed (§6.3), even for non-simulator devices.
- **M5: the seed counts 409s instead of failing.** If the simulator has already written different data for yesterday's UTC date (its clock runs a simulated day about every 10 real minutes), those intervals are reported as conflicts and skipped. A re-run otherwise gives 288 replays (tested e2e).
- **M5: shared limits live in `common/limits.ts`.** `INTERVAL_MINUTES` and `MAX_DEMAND_WH` are needed by the pure profiles and by validation, so they moved out of the DTO and service into a framework-free file.
- **M5: the gateway types its server and socket by the one method it uses (`emit`).** This avoids importing types from `socket.io`, which is only a transitive dependency of `@nestjs/platform-socket.io`, and avoids the isolatedModules decorator-metadata issue.
- **M5: the e2e suite checks the live bus, not a real socket.** `socket.io-client` isn't an API dependency, so e2e subscribes to `LiveEventsService`: one event per new reading, none for a replay or 409. The real socket path (Vite proxy → gateway → client) was smoke-tested by hand: OFFLINE → ONLINE → readings → STALE about 4 s after stopping at 1 s speed.
- **M6: ADR-005 in practice.** `web/src/types.ts` duplicates the API's response shapes by hand; `web/src/api/client.ts` wraps `fetch` with relative `/api` URLs and turns non-2xx responses into an `ApiError` carrying the API's own message.
- **M6: `SplitModeToggle` takes a `save` function prop** (App passes `useBuilding().setSplitMode`). The component owns the optimistic radio, the "Applies from the next interval" note and the revert-on-failure; the composable owns the PATCH. The component test passes the real API client and mocks `fetch`, so it checks the actual request.
- **M6: the dashboard shows the latest stored interval on load.** Until the first live `reading` arrives, App fetches `GET /readings?limit=1` so a reload doesn't blank the figures and bars. "Waiting for first reading…" appears only when the building has no readings at all.
- **M6: the summary date is the simulated date** (the latest reading's UTC date, else the simulator's `simulatedTime`). The summary refetches when that date changes, every 10 live readings, and on the Refresh button.
- **M6: bars share one scale per interval** (the largest demand), so apartments are comparable. Each bar is a `role="meter"` with `aria-valuemax` = demand and `aria-valuenow` = allocated, plus the numbers as visible text.
- **M6: the device-status pill is `role="status"` with text, colour and a `title`.** It's focusable and has an `aria-label` that includes the last reading time, so the tooltip information also reaches keyboard and screen-reader users.
- **M6: responsive layout uses CSS grid areas.** One column on phones, two on tablets, three at ≥ 75rem, so at 1280×720 the controls, live figures and all six bars are above the fold for the video. Checked at 375 px: no horizontal page scroll; the summary table scrolls inside its own container.
- **M6: F13 (sparkline) not built.** It is first in the cut order and was not needed for J1–J3.
- **M6 follow-up: Vue DevTools is opt-in.** The scaffold's `vite-plugin-vue-devtools` puts a floating button on every page, which would appear in the demo video. It now loads only when `VUE_DEVTOOLS=1` is set for the dev server; the dependency stays, with no package changes.
- **M6 follow-up: keep 30 kW and the spec's demand; time the video to the morning.** With the §5.6/§6.2 numbers, solar exceeds demand from about 08:15 to late afternoon. When every demand is met, both split modes give identical results, so the Equal/Entitlement difference is only visible while solar is scarce. One simulated day (seed 42, real generator and engine; "visible" means some apartment differs by at least 15 Wh between modes):

  | Option | Visible in (of 143 daylight intervals) | Largest difference | Spec change |
  |---|---|---|---|
  | **A. As specified: 30 kW, §6.2 demand (chosen)** | 32 (06:15–08:10, 17:10–17:45) | 91 Wh | none |
  | B. 10 kW system | 38 | 55 Wh | §5.6 |
  | E. 8 kW system | 43 | 44 Wh | §5.6 |
  | C. 6 kW system | 52, in fragments | 36 Wh | §5.6 |
  | D. 30 kW, demand ×3 | 55 (06:15–08:50, 16:00–17:45) | 162 Wh | §6.2 |

  A smaller system lengthens the scarce window but shrinks the differences on screen; only higher demand improves both. Option A keeps the spec intact. The difference is largest at 06:30–07:40: at 07:20, for example, Unit 6 (entitlement 30) gets 113 Wh on Equal vs 204 Wh on Entitlement, and Unit 1 (entitlement 10) gets 114 vs 68. **Decision:** record the video segment in the **06:15–07:00** simulated window. Run at 1 s until about 06:15, stop, then record: Start → switch to Entitlement at about 06:30 → Stop at about 07:00 → Stale. The README's video notes describe this.
- **M7: the Cypress smoke test starts from a known state.** Before each run (and after), it stops the simulator and sets the split mode back to Equal through the API. It also waits until the pill is *not* Online before clicking Start, so "Online within 5 s" really proves the start worked. It ran green twice in a row against `npm.cmd run dev`.
- **M7: CI uses throwaway Postgres credentials.** The `postgres:17` service container is created with a CI-only user and password, and the workflow writes `api/.env.test` from them. The developer's password never leaves their machine. `CYPRESS_INSTALL_BINARY=0` skips the Cypress download, since Cypress in CI is a stretch goal (F11).
- **M7: `docs/dashboard.png` is a Cypress viewport screenshot** (1280×720) in Entitlement mode at 07:05 simulated, when solar is scarce. The bars split 56/56/84/84/112/167 Wh for entitlements 10/10/15/15/20/30. It was taken with a one-off capture spec that was not committed.
