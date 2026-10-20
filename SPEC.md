# Specification: FairShare Solar (one-day demo)

> **For Claude: read this whole file before writing any code.** It is the single source of truth for this project. If something you need isn't here, choose the simplest option that fits these rules, write it down in `DECISIONS.md`, and keep going. Ask the user only when the choice would change scope, the stack or the timebox, or when you need a secret (such as the PostgreSQL password). **Never invent or hard-code passwords.**
>
> Spec version 2 (2026-10-19): stack and versions checked against npm on that date. Section numbers start at 1; they match the references in the code, `DECISIONS.md` and `CLAUDE.md`. Where the build deliberately differs from this spec, `DECISIONS.md` says so.

---

## 1. Product

- **Name:** FairShare Solar
- **One-line pitch:** A small full-stack app for one apartment building's shared solar system in Fawkner VIC (Melbourne). It estimates each 5-minute interval's solar from real public weather data (Open-Meteo), simulates apartment demand, splits the solar fairly between the apartments, stores it in PostgreSQL, and streams the result live to a Vue 3 dashboard (ADR-008).
- **Success looks like:** you start the simulator and watch the live dashboard:
  - solar generation rises through a compressed day;
  - each apartment's bar fills with its allocated energy;
  - surplus shows as exported to the grid;
  - switching the split mode from **Equal** to **By lot entitlement** visibly changes later allocations;
  - stopping the simulator makes the device show **Stale** a few seconds later.

  Every interval's numbers add up **exactly**, to the watt-hour.
- **Type:** local web app (NestJS API + Vue 3 SPA + local PostgreSQL). No deployment.

### Independence and branding rules (must be followed and stated in the README)
- This is an **independent demo**. It uses **no third-party code, data, branding or logos**, and it is not affiliated with or endorsed by any company.
- No third-party company or product names appear in the UI, code, package names or repo name. The **only** exception is the README's "Why I built this" section.
- The allocation algorithm is the **author's own simplified model**, not any commercial product's. Apartment demand is **simulated**. Solar is an **estimate from public weather data** (Open-Meteo, CC BY 4.0, attributed in the UI and README), not a real meter.
- The building's location is given at **suburb centre only**, never a street address.

---

## 2. Users

There's one user: a viewer of the dashboard (such as a building manager). **No authentication** (out of scope, §9). The "device" is the built-in simulator, which goes through the same ingest service a real device's HTTP call would.

---

## 3. Core journeys

**J1 — Watch a live day**
1. Open `http://localhost:5173`. The dashboard shows "Prottoy's Apartment", 6 apartments, the weather in Fawkner and a device status of **Offline**.
2. Click **Start simulator**. Every 2 seconds a new 5-minute interval arrives over WebSocket.
3. The solar figure, each apartment's allocated vs demand bar, the exported figure and the daily summary all update without reloading the page.

**J2 — Change the split rule**
1. Switch **Split mode** from *Equal* to *By lot entitlement*.
2. From the next interval on, apartments with higher entitlement get a bigger share when solar is scarce. Past intervals don't change (ADR-003).

**J3 — Device goes quiet**
1. Click **Stop simulator**.
2. After 3 missed intervals (6 s at the default speed) the status pill shows **Stale**, with a tooltip giving the last reading time.
3. Start again and the status returns to **Online**.

**J4 — Bad or repeated device data** (shown by e2e tests, not the UI)
1. A malformed reading gets a 400 with a clear message.
2. Sending the exact same reading again gets a 200 *replay* with the original result and no new rows.
3. Sending the same interval with *different* numbers gets a 409 Conflict.

---

## 4. Features and acceptance criteria

| ID | Feature | Priority | Acceptance criteria |
|---|---|---|---|
| F1 | Allocation engine | MUST | A pure function in `api/src/allocation/allocate.ts` as specified in §6.1. Invariants unit-tested (§7). No I/O, no Nest imports. |
| F2 | Reading ingest | MUST | `POST /api/buildings/:id/readings` with validation (§5.7), allocation, and storing the reading, demands and allocations in **one Prisma transaction**. Idempotent by `(deviceId, intervalStart)`. |
| F3 | Building API | MUST | `GET /api/buildings`, `GET /api/buildings/:id` (with apartments and their `customSharePct`), `PATCH /api/buildings/:id` (splitMode only). Unknown id returns 404. |
| F14 | Owner-set shares | MUST | Split mode `CUSTOM` ("Owner-set shares"): `PUT /api/buildings/:id/shares` sets each apartment's whole-number share (1–100, exactly one per apartment, total exactly 100); weight = share; applies from the next interval (ADR-010). UI: third radio plus a "Building owner settings" panel. No auth in this demo. |
| F15 | Realistic demand | MUST | Simulated demand benchmarked to about 10 kWh per flat per day, smooth, different per flat and per day, and deterministic per interval (§6.2, ADR-009). |
| F4 | Daily summary | MUST | `GET /api/buildings/:id/summary?date=YYYY-MM-DD` returns the totals in §5.7, using **database aggregation** (§6.5), not by loading every row into memory. |
| F5 | Simulator | MUST | Seeded and deterministic; one 5-minute interval every 2 s (configurable); calls the **same `ReadingsService.ingest()`** as HTTP; start, stop and status endpoints. |
| F6 | Live stream | MUST | A Socket.IO gateway emits `reading` after each committed interval and `device-status` on change. |
| F7 | Stale detection | MUST | `STALE` when no reading for 3 × the simulator interval (real time); emitted once per change. |
| F8 | Vue 3 dashboard | MUST | A single page with the components in §6.4, using `<script setup lang="ts">` and the Composition API. Responsive down to 375 px, keyboard accessible, live figures in `aria-live="polite"`. |
| F9 | Tests | MUST | Jest unit (engine, stale logic, profiles), Jest + Supertest e2e against a **separate Postgres test database**, Vitest + Vue Test Utils for 2 components, **one Cypress** smoke test (J1 + J2). |
| F10 | Docs | MUST | `README.md`, `DECISIONS.md` (7 ADRs, §8), `RUNBOOK.md` (§10). |
| F11 | CI | SHOULD | GitHub Actions with a `postgres:17` service container: install, lint, typecheck, Jest unit + e2e, Vitest, build. Cypress in CI is a stretch goal only. |
| F12 | Seeded history | SHOULD | `npm run db:seed` also generates yesterday's 288 intervals through the ingest service (§5.6). |
| F13 | Sparkline | COULD | Inline-SVG chart of the current simulated day's solar vs export. No chart library. |

**Cut order if time runs short:** F13 → F11 → F12. Never cut F1, F2, F6, F8 or the F9 engine/e2e tests.

---

## 5. Stack, setup and data model

### 5.1 Exact stack. Pin these major versions. **Do not just install `latest`.**

Checked on npm on 2026-10-19. Several `latest` tags would break this project:

| Area | Use | Why (and what to avoid) |
|---|---|---|
| Runtime | Node **24** (installed), npm 11 | — |
| API framework | **NestJS 11** (`@nestjs/*@^11`, tagged `legacy` on npm; currently 11.2.x). Scaffold with `npx @nestjs/cli@11 new` | NestJS 12 is now `latest` but switched to ESM and defaults to Vitest. This project uses **Jest**, and most production NestJS codebases are still on 11 / CommonJS. **The official docs site now shows v12 by default**: ignore ESM-only advice such as `.js` import suffixes, and use the v11 docs where they differ. |
| TypeScript (API) | **`typescript@~5.9`** | **TypeScript 7 is `latest` and `ts-jest` requires `typescript <7`.** The API must resolve to 5.x. |
| ORM | **Prisma 6**: `prisma@6.19.3` and `@prisma/client@6.19.3` (exact, same version) | `npm i prisma` now installs **8.0.0-rc** (a pre-release). Prisma 7 needs driver adapters, `prisma.config.ts`, a generated client path and `moduleFormat = "cjs"` with Nest 11: too much setup for one day. Prisma 6 is stable and is what Prisma's NestJS CommonJS setup was built around (ADR-002). Ignore the warning about `package.json#prisma` being deprecated. |
| Database | **PostgreSQL 17**, installed and running locally as Windows service `postgresql-x64-17` (binaries in `C:\Program Files\PostgreSQL\17\bin`, not on PATH) | No Docker needed. |
| WebSockets | `@nestjs/websockets@^11`, `@nestjs/platform-socket.io@^11`; `socket.io-client@^4.8` in web | — |
| Config / validation | `@nestjs/config@^4`, `class-validator`, `class-transformer` | Don't add `@nestjs/schedule`. Use plain `setInterval` with cleanup (§6.2). |
| API tests | Jest **29 or 30** + `ts-jest` + Supertest (whatever `@nestjs/cli@11 new` generates) | — |
| Frontend | **Vue 3.5** via `npm create vue@3.24.0` (pinned). Brings **Vite 8, Vitest 5, Cypress 16** | Don't pass `--vue-rc` (3.6 RC) or `--tsgo` (TypeScript 7 native). |
| Dev tooling | `concurrently`, `cross-env`, `dotenv-cli`, `rimraf` | Windows-safe npm scripts |

After scaffolding, run `npm ls typescript prisma @prisma/client @nestjs/core` and confirm: API TypeScript 5.x, Prisma 6.19.3 for both packages, Nest 11.x. Fix it before moving on.

### 5.2 Scaffolding commands (run from the repo root, PowerShell)
```powershell
git init
npx @nestjs/cli@11 new api --package-manager npm --skip-git --skip-install --strict
npm create vue@3.24.0 web -- --ts --vitest --cypress --eslint --prettier
```
- Then create the root `package.json` with `"private": true` and `"workspaces": ["api", "web"]`, and run **one** `npm install` at the root.
- In `api/package.json`: pin `"typescript": "~5.9.3"`, then add `prisma@6.19.3` (dev), `@prisma/client@6.19.3`, `@nestjs/websockets@^11`, `@nestjs/platform-socket.io@^11`, `@nestjs/config@^4`, `class-validator`, `class-transformer`.
- In `web`: add `socket.io-client`.
- Root dev dependencies: `concurrently`, `cross-env`, `dotenv-cli`, `rimraf`.
- Delete the scaffolded demo content: Nest's `AppController` hello-world and its spec, and Vue's `HelloWorld` / `TheWelcome` components and icons.
- **Note:** with `--cypress` plus `--vitest`, create-vue sets up Cypress e2e only (no component testing), which is what we want.

### 5.3 Database setup (one-time, needs the user)
- **Ask the user** for the local `postgres` superuser password, or ask them to run these commands themselves. Never store it in the repo.
- Create a dedicated role and two databases:
  ```powershell
  & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE ROLE fairshare LOGIN PASSWORD '<choose-a-dev-password>' CREATEDB;"
  & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE DATABASE fairshare_dev OWNER fairshare;"
  & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE DATABASE fairshare_test OWNER fairshare;"
  ```
  The role needs `CREATEDB` because `prisma migrate dev` creates a temporary shadow database.
- **Password encoding:** if the `fairshare` password contains characters that are reserved in URLs, **percent-encode** it in `DATABASE_URL` (`encodeURIComponent` rules: `<` → `%3C`, `>` → `%3E`, `@` → `%40`, `#` → `%23`, `%` → `%25`, `/` → `%2F`, `:` → `%3A`). Test the connection with `npx prisma db pull --print` or `/api/health` before moving on.
- `api/.env` (git-ignored): `DATABASE_URL="postgresql://fairshare:<url-encoded-pw>@localhost:5432/fairshare_dev?schema=public"`, `PORT=3000`, `SIM_SEED=42`.
- `api/.env.test` (git-ignored): the same, pointing at `fairshare_test`.
- Commit `api/.env.example` with placeholders only. Add `.env` and `.env.test` to `.gitignore` **before the first commit**.
- Load env with `@nestjs/config` (`ConfigModule.forRoot({ isGlobal: true })`). Fail fast at startup if `DATABASE_URL` is missing.

### 5.4 Repo layout and scripts
```
FairShare-Demo/
  SPEC.md  README.md  DECISIONS.md  RUNBOOK.md  .gitignore
  package.json            ← workspaces + root scripts
  .github/workflows/ci.yml
  docs/dashboard.png
  api/
    prisma/schema.prisma  prisma/migrations/  prisma/seed.ts
    src/
      main.ts  app.module.ts
      prisma/prisma.module.ts  prisma/prisma.service.ts
      allocation/allocate.ts  allocation/allocate.spec.ts
      buildings/  (module, controller, service, dto/)
      readings/   (module, controller, service, dto/, payload-hash.ts)
      simulator/  (module, controller, service, profiles.ts, prng.ts + specs)
      live/       (live.gateway.ts, device-status.service.ts, device-status.ts + spec)
      common/     (time.ts, local-time.ts, site.ts, limits.ts + specs)
      weather/    (module, controller, service, provider, open-meteo.ts, __fixtures__/ + specs)
      health/     (health.controller.ts)
    test/         (*.e2e-spec.ts, jest-e2e.json, utils/reset-db.ts)
  web/
    vite.config.ts        ← dev proxy (§6.4)
    src/ App.vue  main.ts  styles.css  types.ts
         api/client.ts
         composables/useLive.ts  composables/useBuilding.ts
         components/ BuildingHeader.vue  SplitModeToggle.vue  LiveFlow.vue
                     ApartmentBars.vue  DailySummary.vue  SimulatorControls.vue
         components/__tests__/  (Vitest specs)
    cypress/e2e/dashboard.cy.ts
```
**Root scripts:**

| Script | Does |
|---|---|
| `dev` | `concurrently -n api,web "npm:dev -w api" "npm:dev -w web"`. Add `"dev": "nest start --watch"` in api. |
| `db:migrate` | `prisma migrate dev` in api |
| `db:seed` | `prisma db seed` in api |
| `db:setup` | migrate + seed |
| `test` | api unit → api e2e → web unit |
| `lint`, `typecheck`, `build` | run in both workspaces |
| `e2e` | Cypress run (needs `npm run dev` running) |

- **api e2e:** `dotenv -e .env.test -- prisma migrate reset --force --skip-seed && dotenv -e .env.test -- jest --config ./test/jest-e2e.json --runInBand`
- **Prisma seed config** in `api/package.json`: `"prisma": { "seed": "ts-node prisma/seed.ts" }`

### 5.5 Prisma schema (PostgreSQL)
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum SplitMode {
  EQUAL
  ENTITLEMENT
  CUSTOM // owner-set shares (ADR-010)
}

model Building {
  id              String      @id @default(cuid())
  name            String
  capacityW       Int                          // PV system size in watts, e.g. 30000
  splitMode       SplitMode   @default(EQUAL)
  intervalMinutes Int         @default(5)
  createdAt       DateTime    @default(now())
  apartments      Apartment[]
  readings        Reading[]
}

model Apartment {
  id             String       @id @default(cuid())
  buildingId     String
  building       Building     @relation(fields: [buildingId], references: [id])
  label          String                        // "Unit 1"
  lotEntitlement Int                           // > 0
  customSharePct Int?                          // owner-set share in %, 1–100 when set
  demands        Demand[]
  allocations    Allocation[]
  @@unique([buildingId, label])
}

model Reading {
  id            String       @id @default(cuid())
  buildingId    String
  building      Building     @relation(fields: [buildingId], references: [id])
  deviceId      String
  intervalStart DateTime     @db.Timestamptz(3)  // aligned to the interval, UTC
  solarWh       Int
  exportedWh    Int
  splitModeUsed SplitMode                        // snapshot of the mode at this interval
  payloadHash   String       @db.Char(64)        // sha256 hex, for idempotency
  receivedAt    DateTime     @default(now()) @db.Timestamptz(3)
  demands       Demand[]
  allocations   Allocation[]
  @@unique([deviceId, intervalStart])
  @@index([buildingId, intervalStart])
}

model Demand {
  readingId   String
  apartmentId String
  demandWh    Int
  reading     Reading   @relation(fields: [readingId], references: [id], onDelete: Cascade)
  apartment   Apartment @relation(fields: [apartmentId], references: [id])
  @@id([readingId, apartmentId])
}

model Allocation {
  readingId   String
  apartmentId String
  allocatedWh Int
  reading     Reading   @relation(fields: [readingId], references: [id], onDelete: Cascade)
  apartment   Apartment @relation(fields: [apartmentId], references: [id])
  @@id([readingId, apartmentId])
}
```
- **Database-level guarantees:** after the first migration, add a second migration (`npx prisma migrate dev --create-only --name checks`, then edit the SQL) containing `CHECK` constraints:
  - `solarWh >= 0`, `exportedWh >= 0`, `demandWh >= 0`, `allocatedWh >= 0`
  - `lotEntitlement > 0`, `capacityW > 0`
  - `customSharePct` is NULL or between 1 and 100 (migration `owner_shares`)

  The database refuses bad data even if application validation is bypassed. Remember that Prisma quotes camelCase column names: `"solarWh"`.
- **All energy is stored as integer watt-hours. No floats in stored energy** (ADR-001). Percentages are only calculated when a response is sent.

### 5.6 Seed data
- Building: **"Prottoy's Apartment"**, `capacityW: 10000` (about 1.7 kW per apartment, so real weather produces shortfalls; 833 Wh cap per interval), EQUAL, 5-minute interval.
- Location (in `api/src/common/site.ts`, suburb centre only): **Fawkner VIC 3060**, lat −37.707, lon 144.968, time zone **Australia/Melbourne**.
- 6 apartments: "Unit 1"–"Unit 6" with lot entitlements **10, 10, 15, 15, 20, 30**.
- Device id: `"sim-device-001"`.
- The seed is **idempotent**: upsert by building name / `(buildingId, label)`.
- **F12 history:** the seed boots Nest with `NestFactory.createApplicationContext(AppModule)`. It generates **yesterday as a Melbourne local day** (288 intervals, or 276 / 300 on daylight-saving days), with solar from `WeatherService` (§6.2) and demand from the simulator's profile functions, and calls `ReadingsService.ingest()` for each, so it uses the one validated path. It logs how many intervals used the clear-sky fallback. Then it closes the context. Re-running the seed results in replays, not duplicates.

### 5.7 API (global prefix `api`; JSON only; port 3000)

**`main.ts` must:**
- call `app.setGlobalPrefix('api')`;
- use a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`;
- call `app.enableShutdownHooks()`.

Errors use Nest's default `{ statusCode, message, error }` shape.

| Method | Path | Body / query | Responses |
|---|---|---|---|
| GET | `/api/health` | – | 200 `{status:"ok", db:"up"}` (runs `SELECT 1`) |
| GET | `/api/buildings` | – | 200 list (id, name, splitMode, capacityW) |
| GET | `/api/buildings/:id` | – | 200 with apartments ordered by label, each with `customSharePct`; 404 |
| PATCH | `/api/buildings/:id` | `{ splitMode: "EQUAL" \| "ENTITLEMENT" \| "CUSTOM" }` | 200; 400 (incl. CUSTOM while any apartment has no share); 404 |
| PUT | `/api/buildings/:id/shares` | `{ shares: [{ apartmentId, sharePct }] }`: integers 1–100, exactly one per apartment, total exactly 100 | 200 building with apartments; 400 naming the problem (missing / unknown / duplicate id, total, range); 404 |
| POST | `/api/buildings/:id/readings` | below | 201 new; 200 replay; 400; 404; 409 |
| GET | `/api/buildings/:id/readings?limit=50` | int 1–288, default 50 | 200, newest first, with allocations; 404 |
| GET | `/api/buildings/:id/summary?date=YYYY-MM-DD` | required Melbourne local date | 200; 400; 404 |
| GET | `/api/weather?date=YYYY-MM-DD` | required Melbourne local date | 200 `{ date, location, source: "open-meteo" \| "fallback", sunrise, sunset, daylightHours, sunshineHours, hourly: [{ start, end, irradianceWm2, cloudCoverPct }] }`; 400 |
| POST | `/api/simulator/start` | `{ speedMs?: int 500–10000 }`, default 2000 | 200 status |
| POST | `/api/simulator/stop` | – | 200 status |
| GET | `/api/simulator/status` | – | 200 `{ running, speedMs, buildingId, simulatedTime }` |

**Ingest body** (DTO with `@IsString`, `@IsISO8601`, `@IsInt`, `@Min`, `@Max`, and `@ValidateNested({each:true})` + `@Type(() => DemandDto)` + `@ArrayNotEmpty` on `demands`):
```json
{
  "deviceId": "sim-device-001",
  "intervalStart": "2026-10-20T03:05:00.000Z",
  "solarWh": 1840,
  "demands": [ { "apartmentId": "…", "demandWh": 210 } ]
}
```
**Checks, in this order:**
1. **DTO** (ValidationPipe): integers, `solarWh ≥ 0`, `0 ≤ demandWh ≤ 10000`. Otherwise 400.
2. **Alignment** (in the service): `intervalStart` minutes divisible by the interval, with seconds = 0 and ms = 0. Otherwise 400 `"intervalStart must align to a 5-minute boundary"`. Future times are **allowed**, because the simulator's clock runs ahead of real time.
3. **Building exists.** Otherwise 404.
4. **Capacity:** `solarWh ≤ capacityW × intervalMinutes / 60` (833 for the demo building). Otherwise 400.
5. **Apartment set:** `demands` has exactly one entry per apartment of that building, with no missing, unknown or duplicate ids. Otherwise 400 naming the offending id(s).

**Idempotency:**
- `payloadHash = sha256(JSON.stringify({ deviceId, intervalStart: new Date(x).toISOString(), solarWh, demands: sorted by apartmentId, each {apartmentId, demandWh} }))`, using `node:crypto`.
- Look up `(deviceId, intervalStart)` first:
  - same hash → **200** with the stored result, `replayed: true`, nothing written, **no WebSocket event**;
  - different hash → **409** `"A different reading for this interval already exists"`.
- Race: if the insert transaction throws `Prisma.PrismaClientKnownRequestError` with code **`P2002`**, read the existing row and apply the same replay / 409 rule.
- The **current** building `splitMode` is read **inside the transaction** and stored as `splitModeUsed`.

Response for ingest, readings items and the `reading` event:
```json
{
  "readingId": "…", "buildingId": "…", "intervalStart": "…",
  "solarWh": 1840, "exportedWh": 0, "splitModeUsed": "EQUAL", "replayed": false,
  "allocations": [ { "apartmentId": "…", "label": "Unit 1", "lotEntitlement": 10, "demandWh": 210, "allocatedWh": 210 } ]
}
```
Allocations are ordered by apartment label.

Summary response:
```json
{
  "date": "2026-10-20",
  "building": { "intervals": 0, "solarWh": 0, "allocatedWh": 0, "exportedWh": 0, "demandWh": 0, "solarUsedPct": 0 },
  "apartments": [ { "apartmentId": "…", "label": "Unit 1", "lotEntitlement": 10,
                    "demandWh": 0, "allocatedWh": 0, "selfSufficiencyPct": 0, "shareOfSolarPct": 0 } ]
}
```
- `selfSufficiencyPct` = allocated / demand.
- `shareOfSolarPct` = allocated / building allocated.
- `solarUsedPct` = building allocated / solar.
- A zero denominator gives 0. Round to 1 decimal **only in the response**.
- Every apartment appears, even with zeros.

### 5.8 WebSocket (Socket.IO, default namespace, same port as the API)
- `@WebSocketGateway({ cors: { origin: 'http://localhost:5173' } })`. In dev, the Vite proxy (§6.4) makes the connection same-origin anyway.
- **`reading`** event: the shape above. Emitted **after** the transaction commits. Never emitted for replays.
- **`device-status`** event: `{ buildingId, deviceId, status: "ONLINE" | "STALE" | "OFFLINE", lastReadingAt: string | null }`. `OFFLINE` means no reading since the server started.
- On `handleConnection`, send the current `device-status` to that client only.

---

## 6. Core logic specs

### 6.1 Allocation engine

```ts
export type ApartmentInput = { id: string; weight: number; demandWh: number }; // weight: 1 for EQUAL, lotEntitlement for ENTITLEMENT
export type AllocationResult = { allocations: { id: string; allocatedWh: number }[]; exportedWh: number };
export function allocate(solarWh: number, apartments: ApartmentInput[]): AllocationResult;
```
**Model:** solar is shared **in proportion to weight, but nobody gets more than they're using right now**. Energy one apartment can't use is shared again among those still wanting more ("water-filling"). Only energy that nobody can use is exported.

**Algorithm (integers only):**
1. Check inputs: `solarWh` is an integer ≥ 0, weights are integers > 0, `demandWh` values are integers ≥ 0, ids are unique, and the list is non-empty. Throw `RangeError` otherwise.
2. `remaining = solarWh`. `unmet[i] = demandWh[i]`. `active` = apartments with `unmet > 0`.
3. While `remaining > 0` and `active` is not empty:
   - `W = Σ weight` over active.
   - For each active apartment: `give = min(floor(remaining × weight / W), unmet)`. Allocate it.
   - `remaining -= Σ give`. Drop apartments whose `unmet` is now 0.
   - **If `Σ give == 0`** (every share floored to 0): give out the remaining Wh **one at a time** to active apartments, ordered by **weight descending, then id ascending (`localeCompare`)**, cycling, skipping anyone who becomes fully met, until `remaining == 0` or active is empty. Then stop.
4. `exportedWh = remaining`. Return allocations **in input order**.

`remaining × weight` stays far below `Number.MAX_SAFE_INTEGER` with these input bounds. Add a comment saying so.

> **As built:** the invariant test I4 failed on step 3's rounding as written above. Rounding dust is now placed once, by largest fractional remainder (then weight descending, then id ascending). All seven worked examples below give the same results. See ADR-007 in `DECISIONS.md`.

**Invariants (each gets a test):**
- I1 Conservation: `Σ allocatedWh + exportedWh === solarWh`.
- I2 Never over-supply: `allocatedWh[i] ≤ demandWh[i]`.
- I3 No waste: `exportedWh > 0` ⇒ every demand is fully met.
- I4 Proportional when scarce: if `Σ demand ≥ solarWh` and every apartment's demand is at least its proportional share, then `|allocatedWh[i] − solarWh × wᵢ / W| < 1`.
- I5 Deterministic and order-independent: shuffling the input gives the same allocation per id.
- I6 Integers: every output is an integer ≥ 0.

**Worked examples (table-driven tests; ids are `a`, `b`, `c`):**

| Case | solarWh | weights | demands | expected alloc | export |
|---|---|---|---|---|---|
| Surplus | 1000 | 1,1,1 | 100,200,300 | 100,200,300 | 400 |
| Scarce, equal | 300 | 1,1,1 | 500,500,500 | 100,100,100 | 0 |
| Redistribute | 300 | 1,1,1 | 50,500,500 | 50,125,125 | 0 |
| Scarce, weighted | 100 | 10,30 | 1000,1000 | 25,75 | 0 |
| Remainder | 10 | 1,1,1 | 100,100,100 | 4,3,3 | 0 |
| Zero solar | 0 | 1,1 | 100,100 | 0,0 | 0 |
| Zero demand | 500 | 1,1 | 0,0 | 0,0 | 500 |

Plus a **seeded property test**: 1,000 random cases from `mulberry32` (no extra library), 1–12 apartments, weights 1–50, demands 0–3000, solar 0–2500, checking I1, I2, I3, I5 and I6.

### 6.2 Simulator
- `prng.ts`: `mulberry32(seed)` returning floats in `[0,1)`. Seed from `SIM_SEED` (default 42).
- **Simulated clock:** `intervalStart` is stored in UTC. On start, begin at the interval after the latest stored reading for the device. If there is none, begin at **today 00:00 Melbourne local time**. Each tick moves forward 5 minutes. This avoids 409s after a restart.
- **Local time** (`common/local-time.ts`, `Intl.DateTimeFormat`, no date library): demand bumps, the simulator's start, the seed's "yesterday" and the daily summary all use the **Australia/Melbourne** local day and hour. A local day is 288 intervals, 276 on the day daylight saving starts (e.g. 2026-10-04) and 300 on the day it ends (e.g. 2026-04-05).
- **Tick:** every `speedMs` real ms (default 2000; 288 ticks ≈ 9.6 min per simulated day).
  - `start` while running with a new `speedMs` restarts the timer at the new speed.
  - `start` with the same speed does nothing.
  - `stop` clears the timer.
  - Clear timers in `onModuleDestroy`.
  - Never let two ticks overlap: skip a tick if the previous `ingest` hasn't finished.
- **Solar from real weather** (ADR-008). The source is the Open-Meteo forecast API (free, no key, CC BY 4.0, Node's built-in `fetch`), queried for the site's coordinates with `hourly=shortwave_radiation,cloud_cover`, `daily=sunrise,sunset,sunshine_duration,daylight_duration`, `timezone=Australia/Melbourne`, `timeformat=unixtime`, `past_days=2` and `forecast_days=7`.
  - Hourly `shortwave_radiation` (W/m²) is the **mean of the preceding hour**, so each value sits at the middle of its hour (a value stamped 13:00 is placed at 12:30). It is interpolated linearly to the **midpoint** of each 5-minute interval.
  - `solarWh = clamp(round(capacityW × irradiance / 1000 × 0.8 × 5 / 60), 0, capacityW × 5 / 60)`. 0.8 is the performance ratio (`PERFORMANCE_RATIO`, `profiles.ts`, pure).
  - `WeatherService` caches one response per local date in memory: past dates forever, today and future dates for 1 hour. After a failed fetch it waits 60 s before retrying, and concurrent callers share one fetch.
  - **Fallback:** if the API fails or the date is outside the response, `WeatherService` logs one warning (Nest `Logger`) and the generator uses the previous clear-sky curve, so the simulator never stops. In that curve `h` is the local fractional hour, `clearSky = (6 ≤ h ≤ 18) ? sin(π (h − 6) / 12) : 0`, and `cloud = 0.7 × prevCloud + 0.3 × (0.6 + 0.4 × prng())`, starting from 1.
  - **Tests never call the network.** Unit tests parse one saved real response (`api/src/weather/__fixtures__/`); e2e tests replace the weather provider with a fake through Nest's testing module.
- **Demand** per apartment (simulated; ADR-009). It is a pure function `intervalDemandWh` of (`SIM_SEED`, flat index, Melbourne local date, interval of the day) plus the temperature, using `mulberry32` streams seeded from those parts. It never depends on earlier readings, so restarts and re-seeds replay.
  - **Household size from lot size** (one constant): entitlement 10 → 1 person, 15 → 2, 20 → 2, 30 → 3. Daily targets are 1 ≈ 7 kWh, 2 ≈ 10 kWh and 3 ≈ 13 kWh, a building average of about 10 kWh/day per flat, in line with CitiPower's 9.9 kWh/day for units in 2025 (a benchmark, not the source of the shape).
  - **Shape:** one normalised 24-hour **illustrative typical residential load shape (not measured)**, as hourly fractions summing to 1. It has a low overnight base, a morning peak around 06:30–08:30, low weekday daytime use and an evening peak around 17:30–21:30. A **weekend** variant has a later, smaller morning peak and more daytime use. It is interpolated linearly between hour centres, with no step at the hour.
  - **Variation:**
    - each flat's routine is shifted by a seeded −45…+45 minutes;
    - a daily multiplier of 0.85–1.15 per (flat, date);
    - smooth mean-reverting (AR(1)) noise per flat, mean-zero over the day, for a median interval-to-interval change under 6 %;
    - appliance events in waking hours: +40–150 Wh for 1–4 intervals at a low seeded probability, taken out of the day's budget.
  - **Heating and cooling:** `temperature_2m` from the same Open-Meteo request (instantaneous at its timestamp, so interpolated without the half-hour offset). In waking hours, 40 W per °C below 16 °C and 60 W per °C above 26 °C are added, capped at 600 W. Nothing is added when the temperature is missing (fallback).
  - Clamp to `[0, 10000]` and round.
- Each tick asks `WeatherService` for the interval's irradiance, builds the **same `CreateReadingDto`**, and calls `ReadingsService.ingest(buildingId, dto)`. Log and continue on errors; never crash the timer.

### 6.3 Device status / stale detection
- Pure function `computeStatus(lastReadingAt: number | null, now: number, thresholdMs: number): 'OFFLINE' | 'ONLINE' | 'STALE'` in `device-status.ts`.
- `DeviceStatusService` records `lastReadingAt` (wall clock) when `ingest` stores a **new** reading.
- A 1-second `setInterval` (cleared in `onModuleDestroy`) recomputes the status with `thresholdMs = 3 × simulator speedMs`. It **emits through the gateway only when the status changes**.
- Avoid circular imports: `ReadingsService` publishes through a small plain `LiveEventsService` (an RxJS `Subject` is fine; no event-emitter package) that the gateway and the device-status service both subscribe to.

### 6.4 Frontend
**`vite.config.ts` dev proxy (required for WebSockets):**
```ts
server: {
  proxy: {
    '/api': 'http://localhost:3000',
    '/socket.io': { target: 'http://localhost:3000', ws: true },
  },
},
```
The web app calls relative URLs (`/api/...`) and `io()` with no URL.

**Which date the summary and weather use:** use the **simulated date**, meaning the Melbourne local date of the latest reading's `intervalStart` (or of `simulatedTime` from `/simulator/status`), **not** the browser's date. The simulated clock runs ahead of real time. All times on screen are Melbourne local time with the zone (e.g. "06:30 AEDT").

| Component | Shows | Notes |
|---|---|---|
| `BuildingHeader` | Building name, capacity (kW), device status pill | Status as **text plus colour** (Online green / Stale amber / Offline grey). `title` shows the last reading time. `data-testid="device-status"` |
| `SplitModeToggle` | Radio group *Equal* / *By lot entitlement* / *Owner-set shares* | Real radios in `<fieldset><legend>`. PATCHes on change and shows "Applies from the next interval". Reverts and shows an error if the PATCH fails. `data-testid="split-entitlement"` / `"split-custom"` on those radios |
| `OwnerSettings` | "Building owner settings" disclosure (`<details>`) under Split mode: one labelled number input (%) per unit, a live total in an `aria-live` region | Real labels in a `<fieldset><legend>`. Save is disabled unless every share is a whole number from 1 to 100 and the total is exactly 100. PUTs `/shares` and shows "Applies from the next interval", or reverts with an error. Works at 375 px. No auth in this demo |
| `LiveFlow` | Simulated time, solar Wh, allocated Wh, exported Wh, split mode used | `aria-live="polite"`. Shows "Waiting for first reading…" when empty. `data-testid="live-split-mode"` on the split mode value |
| `ApartmentBars` | Per unit: label, entitlement, allocated vs demand bar, numbers in Wh | Bar is a styled `<div role="meter" aria-valuemin="0" :aria-valuemax="demandWh" :aria-valuenow="allocatedWh" :aria-label="…">` **plus** visible numbers. No chart library |
| `DailySummary` | `/summary` table for the simulated date | Refetches every 10 readings and when the date changes, plus a manual refresh button. Real `<table>`, `<th scope>`, `<caption>` |
| `SimulatorControls` | Start / Stop, speed select (1 s / 2 s / 5 s) | Buttons disabled while a request is in flight. `data-testid="sim-start"` / `"sim-stop"` |
| `WeatherCard` | "Weather in Fawkner": sunrise and sunset, "Sunshine X h of Y h daylight", this hour's cloud cover and sunlight (W/m²) from `/api/weather` for the simulated date | Says so when the source is `fallback`. Always shows "Weather data: Open-Meteo.com (CC BY 4.0)" with links |

- **Composables:**
  - `useLive()`: one socket per app; reactive `connected`, `latestReading`, `deviceStatus`, `recentReadings` (ring buffer of 50). Shows "Reconnecting…" while disconnected. Disconnects in `onUnmounted`.
  - `useBuilding()`: loads the first building, PATCHes split mode, PUTs owner shares.
  - No Pinia, no Router.
- **Styling:** plain CSS with custom properties. Clean, light, generous spacing. Solar yellow `#F5B700` for allocated, slate `#475569` for demand, text contrast ≥ 4.5:1. Must look tidy at 1280×720 and 375 px wide.

### 6.5 Summary query
- Build the Melbourne local day range `[date 00:00 local, next day 00:00 local)` as UTC instants (§6.2 "Local time").
- Use Prisma `aggregate` on `Reading` (`_sum` of solarWh and exportedWh, `_count`).
- Use `groupBy({ by: ['apartmentId'], where: { reading: { buildingId, intervalStart: { gte, lt } } }, _sum: … })` on `Allocation` and `Demand`.
- If a relation filter in `groupBy` misbehaves, use `$queryRaw` with a **tagged template** (parameterised). **Never `$queryRawUnsafe`.**

---

## 7. Testing plan

| Layer | Tool | Must cover |
|---|---|---|
| Engine | Jest | 7 worked examples, I1–I6, the 1,000-case property test, every `RangeError` case |
| Time helpers | Jest | Alignment accepts `…:05:00.000Z` and rejects `…:03:00Z` and `…:05:01Z`; Melbourne local day bounds, incl. 276 intervals on 2026-10-04 and 300 on 2026-04-05 |
| Weather | Jest | Irradiance → Wh and interpolation; the Open-Meteo parser on the saved response; `WeatherService` cache, fallback and retry with a fake provider and clock (no network) |
| Device status | Jest (+ fake timers for the service) | OFFLINE → ONLINE → STALE → ONLINE; emits only on change |
| Profiles | Jest | Solar is 0 at night and ≤ the cap at noon; demand stays in bounds; the same seed gives the same sequence |
| API e2e | Jest + Supertest on `fairshare_test` (reset by the script in §5.4; tables truncated in `beforeEach` with `TRUNCATE … RESTART IDENTITY CASCADE` and a re-seeded building) | 201 stores rows and the response adds up; 200 replay writes nothing (row count unchanged); 409 conflict; 400 for misaligned time, missing / unknown / duplicate apartment, float or negative Wh, solar over capacity, unknown fields; 404 unknown building; PATCH changes **only later** readings' `splitModeUsed`; summary matches hand-calculated totals for 2 known readings; the DB `CHECK` rejects a negative value inserted directly |
| Components | Vitest + Vue Test Utils | `ApartmentBars`: one meter per apartment with correct aria values. `SplitModeToggle`: PATCH called and reverts on error (mock `fetch`) |
| E2E | Cypress | Visit → start (speed 1 s) → `device-status` shows Online within 5 s → click `split-entitlement` → within 5 s `live-split-mode` shows ENTITLEMENT → stop → `device-status` shows Stale within 8 s |

- Close the Nest app in `afterAll` (`app.close()`) so Jest exits cleanly. Use `--detectOpenHandles` if it hangs.
- The e2e tests must **not** start the simulator timer. Only the Cypress test does.

---

## 8. Decisions to record in `DECISIONS.md` (short ADRs: Context / Decision / Consequences)
1. **ADR-001 Integer watt-hours everywhere.** Floats drift, and conservation must hold exactly (the same reasoning as integer cents in a ledger). Backed by DB `CHECK`s.
2. **ADR-002 Stack pins: NestJS 11 + Prisma 6 + TypeScript 5.9 on local PostgreSQL 17.** A mainstream Postgres / Jest / CommonJS NestJS stack. Avoids the NestJS 12 ESM switch, the Prisma 7 adapter / config changes, the Prisma 8 RC and TypeScript 7 (which ts-jest doesn't support) inside a one-day timebox. The upgrade path is noted.
3. **ADR-003 Split mode applies from the next interval.** `splitModeUsed` is stored for each reading, so history stays true.
4. **ADR-004 One ingestion path.** The simulator and seed call the same validated service as HTTP.
5. **ADR-005 Duplicated DTO types in `web/src/types.ts`.** A shared package isn't worth its build setup for a one-day demo.
6. **ADR-006 Idempotent ingest:** `(deviceId, intervalStart)` unique key + payload hash, so device retries are safe and conflicts are loud (409).
7. **ADR-007 Water-filling allocation model.** Why it was chosen, and a clear statement that it isn't any commercial product's algorithm.

---

## 9. Out of scope (don't build these)
- Auth, users, more than one building in the UI
- Batteries, tariffs, dollar savings, billing
- MQTT / AWS IoT Core, time-series databases, Docker, cloud deployment, Infrastructure as Code
- Pinia, Vue Router, UI or chart libraries, `@nestjs/schedule`
- A date picker, i18n, dark mode, a mobile app

Mention the relevant ones under README "What I'd do next" instead.

---

## 10. Documentation contents

**README.md** (keep it scannable):
1. Pitch + `docs/dashboard.png`
2. **Why I built this:** the author's motivation, and the independence disclaimer from §1. This is the only section where third-party company or product names may appear.
3. **Quick start (Windows PowerShell):** prerequisites (Node 24, PostgreSQL 17), DB setup (§5.3), `npm install`, `npm run db:setup`, `npm run dev`, open http://localhost:5173
4. **Architecture:** Mermaid diagram (Simulator → ReadingsService → PostgreSQL → LiveEvents → Socket.IO → Vue)
5. **Allocation model:** plain English + the invariants
6. **Testing:** how to run each layer, what's covered
7. **How I used AI:** honest. Claude Code helped scaffold and draft; every change was reviewed, and the invariant and property tests hold AI-written code to the same bar. Record at least one real case where a test caught a mistake (note it while building).
8. **What I'd do next:** device ingest over MQTT / AWS IoT Core; time-series storage (e.g. Timestream or TimescaleDB); batteries; auth; deploy with IaC; NestJS 12 / Prisma 7 upgrade

**RUNBOOK.md** (half a page): alert *"Device Stale"*. Cover:
- what it means and how it's detected (threshold);
- first checks: is the simulator running (`GET /api/simulator/status`), API logs, `GET /api/buildings/:id/readings?limit=1`, whether the Postgres service is running;
- how to recover;
- when to escalate.

---

## 11. Build plan (about 8 hours; commit at the end of each milestone)

| # | Milestone | Time | Done when |
|---|---|---|---|
| M1 | Scaffold (§5.2), version check (§5.1), DB setup with the user (§5.3), root scripts, `/api/health` through the Vite proxy | 60 min | `npm run dev` starts both; health shows `db: up` |
| M2 | **Allocation engine, test-first** | 75 min | All engine tests green |
| M3 | Schema, migrations incl. CHECKs, PrismaService, seed (without history), buildings module | 45 min | Seed creates Demo Building A; GET / PATCH work |
| M4 | Ingest (DTOs, check order, transaction, idempotency, P2002), readings list, summary, e2e suite | 90 min | All API e2e tests green |
| M5 | Simulator, device status, LiveEvents, gateway + unit tests; seed history (F12) | 60 min | Start / stop works; events seen in the browser console |
| M6 | Vue dashboard: proxy, composables, 6 components, styling, 2 component tests | 90 min | J1–J3 work in the browser |
| M7 | Cypress smoke, CI workflow, README / DECISIONS / RUNBOOK, screenshot | 45 min | Fresh clone + DB setup + 3 commands works |
| — | Buffer | 15 min | — |

## 12. Rules for Claude while building
- Go **milestone by milestone**. At the end of each: run `npm run lint`, `npm run typecheck` and the relevant tests, move on only when they're green, and commit (e.g. `feat(allocation): water-filling engine with invariant tests`).
- **Keep it small.** Nothing beyond this file. Put tempting extras in README "What I'd do next".
- **Tests before or with code**, never "later". The engine and ingest are test-driven.
- TypeScript `strict` in both apps. No `any` except at commented boundaries.
- No floats in stored energy. No `console.log` in committed API code (use Nest `Logger`).
- Pure logic (allocation, profiles, status, time helpers) lives in plain `.ts` files with no framework imports.
- Windows: cross-platform npm scripts only (`cross-env`, `rimraf`, `dotenv-cli`, `concurrently`). PowerShell for any shell commands you show the user.
- **Version discipline:** never run a bare `npm i <pkg>` for Nest, Prisma or TypeScript. Always use the pinned versions in §5.1.
- No third-party company or product names or branding outside the README's "Why I built this" section (§1).
- Write each real trade-off into `DECISIONS.md` when you make it.
- Secrets: `.env*` files are git-ignored; only `.env.example` is committed. Never echo the DB password back in chat.
- If the same step fails twice in the same way, stop and explain the problem to the user instead of trying random fixes.
- Never push to GitHub. The user pushes.

## 13. Definition of done
- [ ] Fresh clone: DB setup (§5.3) + `npm install` + `npm run db:setup` + `npm run dev` works on Windows, exactly as the README says.
- [ ] J1–J3 work in the browser; J4 is covered by e2e tests.
- [ ] All tests green: engine (incl. property), time, device status, profiles, API e2e, component tests, Cypress smoke.
- [ ] Lint and typecheck clean in both workspaces. `npm ls` shows the pinned majors.
- [ ] README (with screenshot), DECISIONS.md (7 ADRs) and RUNBOOK.md written.
- [ ] The repo is published publicly by the user.
