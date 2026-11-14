import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Trophy } from "lucide-react";
import { Button } from "@/shared/ui/Button";

/** GitHub org logins: alphanumerics and single inner hyphens, max 39 chars. */
const ORG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export const HomePage = (): ReactNode => {
    const navigate = useNavigate();
    const [value, setValue] = useState("");
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();

        const org = value.trim();
        if (!ORG_PATTERN.test(org)) {
            setError("Enter a valid GitHub organization name.");
            return;
        }

        navigate(`/leaderboard/${encodeURIComponent(org)}`);
    };

    return (
        <section className="flex flex-col items-center gap-6 pt-16 text-center sm:pt-24">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted">
                <Search size={12} aria-hidden />
                GitHub organization rankings
            </span>

            <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
                Who is shipping the most?
            </h1>

            <p className="max-w-xl text-[15px] leading-relaxed text-ink-muted">
                Contributions across every repository of an organization — commits, pull requests,
                reviews and issues — scored, ranked and cached.
            </p>

            <form onSubmit={handleSubmit} className="w-full max-w-md pt-1" noValidate>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search
                            size={16}
                            aria-hidden
                            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
                        />
                        <input
                            value={value}
                            onChange={(event) => {
                                setValue(event.target.value);
                                if (error !== null) setError(null);
                            }}
                            placeholder="organization name"
                            aria-label="GitHub organization name"
                            aria-invalid={error !== null}
                            autoComplete="off"
                            spellCheck={false}
                            className="h-11 w-full rounded-lg border border-line bg-surface pl-10 pr-3.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25"
                        />
                    </div>
                    <Button type="submit" className="h-11 px-5">
                        View
                    </Button>
                </div>
                {error !== null && (
                    <p role="alert" className="mt-2 text-left text-sm text-danger">
                        {error}
                    </p>
                )}
            </form>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-1 text-sm">
                <span className="text-ink-faint">Try:</span>
                {["facebook", "vercel", "google"].map((org) => (
                    <button
                        key={org}
                        type="button"
                        onClick={() => navigate(`/leaderboard/${org}`)}
                        className="rounded-lg border border-line bg-surface px-3 py-1.5 font-medium text-ink-muted transition-colors duration-150 hover:bg-overlay hover:text-ink"
                    >
                        {org}
                    </button>
                ))}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
                <Button variant="secondary" onClick={() => navigate("/register")}>
                    Create an account
                </Button>
                <span className="hidden items-center gap-1.5 text-xs text-ink-faint sm:inline-flex">
                    <Trophy size={12} aria-hidden />
                    Sign in to trigger refreshes
                </span>
            </div>
        </section>
    );
};
