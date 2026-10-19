/** Shared limits used by validation and by the simulator. Pure: no framework imports. */

/** The 5-minute grid every device reports on (SPEC.md §5.7 check 2). */
export const INTERVAL_MINUTES = 5;

/** Upper bound for one apartment's demand in one interval (SPEC.md §5.7 check 1). */
export const MAX_DEMAND_WH = 10_000;
