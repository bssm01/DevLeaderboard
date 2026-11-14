import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

interface EmptyStateProps {
    icon?: ReactNode;
    title: string;
    description?: string;
    action?: ReactNode;
}

/** Centered placeholder for "nothing to show yet" — never an error. */
export const EmptyState = ({ icon, title, description, action }: EmptyStateProps): ReactNode => (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-6 py-14 text-center">
        {icon !== undefined && (
            <span className="flex size-11 items-center justify-center rounded-full bg-overlay text-ink-muted">
                {icon}
            </span>
        )}
        <h2 className="text-base font-medium">{title}</h2>
        {description !== undefined && (
            <p className="max-w-md text-sm leading-relaxed text-ink-muted">{description}</p>
        )}
        {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
);

interface ErrorStateProps {
    title: string;
    description?: string;
    action?: ReactNode;
}

/** Failure panel with an explicit retry affordance. */
export const ErrorState = ({ title, description, action }: ErrorStateProps): ReactNode => (
    <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-xl border border-danger/30 bg-danger/10 px-6 py-12 text-center"
    >
        <h2 className="text-base font-medium text-ink">{title}</h2>
        {description !== undefined && (
            <p className="max-w-md text-sm leading-relaxed text-ink-muted">{description}</p>
        )}
        {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
);

/** Loading placeholder block that mirrors the shape of the real content. */
export const Skeleton = ({
    className,
    style,
}: {
    className?: string;
    style?: CSSProperties;
}): ReactNode => <div className={cn("animate-pulse rounded-md bg-overlay", className)} style={style} aria-hidden />;
