# FairShare Solar

A small full-stack app for one apartment building's shared rooftop solar system in Fawkner, Melbourne. Solar for each 5-minute interval is estimated from real public weather data; apartment demand is simulated. The app splits the solar fairly between the apartments, stores it in PostgreSQL, and streams the result live to a Vue 3 dashboard. Every interval adds up exactly, to the watt-hour.

**NestJS 11 · Prisma 6 · PostgreSQL 17 · Socket.IO · Vue 3.5 · Jest · Vitest · Cypress**

![FairShare Solar dashboard: six apartments sharing scarce evening solar by lot entitlement, with Fawkner weather](docs/dashboard.png)

*Above: 17:20 AEDT on a simulated 21 October, "By lot entitlement" mode, with that day's real Fawkner weather. Solar is scarce (223 Wh against 701 Wh of demand), so each apartment's share follows its entitlement (10/10/15/15/20/30 → 22/22/34/33/45/67 Wh).*

## Why I built this

I'm applying for the Full Stack Software Engineer role at **Allume Energy**. Allume's **SolShare** shares one rooftop solar system between the apartments in a building, and the role works across NestJS, Vue 3, PostgreSQL and fleets of connected devices. I wanted to show that I can work in that stack on a problem shaped like theirs: device telemetry in, a fair and exact split, stored safely, streamed live, and tested properly.

> **Disclaimer.** This is an independent demo. It is not affiliated with or endorsed by Allume Energy, and it uses no Allume code, data, branding or logos. The allocation algorithm is my own simplified model, not Allume's. Apartment demand is simulated, and solar is an estimate from public weather data, not a real meter.

## Quick start (Windows PowerShell)

**Prerequisites:** Node 24 (npm 11) and PostgreSQL 17 running locally (Windows service `postgresql-x64-17`).

**1. Database (one-time).** As the `postgres` superuser, create a dev role and two databases. Choose your own password; `CREATEDB` lets `prisma migrate dev` create its shadow database.

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE ROLE fairshare LOGIN PASSWORD '<choose-a-dev-password>' CREATEDB;"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE DATABASE fairshare_dev OWNER fairshare;"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE DATABASE fairshare_test OWNER fairshare;"
```

**2. Environment files** (git-ignored). Copy the example twice, put your password in both, and point `.env.test` at `fairshare_test`. If the password contains URL-reserved characters, percent-encode them: `<` → `%3C`, `>` → `%3E`, `@` → `%40`, `#` → `%23`, `%` → `%25`, `/` → `%2F`, `:` → `%3A`.

```powershell
Copy-Item api\.env.example api\.env
Copy-Item api\.env.example api\.env.test
```

**3. Install, set up the database, run.**

```powershell
npm.cmd install
npm.cmd run db:setup
npm.cmd run dev
```

Open **http://localhost:5173**. `db:setup` applies the migrations and seeds *Prottoy's Apartment* (10 kW, six apartments) plus yesterday's simulated intervals, with solar from yesterday's real Fawkner weather. Seeding needs internet access for the weather; without it, that day uses a clear-sky estimate. Click **Start simulator**: one 5-minute interval arrives every 2 s (1 s and 5 s are selectable), and a simulated day takes about 10 minutes at the default speed.

> All times are **Melbourne local time** (AEDT/AEST); readings are stored in UTC. The simulated clock starts at local midnight and runs ahead of real time, so after about a week of simulated days it runs past the 7-day forecast and solar falls back to a clear-sky estimate.

## Architecture

```mermaid
flowchart LR
  OM["Open-Meteo forecast<br/>(irradiance, cloud)"] --> WX["WeatherService<br/>(cache, fallback)"]
  WX --> SIM
  WX --> SEED
  SIM["Simulator<br/>(setInterval, seeded demand)"] --> ING
  SEED["Seed: yesterday<br/>(Melbourne day)"] --> ING
  DEV["Device / curl<br/>POST /api/buildings/:id/readings"] --> ING
  ING["ReadingsService.ingest()<br/>validate → allocate → store"] -->|one transaction| PG[(PostgreSQL 17)]
  ING -->|after commit| BUS["LiveEvents<br/>(RxJS Subject)"]
  BUS --> STATUS["DeviceStatusService<br/>OFFLINE / ONLINE / STALE"]
  BUS --> GW["Socket.IO gateway"]
  STATUS --> GW
  GW -->|reading, device-status| VUE["Vue 3 dashboard"]
  VUE -->|"REST /api (Vite proxy)"| REST["Buildings, readings,<br/>summary, simulator, weather"]
  REST --> PG
```

- **One ingestion path** (ADR-004): the simulator, the seed and HTTP all go through `ReadingsService.ingest()`. It runs the checks in a fixed order (DTO, 5-minute alignment, building, capacity, exactly one demand per apartment), allocates, and stores the reading, demands and allocations in one Prisma transaction.
- **Idempotent** (ADR-006): `(deviceId, intervalStart)` is unique, and a sha256 payload hash decides the rest. The same reading again returns **200 replay** and writes nothing. A different reading for the same interval returns **409**. A race that hits the unique key (`P2002`) gets the same treatment.
- **Split mode applies from the next interval** (ADR-003): each reading stores the `splitModeUsed`, so history never changes.
- **Integers everywhere** (ADR-001): energy is integer Wh, with database `CHECK` constraints behind the validation.
- **Live**: the `reading` event is emitted only after commit and never for replays. `device-status` is emitted only when the status changes, and sent to each client as it connects.
- **Daily summary**: totals come from Postgres `aggregate` / `groupBy` over the Melbourne local day (288 intervals, or 276 / 300 on daylight-saving days); percentages are rounded to 1 decimal only in the response.

Specification: [SPEC.md](SPEC.md). Decisions and trade-offs: [DECISIONS.md](DECISIONS.md) (10 ADRs plus a build log). On-call: [RUNBOOK.md](RUNBOOK.md).

## Data

- **Location:** Fawkner VIC 3060, at the suburb centre (−37.707, 144.968), never a street address. Time zone Australia/Melbourne.
- **Solar is estimated from real weather.** The API asks the free [Open-Meteo](https://open-meteo.com/) forecast API (no key) for hourly shortwave radiation (W/m², the mean of the *preceding* hour) and cloud cover, plus sunrise, sunset, sunshine and daylight. Each hour mean sits at the middle of its hour and is interpolated to the middle of every 5-minute interval. Then `solar Wh = 10 kW × irradiance / 1000 × 0.8 × 5/60`, where 0.8 is a typical performance ratio for inverter, wiring, heat and dirt losses. Responses are cached in memory per local date. If Open-Meteo is unreachable or a date is outside the forecast, solar falls back to a clear-sky curve, and `GET /api/weather` and the dashboard say so ([ADR-008](DECISIONS.md)).
- **Apartment demand is simulated, and benchmarked** ([ADR-009](DECISIONS.md)):
  - Household size follows lot size (entitlement 10 → 1 person, 15 or 20 → 2, 30 → 3), with daily targets of 7 / 10 / 13 kWh. The building averages about **9.5 kWh per flat per day**, against a CitiPower benchmark of 9.9 kWh/day for Melbourne units in 2025.
  - The shape is an **illustrative typical residential load shape, not measured data**: low overnight, a morning peak, quiet weekday daytime and an evening peak. The weekend version has a later morning and more daytime use.
  - Each flat's routine is shifted by up to ±45 minutes, each day gets its own 0.85–1.15 multiplier, and smooth mean-reverting noise plus the odd kettle/oven/washing-machine burst keep it lifelike. The median change from one 5-minute interval to the next is about 3 %, down from 14 %.
  - Heating below 16 °C and cooling above 26 °C come from the real Open-Meteo temperature.
  - Every value is a pure function of seed, flat, local date and interval, so restarts and re-seeds replay instead of conflicting.
- **Owner-set shares** ([ADR-010](DECISIONS.md)): besides *Equal* and *By lot entitlement*, the building owner can set each flat's percentage (whole numbers, exactly 100 % in total) in **Building owner settings** and choose *Owner-set shares*. The seed starts them at 15/15/15/15/20/20. Like the other modes, a change applies from the next interval, and past readings never change.
- **Attribution:** Weather data: [Open-Meteo.com](https://open-meteo.com/) ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). The dashboard shows the same attribution next to the weather.

## Allocation model

Each interval's solar is shared **in proportion to weight**: 1 each in *Equal* mode, the lot entitlement in *By lot entitlement* mode, and the owner's percentage in *Owner-set shares* mode. **Nobody gets more than they're using right now.** Energy one apartment can't use is shared again among those still wanting more ("water-filling"). Only energy that nobody can use is exported to the grid. Rounding is done in whole Wh: each apartment gets the floor of its exact share, and any leftover Wh go one at a time by largest fractional remainder.

Invariants, each with a test:

| | Invariant |
|---|---|
| I1 | Conservation: allocated + exported = solar, exactly |
| I2 | Nobody gets more than their demand |
| I3 | Export only when every demand is fully met |
| I4 | When solar is scarce, every share is within 1 Wh of its proportional share |
| I5 | Deterministic, and independent of input order |
| I6 | Every output is a whole number ≥ 0 |

When solar exceeds demand, every mode gives the same result, because everyone is fully supplied. The modes only differ while solar is scarce. With 10 kW, the realistic demand and recent Fawkner weather, that's roughly 07:30–08:25 and 17:25–18:35 local time, and it depends on the day's cloud.

## Testing

| Layer | Command | Covers |
|---|---|---|
| API unit (Jest, 168) | `npm.cmd run test -w api` | Allocation engine: 7 worked examples, I1–I6, 2 × 1,000 seeded property cases, every `RangeError`. Time helpers including Melbourne local days and the daylight-saving days (276 and 300 intervals). Irradiance → Wh model and interpolation. Open-Meteo parser on a saved real response. Weather cache, fallback and retry (fake provider and clock). **Demand model**: per-flat daily targets ±20 %, building average 8–12 kWh, median interval change under 6 %, day-to-day variation, weekend vs weekday, determinism, staggered peaks, bounds, heating/cooling. Payload hash, reading generator, stale logic and simulator (fake timers) |
| API e2e (Jest + Supertest, 104) | `npm.cmd run test:e2e -w api` | Against `fairshare_test`, with a **fake weather provider** (never the network): 201 / 200 replay / 409 / concurrent races / forced `P2002`, every 400 case, 404s, capacity from the building, split-mode snapshot, hand-calculated Melbourne-day summary, DB `CHECK`s, live event bus, simulator validation, seed history on real (saved) weather, `GET /api/weather` incl. fallback, **owner shares**: `PUT /shares` validation, PATCH to `CUSTOM`, a scarce interval split exactly by the shares, history kept |
| Web unit (Vitest, 19) | `npm.cmd run test:unit -w web -- --run` | `ApartmentBars` meters and aria values; `SplitModeToggle` PATCH (all three modes), revert on error; `WeatherCard` Melbourne times, this hour, fallback, attribution; `OwnerSettings` labelled inputs, live total, Save only at 100 %, PUT and revert on error (mocked `fetch`) |
| Smoke (Cypress, 1) | `npm.cmd run e2e` (with `npm.cmd run dev` running) | Start → Online → switch to entitlement → `ENTITLEMENT` → stop → Stale |

`npm.cmd test` runs the first three in order. `npm.cmd run lint`, `npm.cmd run typecheck` and `npm.cmd run build` cover both workspaces. CI (GitHub Actions, `postgres:17` service) runs install, lint, typecheck, all Jest and Vitest tests, and build. Cypress runs locally only.

The e2e suite applies migrations with `prisma migrate deploy` and truncates every table before each test. It refuses to run against any database other than `fairshare_test`. `npm.cmd run test:e2e:reset -w api` does a full reset of the test database.

## How I used AI

I built this with **Claude Code** as a pair. It scaffolded the workspaces and drafted most of the code, tests and docs, one milestone at a time. Before approving the next milestone, I checked each one myself: reading the diff, running `npm.cmd test` on my machine, and walking the journeys in the browser. The bar for AI-written code was the same as for my own: invariant tests, property tests, e2e tests against a real database, and lint and typecheck clean before every commit.

**A test caught a real mistake.** The spec's own allocation algorithm ([SPEC.md](SPEC.md) §6.1) said to hand out leftover rounding Wh "by weight, descending". The engine was written test-first, and the invariant test I4 ("within 1 Wh of the proportional share") failed on it. At 10 Wh with weights 2/1/1 it gave 6/2/2, not 5/3/2, and with many apartments a second proportional round could pile several Wh onto one heavy apartment. The fix (largest-remainder rounding) kept all seven worked examples unchanged and is recorded in [ADR-007](DECISIONS.md).

**Guardrails for autonomous work.** [`CLAUDE.md`](CLAUDE.md) sets the rules the agent works under:
- Rules: one milestone at a time, lint + typecheck + tests green before every commit, never weaken a test, pinned versions only, hands off `.env` files, the `postgres` superuser and dev data, never push.
- Stop conditions: the same step fails twice; it needs a secret, consent or a database reset; it wants to add a dependency, or change an API shape, the scope or a rule in the spec.
- A local Claude Code permission file (not committed) denies `git push` / `config` / `reset --hard` / `clean` / `rebase`, `prisma migrate reset`, `psql` as `postgres`, `DROP DATABASE`, and deletes outside the repo.
- Prisma 6.19 has its own guard: it refuses `migrate reset` from an AI agent without explicit consent. The e2e setup was changed to `migrate deploy` plus a truncate step that only ever runs on `fairshare_test`.

**Other things the process caught:**
- A test that forced the `P2002` race branch, because the plain concurrency test passed whichever way the race went.
- A legend CSS bug found during the browser check.
- A race in the weather cache: a second request arriving during the first fetch would have fallen back to the clear-sky curve. The "shares one fetch" test caught it.
- A measurement showing that with these numbers the split modes only differ in short scarce windows. I kept the spec's numbers and timed the demo recording to the morning ([DECISIONS.md](DECISIONS.md)).

## What I'd do next

- Device ingest over **MQTT / AWS IoT Core** instead of HTTP, keeping the same idempotent ingest service
- **Real metered demand** from apartment meters instead of the simulated profile, and measured PV output instead of the weather estimate
- **Time-series storage** (Timestream or TimescaleDB) for readings, with Postgres keeping buildings, apartments and allocations
- Batteries, tariffs and dollar savings; panel tilt and orientation in the solar estimate
- Auth, with **Building owner settings behind owner authentication** (in this demo anyone with the page can change the shares), and more than one building in the UI
- Deploy with infrastructure as code; run Cypress in CI
- Generate the web app's types from an OpenAPI document instead of duplicating them (ADR-005)
- Upgrade to NestJS 12 (ESM) and Prisma 7 (driver adapters), then TypeScript 7 once ts-jest supports it (ADR-002)
- A sparkline of the day's solar vs export (cut for time)

## Recording the demo segment

The modes only differ while solar is scarce. In the evening window, Unit 6 (entitlement 30) gets about three times Unit 1's share (entitlement 10) in *By lot entitlement*, instead of the same in *Equal*. To show it:
1. Run the simulator at **1 s** until "This interval" shows about **17:20 AEDT**, then **Stop**.
2. Start recording. **Start**: the pill turns Online and the bars start filling.
3. At about **17:30**, switch to **By lot entitlement**. Optionally, at about **17:50**, switch to **Owner-set shares**.
4. At about **18:15**, **Stop**. The pill shows **Stale** 3–4 s later (three missed 1 s intervals).

The morning (about 07:35–08:25) also works on a clear day. The window moves with the day's cloud, so check "Sunshine X h of Y h" on the weather card first.

## Repository layout

```
api/   NestJS 11 API (Prisma schema, migrations and seed in api/prisma)
web/   Vue 3 dashboard (Vite, Vitest, Cypress)
docs/  dashboard screenshot
.github/workflows/ci.yml
SPEC.md  DECISIONS.md  RUNBOOK.md  CLAUDE.md
```
