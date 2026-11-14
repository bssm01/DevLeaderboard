import type { ReactNode } from "react";
import type { LeaderboardEntry } from "@/shared/api/types";
import { formatNumber } from "@/shared/lib/format";
import { RankBadge } from "./RankBadge";

interface ScoreCardsProps {
    entries: LeaderboardEntry[];
}

/** Mobile counterpart of ScoreTable — stacked cards below the md breakpoint. */
export const ScoreCards = ({ entries }: ScoreCardsProps): ReactNode => (
    <ul className="space-y-2 md:hidden">
        {entries.map((entry) => (
            <li
                key={entry.key}
                className="rounded-xl border border-line bg-surface p-3.5 transition-colors duration-150 active:bg-overlay/60"
            >
                <div className="flex items-center gap-3">
                    <RankBadge rank={entry.rank} />
                    <img
                        src={entry.avatarUrl}
                        alt=""
                        loading="lazy"
                        className="size-8 shrink-0 rounded-full bg-overlay object-cover"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                        {entry.login}
                    </span>
                    <span className="text-sm font-semibold text-ink tabular">
                        {formatNumber(entry.score)}
                    </span>
                </div>

                <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-line/60 pt-3 text-center">
                    {(
                        [
                            ["Commits", entry.commits],
                            ["PRs", entry.pullRequests],
                            ["Reviews", entry.reviews],
                            ["Issues", entry.issues],
                        ] as const
                    ).map(([label, value]) => (
                        <div key={label}>
                            <dt className="text-[11px] uppercase tracking-wide text-ink-faint">
                                {label}
                            </dt>
                            <dd className="mt-0.5 text-sm text-ink-muted tabular">
                                {formatNumber(value)}
                            </dd>
                        </div>
                    ))}
                </dl>
            </li>
        ))}
    </ul>
);
