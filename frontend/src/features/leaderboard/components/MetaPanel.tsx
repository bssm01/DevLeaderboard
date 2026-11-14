import type { ReactNode } from "react";
import type { LeaderboardMeta, Period } from "@/shared/api/types";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/shared/lib/format";

interface MetaPanelProps {
    meta: LeaderboardMeta;
}

const PERIOD_LABELS: Record<Period, string> = {
    "7d": "7 days",
    "30d": "30 days",
    year: "This year",
};

/**
 * Secondary info: how scoring works, how fresh each snapshot is, and how much
 * GitHub quota the last call consumed. Read-only context, never blocking.
 */
export const MetaPanel = ({ meta }: MetaPanelProps): ReactNode => {
    const { rateLimit, scoreWeights, snapshots } = meta;
    const quotaPercent =
        rateLimit?.limit !== undefined && rateLimit.remaining !== undefined
            ? Math.round((rateLimit.remaining / rateLimit.limit) * 100)
            : null;

    return (
        <section className="grid gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-3">
            <div>
                <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Score weights
                </h2>
                <dl className="mt-3 space-y-1.5 text-sm">
                    {(
                        [
                            ["Commit", scoreWeights.Commit],
                            ["Pull request", scoreWeights.PullRequest],
                            ["Review", scoreWeights.Review],
                            ["Issue", scoreWeights.Issue],
                        ] as const
                    ).map(([label, weight]) => (
                        <div key={label} className="flex justify-between gap-3">
                            <dt className="text-ink-muted">{label}</dt>
                            <dd className="font-medium text-ink tabular">×{weight}</dd>
                        </div>
                    ))}
                </dl>
            </div>

            <div>
                <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Snapshots
                </h2>
                {snapshots.length === 0 ? (
                    <p className="mt-3 text-sm text-ink-faint">None generated yet.</p>
                ) : (
                    <dl className="mt-3 space-y-1.5 text-sm">
                        {snapshots.map((snapshot) => (
                            <div key={snapshot.period} className="flex justify-between gap-3">
                                <dt className="text-ink-muted">{PERIOD_LABELS[snapshot.period]}</dt>
                                <dd className="text-right">
                                    <span className="font-medium text-ink tabular">
                                        {formatNumber(snapshot.entryCount)}
                                    </span>
                                    <span className="text-ink-faint"> · </span>
                                    <span className="text-ink-faint">
                                        {formatRelativeTime(snapshot.generatedAt)}
                                    </span>
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}
            </div>

            <div>
                <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    GitHub quota
                </h2>
                {rateLimit === null || rateLimit === undefined ? (
                    <p className="mt-3 text-sm text-ink-faint">No GitHub call made yet.</p>
                ) : (
                    <div className="mt-3 space-y-2 text-sm">
                        <p className="text-ink-muted">
                            <span className="font-medium text-ink tabular">
                                {formatNumber(rateLimit.remaining ?? 0)}
                            </span>
                            <span className="text-ink-faint">
                                {" "}
                                of {formatNumber(rateLimit.limit ?? 0)} left
                            </span>
                        </p>
                        {quotaPercent !== null && (
                            <div
                                className="h-1.5 overflow-hidden rounded-full bg-overlay"
                                role="progressbar"
                                aria-valuenow={quotaPercent}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label="GitHub quota remaining"
                            >
                                <div
                                    className={
                                        quotaPercent > 25
                                            ? "h-full rounded-full bg-accent-500"
                                            : "h-full rounded-full bg-danger"
                                    }
                                    style={{ width: `${quotaPercent}%` }}
                                />
                            </div>
                        )}
                        {rateLimit.resetAt !== undefined && (
                            <p className="text-xs text-ink-faint">
                                Resets {formatDateTime(rateLimit.resetAt)}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
};
