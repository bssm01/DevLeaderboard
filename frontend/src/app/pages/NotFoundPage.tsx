import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export const NotFoundPage = (): ReactNode => (
    <section className="flex flex-col items-center gap-4 pt-24 text-center">
        <p className="text-5xl font-semibold tracking-tight text-accent-500">404</p>
        <h1 className="text-xl font-medium">Page not found</h1>
        <p className="text-sm text-ink-muted">That route doesn't exist.</p>
        <Link
            to="/"
            className="mt-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium transition-colors duration-150 hover:bg-overlay"
        >
            Back home
        </Link>
    </section>
);
