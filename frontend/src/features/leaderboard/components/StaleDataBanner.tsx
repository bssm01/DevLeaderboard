import type { ReactNode } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { formatRetryDelay } from "@/shared/lib/format";

interface StaleDataBannerProps {
    /** Seconds from `Retry-After`, when the server sent one. */
    retryAfterSeconds: number | null;
    onRetry: () => void;
    busy?: boolean;
}

/**
 * Shown when a refresh failed but a previous snapshot is still on screen.
 * This is the backend's documented failure mode: reads never depend on
 * GitHub, so the right response is "serving the last snapshot", not an error.
 */
export const StaleDataBanner = ({
    retryAfterSeconds,
    onRetry,
    busy = false,
}: StaleDataBannerProps): ReactNode => (
    <div
        role="status"
        className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
        <div className="flex items-start gap-2.5">
            <CloudOff size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            <div className="text-sm">
                <p className="font-medium text-ink">GitHub is unavailable</p>
                <p className="text-ink-muted">
                    Showing the last snapshot.
                    {retryAfterSeconds !== null && (
                        <> Retry in {formatRetryDelay(retryAfterSeconds)}.</>
                    )}
                </p>
            </div>
        </div>

        <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-overlay disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
        >
            <RefreshCw size={14} className={busy ? "animate-spin" : undefined} aria-hidden />
            Retry
        </button>
    </div>
);
