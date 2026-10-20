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

## ADR-008 Solar from real weather for Fawkner; site-local time

**Context.** The made-up clear-sky curve with a random cloud walk looked plausible but wasn't real. The building now has a real location, so solar can be estimated from public weather data. Apartment demand stays simulated.

**Decision.**
- **Site.** The building is "Prottoy's Apartment" in Fawkner VIC 3060. Only the suburb centre is used, never a street address: lat −37.707, lon 144.968, time zone Australia/Melbourne, all in `api/src/common/site.ts`. Open-Meteo snaps this to its nearest model grid cell (−37.715, 144.987).
- **Source.** The Open-Meteo forecast API: free, no API key, CC BY 4.0, called with Node's built-in `fetch` (no new dependency). The request asks for `shortwave_radiation` and `cloud_cover` hourly, `sunrise`, `sunset`, `sunshine_duration` and `daylight_duration` daily, `timezone=Australia/Melbourne`, `timeformat=unixtime`, `past_days=2` and `forecast_days=7`. One real response (requested 2026-10-20, covering 18–26 October) is saved as `api/src/weather/__fixtures__/open-meteo-fawkner.json`.
- **Timing convention.** Per the Open-Meteo docs, hourly `shortwave_radiation` is "Shortwave solar radiation as average of the preceding hour". A value stamped 13:00 is the mean over 12:00–13:00, so it is placed at **12:30**. The saved response agrees: sunrise on 20 October is 06:28 and the 07:00 value is only 5 W/m²; sunset is 19:41 and the 20:00 value is 17 W/m².
- **Model.** Implemented in `profiles.ts` (pure, test-first). Hour means are interpolated linearly between their centres to the **midpoint** of each 5-minute interval, then `solarWh = clamp(round(capacityW × irradiance / 1000 × 0.8 × 5 / 60), 0, max per interval)`.
  - Irradiance (W/m² on a horizontal surface) is the physical input to PV output, and it already includes cloud. Sunshine duration is only a yes/no count of bright minutes.
  - **0.8 is the performance ratio** (`PERFORMANCE_RATIO`): the share of rated output that reaches the building after inverter, wiring, temperature and soiling losses, a typical rooftop value. Panel tilt and orientation are ignored.
- **Local time.** `intervalStart` stays stored in UTC. Demand bumps, the simulator's start time, the seed's "yesterday" and the daily summary use the **Melbourne local** day and hour, via `Intl.DateTimeFormat` (`common/local-time.ts`, no date library). Local days have 288 intervals, except 276 when daylight saving starts (2026-10-04) and 300 when it ends (2026-04-05); both are tested.
- **Reliability.** `WeatherService` caches in memory per local date. One response fills nine dates; past dates are kept forever, and today and future dates for 1 hour. On a failed or malformed fetch, or a date outside the response, it logs one warning through Nest `Logger` and returns `fallback`. Callers then use the old clear-sky curve, so the simulator never stops. After a failure it waits 60 s before retrying, and concurrent callers share one in-flight fetch. Tests never call the network: unit tests parse the saved fixture, and e2e tests swap the provider for a fake through Nest's testing module.
- **Capacity 10 kW.** That's about 1.7 kW per apartment, in line with a published shared-solar example of 15 flats on 20 kW. With 30 kW, real midday weather would cover every demand almost all day, and the split mode would rarely matter.
- **API and UI.** `GET /api/weather?date=` exposes the day the simulator uses: location, source, sun times, daylight and sunshine hours, and the hourly means with their `[start, end)` windows. The dashboard shows every time in Melbourne local time with the zone (e.g. "06:30 AEDT"), and a `WeatherCard` with the attribution next to the data.

**Consequences.**
- Equal and Entitlement now differ wherever real weather leaves solar short of demand. On the saved 18–26 October response that's about **07:30–09:00 and 17:05–18:30 local** (on the overcast morning of the 20th, about 08:15–09:00). Midday is a surplus, and both modes agree then. The video window moves with the day's weather (README, "Recording the demo segment").
- The dashboard follows real Fawkner weather for the simulated date, with a forecast up to 7 days ahead. The simulated clock runs ahead of real time, so after about a week of simulated days the solar falls back to the clear-sky curve and the source shows `fallback`.
- An idle day can't be "replayed" against changed weather: the same interval reingested with a newer forecast gets a 409, which the simulator logs and skips (ADR-006).
- Showing Open-Meteo data requires the attribution "Weather data: Open-Meteo.com (CC BY 4.0)", with a link.

## ADR-009 Realistic, deterministic apartment demand

**Context.** User testing on the dev database found four problems:
- **Jumpy.** Each 5-minute value was a fixed curve times fresh ±20 % noise. Unit 1 went 294 → 379 → 366 → 326 Wh, about 14 % change per interval.
- **Looping.** Every flat followed the same shape every day.
- **About three times too high.** Flats used 28–37 kWh a day and 700–860 W all night.
- **History-dependent.** Values depended on how many readings had come before.

**Decision.** Demand is a pure function of (`SIM_SEED`, flat index, Melbourne local date, interval of the day), plus the outdoor temperature, in `profiles.ts` (`intervalDemandWh`):
- **Household size from lot size:** entitlement 10 → 1 person, 15 → 2, 20 → 2, 30 → 3 (`PERSONS_BY_ENTITLEMENT`). Daily targets are 7 / 10 / 13 kWh for 1 / 2 / 3 people (`DAILY_KWH_BY_PERSONS`), so the demo building averages **9.5 kWh per flat per day**. **Benchmark:** CitiPower (inner-Melbourne distributor) reports an average of 9.9 kWh/day for units in 2025. That figure was supplied with the requirements and not independently re-checked here, and it is a check on the level, not the source of the shape.
- **Shape:** one normalised 24-hour **illustrative typical residential load shape, not measured data**. It has a low overnight base (fridge and standby), a morning peak around 06:30–08:30, low weekday daytime use, and an evening peak around 17:30–21:30. A weekend variant has a later, smaller morning peak and more daytime use. Hourly fractions sit at hh:30 and are interpolated linearly, wrapping round midnight, so there is no step at the hour and the day still sums to 1.
- **Different flats, different days:**
  - each flat's routine is shifted by a seeded −45…+45 minutes;
  - a daily multiplier of 0.85–1.15 per (flat, date);
  - smooth noise from a mean-reverting AR(1) walk per flat-day (spread 8 %, persistence 0.92), with its daily mean removed so it reshapes the day without changing its total;
  - appliance events in waking hours (06:30–22:30): +40–150 Wh per interval for 1–4 intervals, at a probability of 0.006 per interval.

  The day's actual event energy comes out of the shape's budget, so a flat's day totals about target × multiplier.
- **Determinism:** every draw comes from `mulberry32`, seeded with an FNV-1a hash of (seed, flat, date, stream). Noise and events are generated for the whole local day and memoised. An interval's value never depends on how many readings came before, so a restart, the seed and the simulator produce identical values, and re-runs replay instead of 409.
- **Heating and cooling** (weather-linked). `temperature_2m` is added to the Open-Meteo request and the saved fixture. It is an *instantaneous* value at the stamped time, unlike radiation's preceding-hour mean, so it is interpolated between timestamps to the interval midpoint. In waking hours (06:00–23:00), 40 W per °C below 16 °C and 60 W per °C above 26 °C are added, capped at 600 W. In fallback (no temperature), nothing is added.

**Consequences.**
- Each flat stays within ±20 % of its target, and the building averages 8–12 kWh/day: tested over two weeks of dates without weather. The median interval-to-interval change is under 6 %, flats peak at different times, and weekends differ from weekdays (all tested).
- Heating and cooling add energy above the target on cold or hot days, as real homes do. The ±20 % test is run without weather.
- The clear-sky solar fallback's cloud walk now has the generator's PRNG to itself, so its random sequence differs from before. Its formula is unchanged.
- The fixture now combines two real Open-Meteo responses for 18–26 October 2026: the original forecast, plus `temperature_2m` requested later for the same dates with `start_date`/`end_date`. The merge checked that the hourly timestamps match exactly.

## ADR-010 Owner-set shares (CUSTOM split mode)

**Context.** The building owner had no way to set the split. The only write endpoint changed the mode between Equal and Entitlement, and lot entitlements are fixed by the seed (and by strata records in real life).

**Decision.**
- **Data.** A third split mode, `CUSTOM` ("Owner-set shares" in the UI), and `Apartment.customSharePct Int?`. A database CHECK keeps it between 1 and 100 when set. The seed's default is 15/15/15/15/20/20, visibly different from Equal (16.7 % each) and Entitlement (10/10/15/15/20/30). A re-seed fills only missing shares and keeps the owner's choice.
- **API.** `PUT /api/buildings/:id/shares` with `{ shares: [{ apartmentId, sharePct }] }`. Checks run in order:
  1. DTO: whole numbers 1–100, a non-empty list, no unknown fields;
  2. the building exists (404);
  3. exactly one entry per apartment, naming missing, unknown or duplicate ids;
  4. the total is exactly 100 (400, giving the actual total).

  All shares are written in one transaction, and the building is returned with its apartments. `GET /api/buildings/:id` includes `customSharePct`. `PATCH` accepts `CUSTOM`, with a 400 naming any unit without a share.
- **Engine input only.** In `CUSTOM` mode the weight is `customSharePct`; the allocation algorithm is unchanged (ADR-007). The mode and shares are read inside the ingest transaction, the same snapshot rule as ADR-003. A change applies from the next interval, and past readings never change: `splitModeUsed` and the stored allocations keep history truthful. The shares themselves aren't copied onto each reading.
- **No auth.** The UI panel is labelled "Building owner settings". In a real product it would sit behind owner authentication (README "What I'd do next"). This demo adds none.

**Consequences.**
- The owner can favour anyone, for example a flat that paid for more panels. Water-filling still caps everyone at their demand and shares the rest (I1–I3 still hold), so shares only matter while solar is scarce, as with the other modes.
- Shares are whole percentages totalling 100 exactly, which keeps the input simple and auditable. Finer splits would need a different unit.

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
- **CI fix: explicit 30 s timeout for the two seed-history e2e tests.** Each one ingests 288 intervals one by one through `ReadingsService.ingest()`, which took under 5 s locally but hit Jest's 5 s default on the GitHub runner (74/75 passed). The fix keeps the real ingest path and every assertion; only the per-test timeout changed (`SEED_TIMEOUT_MS` in `test/live.e2e-spec.ts`).
- **W1: weather building blocks, not yet wired in.** This adds `site.ts`, the Melbourne local-time helpers (`common/local-time.ts`, DST days tested), the irradiance → Wh model and interpolation in `profiles.ts`, the Open-Meteo URL and parser (tested against the saved real response), and `WeatherService` with its cache, fallback and retry (tested with a fake provider and a movable clock). The simulator, seed and summary switch over in W2.
- **W1: a test caught a race in the weather cache.** The first version recorded "attempted just now" as soon as a fetch started, so a second concurrent caller saw a recent attempt, skipped fetching and fell back to the clear-sky curve while the real data was still arriving. The "shares one fetch between concurrent callers" test failed on it. Callers now always wait for a fetch that is already in flight.
- **W1: the fixture loader lives in `__fixtures__/load-fixture.ts`,** not in a spec file, because importing a spec would re-run its tests. `__fixtures__` is excluded from the Nest build.
- **W2: the simulator and seed take solar from `WeatherService`.** For each interval they ask for the irradiance, and pass it (or `null` for the clear-sky fallback) to `ReadingGenerator.next(at, irradiance)`. The generator stays pure and deterministic for a given weather input. Its PRNG advances the same way with or without weather, so simulated demand never depends on the weather source (tested).
- **W2: local time throughout.** Demand bumps use the Melbourne local hour. The simulator starts at local midnight when there are no readings. The seed's "yesterday" is the previous local day, looped from local midnight to local midnight (276/288/300 intervals). The summary sums the local day. The summary's `/ 288` assumption is gone from the API; the UI changes come in W3.
- **W2: e2e tests always run on a fake weather provider.** `createTestApp()` overrides `WEATHER_PROVIDER` with the saved fixture, and `WEATHER_CLOCK` with 12:00 local on 20 October 2026, through Nest's testing module, so no e2e test can reach the network. A second app with a provider that always rejects checks the fallback path.
- **W2: the seed reports `fallbackIntervals`,** the number of intervals that used the clear-sky curve, so a seed run makes it obvious whether real weather was used.
- **W2: capacity 10 kW (item 8).** 10 kW is about 1.7 kW per apartment, in line with a published shared-solar example of 15 flats on a 20 kW system, so real weather produces shortfalls that make the split mode matter. The per-interval cap is now 833 Wh. E2e tests that relied on the 2,500 Wh cap now compute it from the building (`maxSolarWhFor`). The default test reading is 800 Wh, with exports and summary totals recalculated by hand.
- **W2: `GET /api/weather?date=`** returns the location, `source` (`open-meteo` or `fallback`), sunrise, sunset, daylight and sunshine hours (1 decimal), and the hourly means as `{ start, end, irradianceWm2, cloudCoverPct }`. Each hour is listed with its own averaging window, so clients don't need to know Open-Meteo's "preceding hour" convention. The date is validated like `/summary`. A failing source gives `200` with `source: "fallback"`, not an error.
- **W2: the old UTC-day helpers in `common/time.ts` (`utcDayRange`, `startOfUtcDay`, `utcHourOfDay`) are no longer used by the app.** I kept them and their tests to keep this change small.
- **W3: all times on screen are Melbourne local time with the zone** (`formatSiteTime`, e.g. "17:20 AEDT"), including the "last reading" tooltip. The site zone is duplicated in `web/src/site.ts` (ADR-005). The summary drops its fixed "/ 288", because local days can have 276 or 300 intervals.
- **W3: `WeatherCard`** sits under "This interval" in the middle column, so at 1280×720 everything the video needs stays above the fold. It shows sunrise, sunset, "Sunshine X h of Y h daylight", and the hour mean containing the interval on screen. It says plainly when the source is the clear-sky fallback, and always shows the CC BY 4.0 attribution with links. Covered by 4 Vitest tests (mocked `fetch`).
- **W3: `docs/dashboard.png` was retaken.** The old one showed UTC times and the old building name. The new one is 17:20 AEDT on a simulated 21 October in Entitlement mode with real weather: 223 Wh shared 22/22/34/33/45/67 Wh. It was captured with a one-off Cypress spec that was not committed.
- **W3: the simulator's "Stopped." hint no longer says "Simulated data only"**, because solar is now an estimate from real weather.
- **D1: realistic demand (ADR-009).** The old `baseDemandWh` / `demandWh` and their tests are replaced by `intervalDemandWh` and `demand.spec.ts` (18 tests covering every target in the requirements). `ReadingGenerator` now takes `{ id, lotEntitlement }` per flat and `{ irradianceWm2, temperatureC }` per interval. `WeatherService.intervalWeather()` returns both from the same cache entry (nulls in fallback). The simulator and the seed use it.
- **D1: a first version failed the ±20 % test on one flat-day (79 % of target).** The noise could drift below zero over a whole day, and a day without appliance events fell under the shape budget reserved for them. Rather than loosen the test, the noise is now mean-zero per day, and the day's actual event energy comes out of the budget. The daily total then follows the multiplier, as designed.
- **D2: owner-set shares backend (ADR-010).** The migration `owner_shares` was written by hand (adding the `CUSTOM` enum value, the `customSharePct` column and its CHECK), so `fairshare_dev` wasn't touched before the user's reset. It was applied to `fairshare_test` with `migrate deploy`, and `prisma migrate diff` against the schema shows no drift. The seed fills only missing shares and never overwrites one already set (tested). The `splitMode` validation message now lists `EQUAL, ENTITLEMENT, CUSTOM`; that e2e expectation was updated for the new enum value.
- **D3: owner settings UI.** `SplitModeToggle` gains a third radio, "Owner-set shares" (`data-testid="split-custom"`). `OwnerSettings.vue` is a `<details>` disclosure under Split mode. It has a fieldset/legend, one labelled number input per unit (with its entitlement), a live total in an `aria-live` region, and Save enabled only when every share is a whole 1–100 and the total is exactly 100. A failed PUT reverts the inputs and shows the error, the same pattern as the toggle. The existing toggle test now expects three radios (the spec gained a mode), and the `ApartmentBars` fixtures carry the new `customSharePct` field.
- **D3: browser check.** At 1280×720 and 375 px: three modes, the owner panel opened, a live total while typing (Save disabled at 95 %), shares saved, `CUSTOM` chosen, and a live scarce interval at 17:45 AEDT split 17/17/17/35/35/52 Wh for 10/10/10/20/20/30 %. No horizontal page scroll at 375 px. The Cypress smoke passes unchanged. The dev database was left in Equal with the seeded shares.
- **D3: the simulator controls only know the status from their own requests.** Starting the simulator through the API (as the checks do to fast-forward) leaves the panel showing "Stopped." until the next click. This was already true before these changes and is out of scope here.
