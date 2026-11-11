import type { LeaderboardEntry, RawContributor, ScoreWeights } from "./types.js";

/**
 * Known automation accounts. `*[bot]` and `*-bot` logins are caught by the
 * suffix rules below; this list is for services that post as regular users.
 */
export const BOT_DENYLIST: ReadonlySet<string> = new Set([
    "dependabot",
    "renovate",
    "github-actions",
    "codecov",
    "coveralls",
    "sonarcloud",
    "imgbot",
    "allcontributors",
]);

export const isBotLogin = (login: string): boolean => {
    const normalized = login.toLowerCase();
    return (
        normalized.endsWith("[bot]") ||
        normalized.endsWith("-bot") ||
        BOT_DENYLIST.has(normalized)
    );
};

/** Counts arrive from JSON: floor them, floor at zero, treat NaN as zero. */
const asCount = (value: number): number =>
    Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export const scoreOf = (
    totals: Pick<RawContributor, "commits" | "pullRequests" | "reviews" | "issues">,
    weights: ScoreWeights,
): number =>
    totals.commits * weights.Commit +
    totals.pullRequests * weights.PullRequest +
    totals.reviews * weights.Review +
    totals.issues * weights.Issue;

/**
 * Deterministic ordering: score desc, then commits desc, then login asc.
 * The login comparison is deliberately locale-independent so the same input
 * always produces the same leaderboard on every machine.
 */
const compareEntries = (a: LeaderboardEntry, b: LeaderboardEntry): number => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.commits !== b.commits) return b.commits - a.commits;

    const left = a.login.toLowerCase();
    const right = b.login.toLowerCase();
    if (left === right) return 0;
    return left < right ? -1 : 1;
};

/**
 * Filters bots, merges duplicate keys, scores, sorts and assigns ranks.
 * Pure: same input always yields the same leaderboard.
 */
export const aggregate = (contributors: RawContributor[], weights: ScoreWeights): LeaderboardEntry[] => {
    const merged = new Map<string, RawContributor>();

    for (const contributor of contributors) {
        if (contributor.key.length === 0 || contributor.login.length === 0) continue;
        if (isBotLogin(contributor.login)) continue;

        const normalized: RawContributor = {
            ...contributor,
            commits: asCount(contributor.commits),
            pullRequests: asCount(contributor.pullRequests),
            reviews: asCount(contributor.reviews),
            issues: asCount(contributor.issues),
        };

        const existing = merged.get(normalized.key);
        if (existing === undefined) {
            merged.set(normalized.key, normalized);
            continue;
        }

        // Same account seen twice (e.g. member + outside collaborator).
        existing.commits += normalized.commits;
        existing.pullRequests += normalized.pullRequests;
        existing.reviews += normalized.reviews;
        existing.issues += normalized.issues;
        // Keep the fresher display fields.
        existing.login = normalized.login;
        existing.avatarUrl = normalized.avatarUrl;
    }

    const entries: LeaderboardEntry[] = [];
    for (const contributor of merged.values()) {
        entries.push({
            ...contributor,
            score: scoreOf(contributor, weights),
            rank: 0,
        });
    }

    entries.sort(compareEntries);
    return entries.map((entry, index) => ({ ...entry, rank: index + 1 }));
};
