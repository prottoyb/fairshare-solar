/** The built-in simulator's device id (SPEC.md §5.6). */
export const SIM_DEVICE_ID = 'sim-device-001';

/** Real milliseconds between simulated 5-minute intervals (SPEC.md §6.2). */
export const DEFAULT_SPEED_MS = 2000;
export const MIN_SPEED_MS = 500;
export const MAX_SPEED_MS = 10_000;

/** Seed for the simulator's PRNG when SIM_SEED is not set. */
export const DEFAULT_SIM_SEED = 42;
