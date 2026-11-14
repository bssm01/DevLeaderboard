/* TEMPORARY Phase 3 gate part 2 — render checks for new components. */
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "./src/app/layout/AppLayout";
import { HomePage } from "./src/features/home/pages/HomePage";
import { LeaderboardPage } from "./src/features/leaderboard/pages/LeaderboardPage";
import { NotFoundPage } from "./src/app/pages/NotFoundPage";
import { StaleDataBanner } from "./src/features/leaderboard/components/StaleDataBanner";
import { ToastProvider } from "./src/shared/ui/ToastProvider";
import { AuthProvider } from "./src/features/auth/AuthProvider";
import { useToast } from "./src/shared/ui/toastContext";
import type { ReactNode } from "react";

const assert = (label: string, condition: boolean): void => {
    console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
    if (!condition) process.exitCode = 1;
};

const render = (path: string): string => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(
        [
            {
                path: "/",
                element: <AppLayout />,
                children: [
                    { index: true, element: <HomePage /> },
                    { path: "leaderboard/:org", element: <LeaderboardPage /> },
                    { path: "*", element: <NotFoundPage /> },
                ],
            },
        ],
        { initialEntries: [path] },
    );

    return renderToString(
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <AuthProvider>
                    <RouterProvider router={router} />
                </AuthProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
};

// 1. Stale banner renders its message + retry affordance.
const banner = renderToString(
    <StaleDataBanner retryAfterSeconds={42} onRetry={() => undefined} />,
);
assert("banner names the failure", banner.includes("GitHub is unavailable"));
assert("banner explains state", banner.includes("Showing the last snapshot"));
assert("banner shows Retry-After", banner.includes("42s"));
assert("banner has retry button", banner.includes("Retry"));

const noDelay = renderToString(<StaleDataBanner retryAfterSeconds={null} onRetry={() => undefined} />);
assert("banner without Retry-After still renders", noDelay.includes("GitHub is unavailable"));
assert(
    "banner without Retry-After omits countdown",
    !noDelay.includes("Retry in"),
);

// 2. Toast wiring: provider renders, useToast throws outside it.
const withToast = render("/");
assert("app renders inside ToastProvider", withToast.includes("DevLeaderboard"));

let threw = false;
try {
    renderToString(<ToastProbe />);
} catch {
    threw = true;
}
assert("useToast outside provider throws (wiring bug caught)", threw);

// 3. Leaderboard still renders all base states.
const board = render("/leaderboard/tensiocare?period=30d");
assert("leaderboard renders org", board.includes("tensiocare"));
assert("leaderboard has radiogroup", board.includes('role="radiogroup"'));

console.log("\nPhase 3 render gate done.");

/** Uses useToast; must throw when rendered outside <ToastProvider>. */
function ToastProbe(): ReactNode {
    const push = useToast();
    push("should not run");
    return null;
}
