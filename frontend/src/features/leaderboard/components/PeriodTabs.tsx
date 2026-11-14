import type { ReactNode } from "react";
import { PERIODS, type Period } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";

interface PeriodTabsProps {
    value: Period;
    onChange: (period: Period) => void;
    disabled?: boolean;
}

const PERIOD_LABELS: Record<Period, string> = {
    "7d": "7 days",
    "30d": "30 days",
    year: "This year",
};

/** Segmented control for the time window. Keyboard accessible (radiogroup). */
export const PeriodTabs = ({ value, onChange, disabled = false }: PeriodTabsProps): ReactNode => (
    <div
        role="radiogroup"
        aria-label="Time period"
        className="inline-flex rounded-lg border border-line bg-surface p-1"
    >
        {PERIODS.map((period) => {
            const isActive = period === value;
            return (
                <button
                    key={period}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    disabled={disabled}
                    onClick={() => onChange(period)}
                    className={cn(
                        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150",
                        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-500",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        isActive ? "bg-accent-600 text-white" : "text-ink-muted hover:text-ink",
                    )}
                >
                    {PERIOD_LABELS[period]}
                </button>
            );
        })}
    </div>
);
