/* TEMPORARY Phase 2 gate — deleted before commit (tests are Phase 6). */
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "./src/app/layout/AppLayout";
import { HomePage } from "./src/features/home/pages/HomePage";
import { LeaderboardPage } from "./src/features/leaderboard/pages/LeaderboardPage";
import { NotFoundPage } from "./src/app/pages/NotFoundPage";
import { AuthProvider } from "./src/features/auth/AuthProvider";

const assert = (label: string, condition: boolean): void => {
    console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
    if (!condition) process.exitCode = 1;
};

const render = (path: string): string => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
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
            <AuthProvider>
                <RouterProvider router={router} />
            </AuthProvider>
        </QueryClientProvider>,
    );
};

// 1. Home renders the search form.
const home = render("/");
assert("home renders headline", home.includes("Who is shipping the most?"));
assert("home has org input", home.includes('aria-label="GitHub organization name"'));
assert("home suggests sample orgs", home.includes("facebook"));

// 2. Leaderboard renders (suspense/loading state first — no crash).
const board = render("/leaderboard/facebook?period=7d");
assert("leaderboard renders org heading", board.includes("facebook"));
assert("leaderboard has period radiogroup", board.includes('role="radiogroup"'));
assert("leaderboard active period = 7d", board.includes('aria-checked="true"'));
assert("leaderboard shows loading skeleton", board.includes("Loading leaderboard"));

// 3. Unknown route → 404 page.
const missing = render("/definitely/not/a/route");
assert("404 renders", missing.includes("Page not found"));

console.log("\nPhase 2 gate done.");
