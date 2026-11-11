import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ZodError } from "zod";
import { config } from "../config/config.js";
import { HttpError } from "../middleware/errorHandler.js";
import {
    findSnapshot,
    findSnapshotSummaries,
    type LeaderboardSnapshotAttrs,
} from "../models/leaderboardSnapshot.js";
import { GitHubError } from "../services/github/errors.js";
import { githubClient } from "../services/github/githubClient.js";
import { syncLeaderboard } from "../services/leaderboard/sync.js";
import type { SnapshotContributor, SyncResult } from "../services/leaderboard/types.js";

vi.mock("../models/leaderboardSnapshot.js", () => ({
    findSnapshot: vi.fn(),
    findSnapshotSummaries: vi.fn(),
}));

vi.mock("../services/leaderboard/sync.js", () => ({
    syncLeaderboard: vi.fn(),
}));

vi.mock("../services/github/githubClient.js", () => ({
    githubClient: { getRateLimit: vi.fn() },
}));

import { getLeaderboard, getLeaderboardMeta, refreshLeaderboard } from "./leaderboardCtrl.js";

const findSnapshotMock = findSnapshot as unknown as Mock;
const findSummariesMock = findSnapshotSummaries as unknown as Mock;
const syncMock = syncLeaderboard as unknown as Mock;
const rateLimitMock = githubClient.getRateLimit as unknown as Mock;

// ---------------------------------------------------------------------------
// Fakes: Express Response/Request stand-ins that record what the handler did.
// ---------------------------------------------------------------------------

interface FakeResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
    ended: boolean;
    status: (code: number) => FakeResponse;
    json: (payload: unknown) => FakeResponse;
    set: (field: string, value: string) => FakeResponse;
    setHeader: (field: string, value: string) => FakeResponse;
    end: () => FakeResponse;
}

const makeRes = (): FakeResponse => {
    const res: FakeResponse = {
        statusCode: 200,
        headers: {},
        body: undefined,
        ended: false,
        status(code) {
            res.statusCode = code;
            return res;
        },
        json(payload) {
            res.body = payload;
            return res;
        },
        set(field, value) {
            res.headers[field.toLowerCase()] = value;
            return res;
        },
        setHeader(field, value) {
            res.headers[field.toLowerCase()] = value;
            return res;
        },
        end() {
            res.ended = true;
            return res;
        },
    };
    return res;
};

const makeReq = (
    overrides: { params?: Record<string, string>; query?: Record<string, string>; fresh?: boolean } = {},
): Request =>
    ({
        params: overrides.params ?? { org: "acme" },
        query: overrides.query ?? {},
        headers: {},
        fresh: overrides.fresh ?? false,
    }) as unknown as Request;

const call = async (
    handler: (req: Request, res: Response) => Promise<void>,
    req: Request,
): Promise<{ res: FakeResponse; error?: unknown }> => {
    const res = makeRes();
    try {
        await handler(req, res as unknown as Response);
        return { res };
    } catch (error) {
        return { res, error };
    }
};

const expectHttpError = (error: unknown, status: number): HttpError => {
    expect(error).toBeInstanceOf(HttpError);
    const httpError = error as HttpError;
    expect(httpError.status).toBe(status);
    return httpError;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const contributor = (index: number): SnapshotContributor => ({
    key: `node-${index}`,
    login: `user${index}`,
    avatarUrl: `https://avatars.example/${index}.png`,
    commits: index,
    pullRequests: 1,
    reviews: 1,
    issues: 0,
    score: index * 5 + 13,
    rank: index + 1,
});

const snapshot = (
    overrides: Partial<LeaderboardSnapshotAttrs> = {},
): LeaderboardSnapshotAttrs => ({
    orgLogin: "acme",
    period: "30d",
    windowFrom: new Date("2026-10-12T00:00:00.000Z"),
    windowTo: new Date("2026-11-11T00:00:00.000Z"),
    generatedAt: new Date("2026-11-11T00:00:00.000Z"),
    contributors: [contributor(1), contributor(2)],
    warnings: ["Outside collaborators unavailable: 403"],
    ...overrides,
});

const syncResult = (period: "7d" | "30d" | "year", orgLogin = "acme"): SyncResult => ({
    orgLogin,
    period,
    generatedAt: new Date("2026-11-11T00:00:00.000Z"),
    entryCount: 12,
    warnings: [],
});

beforeEach(() => {
    findSnapshotMock.mockReset();
    findSummariesMock.mockReset();
    syncMock.mockReset();
    rateLimitMock.mockReset();
    rateLimitMock.mockReturnValue(undefined);
});

// ---------------------------------------------------------------------------
// GET /leaderboard/:org
// ---------------------------------------------------------------------------

describe("getLeaderboard", () => {
    it("answers 202 when no snapshot exists yet", async () => {
        findSnapshotMock.mockResolvedValue(null);

        const { res, error } = await call(getLeaderboard, makeReq());

        expect(error).toBeUndefined();
        expect(res.statusCode).toBe(202);
        expect(res.body).toMatchObject({ org: "acme", period: "30d" });
        expect((res.body as { message: string }).message).toContain("No snapshot yet");
        expect(findSnapshotMock).toHaveBeenCalledWith("acme", "30d");
    });

    it("returns the leaderboard with a default limit of 50", async () => {
        const many = Array.from({ length: 60 }, (_, index) => contributor(index));
        findSnapshotMock.mockResolvedValue(snapshot({ contributors: many }));

        const { res, error } = await call(getLeaderboard, makeReq());

        expect(error).toBeUndefined();
        expect(res.statusCode).toBe(200);

        const body = res.body as { entries: unknown[]; total: number; count: number; warnings: string[] };
        expect(body.total).toBe(60);
        expect(body.count).toBe(50);
        expect(body.entries).toHaveLength(50);
        expect(body.warnings).toHaveLength(1);
        expect(res.headers.etag).toBe(`W/"${new Date("2026-11-11T00:00:00.000Z").getTime()}-60-50"`);
    });

    it("honours ?limit and ?period", async () => {
        findSnapshotMock.mockResolvedValue(snapshot());

        const { res } = await call(
            getLeaderboard,
            makeReq({ query: { limit: "1", period: "7d" } }),
        );

        expect(findSnapshotMock).toHaveBeenCalledWith("acme", "7d");
        expect((res.body as { entries: unknown[] }).entries).toHaveLength(1);
        expect(res.body).toMatchObject({ total: 2, count: 1 });
    });

    it("tolerates differently-cased org logins in the URL", async () => {
        findSnapshotMock.mockResolvedValue(null);

        await call(getLeaderboard, makeReq({ params: { org: "AcmeCorp" } }));

        expect(findSnapshotMock).toHaveBeenCalledWith("AcmeCorp", "30d");
    });

    it("answers 304 when the client already has the current ETag", async () => {
        findSnapshotMock.mockResolvedValue(snapshot());

        const { res } = await call(getLeaderboard, makeReq({ fresh: true }));

        expect(res.statusCode).toBe(304);
        expect(res.ended).toBe(true);
        expect(res.body).toBeUndefined();
        expect(res.headers.etag).toBeDefined();
    });

    it.each<[string, Record<string, string>]>([
        ["a nonsense period", { period: "all" }],
        ["a zero limit", { limit: "0" }],
        ["a limit above the cap", { limit: "101" }],
        ["a non-numeric limit", { limit: "lots" }],
    ])("rejects %s with a 400-shaped ZodError", async (_label, query) => {
        const { error } = await call(getLeaderboard, makeReq({ query }));

        expect(error).toBeInstanceOf(ZodError);
        expect(findSnapshotMock).not.toHaveBeenCalled();
    });

    it.each<string>(["-leading", "trailing-", "has_underscore", "a".repeat(40)])(
        "rejects the invalid org login %s",
        async (org) => {
            const { error } = await call(getLeaderboard, makeReq({ params: { org } }));

            expect(error).toBeInstanceOf(ZodError);
            expect(findSnapshotMock).not.toHaveBeenCalled();
        },
    );
});

// ---------------------------------------------------------------------------
// GET /leaderboard/:org/meta
// ---------------------------------------------------------------------------

describe("getLeaderboardMeta", () => {
    it("reports scoring rules, quota and snapshot freshness", async () => {
        findSummariesMock.mockResolvedValue([
            { period: "7d", generatedAt: new Date("2026-11-11T00:00:00.000Z"), entryCount: 30 },
        ]);
        rateLimitMock.mockReturnValue({ limit: 5000, remaining: 4980 });

        const { res, error } = await call(getLeaderboardMeta, makeReq());

        expect(error).toBeUndefined();
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            org: "acme",
            scoreWeights: config.Score,
            rateLimit: { limit: 5000, remaining: 4980 },
            snapshots: [{ period: "7d", entryCount: 30 }],
        });
        expect(findSummariesMock).toHaveBeenCalledWith("acme");
    });

    it("reports a null rate limit before any GitHub call has happened", async () => {
        findSummariesMock.mockResolvedValue([]);

        const { res } = await call(getLeaderboardMeta, makeReq());

        expect((res.body as { rateLimit: unknown }).rateLimit).toBeNull();
    });

    it("rejects an invalid org login", async () => {
        const { error } = await call(getLeaderboardMeta, makeReq({ params: { org: "nope!" } }));

        expect(error).toBeInstanceOf(ZodError);
        expect(findSummariesMock).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// POST /leaderboard/:org/refresh
// ---------------------------------------------------------------------------

describe("refreshLeaderboard", () => {
    it("refreshes every period when none is requested", async () => {
        syncMock.mockImplementation(
            async (_org: string, period: "7d" | "30d" | "year") => syncResult(period),
        );

        const { res, error } = await call(refreshLeaderboard, makeReq());

        expect(error).toBeUndefined();
        expect(res.statusCode).toBe(200);
        expect(syncMock.mock.calls.map(([, period]) => period)).toEqual(["7d", "30d", "year"]);
        expect((res.body as { results: SyncResult[] }).results.map((r) => r.period)).toEqual([
            "7d",
            "30d",
            "year",
        ]);
        expect(res.body).toMatchObject({ org: "acme" });
    });

    it("refreshes only the requested period", async () => {
        syncMock.mockResolvedValue(syncResult("7d"));

        const { res } = await call(
            refreshLeaderboard,
            makeReq({ query: { period: "7d" } }),
        );

        expect(syncMock).toHaveBeenCalledTimes(1);
        expect(syncMock).toHaveBeenCalledWith("acme", "7d");
        expect((res.body as { results: unknown[] }).results).toHaveLength(1);
    });

    it("maps an unknown organization to 404", async () => {
        syncMock.mockRejectedValue(new GitHubError("Organization not found: nope", 404));

        const { error } = await call(refreshLeaderboard, makeReq());

        expect(expectHttpError(error, 404).message).toContain("not found on GitHub");
        expect(syncMock).toHaveBeenCalledTimes(1);
    });

    it("maps an exhausted rate limit to 503 with Retry-After", async () => {
        const resetAt = new Date(Date.now() + 90_000);
        syncMock.mockRejectedValue(
            new GitHubError("API rate limit exceeded", 429, { remaining: 0, resetAt }),
        );

        const { res, error } = await call(refreshLeaderboard, makeReq());

        expect(expectHttpError(error, 503).message).toContain("rate limit");
        expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(89);
        expect(Number(res.headers["retry-after"])).toBeLessThanOrEqual(91);
    });

    it("treats a 403 with no quota left as rate limiting, not bad credentials", async () => {
        syncMock.mockRejectedValue(
            new GitHubError("API rate limit exceeded", 403, { remaining: 0 }),
        );

        const { error } = await call(refreshLeaderboard, makeReq());

        expect(expectHttpError(error, 503).status).toBe(503);
    });

    it("maps rejected credentials to 502", async () => {
        syncMock.mockRejectedValue(new GitHubError("Bad credentials", 401));

        const { error } = await call(refreshLeaderboard, makeReq());

        expect(expectHttpError(error, 502).message).toContain("credentials");
    });

    it("maps a permission 403 to 502 rather than 503", async () => {
        syncMock.mockRejectedValue(
            new GitHubError("Resource not accessible by integration", 403, { remaining: 4000 }),
        );

        const { error } = await call(refreshLeaderboard, makeReq());

        expect(expectHttpError(error, 502).message).toContain("credentials");
    });

    it("maps a network failure (status 0) to 502", async () => {
        syncMock.mockRejectedValue(new GitHubError("Network error contacting GitHub: timeout", 0));

        const { error } = await call(refreshLeaderboard, makeReq());

        expect(expectHttpError(error, 502).message).toContain("unavailable");
    });

    it("maps a GitHub 5xx to 502", async () => {
        syncMock.mockRejectedValue(new GitHubError("GitHub API error 502: Bad Gateway", 502));

        const { error } = await call(refreshLeaderboard, makeReq());

        expect(expectHttpError(error, 502).status).toBe(502);
    });

    it("does not set Retry-After when GitHub gave no reset time", async () => {
        syncMock.mockRejectedValue(new GitHubError("API rate limit exceeded", 429));

        const { res, error } = await call(refreshLeaderboard, makeReq());

        expect(expectHttpError(error, 503).status).toBe(503);
        expect(res.headers["retry-after"]).toBeUndefined();
    });

    it("stops at the first failing period of an all-periods refresh", async () => {
        syncMock
            .mockResolvedValueOnce(syncResult("7d"))
            .mockRejectedValueOnce(new GitHubError("boom", 500));

        const { error } = await call(refreshLeaderboard, makeReq());

        expect(expectHttpError(error, 502).status).toBe(502);
        expect(syncMock).toHaveBeenCalledTimes(2);
    });

    it("propagates unexpected errors untouched for the 500 handler", async () => {
        const failure = new Error("database exploded");
        syncMock.mockRejectedValue(failure);

        const { error } = await call(refreshLeaderboard, makeReq());

        expect(error).toBe(failure);
    });

    it("rejects an invalid period without calling GitHub", async () => {
        const { error } = await call(refreshLeaderboard, makeReq({ query: { period: "forever" } }));

        expect(error).toBeInstanceOf(ZodError);
        expect(syncMock).not.toHaveBeenCalled();
    });
});
