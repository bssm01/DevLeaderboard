/* TEMPORARY Phase 4 gate — deleted before commit (tests are Phase 6). */
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "./src/app/layout/AppLayout";
import { HomePage } from "./src/features/home/pages/HomePage";
import { LeaderboardPage } from "./src/features/leaderboard/pages/LeaderboardPage";
import { LoginPage } from "./src/features/auth/pages/LoginPage";
import { RegisterPage } from "./src/features/auth/pages/RegisterPage";
import { ProtectedRoute } from "./src/features/auth/ProtectedRoute";
import { NotFoundPage } from "./src/app/pages/NotFoundPage";
import { AuthProvider } from "./src/features/auth/AuthProvider";
import { AuthContext, useAuth } from "./src/features/auth/authContext";
import { ToastProvider } from "./src/shared/ui/ToastProvider";
import type { PublicUser } from "./src/shared/api/types";

const assert = (label: string, condition: boolean): void => {
    console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
    if (!condition) process.exitCode = 1;
};

const USER: PublicUser = { id: "u1", name: "Ada", email: "ada@example.com", image: "" };

interface RenderOptions {
    path: string;
    /** null → no session; object → that session is restored. */
    session?: { token: string; user: PublicUser } | null;
}

const render = ({ path, session = null }: RenderOptions): string => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(
        [
            {
                path: "/",
                element: <AppLayout />,
                children: [
                    { index: true, element: <HomePage /> },
                    { path: "leaderboard/:org", element: <LeaderboardPage /> },
                    { path: "login", element: <LoginPage /> },
                    { path: "register", element: <RegisterPage /> },
                    {
                        path: "settings",
                        element: (
                            <ProtectedRoute>
                                <p>secret-settings</p>
                            </ProtectedRoute>
                        ),
                    },
                    { path: "*", element: <NotFoundPage /> },
                ],
            },
        ],
        { initialEntries: [path] },
    );

    // Real AuthProvider reads localStorage (absent under SSR), so the session
    // is injected through the context to exercise the signed-in render path.
    const inner = (
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <AuthProvider>
                    {session === null ? (
                        <RouterProvider router={router} />
                    ) : (
                        <AuthContext.Provider
                            value={{
                                user: session.user,
                                token: session.token,
                                login: async () => undefined,
                                register: async () => undefined,
                                logout: () => undefined,
                            }}
                        >
                            <RouterProvider router={router} />
                        </AuthContext.Provider>
                    )}
                </AuthProvider>
            </ToastProvider>
        </QueryClientProvider>
    );

    return renderToString(inner);
};

// --- 1. Login form renders with a11y wiring ---
const login = render({ path: "/login" });
assert("login renders heading", login.includes("Welcome back"));
assert("login has email field", login.includes('type="email"'));
assert("login has password field", login.includes('type="password"'));
assert("login links to register", login.includes("/register"));
assert("login submit button", login.includes("Sign in"));

// --- 2. Register form renders ---
const register = render({ path: "/register" });
assert("register renders heading", register.includes("Create your account"));
assert("register has confirm password", register.includes("Confirm password"));
assert("register links to login", register.includes("/login"));

// --- 3. Protected route: signed out → content must not leak ---
// NOTE: <Navigate> performs the redirect inside useEffect, which renderToString
// never runs — so we assert the security property (no content leak) here, and
// the redirect itself is verified by the browser-side behaviour of react-router.
const protectedLoggedOut = render({ path: "/settings" });
assert(
    "signed out → protected content hidden",
    !protectedLoggedOut.includes("secret-settings"),
);
assert("signed out → header still shows Sign in", protectedLoggedOut.includes("Sign in"));

// --- 4. Protected route: signed in → content renders ---
const protectedLoggedIn = render({ path: "/settings", session: { token: "t", user: USER } });
assert("signed in → protected content", protectedLoggedIn.includes("secret-settings"));
assert(
    "signed in → header shows user name",
    protectedLoggedIn.includes("Ada") && protectedLoggedIn.includes("Sign out"),
);

// --- 5. Header auth state flips with the session ---
const homeLoggedOut = render({ path: "/" });
assert("signed out header → Sign in", homeLoggedOut.includes("Sign in"));
assert(
    "signed out header hides Sign out",
    !homeLoggedOut.includes("Sign out"),
);

// --- 6. Signed-in user doesn't see the login form ---
// (Same SSR caveat: the <Navigate> home-redirect is effect-driven, so we
// assert the form is gone rather than the destination being rendered.)
const loginWhenLoggedIn = render({ path: "/login", session: { token: "t", user: USER } });
assert(
    "signed in on /login → login form suppressed",
    !loginWhenLoggedIn.includes("Welcome back"),
);

// --- 7. useAuth outside provider throws (wiring bug caught) ---
let threw = false;
try {
    renderToString(<AuthProbe />);
} catch {
    threw = true;
}
assert("useAuth outside provider throws", threw);

console.log("\nPhase 4 render gate done.");

/** Uses useAuth; must throw when rendered outside <AuthProvider>. */
function AuthProbe(): ReactNode {
    useAuth();
    return null;
}
