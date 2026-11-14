import type { ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { ApiError } from "@/shared/api/client";
import { hasSnapshot, PERIODS, type Period } from "@/shared/api/types";
import { formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/shared/ui/States";
import { useLeaderboard, useLeaderboardMeta } from "../api";
import { PeriodTabs } from "../components/PeriodTabs";
import { ScoreCards } from "../components/ScoreCards";
import { ScoreTable } from "../components/ScoreTable";
import { MetaPanel } from "../components/MetaPanel";
import { StaleDataBanner } from "../components/StaleDataBanner";

const DEFAULT_PERIOD: Period = "30d";
const DEFAULT_LIMIT = 50;

const isPeriod = (value: string | null): value is Period =>
    value !== null && (PERIODS as readonly string[]).includes(value);

export const LeaderboardPage = (): ReactNode => {
    const { org = "" } = useParams<{ org: string }>();
    const [searchParams, setSearchParams] = useSearchParams();

    const period = isPeriod(searchParams.get("period")) ? (searchParams.get("period") as Period) : DEFAULT_PERIOD;
    const limit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);

    const leaderboard = useLeaderboard({ org, period, limit });
    const meta = useLeaderboardMeta(org);

    // Changing the period rewrites the URL so results are shareable/bookmarkable.
    const changePeriod = (next: Period): void => {
        const params = new URLSearchParams(searchParams);
        params.set("period", next);
        setSearchParams(params, { replace: true });
    };

    const retry = (): void => void leaderboard.refetch();

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-accent-400">
                        Leaderboard
                    </p>
                    <h1 className="mt-1 text-3xl font-semibold tracking-tight">{org}</h1>
                </div>
                <PeriodTabs value={period} onChange={changePeriod} disabled={leaderboard.isFetching} />
            </div>

            {/* Warnings from the last collection run — non-blocking by design. */}
            {leaderboard.data !== undefined && hasSnapshot(leaderboard.data) &&
                leaderboard.data.warnings.length > 0 && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink-muted">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                        <p>
                            {leaderboard.data.warnings.length} warning
                            {leaderboard.data.warnings.length > 1 ? "s" : ""} during the last
                            refresh: {leaderboard.data.warnings.join(" · ")}
                        </p>
                    </div>
                )}

            {/* States */}
            {leaderboard.isPending ? (
                <TableSkeleton />
            ) : leaderboard.isError && leaderboard.data === undefined ? (
                <ErrorState
                    title={
                        leaderboard.error instanceof ApiError && leaderboard.error.status === 404
                            ? "Organization not found"
                            : "Couldn't load the leaderboard"
                    }
                    description={
                        leaderboard.error instanceof ApiError
                            ? leaderboard.error.message
                            : "Something went wrong while loading this leaderboard."
                    }
                    action={
                        <Button variant="secondary" onClick={retry}>
                            <RefreshCw size={15} aria-hidden />
                            Try again
                        </Button>
                    }
                />
            ) : leaderboard.data !== undefined && hasSnapshot(leaderboard.data) ? (
                <>
                    {/* Refresh failed but a snapshot is cached: keep serving it. */}
                    {leaderboard.isError && (
                        <StaleDataBanner
                            retryAfterSeconds={
                                leaderboard.error instanceof ApiError
                                    ? leaderboard.error.retryAfterSeconds
                                    : null
                            }
                            onRetry={retry}
                            busy={leaderboard.isFetching}
                        />
                    )}

                    <p className="text-sm text-ink-faint">
                        Updated {formatRelativeTime(leaderboard.data.generatedAt)} · showing{" "}
                        <span className="text-ink-muted tabular">{leaderboard.data.count}</span> of{" "}
                        <span className="text-ink-muted tabular">{leaderboard.data.total}</span>{" "}
                        contributors
                    </p>

                    <ScoreTable entries={leaderboard.data.entries} />
                    <ScoreCards entries={leaderboard.data.entries} />
                </>
            ) : leaderboard.data !== undefined ? (
                <EmptyState
                    icon={<Inbox size={20} />}
                    title="No snapshot yet"
                    description={leaderboard.data.message}
                    action={
                        <Button variant="secondary" disabled>
                            <RefreshCw size={15} aria-hidden />
                            Run the first refresh
                        </Button>
                    }
                />
            ) : (
                // Should be unreachable: isPending | isError | data are exhaustive.
                <ErrorState title="Something went wrong" description="Please try again." />
            )}

            {meta.data !== undefined && <MetaPanel meta={meta.data} />}
        </div>
    );
};

/** Skeleton matching the table's geometry so nothing jumps on load. */
const TableSkeleton = (): ReactNode => (
    <div className="space-y-3" aria-busy aria-label="Loading leaderboard">
        <Skeleton className="h-4 w-56" />
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {Array.from({ length: 8 }, (_, index) => (
                <div
                    key={index}
                    className="flex items-center gap-4 border-b border-line/60 px-4 py-3.5 last:border-0"
                >
                    <Skeleton className="size-7 rounded-full" />
                    <Skeleton className="size-8 rounded-full" />
                    <Skeleton className="h-4 flex-1" style={{ maxWidth: `${40 + ((index * 7) % 30)}%` }} />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-14" />
                </div>
            ))}
        </div>
    </div>
);
