import { config } from "../../config/config.js";
import { upsertSnapshot, type SnapshotInput } from "../../models/leaderboardSnapshot.js";
import { aggregate } from "./aggregator.js";
import { collectContributions } from "./collector.js";
import { windowFor, type Period, type TimeWindow } from "./periods.js";
import type { CollectResult, SyncResult } from "./types.js";

export interface SyncOptions {
    /** Injection points for tests; production uses the real collector and store. */
    collect?: (orgLogin: string, window: TimeWindow) => Promise<CollectResult>;
    save?: (snapshot: SnapshotInput) => Promise<void>;
    now?: Date;
}

// One refresh per org+period at a time; concurrent callers await the same run.
const inFlight = new Map<string, Promise<SyncResult>>();

const runSync = async (orgLogin: string, period: Period, options: SyncOptions): Promise<SyncResult> => {
    const now = options.now ?? new Date();
    const collect = options.collect ?? ((org, window) => collectContributions(org, window));
    const save = options.save ?? upsertSnapshot;

    const window = windowFor(period, now);
    const { contributors, warnings } = await collect(orgLogin, window);
    const entries = aggregate(contributors, config.Score);

    const snapshot: SnapshotInput = {
        orgLogin: orgLogin.toLowerCase(),
        period,
        windowFrom: window.from,
        windowTo: window.to,
        generatedAt: now,
        contributors: entries.map((entry) => ({
            key: entry.key,
            login: entry.login,
            avatarUrl: entry.avatarUrl,
            commits: entry.commits,
            pullRequests: entry.pullRequests,
            reviews: entry.reviews,
            issues: entry.issues,
            score: entry.score,
            rank: entry.rank,
        })),
        warnings,
    };

    await save(snapshot);

    return {
        orgLogin: snapshot.orgLogin,
        period,
        generatedAt: now,
        entryCount: entries.length,
        warnings,
    };
};

export const syncLeaderboard = async (
    orgLogin: string,
    period: Period,
    options: SyncOptions = {},
): Promise<SyncResult> => {
    const key = `${orgLogin.toLowerCase()}:${period}`;

    const existing = inFlight.get(key);
    if (existing !== undefined) return existing;

    const task = runSync(orgLogin, period, options).finally(() => {
        inFlight.delete(key);
    });

    inFlight.set(key, task);
    return task;
};
