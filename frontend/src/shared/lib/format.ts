/** Formatting helpers — pure functions, unit-testable in isolation. */

/** 1234567 → "1,234,567" (en-US keeps columns stable and readable). */
export const formatNumber = (value: number): string => new Intl.NumberFormat("en-US").format(value);

/** Full timestamp → "Nov 14, 2026, 10:23". */
export const formatDateTime = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "unknown";

    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** ISO timestamp → "just now" / "5m ago" / "3h ago" / "2d ago". */
export const formatRelativeTime = (iso: string, now: Date = new Date()): string => {
    const timestamp = Date.parse(iso);
    if (Number.isNaN(timestamp)) return "unknown";

    const elapsed = now.getTime() - timestamp;
    if (elapsed < MINUTE_MS) return "just now";
    if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
    if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
    return `${Math.floor(elapsed / DAY_MS)}d ago`;
};

/** Seconds → "Retry in 42s" friendly value; null when unknown. */
export const formatRetryDelay = (seconds: number): string =>
    seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds}s`;
