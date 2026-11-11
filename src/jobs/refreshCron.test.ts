import type { TaskFn, TaskOptions } from "node-cron";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Period } from "../services/leaderboard/periods.js";
import { syncLeaderboard } from "../services/leaderboard/sync.js";
import type { SyncResult } from "../services/leaderboard/types.js";

const harness = vi.hoisted(() => ({
    leaderboard: { Schedule: "0 */6 * * *", Orgs: ["acme"] as string[] },
    tasks: [] as Array<{
        expression: string;
        fn: TaskFn;
        options: TaskOptions | undefined;
        stopped: boolean;
        stop: () => void;
    }>,
}));

vi.mock("node-cron", () => ({
    validate: vi.fn(),
    schedule: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
    config: {
        Leaderboard: harness.leaderboard,
        // The logger reads its level from config at import time.
        Log: { Level: "warn" },
    },
}));

vi.mock("../services/leaderboard/sync.js", () => ({
    syncLeaderboard: vi.fn(),
}));

import { schedule, validate } from "node-cron";
import { refreshOrg, startRefreshCron, stopRefreshCron } from "./refreshCron.js";

const scheduleMock = schedule as unknown as Mock;
const validateMock = validate as unknown as Mock;
const syncMock = syncLeaderboard as unknown as Mock;

const resultFor = (orgLogin: string, period: Period): SyncResult => ({
    orgLogin,
    period,
    generatedAt: new Date("2026-11-11T00:00:00.000Z"),
    entryCount: 7,
    warnings: [],
});

/** Runs the callback the scheduler registered, and awaits its completion. */
const fireScheduled = async (): Promise<void> => {
    const registered = harness.tasks.at(-1);
    expect(registered).toBeDefined();
    await registered?.fn({} as Parameters<TaskFn>[0]);
};

beforeEach(() => {
    harness.tasks.length = 0;
    harness.leaderboard.Schedule = "0 */6 * * *";
    harness.leaderboard.Orgs = ["acme", "beta"];

    validateMock.mockReturnValue(true);
    scheduleMock.mockImplementation((expression: string, fn: TaskFn, options?: TaskOptions) => {
        const task = {
            expression,
            fn,
            options,
            stopped: false,
            stop: () => {
                task.stopped = true;
            },
        };
        harness.tasks.push(task);
        return task;
    });
    syncMock.mockImplementation(
        async (orgLogin: string, period: Period) => resultFor(orgLogin, period),
    );

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("startRefreshCron", () => {
    it("schedules the configured expression with overlap protection and unref", () => {
        startRefreshCron();

        expect(scheduleMock).toHaveBeenCalledTimes(1);
        const [expression, , options] = scheduleMock.mock.calls[0] as [string, TaskFn, TaskOptions];
        expect(expression).toBe("0 */6 * * *");
        expect(options).toEqual({ noOverlap: true, unref: true });
    });

    it("refreshes every period of every org sequentially when it fires", async () => {
        startRefreshCron();

        await fireScheduled();

        expect(syncMock.mock.calls).toEqual([
            ["acme", "7d"],
            ["acme", "30d"],
            ["acme", "year"],
            ["beta", "7d"],
            ["beta", "30d"],
            ["beta", "year"],
        ]);
    });

    it("disables itself when no orgs are configured", () => {
        harness.leaderboard.Orgs = [];

        startRefreshCron();

        expect(scheduleMock).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("LEADERBOARD_ORGS"));
    });

    it("refuses to start with an invalid cron expression", () => {
        validateMock.mockReturnValue(false);

        expect(() => startRefreshCron()).toThrow("Invalid LEADERBOARD_CRON");
        expect(scheduleMock).not.toHaveBeenCalled();
    });

    it("stops any previously scheduled task before starting a new one", () => {
        startRefreshCron();
        const first = harness.tasks[0];

        startRefreshCron();

        expect(first.stopped).toBe(true);
        expect(harness.tasks).toHaveLength(2);
    });
});

describe("stopRefreshCron", () => {
    it("stops the running task and is safe to call repeatedly", () => {
        startRefreshCron();

        stopRefreshCron();

        expect(harness.tasks[0].stopped).toBe(true);
        expect(() => stopRefreshCron()).not.toThrow();
    });

    it("is a no-op when nothing was ever scheduled", () => {
        expect(() => stopRefreshCron()).not.toThrow();
    });
});

describe("refreshOrg", () => {
    it("reports one outcome per period", async () => {
        const outcomes = await refreshOrg("acme");

        expect(outcomes).toEqual([
            { orgLogin: "acme", period: "7d", ok: true, entryCount: 7 },
            { orgLogin: "acme", period: "30d", ok: true, entryCount: 7 },
            { orgLogin: "acme", period: "year", ok: true, entryCount: 7 },
        ]);
    });

    it("keeps going when one period fails", async () => {
        syncMock.mockImplementation(async (orgLogin: string, period: Period) => {
            if (period === "7d") throw new Error("GitHub down");
            return resultFor(orgLogin, period);
        });

        const outcomes = await refreshOrg("Acme");

        expect(outcomes).toHaveLength(3);
        expect(outcomes[0]).toMatchObject({ period: "7d", ok: false, error: "GitHub down" });
        expect(outcomes[1]).toMatchObject({ period: "30d", ok: true });
        expect(outcomes[2]).toMatchObject({ period: "year", ok: true });
        expect(syncMock).toHaveBeenCalledTimes(3);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Acme/7d"));
    });

    it("records a thrown non-Error as text", async () => {
        syncMock.mockRejectedValue("everything is broken");

        const outcomes = await refreshOrg("acme");

        expect(outcomes[0]).toMatchObject({ ok: false, error: "everything is broken" });
        expect(outcomes.every((outcome) => outcome.ok === false)).toBe(true);
    });

    it("logs collection warnings without failing the run", async () => {
        syncMock.mockResolvedValue({
            ...resultFor("acme", "7d"),
            warnings: ["Outside collaborators unavailable: 403"],
        });

        const outcomes = await refreshOrg("acme");

        expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining("Outside collaborators unavailable"),
        );
    });

    it("does not let one org's failure stop the next org", async () => {
        syncMock.mockImplementation(async (orgLogin: string, period: Period) => {
            if (orgLogin === "acme") throw new Error("org is broken");
            return resultFor(orgLogin, period);
        });

        startRefreshCron();
        await fireScheduled();

        expect(syncMock.mock.calls.filter(([org]) => org === "beta")).toHaveLength(3);
        expect(syncMock).toHaveBeenCalledTimes(6);
    });
});
