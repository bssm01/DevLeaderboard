import type { Period } from "./periods.js";

/** Weight applied to each metric when computing `score`. */
export interface ScoreWeights {
    Commit: number;
    PullRequest: number;
    Review: number;
    Issue: number;
}

/** One contributor as reported by GitHub, before filtering or ranking. */
export interface RawContributor {
    /** GitHub node ID — immutable across renames, unlike `login`. */
    key: string;
    login: string;
    avatarUrl: string;
    commits: number;
    pullRequests: number;
    reviews: number;
    issues: number;
}

export interface LeaderboardEntry extends RawContributor {
    score: number;
    rank: number;
}

export interface CollectResult {
    contributors: RawContributor[];
    warnings: string[];
}

export interface SnapshotContributor {
    key: string;
    login: string;
    avatarUrl: string;
    commits: number;
    pullRequests: number;
    reviews: number;
    issues: number;
    score: number;
    rank: number;
}

export interface SyncResult {
    orgLogin: string;
    period: Period;
    generatedAt: Date;
    entryCount: number;
    warnings: string[];
}
