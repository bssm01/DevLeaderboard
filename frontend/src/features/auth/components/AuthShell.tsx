import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface AuthShellProps {
    title: string;
    description: string;
    children: ReactNode;
    /** Link rendered under the form (login ↔ register). */
    footer: { prompt: string; to: string; label: string };
}

/** Centered card used by both auth forms so they stay visually identical. */
export const AuthShell = ({ title, description, children, footer }: AuthShellProps): ReactNode => (
    <section className="mx-auto flex w-full max-w-sm flex-col gap-6 pt-10">
        <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1.5 text-sm text-ink-muted">{description}</p>
        </div>

        <div className="rounded-xl border border-line bg-surface p-6">{children}</div>

        <p className="text-center text-sm text-ink-muted">
            {footer.prompt}{" "}
            <Link
                to={footer.to}
                className="font-medium text-accent-400 transition-colors hover:text-accent-300"
            >
                {footer.label}
            </Link>
        </p>
    </section>
);
