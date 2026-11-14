import type { ReactNode } from "react";
import type { LeaderboardEntry } from "@/shared/api/types";
import { formatNumber } from "@/shared/lib/format";
import { RankBadge } from "./RankBadge";

interface ScoreTableProps {
    entries: LeaderboardEntry[];
}

const HEADERS = ["Rank", "Contributor", "Commits", "PRs", "Reviews", "Issues", "Score"] as const;

const cellClass = "px-4 py-3 text-sm tabular text-ink-muted";

/** Desktop leaderboard. `table-fixed` + right-aligned numerics keep columns stable. */
export const ScoreTable = ({ entries }: ScoreTableProps): ReactNode => (
    <div className="hidden overflow-hidden rounded-xl border border-line bg-surface md:block">
        <table className="w-full table-fixed border-collapse">
            <thead>
                <tr className="border-b border-line bg-overlay/40 text-left">
                    {HEADERS.map((header, index) => (
                        <th
                            key={header}
                            scope="col"
                            className={[
                                "px-4 py-3 text-xs font-medium uppercase tracking-wide text-ink-faint",
                                index === 0 ? "w-16" : "",
                                index === 1 ? "w-auto" : "text-right",
                                index === HEADERS.length - 1
                                    ? "text-right text-ink-muted"
                                    : "",
                            ].join(" ")}
                        >
                            {header}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {entries.map((entry) => (
                    <tr
                        key={entry.key}
                        className="border-b border-line/60 transition-colors duration-150 last:border-0 hover:bg-overlay/50"
                    >
                        <td className="px-4 py-3">
                            <RankBadge rank={entry.rank} />
                        </td>
                        <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                                <img
                                    src={entry.avatarUrl}
                                    alt=""
                                    loading="lazy"
                                    className="size-8 shrink-0 rounded-full bg-overlay object-cover"
                                />
                                <span className="truncate text-sm font-medium text-ink">
                                    {entry.login}
                                </span>
                            </div>
                        </td>
                        <td className={`${cellClass} text-right`}>{formatNumber(entry.commits)}</td>
                        <td className={`${cellClass} text-right`}>
                            {formatNumber(entry.pullRequests)}
                        </td>
                        <td className={`${cellClass} text-right`}>{formatNumber(entry.reviews)}</td>
                        <td className={`${cellClass} text-right`}>{formatNumber(entry.issues)}</td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-ink tabular">
                            {formatNumber(entry.score)}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);
