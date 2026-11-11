import { describe, expect, it, vi } from "vitest";
import type { SnapshotInput } from "../../models/leaderboardSnapshot.js";
import { syncLeaderboard } from "./sync.js";
import type { TimeWindow } from "./periods.js";
import type { CollectResult } from "./types.js";

const NOW = new Date("2026-11-11T12:00:00.000Z");

const collectResult = (overrides: Partial<CollectResult> = {}): CollectResult => ({
    contributors: [
        { key: "n1", login: "bassem", avatarUrl: "a.png", commits: 2, pullRequests: 1, reviews: 3, issues: 0 },
        { key: "n2", login: "other", avatarUrl: "b.png", commits: 100, pullRequests: 0, reviews: 0, issues: 0 },
    ],
    warnings: [],
    ...overrides,
});

const makeCollect = (result: CollectResult = collectResult()) =>
    vi.fn<(orgLogin: string, window: TimeWindow) => Promise<CollectResult>>(async () => result);

const makeSave = () => vi.fn<(snapshot: SnapshotInput) => Promise<void>>(async () => undefined);

describe("syncLeaderboard", () => {
    it("collects, scores, ranks and saves a lowercased snapshot", async () => {
        const collect = makeCollect();
        const save = makeSave();

        const result = await syncLeaderboard("AcmeCorp", "30d", { collect, save, now: NOW });

        expect(collect).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledTimes(1);

        const snapshot = save.mock.calls[0][0];
        expect(snapshot.orgLogin).toBe("acmecorp");
        expect(snapshot.period).toBe("30d");
        expect(snapshot.generatedAt).toBe(NOW);
        expect(snapshot.windowFrom.getTime()).toBeLessThan(snapshot.windowTo.getTime());

        // Default weights (5/10/3/2): other = 100*5, bassem = 2*5+1*10+3*3
        expect(snapshot.contributors.map((c) => [c.login, c.rank, c.score])).toEqual([
            ["other", 1, 500],
            ["bassem", 2, 29],
        ]);

        expect(result).toEqual({
            orgLogin: "acmecorp",
            period: "30d",
            generatedAt: NOW,
            entryCount: 2,
            warnings: [],
        });
    });

    it("passes the computed window to the collector", async () => {
        const collect = makeCollect();
        await syncLeaderboard("acme", "7d", { collect, save: makeSave(), now: NOW });

        const window = collect.mock.calls[0][1];
        expect(window.to.toISOString()).toBe(NOW.toISOString());
        expect(window.to.getTime() - window.from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it("runs only one refresh per org+period even when called concurrently", async () => {
        let release!: (value: CollectResult) => void;
        const collect = vi.fn<(orgLogin: string, window: TimeWindow) => Promise<CollectResult>>(
            () => new Promise((resolve) => { release = resolve; }),
        );
        const save = makeSave();

        // Different casings must still map to the same flight.
        const first = syncLeaderboard("Acme", "30d", { collect, save, now: NOW });
        const second = syncLeaderboard("acme", "30d", { collect, save, now: NOW });

        release(collectResult());

        const [a, b] = await Promise.all([first, second]);

        expect(collect).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledTimes(1);
        expect(a).toEqual(b);
    });

    it("allows different periods to refresh independently", async () => {
        const collect = makeCollect();
        const save = makeSave();

        await Promise.all([
            syncLeaderboard("acme", "7d", { collect, save, now: NOW }),
            syncLeaderboard("acme", "30d", { collect, save, now: NOW }),
        ]);

        expect(collect).toHaveBeenCalledTimes(2);
        expect(save).toHaveBeenCalledTimes(2);
    });

    it("releases the flight lock after a failure so a retry can run", async () => {
        const collect = vi
            .fn<(orgLogin: string, window: TimeWindow) => Promise<CollectResult>>()
            .mockRejectedValueOnce(new Error("GitHub exploded"))
            .mockResolvedValueOnce(collectResult());
        const save = makeSave();

        await expect(syncLeaderboard("acme", "30d", { collect, save, now: NOW })).rejects.toThrow("GitHub exploded");
        expect(save).not.toHaveBeenCalled();

        const retry = await syncLeaderboard("acme", "30d", { collect, save, now: NOW });
        expect(retry.entryCount).toBe(2);
    });

    it("does not save when collection fails", async () => {
        const collect = vi
            .fn<(orgLogin: string, window: TimeWindow) => Promise<CollectResult>>()
            .mockRejectedValue(new Error("boom"));
        const save = makeSave();

        await expect(syncLeaderboard("acme", "30d", { collect, save, now: NOW })).rejects.toThrow("boom");
        expect(save).not.toHaveBeenCalled();
    });

    it("propagates warnings into the snapshot and result", async () => {
        const collect = makeCollect(collectResult({ warnings: ["Outside collaborators unavailable"] }));
        const save = makeSave();

        const result = await syncLeaderboard("acme", "year", { collect, save, now: NOW });

        expect(save.mock.calls[0][0].warnings).toEqual(["Outside collaborators unavailable"]);
        expect(result.warnings).toEqual(["Outside collaborators unavailable"]);
    });

    it("saves an empty snapshot when there is nothing to rank", async () => {
        const collect = makeCollect(collectResult({ contributors: [] }));
        const save = makeSave();

        const result = await syncLeaderboard("acme", "30d", { collect, save, now: NOW });

        expect(save.mock.calls[0][0].contributors).toEqual([]);
        expect(result.entryCount).toBe(0);
    });
});
