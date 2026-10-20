# Runbook: "Device Stale"

## What it means

The dashboard's status pill shows **Stale** (amber) and the API emits `device-status` with `status: "STALE"`.

`DeviceStatusService` checks every second. A device is **STALE** when its last *new* reading is at least **3 × the simulator speed** old (6 s at the default 2 s per interval). Replays don't count as new readings. **OFFLINE** means no reading since the API started; **ONLINE** returns as soon as a new reading is stored. Hover the pill to see when the last reading arrived.

## First checks (in order)

1. **Is the simulator running?**
   ```powershell
   Invoke-RestMethod http://localhost:3000/api/simulator/status
   ```
   `running: false` means someone pressed Stop or the API restarted. Stale is expected: go to *Recover*.
2. **Is the API healthy and talking to Postgres?**
   ```powershell
   Invoke-RestMethod http://localhost:3000/api/health
   ```
   Expect `{ status: "ok", db: "up" }`. A 503 with `db: "down"` means the database is the problem (step 4).
3. **When was the last reading stored?** (id from `GET /api/buildings`)
   ```powershell
   Invoke-RestMethod "http://localhost:3000/api/buildings/<id>/readings?limit=1"
   ```
   Compare `intervalStart` with the simulator's `simulatedTime`. If the simulator is running but nothing new is stored, read the API logs (the `npm.cmd run dev` terminal) for `SimulatorService` warnings such as `Interval … failed: …`. Each failed tick is logged and skipped; the timer keeps going.
4. **Is PostgreSQL running?**
   ```powershell
   Get-Service postgresql-x64-17
   ```

## Recover

- **Simulator stopped:** press **Start simulator** (or `POST /api/simulator/start`). The clock resumes at the interval after the last stored reading, so there are no conflicts.
- **Postgres stopped:** `Start-Service postgresql-x64-17` (as administrator), then check `/api/health`. The simulator carries on by itself.
- **API down or hung:** stop and restart `npm.cmd run dev`, then press Start. Status shows OFFLINE until the first new reading.
- **Every tick fails with 409:** the stored data for upcoming intervals came from a different source. Check the warnings for the interval time. This is safe to leave; each failed interval is skipped.

## Related: weather source shows "fallback"

The weather card says "No weather data … clear-sky estimate", or `GET /api/weather?date=<simulated date>` returns `"source": "fallback"`. The simulator keeps running; only the solar estimate is less realistic. It is not a Stale alert.

1. **Is the simulated date within the forecast?** Open-Meteo covers 2 days back to 7 days ahead of *real* today. The simulated clock runs ahead, so after about a week of simulated days fallback is expected. This is normal for a long demo run.
2. **Check the API log** for `WeatherService` warnings: `Weather fetch failed (…)` (network, HTTP error or bad response) or `No weather data for <date>` (out of range). After a failure it retries every 60 s by itself.
3. **Can this machine reach Open-Meteo?**
   ```powershell
   Invoke-RestMethod "https://api.open-meteo.com/v1/forecast?latitude=-37.707&longitude=144.968&hourly=shortwave_radiation&timezone=Australia%2FMelbourne&forecast_days=1"
   ```
   If this fails, the cause is the network or a proxy, or Open-Meteo is down (check https://open-meteo.com/). No API key is involved.
4. **Recover:** once Open-Meteo is reachable, new intervals use real weather again within a minute. Intervals already stored on the fallback stay as they are (ADR-003: history isn't rewritten). If the simulated date is simply too far ahead, a database reset and re-seed brings the clock back to today (the user does this; see README).

## Escalate when

- `/api/health` keeps reporting `db: "down"` after Postgres has been restarted;
- the simulator is running and healthy but no new readings appear for more than 1 minute, and the logs show repeated non-409 errors;
- readings arrive whose allocated + exported doesn't equal solar (this should be impossible: ADR-001, ADR-007).

Escalate to the API owner with the time of the first failure, the output of all four checks above, and the API log excerpt.
