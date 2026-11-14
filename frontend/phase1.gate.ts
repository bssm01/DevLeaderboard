/* TEMPORARY Phase 1 gate — deleted before commit (tests are Phase 6). */
import { request, ApiError, isAuthError } from "./src/shared/api/client";
import { hasSnapshot, type LeaderboardMeta, type LeaderboardResult } from "./src/shared/api/types";

// The browser resolves "/api/..." against its own origin; Node's fetch cannot.
// Route relative URLs through the Vite dev server for this gate only.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" && input.startsWith("/")
        ? `http://localhost:5173${input}`
        : input;
    return realFetch(url, init);
}) as typeof fetch;

const assert = (label: string, condition: boolean): void => {
    console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
    if (!condition) process.exitCode = 1;
};

// 1. Snapshot-less org → 202 payload, narrows correctly.
//    (An org name that can never exist, so the 202 state is stable regardless
//    of what refreshes have run against real orgs in the meantime.)
const EMPTY_ORG = "no-such-org-gate-000";
const board = await request<LeaderboardResult>(`/leaderboard/${EMPTY_ORG}`);
assert("202 payload parses", board.org === EMPTY_ORG && board.period === "30d");
assert("hasSnapshot narrows 202 → false", hasSnapshot(board) === false);

// 1b. Org with a real snapshot → 200 payload, narrows correctly.
const populated = await request<LeaderboardResult>("/leaderboard/tensiocare?period=30d");
assert("200 payload parses", populated.org === "tensiocare");
assert("hasSnapshot narrows 200 → true", hasSnapshot(populated) === true);
assert(
    "narrowed payload exposes entries",
    hasSnapshot(populated) && Array.isArray(populated.entries),
);

// 2. Meta response parses into typed shape.
const meta = await request<LeaderboardMeta>("/leaderboard/facebook/meta");
assert(
    "meta scoreWeights complete",
    typeof meta.scoreWeights.Commit === "number" &&
        typeof meta.scoreWeights.PullRequest === "number" &&
        typeof meta.scoreWeights.Review === "number" &&
        typeof meta.scoreWeights.Issue === "number",
);
assert("meta rateLimit nullable", meta.rateLimit === null || typeof meta.rateLimit === "object");
assert("meta snapshots is array", Array.isArray(meta.snapshots));

// 3. Unknown route → 404 with backend message.
try {
    await request("/does-not-exist");
    assert("404 throws ApiError", false);
} catch (error) {
    assert("404 throws ApiError", error instanceof ApiError);
    assert("404 status preserved", error instanceof ApiError && error.status === 404);
    assert("404 message from body", error instanceof ApiError && error.message === "Not found");
}

// 4. Backend validation error → 400 with field issues.
//    (GET, not POST: the refresh route checks auth before validating input.)
try {
    await request("/leaderboard/bad org!");
    assert("400 throws ApiError", false);
} catch (error) {
    assert("400 throws ApiError", error instanceof ApiError);
    assert(
        "400 carries validation issues",
        error instanceof ApiError &&
            error.status === 400 &&
            error.issues.length > 0 &&
            typeof error.issues[0]?.path === "string",
    );
}

// 5. Refresh without token → 401 recognized by isAuthError.
try {
    await request("/leaderboard/facebook/refresh", { method: "POST" });
    assert("401 throws ApiError", false);
} catch (error) {
    assert("401 throws ApiError", error instanceof ApiError);
    assert("isAuthError detects 401", isAuthError(error));
    assert("401 status", error instanceof ApiError && error.status === 401);
}

// 6. Unreachable server → ApiError with status 0 (not a crash).
try {
    await request<unknown>("", { signal: AbortSignal.timeout(1) });
    assert("abort → ApiError 0", false);
} catch (error) {
    assert("abort → ApiError 0", error instanceof ApiError);
    assert("abort status is 0", error instanceof ApiError && error.status === 0);
}

console.log("\nPhase 1 gate done.");
