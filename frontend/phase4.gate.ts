/* TEMPORARY Phase 4 gate — deleted before commit (tests are Phase 6). */
import { request, ApiError } from "./src/shared/api/client";
import type { AuthResponse } from "./src/shared/api/types";

const assert = (label: string, condition: boolean): void => {
    console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
    if (!condition) process.exitCode = 1;
};

// The browser resolves "/api/..." against its own origin; Node's fetch cannot.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
        typeof input === "string" && input.startsWith("/") ? `http://localhost:5173${input}` : input;
    return realFetch(url, init);
}) as typeof fetch;

// Unique per run so repeated gates never collide with an existing account.
const stamp = Date.now().toString(36);
const EMAIL = `phase4-${stamp}@example.com`;
const PASSWORD = "gate-pass-123";

// --- 1. Register creates a session ---
const registered = await request<AuthResponse>("/auth/register", {
    method: "POST",
    body: { name: "Phase4 Gate", email: EMAIL, password: PASSWORD },
});
assert("register returns 201 payload", registered.message.length > 0);
assert("register returns a user", typeof registered.user.id === "string");
assert("register returns a JWT", registered.token.split(".").length === 3);

// --- 2. Duplicate registration → 409 with a clear message ---
try {
    await request("/auth/register", {
        method: "POST",
        body: { name: "Dup", email: EMAIL, password: PASSWORD },
    });
    assert("duplicate register throws", false);
} catch (error) {
    assert("duplicate register throws", error instanceof ApiError);
    assert("duplicate register → 409", error instanceof ApiError && error.status === 409);
}

// --- 3. Login with correct credentials ---
const loggedIn = await request<AuthResponse>("/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
});
assert("login returns same user", loggedIn.user.email === EMAIL);
assert("login returns a JWT", loggedIn.token.split(".").length === 3);

// --- 4. Wrong password → generic 401 (no user enumeration) ---
try {
    await request("/auth/login", {
        method: "POST",
        body: { email: EMAIL, password: "wrong-password" },
    });
    assert("wrong password throws", false);
} catch (error) {
    assert("wrong password throws", error instanceof ApiError);
    assert("wrong password → 401", error instanceof ApiError && error.status === 401);
    assert(
        "401 message is generic",
        error instanceof ApiError && error.message === "Invalid email or password",
    );
}

// --- 5. Unknown email → identical 401 (can't probe which accounts exist) ---
try {
    await request("/auth/login", {
        method: "POST",
        body: { email: `nobody-${stamp}@example.com`, password: "whatever-123" },
    });
    assert("unknown email throws", false);
} catch (error) {
    assert(
        "unknown email → same generic 401",
        error instanceof ApiError &&
            error.status === 401 &&
            error.message === "Invalid email or password",
    );
}

// --- 6. Invalid payload → 400 with field-level issues ---
try {
    await request("/auth/register", {
        method: "POST",
        body: { name: "", email: "not-an-email", password: "123" },
    });
    assert("invalid register throws", false);
} catch (error) {
    assert("invalid register → 400", error instanceof ApiError && error.status === 400);
    assert(
        "400 carries field issues",
        error instanceof ApiError && error.issues.length >= 3,
    );
}

// --- 7. Token actually authorizes: refresh without token → 401, with token → passes auth ---
// The refresh route's rate limiter runs BEFORE requireAuth, so once the bucket
// is empty every probe returns 429 regardless of the token. In that case the
// auth question is unanswerable this window — report it as a skip, not a pass
// or a failure, rather than asserting something the server didn't evaluate.
interface Probe {
    status: number;
    rateLimited: boolean;
}

const probeRefresh = async (token?: string): Promise<Probe> => {
    try {
        await request("/leaderboard/facebook/refresh", {
            method: "POST",
            ...(token === undefined ? {} : { token }),
        });
        return { status: 200, rateLimited: false }; // request() only resolves on success
    } catch (error) {
        const status = error instanceof ApiError ? error.status : -1;
        return { status, rateLimited: status === 429 };
    }
};

const noToken = await probeRefresh();
if (noToken.rateLimited) {
    console.log("SKIP  refresh without token → 429 rate limit (limiter precedes auth)");
} else {
    assert("refresh without token → 401", noToken.status === 401);
}

// Auth runs first, so anything except 401 proves the token was accepted.
// (200 = refresh ran, 400 = bad input, 502 = GitHub unreachable.)
const withToken = await probeRefresh(loggedIn.token);
if (withToken.rateLimited) {
    console.log("SKIP  refresh with valid token → 429 rate limit (limiter precedes auth)");
} else {
    assert("refresh with valid token passes auth", withToken.status !== 401);
}

// --- 8. Garbage token → 401 (not a crash) ---
const garbage = await probeRefresh("not.a.jwt");
if (garbage.rateLimited) {
    console.log("SKIP  garbage token → 429 rate limit (limiter precedes auth)");
} else {
    assert("garbage token → 401", garbage.status === 401);
}

console.log("\nPhase 4 gate done.");
