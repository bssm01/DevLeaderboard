export const PERIODS = ["7d", "30d", "year"] as const;

export type Period = (typeof PERIODS)[number];

export interface TimeWindow {
    from: Date;
    to: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// GitHub's contributionsCollection accepts at most one year of history;
// 364 days keeps us safely inside that bound (inclusive endpoints).
const YEAR_WINDOW_DAYS = 364;

const DAYS_BY_PERIOD: Record<Exclude<Period, "year">, number> = {
    "7d": 7,
    "30d": 30,
};

/** Deterministic UTC window for a period, relative to `now`. */
export const windowFor = (period: Period, now: Date = new Date()): TimeWindow => {
    const to = new Date(now);
    const days = period === "year" ? YEAR_WINDOW_DAYS : DAYS_BY_PERIOD[period];
    return { from: new Date(to.getTime() - days * DAY_MS), to };
};

