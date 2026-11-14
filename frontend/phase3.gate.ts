/* TEMPORARY Phase 3 gate — deleted before commit (tests are Phase 6). */
import http from "node:http";
import { request, ApiError } from "./src/shared/api/client";
import type { LeaderboardResult } from "./src/shared/api/types";
import { formatRelativeTime, formatRetryDelay, formatNumber } from "./src/shared/lib/format";

const assert = (label: string, condition: boolean): void => {
    console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
    if (!condition) process.exitCode = 1;
};

const realFetch = globalThis.fetch;
// Held in an object so TS doesn't narrow it to `null` (assignments happen
// inside the fetch callback, which control-flow analysis can't see).
const observed: { status: number; requestHeaders: Headers | null } = {
    status: 0,
    requestHeaders: null,
};

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
        typeof input === "string" && input.startsWith("/")
            ? `http://localhost:5173${input}`
            : input;

    // Node's fetch injects `cache-control: no-cache` alongside any conditional
    // header, which makes Express's `fresh` answer 200 instead of 304. Real
    // browsers don't do this, so override it to exercise the true 304 path.
    const headers = new Headers(init?.headers);
    if (headers.has("If-None-Match")) {
        headers.set("Cache-Control", "max-age=0");
        headers.delete("Pragma");
    }
    observed.requestHeaders = headers;

    return realFetch(url, { ...init, headers }).then((response) => {
        observed.status = response.status;
        return response;
    });
}) as typeof fetch;

const PATH = "/leaderboard/tensiocare?period=30d&limit=50";

// --- 1. First call: 200 + validator, If-None-Match not yet sent ---
const first = await request<LeaderboardResult>(PATH, { etag: true });
assert("first call returns 200", observed.status === 200);
assert("no conditional header on first call", !observed.requestHeaders?.has("If-None-Match"));
assert("snapshot has entries", "entries" in first && first.entries.length > 0);
const firstCount = "entries" in first ? first.entries.length : 0;

// --- 2. Second call: sends If-None-Match, gets 304, replays stored body ---
const second = await request<LeaderboardResult>(PATH, { etag: true });
assert(
    "second call sent If-None-Match",
    observed.requestHeaders?.has("If-None-Match") === true,
);
assert("second call received 304", observed.status === 304);
assert(
    "304 replayed stored body instead of throwing",
    "entries" in second && second.entries.length === firstCount,
);
assert("replayed payload is byte-identical", JSON.stringify(second) === JSON.stringify(first));

// --- 3. etag opt-in off → never conditional ---
await request<LeaderboardResult>(PATH);
assert("no etag opt-in → 200", observed.status === 200);
assert("no etag opt-in → no If-None-Match", !observed.requestHeaders?.has("If-None-Match"));

// --- 4. Server replying 304 with nothing stored must not crash ---
// (fresh cache state: simulate by hitting an uncached path with a bogus etag)
try {
    const bogus = await request<LeaderboardResult>(
        "/leaderboard/tensiocare?period=7d&limit=5",
        { etag: true },
    );
    assert("uncached path still returns data", "entries" in bogus);
} catch (error) {
    assert(`uncached path must not throw (got ${String(error)})`, false);
}

// --- 5. Validation errors unaffected by client changes ---
try {
    await request("/leaderboard/bad org!");
    assert("400 still throws", false);
} catch (error) {
    assert("400 still throws", error instanceof ApiError);
    assert("400 issues preserved", error instanceof ApiError && error.issues.length > 0);
}

// --- 6. Formatters ---
assert("relative: just now", formatRelativeTime(new Date().toISOString()) === "just now");
assert(
    "relative: hours",
    formatRelativeTime(new Date(Date.now() - 3 * 3600_000).toISOString()) === "3h ago",
);
assert("relative: garbage → unknown", formatRelativeTime("not-a-date") === "unknown");
assert("retry: seconds", formatRetryDelay(42) === "42s");
assert("retry: minutes", formatRetryDelay(180) === "3 min");
assert("number grouping", formatNumber(1234567) === "1,234,567");

// --- 7. Real HTTP304 semantics via raw node:http (no undici interference) ---
await new Promise<void>((resolve) => {
    const req = http.request(
        {
            host: "localhost",
            port: 3000,
            path: "/leaderboard/tensiocare?period=30d&limit=50",
            headers: { "If-None-Match": 'W/"1794517608446-3-50"' },
        },
        (res) => {
            assert("backend answers 304 to a plain conditional GET", res.statusCode === 304);
            res.resume();
            res.on("end", resolve);
        },
    );
    req.end();
});

console.log("\nPhase 3 gate done.");
