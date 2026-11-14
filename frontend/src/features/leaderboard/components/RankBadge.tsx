import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/** Rank medallion: gold/silver/bronze for the podium, muted for everyone else. */
export const RankBadge = ({ rank }: { rank: number }): ReactNode => {
    const tone =
        rank === 1
            ? "bg-amber-400/15 text-amber-400 ring-amber-400/40"
            : rank === 2
              ? "bg-zinc-300/10 text-zinc-300 ring-zinc-300/40"
              : rank === 3
                ? "bg-orange-400/10 text-orange-400 ring-orange-400/40"
                : "bg-overlay text-ink-muted ring-transparent";

    return (
        <span
            className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 tabular",
                tone,
            )}
        >
            {rank}
        </span>
    );
};
