import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One real Open-Meteo response for Fawkner, requested on 2026-10-20
 * (past_days=2, forecast_days=7, so 18–26 October). Saved so tests never call
 * the network. Used by unit tests and by the e2e fake weather provider.
 */
export function loadOpenMeteoFixture(): unknown {
  return JSON.parse(
    readFileSync(join(__dirname, 'open-meteo-fawkner.json'), 'utf8'),
  ) as unknown;
}
