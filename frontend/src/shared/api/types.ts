/**
 * DTOs mirroring the backend's JSON responses.
 *
 * These are hand-written on purpose: the API is small and stable, and
 * generated clients add a build step without catching more than these do.
 * Every field here has been verified against a live backend response.
 */

export type Period = "7d" | "30d" | "year";

export const PERIODS: readonly Period[] = ["7d", "30d", "year"] as const;

/** One ranked contributor as stored in a snapshot. */
export interface LeaderboardEntry {
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

/** 200 response of GET /leaderboard/:org — served from Mongo, never GitHub. */
export interface LeaderboardSnapshot {
    org: string;
    period: Period;
    generatedAt: string;
    windowFrom: string;
    windowTo: string;
    total: number;
    count: number;
    warnings: string[];
    entries: LeaderboardEntry[];
}

/** 202 response — the schedule has not produced a snapshot yet. */
export interface NoSnapshotYet {
    org: string;
    period: Period;
    message: string;
}

export type LeaderboardResult = LeaderboardSnapshot | NoSnapshotYet;

/** Narrow helper: a 202 payload has no entries, a 200 payload does. */
export const hasSnapshot = (result: LeaderboardResult): result is LeaderboardSnapshot =>
    "entries" in result;

export interface ScoreWeights {
    Commit: number;
    PullRequest: number;
    Review: number;
    Issue: number;
}

export interface RateLimitInfo {
    limit?: number;
    remaining?: number;
    cost?: number;
    resource?: string;
    resetAt?: string;
}

export interface SnapshotSummary {
    period: Period;
    generatedAt: string;
    entryCount: number;
}

/** GET /leaderboard/:org/meta */
export interface LeaderboardMeta {
    org: string;
    scoreWeights: ScoreWeights;
    rateLimit: RateLimitInfo | null;
    snapshots: SnapshotSummary[];
}

/** One period's outcome from a refresh run. */
export interface SyncResult {
    orgLogin: string;
    period: Period;
    generatedAt: string;
    entryCount: number;
    warnings: string[];
}

/** POST /leaderboard/:org/refresh */
export interface RefreshResponse {
    org: string;
    results: SyncResult[];
}

export interface PublicUser {
    id: string;
    name: string;
    email: string;
    image: string;
}

/** POST /auth/register and POST /auth/login */
export interface AuthResponse {
    message: string;
    user: PublicUser;
    token: string;
}

/** Field-level validation issue attached to a 400. */
export interface ValidationIssue {
    path: string;
    message: string;
}

/** The only error shape the backend emits: { error, details? }. */
export interface ErrorBody {
    error: string;
    details?: ValidationIssue[];
}
