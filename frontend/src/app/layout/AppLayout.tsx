import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Trophy } from "lucide-react";
import { useAuth } from "@/features/auth/authContext";

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
    [
        "rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
        isActive ? "bg-overlay text-ink" : "text-ink-muted hover:bg-overlay/60 hover:text-ink",
    ].join(" ");

/**
 * Shared page chrome: brand, primary nav, and the routed outlet below.
 * Deliberately quiet — the leaderboard is the hero of the product.
 */
export const AppLayout = (): React.ReactNode => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = (): void => {
        logout();
        navigate("/");
    };

    return (
        <div className="flex min-h-screen flex-col">
            <header className="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur">
                <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
                    <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
                        <span className="flex size-8 items-center justify-center rounded-lg bg-accent-600 text-white">
                            <Trophy size={16} aria-hidden />
                        </span>
                        <span className="text-[15px]">DevLeaderboard</span>
                    </Link>

                    <nav className="flex items-center gap-1">
                        <NavLink to="/" end className={navLinkClass}>
                            Home
                        </NavLink>
                        {user !== null ? (
                            <>
                                <span
                                    className="hidden max-w-[10rem] truncate px-3 text-sm text-ink-muted sm:block"
                                    title={user.email}
                                >
                                    {user.name}
                                </span>
                                <button
                                    type="button"
                                    onClick={handleLogout}
                                    className="rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors duration-150 hover:bg-overlay/60 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-500"
                                >
                                    Sign out
                                </button>
                            </>
                        ) : (
                            <NavLink to="/login" className={navLinkClass}>
                                Sign in
                            </NavLink>
                        )}
                    </nav>
                </div>
            </header>

            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
                <Outlet />
            </main>

            <footer className="border-t border-line">
                <div className="mx-auto w-full max-w-6xl px-4 py-6 text-sm text-ink-faint sm:px-6">
                    DevLeaderboard — contribution rankings, refreshed from GitHub.
                </div>
            </footer>
        </div>
    );
};
